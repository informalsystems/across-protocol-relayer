import { gasPriceOracle, typeguards, utils as sdkUtils } from "@across-protocol/sdk";
import { FeeData } from "@ethersproject/abstract-provider";
import dotenv from "dotenv";
import { AugmentedTransaction } from "../clients";
import { DEFAULT_GAS_FEE_SCALERS } from "../common";
import { EthersError } from "../interfaces";
import {
  BigNumber,
  bnZero,
  Contract,
  isDefined,
  TransactionResponse,
  ethers,
  getContractInfoFromAddress,
  Signer,
  toBNWei,
  winston,
  stringifyThrownValue,
  CHAIN_IDs,
  EvmGasPriceEstimate,
  SVMProvider,
  parseUnits,
  shouldUseFlashbots,
  getFlashbotsProvider,
  getFlashbotsMaxBlockNumber,
  logFlashbotsSubmission,
} from "../utils";
import {
  CompilableTransactionMessage,
  KeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransactionMessageWithSigners,
  type Blockhash,
} from "@solana/kit";

dotenv.config();

// Define chains that require legacy (type 0) transactions
// Can be configured via LEGACY_TRANSACTION_CHAINS environment variable (comma-separated chain IDs)
const DEFAULT_LEGACY_CHAINS = [CHAIN_IDs.BSC];
const ENV_LEGACY_CHAINS = process.env.LEGACY_TRANSACTION_CHAINS;
const ENV_LEGACY_CHAINS_PARSED: number[] = ENV_LEGACY_CHAINS ? JSON.parse(ENV_LEGACY_CHAINS) : [];
export const LEGACY_TRANSACTION_CHAINS = [...DEFAULT_LEGACY_CHAINS, ...ENV_LEGACY_CHAINS_PARSED];

export type TransactionSimulationResult = {
  transaction: AugmentedTransaction;
  succeed: boolean;
  reason?: string;
  data?: any;
};

export type LatestBlockhash = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

const { isError, isEthersError } = typeguards;

export type Multicall2Call = {
  callData: ethers.utils.BytesLike;
  target: string;
};

const nonceReset: { [chainId: number]: boolean } = {};

const txnRetryErrors = new Set(["INSUFFICIENT_FUNDS", "NONCE_EXPIRED", "REPLACEMENT_UNDERPRICED"]);
const expectedRpcErrorMessages = new Set(["nonce has already been used", "intrinsic gas too low"]);
const txnRetryable = (error?: unknown): boolean => {
  if (isEthersError(error)) {
    return txnRetryErrors.has(error.code);
  }

  return expectedRpcErrorMessages.has((error as Error)?.message);
};

const isFillRelayError = (error: unknown): boolean => {
  const fillRelaySelector = "0xdeff4b24"; // keccak256("fillRelay()")[:4]
  const multicallSelector = "0xac9650d8"; // keccak256("multicall()")[:4]

  const errorStack = (error as Error).stack;
  const isFillRelayError = errorStack?.includes(fillRelaySelector);
  const isMulticallError = errorStack?.includes(multicallSelector);
  const isFillRelayInMulticallError = isMulticallError && errorStack?.includes(fillRelaySelector);

  return isFillRelayError && isFillRelayInMulticallError;
};

export function getNetworkError(err: unknown): string {
  return isEthersError(err) ? err.reason : isError(err) ? err.message : "unknown error";
}

export async function getMultisender(chainId: number, baseSigner: Signer): Promise<Contract | undefined> {
  return sdkUtils.getMulticall3(chainId, baseSigner);
}

// Note that this function will throw if the call to the contract on method for given args reverts. Implementers
// of this method should be considerate of this and catch the response to deal with the error accordingly.
// @dev: If the method value is an empty string (e.g. ""), then this function
// will submit a raw transaction to the contract address.
export async function runTransaction(
  logger: winston.Logger,
  contract: Contract,
  method: string,
  args: unknown,
  value = bnZero,
  gasLimit: BigNumber | null = null,
  nonce: number | null = null,
  retriesRemaining = 1,
  depositId?: BigNumber,
  maxGasUsd?: BigNumber,
  gasTokenPriceUsd?: BigNumber
): Promise<TransactionResponse> {
  const { provider } = contract;
  const { chainId } = await provider.getNetwork();

  if (!nonceReset[chainId]) {
    nonce = await provider.getTransactionCount(await contract.signer.getAddress());
    nonceReset[chainId] = true;
  }

  const sendRawTransaction = method === "";

  try {
    const priorityFeeScaler =
      Number(process.env[`PRIORITY_FEE_SCALER_${chainId}`] || process.env.PRIORITY_FEE_SCALER) ||
      DEFAULT_GAS_FEE_SCALERS[chainId]?.maxPriorityFeePerGasScaler;
    const maxFeePerGasScaler =
      Number(process.env[`MAX_FEE_PER_GAS_SCALER_${chainId}`] || process.env.MAX_FEE_PER_GAS_SCALER) ||
      DEFAULT_GAS_FEE_SCALERS[chainId]?.maxFeePerGasScaler;

    let gas = await getGasPrice(
      provider,
      priorityFeeScaler,
      maxFeePerGasScaler,
      sendRawTransaction
        ? undefined
        : await contract.populateTransaction[method](...(args as Array<unknown>), { value }),
      logger,
      method,
      depositId,
      maxGasUsd, // pre-calculated leftover USD for gas
      gasTokenPriceUsd,
      gasLimit
    );

    const flooredPriorityFeePerGas = parseUnits(process.env[`MIN_PRIORITY_FEE_PER_GAS_${chainId}`] || "0", 9);

    // Check if the chain requires legacy transactions
    if (LEGACY_TRANSACTION_CHAINS.includes(chainId)) {
      // For legacy chains ensure only gasPrice is present
      gas = { gasPrice: gas.gasPrice || gas.maxFeePerGas };
    } else {
      // If the priority fee was overridden by the min/floor value, the base fee must be scaled up as well.
      const maxPriorityFeePerGas = sdkUtils.bnMax(gas.maxPriorityFeePerGas, flooredPriorityFeePerGas);
      const baseFeeDelta = maxPriorityFeePerGas.sub(gas.maxPriorityFeePerGas);
      gas = {
        maxFeePerGas: gas.maxFeePerGas.add(baseFeeDelta),
        maxPriorityFeePerGas,
      };
    }

    logger.debug({
      at: "TxUtil",
      message: "Send tx",
      target: getTarget(contract.address),
      method,
      args,
      value,
      nonce,
      gas,
      flooredPriorityFeePerGas,
      gasLimit,
      priorityFeeScaler,
      maxFeePerGasScaler,
      legacyTx: LEGACY_TRANSACTION_CHAINS.includes(chainId),
      sendRawTxn: sendRawTransaction,
    });
    // TX config has gas (from gasPrice function), value (how much eth to send) and an optional gasLimit. The reduce
    // operation below deletes any null/undefined elements from this object. If gasLimit or nonce are not specified,
    // ethers will determine the correct values to use.
    const txConfig: any = Object.entries({ ...gas, value, nonce, gasLimit }).reduce(
      (a, [k, v]) => (v ? ((a[k] = v), a) : a),
      {}
    );

    // For legacy chains, explicitly set transaction type to 0
    if (LEGACY_TRANSACTION_CHAINS.includes(chainId)) {
      txConfig.type = 0; // Legacy transaction type
    }

    // Check if we should use Flashbots for this transaction
    const useFlashbots = shouldUseFlashbots(chainId, method);

    if (useFlashbots) {
      // Flashbots path: Get unsigned transaction and send via Flashbots relay
      logFlashbotsSubmission(logger, method, chainId);

      let unsignedTx: ethers.providers.TransactionRequest;

      if (sendRawTransaction) {
        // For raw transactions, use the config directly
        unsignedTx = LEGACY_TRANSACTION_CHAINS.includes(chainId)
          ? { to: contract.address, value, ...gas, type: 0 }
          : { to: contract.address, value, ...gas };
      } else {
        // For contract method calls, use populateTransaction to get the unsigned tx
        const populatedTx = await contract.populateTransaction[method](...(args as Array<unknown>), txConfig);

        // Helper to convert BigNumber to hex string
        const toHexString = (value: any): string | undefined => {
          if (!value) return undefined;
          if (BigNumber.isBigNumber(value)) return value.toHexString();
          if (value.type === "BigNumber" && value.hex) {
            return value.hex;
          }
          return BigNumber.from(value).toHexString();
        };

        // Flashbots requires LEGACY transaction format (not EIP-1559)
        // Convert maxFeePerGas to gasPrice for compatibility
        // Use maxFeePerGas as gasPrice since that's the maximum we're willing to pay
        const gasPriceForFlashbots = populatedTx.maxFeePerGas || populatedTx.gasPrice;

        // Build legacy transaction for Flashbots (no maxFeePerGas/maxPriorityFeePerGas)
        unsignedTx = {
          to: populatedTx.to,
          data: populatedTx.data,
          gasLimit: toHexString(populatedTx.gasLimit),
          gasPrice: toHexString(gasPriceForFlashbots),  // Use gasPrice instead of maxFeePerGas
          value: toHexString(populatedTx.value),
          nonce: populatedTx.nonce,
          chainId: populatedTx.chainId,
          type: 0,  // Force legacy transaction type
        };

      }

      // Get the Flashbots provider and send the private transaction
      const flashbotsProvider = await getFlashbotsProvider(provider, chainId);
      const currentBlockNumber = await provider.getBlockNumber();
      const maxBlockNumber = getFlashbotsMaxBlockNumber(currentBlockNumber);

      logger.debug({
        at: "TxUtil#Flashbots",
        message: "Sending TX via Flashbots",
        currentBlockNumber,
        maxBlockNumber,
        method,
        unsignedTx: {
          to: unsignedTx.to,
          nonce: unsignedTx.nonce,
          gasLimit: unsignedTx.gasLimit,
          maxFeePerGas: unsignedTx.maxFeePerGas,
          maxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas,
          type: unsignedTx.type,           // CRITICAL: Must be 2 for EIP-1559
          chainId: unsignedTx.chainId,     // CRITICAL: Must be present
          valueTypes: {
            gasLimit: typeof unsignedTx.gasLimit,
            maxFeePerGas: typeof unsignedTx.maxFeePerGas,
            type: typeof unsignedTx.type,
            chainId: typeof unsignedTx.chainId,
          },
        },
      });


      // Step 1: Sign the transaction
      const signedTx = await contract.signer.signTransaction(unsignedTx);
      const txHash = ethers.utils.parseTransaction(signedTx).hash;

      logger.debug({
        at: "TxUtil#Flashbots",
        message: "Transaction signed",
        txHash,
        signedTxLength: signedTx.length,
      });

      // Step 2: Simulate before sending (optional, enabled via FLASHBOTS_SIMULATE=true)
      if (process.env.FLASHBOTS_SIMULATE === "true") {
        try {
          logger.debug({
            at: "TxUtil#Flashbots",
            message: "Simulating transaction before Flashbots submission",
            method,
            targetBlock: currentBlockNumber + 1,
          });

          const simulation = await flashbotsProvider.simulate([signedTx], currentBlockNumber + 1);

          // Check if simulation is an error response
          if ("error" in simulation) {
            logger.warn({
              at: "TxUtil#Flashbots",
              message: "Flashbots simulation returned error",
              error: simulation.error,
            });
          } else {
            // SimulationResponseSuccess
            const firstResult = simulation.results?.[0];
            const isSuccess = firstResult && !("error" in firstResult);

            logger.info({
              at: "TxUtil#Flashbots",
              message: "Flashbots simulation result",
              method,
              bundleHash: simulation.bundleHash,
              coinbaseDiff: simulation.coinbaseDiff.toString(),
              totalGasUsed: simulation.totalGasUsed,
              firstResult: {
                success: isSuccess,
                error: !isSuccess && "error" in firstResult ? firstResult.error : undefined,
                revert: !isSuccess && "revert" in firstResult ? firstResult.revert : undefined,
                gasUsed: firstResult?.gasUsed,
              },
            });

            // If simulation failed, potentially abort
            if (!isSuccess && "error" in firstResult) {
              const abortOnSimFail = process.env.FLASHBOTS_ABORT_ON_SIMULATION_FAIL === "true";
              if (abortOnSimFail) {
                throw new Error(`Flashbots simulation failed: ${firstResult.error} - ${firstResult.revert}`);
              }
            }
          }
        } catch (simError) {
          logger.warn({
            at: "TxUtil#Flashbots",
            message: "Flashbots simulation error (continuing with submission)",
            error: stringifyThrownValue(simError),
          });
        }
      }

      // Step 3: Get and log Flashbots user stats before sending (mainnet only)
      // Note: getUserStatsV2 is only available on mainnet relay, not Sepolia
      if (chainId === 1) {
        try {
          const userStats = await flashbotsProvider.getUserStatsV2();
          if ("error" in userStats) {
            logger.warn({
              at: "TxUtil#Flashbots",
              message: "Flashbots user stats returned error",
              error: userStats.error,
              method,
              hash: txHash,
            });
          } else {
            logger.info({
              at: "TxUtil#Flashbots",
              message: "Flashbots user stats before submission",
              stats: {
                isHighPriority: userStats.isHighPriority,
                allTimeValidatorPayments: userStats.allTimeValidatorPayments,
                allTimeGasSimulated: userStats.allTimeGasSimulated,
                last7dValidatorPayments: userStats.last7dValidatorPayments,
                last7dGasSimulated: userStats.last7dGasSimulated,
                last1dValidatorPayments: userStats.last1dValidatorPayments,
                last1dGasSimulated: userStats.last1dGasSimulated,
              },
              method,
              hash: txHash,
            });
          }
        } catch (statsError) {
          logger.warn({
            at: "TxUtil#Flashbots",
            message: "Failed to get Flashbots user stats",
            error: stringifyThrownValue(statsError),
            method,
            hash: txHash,
          });
        }
      }

      // Step 4: Send the PRE-SIGNED transaction via Flashbots
      const flashbotsResponse = await flashbotsProvider.sendPrivateTransaction(
        {
          signedTransaction: signedTx,
        },
        {
          maxBlockNumber,
        }
      );

      if (!txHash) {
        throw new Error("Failed to get transaction hash from Flashbots submission");
      }

      // Check if response is an error
      if ("error" in flashbotsResponse) {
        logger.error({
          at: "TxUtil#Flashbots",
          message: "Flashbots relay returned error",
          error: flashbotsResponse.error,
          hash: txHash,
        });
        throw new Error(`Flashbots error: ${flashbotsResponse.error.message}`);
      }

      logger.info({
        at: "TxUtil#Flashbots",
        message: "Transaction submitted to Flashbots relay 🥷",
        hash: txHash,
        currentBlock: currentBlockNumber,
        maxBlockNumber,
        validForBlocks: maxBlockNumber - currentBlockNumber,
        flashbotsResponse: {
          account: flashbotsResponse.transaction.account,
          nonce: flashbotsResponse.transaction.nonce,
        },
      });

      // Step 4: Wait for transaction inclusion if env var is set
      if (process.env.FLASHBOTS_WAIT === "true") {
        try {
          logger.debug({
            at: "TxUtil#Flashbots",
            message: "Waiting for Flashbots transaction resolution ...",
            hash: txHash,
            maxBlockNumber,
          });

          const resolution = await flashbotsResponse.wait();

          logger.info({
            at: "TxUtil#Flashbots",
            message: "Flashbots transaction resolution",
            hash: txHash,
            resolution: resolution,
          });
          // FlashbotsTransactionResolution: TxIncluded = 0, TxDropped = 1 

          // Get the actual transaction receipt
          const receipts = await flashbotsResponse.receipts();
          if (receipts && receipts.length > 0) {
            const receipt = receipts[0];
            logger.info({
              at: "TxUtil#Flashbots",
              message: "Flashbots transaction mined ⛏️",
              hash: txHash,
              blockNumber: receipt.blockNumber,
              status: receipt.status,
              gasUsed: receipt.gasUsed.toString(),
              effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
              includedInBlock: receipt.blockNumber - currentBlockNumber,
            });
          } else {
            logger.warn({
              at: "TxUtil#Flashbots",
              message: "Flashbots transaction not mined within validity window",
              hash: txHash,
              resolution,
              maxBlockNumber,
              note: "Transaction may have been dropped or not competitive enough",
            });
          }
        } catch (waitError) {
          logger.warn({
            at: "TxUtil#Flashbots",
            message: "Error waiting for Flashbots transaction",
            hash: txHash,
            error: stringifyThrownValue(waitError),
          });
        }
      }

      // Return a TransactionResponse-like object using the Flashbots response
      // This matches the standard path behavior where we return the result of contract[method]()
      return {
        hash: txHash,
        from: await contract.signer.getAddress(),
        nonce: flashbotsResponse.transaction.nonce,
        gasLimit: unsignedTx.gasLimit,
        gasPrice: unsignedTx.gasPrice,
        data: unsignedTx.data,
        value: unsignedTx.value,
        chainId: unsignedTx.chainId,
        confirmations: 0,
        wait: async (confirmations?: number) => {
          // Log Flashbots response details when wait() is called
          logger.info({
            at: "TxUtil#Flashbots#wait",
            message: "Flashbots transaction response details",
            hash: txHash,
            method,
            flashbotsResponse: {
              account: flashbotsResponse.transaction.account,
              nonce: flashbotsResponse.transaction.nonce,
              signedTransactionLength: flashbotsResponse.transaction.signedTransaction.length,
            },
            transactionDetails: {
              from: await contract.signer.getAddress(),
              to: unsignedTx.to,
              gasLimit: unsignedTx.gasLimit,
              gasPrice: unsignedTx.gasPrice,
              value: unsignedTx.value,
              chainId: unsignedTx.chainId,
            },
            note: "Flashbots transaction details logged when wait() is called",
          });

          // Use standard provider wait (never Flashbots wait outside simulation)
          return provider.waitForTransaction(txHash, confirmations || 0);
        },
      } as TransactionResponse;
    } else {
      // Standard path: Send transaction through public mempool
      if (sendRawTransaction) {
        // For legacy chains, ensure we're sending a legacy transaction
        const rawTxConfig = LEGACY_TRANSACTION_CHAINS.includes(chainId)
          ? { to: contract.address, value, ...gas, type: 0 }
          : { to: contract.address, value, ...gas };

        return await (await contract.signer).sendTransaction(rawTxConfig);
      } else {
        return await contract[method](...(args as Array<unknown>), txConfig);
      }
    }
  } catch (error) {
    if (retriesRemaining > 0 && txnRetryable(error)) {
      // If error is due to a nonce collision or gas underpricement then re-submit to fetch latest params.
      retriesRemaining -= 1;
      logger.debug({
        at: "TxUtil#runTransaction",
        message: "Retrying txn due to expected error",
        error: stringifyThrownValue(error),
        retriesRemaining,
      });

      return await runTransaction(
        logger,
        contract,
        method,
        args,
        value,
        gasLimit,
        null,
        retriesRemaining,
        depositId,
        maxGasUsd,
        gasTokenPriceUsd
      );
    } else {
      // Empirically we have observed that Ethers can produce nested errors, so we try to recurse down them
      // and log them as clearly as possible. For example:
      // - Top-level (Contract method call): "reason":"cannot estimate gas; transaction may fail or may require manual gas limit" (UNPREDICTABLE_GAS_LIMIT)
      // - Mid-level (eth_estimateGas): "reason":"execution reverted: delegatecall failed" (UNPREDICTABLE_GAS_LIMIT)
      // - Bottom-level (JSON-RPC/HTTP): "reason":"processing response error" (SERVER_ERROR)
      const commonFields = {
        at: "TxUtil#runTransaction",
        message: "Error executing tx",
        retriesRemaining,
        target: getTarget(contract.address),
        method,
        args,
        value,
        nonce,
        sendRawTxn: sendRawTransaction,
        notificationPath: "across-error",
      };
      if (isEthersError(error)) {
        const ethersErrors: { reason: string; err: EthersError }[] = [];
        let topError = error;
        while (isEthersError(topError)) {
          ethersErrors.push({ reason: topError.reason, err: topError.error as EthersError });
          topError = topError.error as EthersError;
        }
        logger[ethersErrors.some((e) => txnRetryable(e.err)) ? "warn" : "error"]({
          ...commonFields,
          errorReasons: ethersErrors.map((e, i) => `\t ${i}: ${e.reason}`).join("\n"),
        });
      } else {
        logger[txnRetryable(error) || isFillRelayError(error) ? "warn" : "error"]({
          ...commonFields,
          error: stringifyThrownValue(error),
        });
      }
      throw error;
    }
  }
}

export async function sendAndConfirmSolanaTransaction(
  unsignedTransaction: CompilableTransactionMessage,
  signer: KeyPairSigner,
  provider: SVMProvider,
  cycles = 25,
  pollingDelay = 600 // 1.5 slots on Solana.
): Promise<string> {
  const delay = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
  const signedTx = await signTransactionMessageWithSigners(unsignedTransaction);
  const serializedTx = getBase64EncodedWireTransaction(signedTx);
  const txSignature = await provider
    .sendTransaction(serializedTx, { preflightCommitment: "confirmed", skipPreflight: false, encoding: "base64" })
    .send();
  let confirmed = false;
  let _cycles = 0;
  while (!confirmed && _cycles < cycles) {
    const txStatus = await provider.getSignatureStatuses([txSignature]).send();
    // Index 0 since we are only sending a single transaction in this method.
    confirmed =
      txStatus?.value?.[0]?.confirmationStatus === "confirmed" ||
      txStatus?.value?.[0]?.confirmationStatus === "finalized";
    // If the transaction wasn't confirmed, wait `pollingInterval` and retry.
    if (!confirmed) {
      await delay(pollingDelay);
      _cycles++;
    }
  }
  return txSignature;
}

export async function getGasPrice(
  provider: ethers.providers.Provider,
  priorityScaler = 1.2,
  maxFeePerGasScaler = 3,
  transactionObject?: ethers.PopulatedTransaction,
  logger?: winston.Logger,
  method?: string,
  depositId?: BigNumber,
  maxGasUsd?: BigNumber,
  gasTokenPriceUsd?: BigNumber,
  gasLimit?: BigNumber
): Promise<Partial<FeeData>> {
  // Floor scalers at 1.0 as we'll rarely want to submit too low of a gas price. We mostly
  // just want to submit with as close to prevailing fees as possible.
  maxFeePerGasScaler = Math.max(1, maxFeePerGasScaler);
  priorityScaler = Math.max(1, priorityScaler);
  const { chainId } = await provider.getNetwork();

  // Check if this chain uses legacy transactions
  const isLegacyChain = LEGACY_TRANSACTION_CHAINS.includes(chainId);

  // Pass in unsignedTx here for better Linea gas price estimations via the Linea Viem provider.
  const feeData = (await gasPriceOracle.getGasPriceEstimate(provider, {
    chainId,
    baseFeeMultiplier: toBNWei(maxFeePerGasScaler),
    priorityFeeMultiplier: toBNWei(priorityScaler),
    unsignedTx: transactionObject,
  })) as EvmGasPriceEstimate;

  // Log the original oracle gas prices
  logger.debug({
    at: "TxUtil#getGasPrice",
    message: "Oracle suggested gas prices",
    chainId: chainId,
    method: method,
    depositId: depositId ? ethers.utils.formatUnits(depositId, "wei") : undefined,
    baseFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas), "gwei"),
    maxPriorityFeePerGas: ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
    maxFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas, "gwei"),
    gasLimit: gasLimit ? ethers.utils.formatUnits(gasLimit, "wei") : undefined,
    maxFeeScaler: maxFeePerGasScaler,
    priorityScaler: priorityScaler,
  });

  // Implement the new enhanced gas pricing approach:
  // 1. maxGasUsd is the entire amount available for gas
  // 2. Divide by gas limit to get per-gas enhancement
  // 3. Use it as the effective max fee per gas unit
  // 4. For legacy chains: use simplified calculation without gas fee estimate, for EIP-1559: derive priority fee from gas estimation

  if (Boolean(process.env.ENHANCE_GAS_PRICE) && logger && maxGasUsd && gasTokenPriceUsd && maxGasUsd.gt(bnZero)) {
    // Gas price is per unit of gas, so divide maxGasUsd by gas limit first
    const gasLimitForCalculation = gasLimit || toBNWei(21000); // Default to 21k gas if not specified
    const maxGasUsdPerGas = maxGasUsd.div(gasLimitForCalculation);

    // Convert USD per gas to wei per gas to get the effective max fee per gas unit
    const enhancedGasPrice = maxGasUsdPerGas.mul(toBNWei(1)).div(gasTokenPriceUsd);

    if (isLegacyChain) {
      logger.debug({
        at: "TxUtil#getGasPrice",
        message: "Enhanced gas price using legacy Tx",
        chainId: chainId,
        method: method,
        depositId: depositId ? ethers.utils.formatUnits(depositId, "wei") : undefined,
        estimatedGasPrice: ethers.utils.formatUnits(feeData.maxFeePerGas, "gwei"),
        enhancedGasPrice: ethers.utils.formatUnits(enhancedGasPrice, "gwei"),
        gasLimit: ethers.utils.formatUnits(gasLimitForCalculation, "wei"),
        maxGasUsd: ethers.utils.formatEther(maxGasUsd),
        maxGasUsdPerGas: ethers.utils.formatEther(maxGasUsdPerGas),
        gasTokenPriceUsd: ethers.utils.formatEther(gasTokenPriceUsd),
      });

      return {
        gasPrice: enhancedGasPrice, // Single gasPrice field for legacy transactions
      };
    } else {
      // EIP-1559 calculation: derive priority fee from gas estimation
      const estimatedBaseFee = feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas);

      // Calculate the final priority fee: effectiveMaxFee - estimatedBaseFee
      const finalMaxPriorityFee = enhancedGasPrice.sub(estimatedBaseFee);

      // Ensure priority fee is not negative
      const enhancedMaxPriorityFee = finalMaxPriorityFee.gt(bnZero)
        ? finalMaxPriorityFee
        : feeData.maxPriorityFeePerGas;

      logger.debug({
        at: "TxUtil#getGasPrice",
        message: "Enhanced gas prices using EIP-1559",
        chainId: chainId,
        method: method,
        depositId: depositId ? ethers.utils.formatUnits(depositId, "wei") : undefined,
        originalMaxFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas, "gwei"),
        enhancedMaxFeePerGas: ethers.utils.formatUnits(enhancedGasPrice, "gwei"),
        originalMaxPriorityFeePerGas: ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        enhancedMaxPriorityFeePerGas: ethers.utils.formatUnits(enhancedMaxPriorityFee, "gwei"),
        maxGasUsd: ethers.utils.formatEther(maxGasUsd),
        gasLimit: ethers.utils.formatUnits(gasLimitForCalculation, "wei"),
        maxGasUsdPerGas: ethers.utils.formatEther(maxGasUsdPerGas),
        estimatedBaseFee: ethers.utils.formatUnits(estimatedBaseFee, "gwei"),
        gasTokenPriceUsd: ethers.utils.formatEther(gasTokenPriceUsd),
      });

      return {
        maxFeePerGas: enhancedGasPrice,
        maxPriorityFeePerGas: enhancedMaxPriorityFee,
      };
    }
  } else {
    logger.debug({
      at: "TxUtil#getGasPrice",
      message: "Gas enhancement disabled; using oracle prices",
    });
  }

  // Default to EIP-1559 (type 2) pricing. If gasPriceOracle is using a legacy adapter for this chain then
  // the priority fee will be 0.
  return {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  };
}

export async function willSucceed(transaction: AugmentedTransaction): Promise<TransactionSimulationResult> {
  // If the transaction already has a gasLimit, it should have been simulated in advance.
  if (transaction.canFailInSimulation || isDefined(transaction.gasLimit)) {
    return { transaction, succeed: true };
  }

  const timeNow = Date.now();
  const { contract, method } = transaction;
  const args = transaction.value ? [...transaction.args, { value: transaction.value }] : transaction.args;

  // First callStatic, which will surface a custom error if the transaction would fail.
  // This is useful for surfacing custom error revert reasons like RelayFilled in the SpokePool but
  // it does incur an extra RPC call. We do this because estimateGas is a provider function that doesn't
  // relay custom errors well: https://github.com/ethers-io/ethers.js/discussions/3291#discussion-4314795
  let data;
  try {
    data = await contract.callStatic[method](...args);
  } catch (err: any) {
    if (err.errorName) {
      return {
        transaction,
        succeed: false,
        reason: err.errorName,
      };
    }
  }

  try {
    const gasLimit = await contract.estimateGas[method](...args);
    return { transaction: { ...transaction, gasLimit }, succeed: true, data };
  } catch (_error) {
    const error = _error as EthersError;
    return { transaction, succeed: false, reason: error.reason };
  }
}

export function getTarget(targetAddress: string):
  | {
    chainId: number;
    contractName: string;
    targetAddress: string;
  }
  | {
    targetAddress: string;
  } {
  try {
    return { targetAddress, ...getContractInfoFromAddress(targetAddress) };
  } catch (error) {
    return { targetAddress };
  }
}
