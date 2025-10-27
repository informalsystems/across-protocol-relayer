import { gasPriceOracle, typeguards, utils as sdkUtils } from "@across-protocol/sdk";
import { FeeData } from "@ethersproject/abstract-provider";
import dotenv from "dotenv";
import { AugmentedTransaction } from "../clients";
import { DEFAULT_GAS_FEE_SCALERS } from "../common";
import { EthersError } from "../interfaces";
import { createHintPreferences, createTransactionOptions, getBuilders, getMevShareClient, isMevShareSupportedChain, Wallet, getBundleParams } from "./MevShareUtils";
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
} from "../utils";
import {
  CompilableTransactionMessage,
  KeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransactionMessageWithSigners,
  type Blockhash,
} from "@solana/kit";
import { BundleParams } from "@flashbots/mev-share-client";

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


  // Reset nonce once per chain during the runtime of the script
  if (!nonceReset[chainId]) {
    nonce = await provider.getTransactionCount(await contract.signer.getAddress());
    nonceReset[chainId] = true;
  }

  const sendRawTransaction = method === "";

  if (process.env.MEV_SHARE_SIMULATE !== "false") {
    // If private transaction is enabled and the chain is supported, submit the transaction via MEV-Share
    const rawTx = await contract.populateTransaction[method](...(args as Array<unknown>),
      { nonce: nonce, type: 0, gasPrice: 2000000, gasLimit: 200000 }); // Default gas limit and gas price if not specified
    const bundleSimulation = await simulateBundle(logger, chainId, rawTx, contract.signer, provider);
    // Update the gas limit with the bundle simulation gas limit as it has proven better accuracy
    gasLimit = BigNumber.from(bundleSimulation.gasUsed);
  }


  try {
    // Scalers must be set to 1 
    const priorityFeeScaler =
      Number(process.env[`PRIORITY_FEE_SCALER_${chainId}`] || process.env.PRIORITY_FEE_SCALER) ||
      DEFAULT_GAS_FEE_SCALERS[chainId]?.maxPriorityFeePerGasScaler;
    const maxFeePerGasScaler =
      Number(process.env[`MAX_FEE_PER_GAS_SCALER_${chainId}`] || process.env.MAX_FEE_PER_GAS_SCALER) ||
      DEFAULT_GAS_FEE_SCALERS[chainId]?.maxFeePerGasScaler;


    // TODO: check async calls are getting resolved in the correct order
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
      // Legacy transaction gas price multiplier
      const gasMultiplier = ethers.utils.parseUnits(process.env.LEGACY_TRANSACTION_GAS_PRICE_MULTIPLIER || "1", 1).div(ethers.utils.parseUnits("1", 1));
      gas.gasPrice = gas.gasPrice?.mul(gasMultiplier);
      // Only used to send tx - enhanced gas price still use estimated gas limit from oracle  
      gasLimit = BigNumber.from(process.env.LEGACY_TRANSACTION_GAS_LIMIT || "200000");
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
      gasMultiplier: process.env.LEGACY_TRANSACTION_GAS_PRICE_MULTIPLIER || "1",
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

    if (sendRawTransaction) {
      // For legacy chains, ensure we're sending a legacy transaction
      const rawTxConfig = LEGACY_TRANSACTION_CHAINS.includes(chainId)
        ? { to: contract.address, value, ...gas, type: 0 }
        : { to: contract.address, value, ...gas };
      return await (await contract.signer).sendTransaction(rawTxConfig);
    } else if (process.env.PRIVATE_TX_ENABLED === "true" && isMevShareSupportedChain(chainId)) {
      // If private transaction is enabled and the chain is supported, submit the transaction via MEV-Share
      const rawTx = await contract.populateTransaction[method](...(args as Array<unknown>), txConfig);
      // Note that only legacy transactions are supported  for now.
      rawTx.type = 0;
      return await submitPrivateTransaction(logger, chainId, rawTx, contract.signer, provider);
    } else if (process.env.MEV_SHARE_BUNDLE_ENABLED === "true" && isMevShareSupportedChain(chainId)) {
      // If private transaction is enabled and the chain is supported, submit the transaction via MEV-Share
      const rawTx = await contract.populateTransaction[method](...(args as Array<unknown>), txConfig);
      // Note that only legacy transactions are supported  for now.
      rawTx.type = 0;
      return await submitBundle(logger, chainId, rawTx, contract.signer, provider);
    } else {
      return await contract[method](...(args as Array<unknown>), txConfig);
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
    depositId: ethers.utils.formatUnits(depositId, "wei"),
    baseFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas.sub(feeData.maxPriorityFeePerGas), "gwei"),
    maxPriorityFeePerGas: ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
    maxFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas, "gwei"),
    gasLimit: ethers.utils.formatUnits(gasLimit, "wei"),
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
        depositId: ethers.utils.formatUnits(depositId, "wei"),
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
        depositId: ethers.utils.formatUnits(depositId, "wei"),
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


async function submitPrivateTransaction(
  logger: winston.Logger,
  chainId: number,
  transaction: ethers.providers.TransactionRequest,
  signer: ethers.Signer,
  provider: ethers.providers.Provider,
): Promise<TransactionResponse> {

  const currentBlockNumber = await provider.getBlockNumber();
  const maxBlockNumber = currentBlockNumber + Number(process.env.FLASHBOTS_MAX_BLOCKS_IN_FUTURE);

  const mevShareClient = await getMevShareClient(provider, chainId);
  const signedTx = await signer.signTransaction(transaction);

  // Parse the signed transaction to get the hash
  const txHash = ethers.utils.parseTransaction(signedTx).hash;

  // Create transaction options
  const txOptions = createTransactionOptions(
    maxBlockNumber,
    getBuilders(), // Flashbots sends transactions to all builders by default
    createHintPreferences(false, false, true, true, false),
  );


  // Simulate the transaction before sending (if enabled)
  if (process.env.MEV_SHARE_SIMULATE !== "false") {
    try {
      logger.info({
        at: "TxUtil#submitPrivateTransaction",
        message: "Simulating MEV-Share transaction",
        chainId: chainId,
        transaction: txHash,
      });

      // Also try MEV-Share bundle simulation if available
      const bundleSimulation = await mevShareClient.simulateBundle({
        transactions: [signedTx],
        blockNumber: await provider.getBlockNumber(),
      });

      logger.info({
        at: "TxUtil#submitPrivateTransaction",
        message: "MEV-Share bundle simulation successful",
        chainId: chainId,
        transaction: txHash,
        bundleSimulation: {
          gasUsed: bundleSimulation.gasUsed,
          gasFees: bundleSimulation.gasFees,
          coinbaseDiff: bundleSimulation.coinbaseDiff,
          totalCoinbaseDiff: bundleSimulation.totalCoinbaseDiff,
          refundableValue: bundleSimulation.refundableValue,
          gasPrice: bundleSimulation.gasPrice,
        },
      });
    } catch (bundleSimError) {
      logger.warn({
        at: "TxUtil#submitPrivateTransaction",
        message: "MEV-Share bundle simulation failed (this is optional)",
        error: bundleSimError instanceof Error ? bundleSimError.message : String(bundleSimError),
        chainId: chainId,
        transaction: txHash,
      });

      // For now, we'll still try to send the transaction even if simulation fails
      // In production, you might want to throw here to prevent sending failed transactions
      logger.warn({
        at: "TxUtil#submitPrivateTransaction",
        message: "Proceeding with transaction despite simulation failure",
        chainId: chainId,
        transaction: txHash,
      });
    }
  }

  try {
    // Send transaction via MEV-Share
    logger.info({
      at: "TxUtil#submitPrivateTransaction",
      message: "Submitting private transaction via MEV-Share",
      chainId: chainId,
      transaction: txHash,
      hints: txOptions.hints,
      signedTxLength: signedTx.length,
      currentBlockNumber: currentBlockNumber,
      txOptions: txOptions,
      originalTransaction: {
        to: transaction.to,
        value: transaction.value,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        nonce: transaction.nonce,
        data: transaction.data,
        type: transaction.type,
        chainId: transaction.chainId
      },
    });

    const response = await mevShareClient.sendTransaction(signedTx, txOptions);
    logger.info({
      at: "TxUtil#submitPrivateTransaction",
      message: "MEV-Share transaction sent successfully",
      chainId: chainId,
      transaction: txHash,
      response: response,
    });

  } catch (error) {
    logger.error({
      at: "TxUtil#submitPrivateTransaction",
      message: "MEV-Share transaction failed",
      error: error instanceof Error ? error.message : String(error),
      chainId: chainId,
      transaction: txHash,
    });
    throw error;
  }


  logger.info({
    at: "TxUtil#submitPrivateTransaction",
    message: "Private transaction submitted to MEV-Share relay 🎭",
    chainId: chainId,
    transaction: txHash,
    txOptions: txOptions,
  });

  // Return a TransactionResponse-like object
  // Note: For MEV-Share transactions, we need to be careful about nonce management
  // since failed simulations or non-inclusion don't consume the nonce
  return {
    hash: txHash,
    from: await signer.getAddress(),
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit,
    gasPrice: transaction.gasPrice,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    data: transaction.data,
    value: transaction.value,
    chainId: transaction.chainId,
    confirmations: 0,
    wait: async (confirmations?: number) => {
      // MEV-Share transactions are private until mined
      // Use standard provider wait for confirmation
      return provider.waitForTransaction(txHash, confirmations || 0);
    },
    // Add a flag to indicate this is a MEV-Share transaction for special handling
    _mevShareTransaction: true,
    // Pass along the target block number used in the MEV-Share transaction
    _mevShareTargetBlock: maxBlockNumber,
  } as TransactionResponse & { _mevShareTransaction?: boolean; _mevShareTargetBlock?: number };
}

async function submitBundle(
  logger: winston.Logger,
  chainId: number,
  transaction: ethers.providers.TransactionRequest,
  signer: ethers.Signer,
  provider: ethers.providers.Provider,
): Promise<TransactionResponse> {
  const mevShareClient = await getMevShareClient(provider, chainId);
  const signedTx = await signer.signTransaction(transaction);
  // Parse the signed transaction to get the hash
  const txHash = ethers.utils.parseTransaction(signedTx).hash;

  const bundle = [
    { tx: signedTx, canRevert: false },
  ]


  const currentBlockNumber = await provider.getBlockNumber();
  const bundleParams: BundleParams = await getBundleParams(
    signedTx,
    currentBlockNumber,
    createHintPreferences(false, false, true, true, false),
  );

  try {
    logger.info({
      at: "TxUtil#submitBundle",
      message: "Submitting bundle via MEV-Share",
      chainId: chainId,
      transaction: txHash,
      currentBlockNumber: currentBlockNumber,
      Inclusion: bundleParams.inclusion,
      hints: bundleParams.privacy,
      originalTransaction: {
        to: transaction.to,
        value: transaction.value,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        nonce: transaction.nonce,
        data: transaction.data,
        type: transaction.type,
      },
    });

    const response = await mevShareClient.sendBundle(bundleParams);
    logger.info({
      at: "TxUtil#submitBundle",
      message: "Bundle sent successfully",
      chainId: chainId,
      response: response,
      transaction: txHash,
      currentBlockNumber: currentBlockNumber,
      maxBlockNumber: bundleParams.inclusion.maxBlock,
      bundleParams: bundleParams,
    });
  } catch (bundleSendError) {
    logger.error({
      at: "TxUtil#submitBundle",
      message: "MEV-Share bundle send failed",
      error: bundleSendError instanceof Error ? bundleSendError.message : String(bundleSendError),
      chainId: chainId,
      transaction: txHash,
    });
    throw bundleSendError;
  }


  return {
    hash: txHash,
    from: await signer.getAddress(),
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit,
    gasPrice: transaction.gasPrice,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    data: transaction.data,
    value: transaction.value,
    chainId: transaction.chainId,
    wait: async (confirmations?: number) => {
      // MEV-Share bundles are private until mined
      // Use standard provider wait for confirmation
      return provider.waitForTransaction(txHash, confirmations || 0);
    },
    // Add a flag to indicate this is a MEV-Share bundle for special handling
    _mevShareTransaction: true,
    // Pass along the target block number used in the MEV-Share transaction
    _mevShareTargetBlock: bundleParams.inclusion.maxBlock,
  } as TransactionResponse & { _mevShareTransaction?: boolean; _mevShareTargetBlock?: number };
}

// simulateSubmitBundle replaces the old simulateBundle helper
async function simulateBundle(
  logger: winston.Logger,
  chainId: number,
  transaction: ethers.providers.TransactionRequest,
  signer: ethers.Signer,
  provider: ethers.providers.Provider,
): Promise<any> {
  const mevShareClient = await getMevShareClient(provider, chainId);

  // Sign the original transaction
  const signedTx = await signer.signTransaction(transaction);
  const txHash = ethers.utils.parseTransaction(signedTx).hash;


  const currentBlockNumber = await provider.getBlockNumber();
  const bundleParams: BundleParams = await getBundleParams(
    signedTx,
    currentBlockNumber,
    createHintPreferences(false, false, true, true, false),
  );

  logger.info({
    at: "TxUtil#simulateSubmitBundle",
    message: "Simulating MEV-Share bundle",
    chainId: chainId,
    txHash: txHash,
    Inclusion: bundleParams.inclusion,
    hints: bundleParams.privacy
  });

  const startTime = Date.now();

  const bundleSimulation = await mevShareClient.simulateBundle(bundleParams);


  logger.info({
    at: "TxUtil#simulateSubmitBundle",
    message: "Bundle simulation successful",
    txHash: txHash,
    chainId: chainId,
    transaction: txHash,
    currentBlockNumber: currentBlockNumber,
    Inclusion: bundleParams.inclusion,
    hints: bundleParams.privacy,
    bundleSimulation: bundleSimulation,
    timeElapsed: Date.now() - startTime,
  });

  return bundleSimulation;
}