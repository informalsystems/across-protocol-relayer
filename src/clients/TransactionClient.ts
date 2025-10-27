/* eslint-disable @typescript-eslint/no-explicit-any */
import { utils as sdkUtils, typeguards } from "@across-protocol/sdk";
import {
  winston,
  getNetworkName,
  Contract,
  runTransaction,
  BigNumber,
  blockExplorerLink,
  toBNWei,
  TransactionResponse,
  TransactionSimulationResult,
  willSucceed,
  stringifyThrownValue,
  getProvider,
  ethers,
} from "../utils";
import { throws } from "assert";

export interface AugmentedTransaction {
  contract: Contract;
  chainId: number;
  method: string;
  args: any[];
  gasLimit?: BigNumber;
  gasLimitMultiplier?: number;
  message?: string;
  mrkdwn?: string;
  value?: BigNumber;
  unpermissioned?: boolean; // If false, the transaction must be sent from the enqueuer of the method.
  // If true, then can be sent from the MakerDAO multisender contract.
  canFailInSimulation?: boolean;
  // Optional batch ID to use to group transactions
  groupId?: string;
  // If true, the transaction is being sent to a non Multicall contract so we can't batch it together
  // with other transactions.
  nonMulticall?: boolean;
  // Optional deposit Id of the fill relay embedded in the tx
  depositId?: BigNumber;
  // Pre-calculated profitability data for gas price enhancement
  maxGasUsd?: BigNumber; // Maximum USD amount available for gas (entire amount, not leftover)
  gasTokenPriceUsd?: BigNumber; // Gas token price in USD for conversion
}

const { fixedPointAdjustment: fixedPoint } = sdkUtils;
const { isError } = typeguards;

const DEFAULT_GASLIMIT_MULTIPLIER = 1.0;

export class TransactionClient {
  readonly nonces: { [chainId: number]: number } = {};

  // eslint-disable-next-line no-useless-constructor
  constructor(readonly logger: winston.Logger) { }

  protected _simulate(txn: AugmentedTransaction): Promise<TransactionSimulationResult> {
    return willSucceed(txn);
  }

  // Each transaction is simulated in isolation; but on-chain execution may produce different
  // results due to execution sequence or intermediate changes in on-chain state.
  simulate(txns: AugmentedTransaction[]): Promise<TransactionSimulationResult[]> {
    return Promise.all(txns.map((txn: AugmentedTransaction) => this._simulate(txn)));
  }

  protected _submit(txn: AugmentedTransaction, nonce: number | null = null): Promise<TransactionResponse> {
    const { contract, method, args, value, gasLimit, depositId, maxGasUsd, gasTokenPriceUsd } = txn;
    return runTransaction(
      this.logger,
      contract,
      method,
      args,
      value,
      gasLimit,
      nonce,
      undefined,
      depositId,
      maxGasUsd,
      gasTokenPriceUsd
    );
  }

  /**
   * Wait for a transaction to be included in a specific block or any subsequent block
   * @param txHash Transaction hash to wait for
   * @param targetBlock Target block number to check
   * @param chainId Chain ID for the transaction
   * @returns Transaction receipt if found, null if not included by target block
   */
  private async waitForTransactionInBlock(
    txHash: string,
    targetBlock: number,
    chainId: number
  ): Promise<any> {
    const provider = await getProvider(chainId);
    const timeoutMs = Number(process.env.MEV_SHARE_CONFIRMATION_TIMEOUT) || 5 * 60 * 1000; // Default 5 minutes
    const startTime = Date.now();


    let currentBlock = await provider.getBlockNumber();
    if (currentBlock > targetBlock) {
      this.logger.warn({
        at: "TransactionClient#waitForTransactionInBlock",
        message: "Current block is past target block, nothing to check",
        transactionHash: txHash,
        currentBlock: currentBlock,
        targetBlock: targetBlock,
      });
      return null;
    }


    while ((Date.now() - startTime < timeoutMs) && (currentBlock <= targetBlock)) {
      const block = await provider.getBlockWithTransactions(currentBlock);
      this.logger.debug({
        at: "TransactionClient#waitForTransactionInBlock",
        message: "checking block for transaction inclusion",
        block: block.number,
        txHash: txHash,
        targetBlock: targetBlock,
      });

      const tx = block.transactions.find((t) => t.hash === txHash);
      if (tx) {
        const receipt = await provider.getTransactionReceipt(txHash);
        return receipt;
      } else {
        currentBlock = block.number;
        this.logger.debug({
          at: "TransactionClient#waitForTransactionInBlock",
          message: "tx not found in block, waiting for new block",
          block: block.number,
          txHash: txHash,
          targetBlock: targetBlock,
        });
      }

      await new Promise<void>((resolve) => {
        provider.once("block", (blockNumber) => {
          if ((blockNumber !== currentBlock) && (blockNumber !== currentBlock + 1)) {
            this.logger.warn({
              at: "TransactionClient#waitForTransactionInBlock",
              message: "Block number advanced by more than 1",
              previousBlock: currentBlock,
              newBlock: blockNumber,
              txHash: txHash,
              targetBlock: targetBlock,
            });
          }
          currentBlock = blockNumber; // stay the same or advance to the actual new block
          resolve();
        });
      });
    }

    this.logger.warn({
      at: "TransactionClient#waitForTransactionInBlock",
      message: currentBlock >= targetBlock ? "Transaction not found in blocks" : "Timeout waiting for transaction inclusion",
      transactionHash: txHash,
      targetBlock: targetBlock,
      timeoutMs: timeoutMs,
    });

    return null;
  }

  async submit(chainId: number, txns: AugmentedTransaction[]): Promise<TransactionResponse[]> {
    const networkName = getNetworkName(chainId);
    const txnResponses: TransactionResponse[] = [];

    this.logger.debug({
      at: "TransactionClient#submit",
      message: `Processing ${txns.length} transactions.`,
    });

    // Transactions are submitted sequentially to avoid nonce collisions. More
    // advanced nonce management may permit them to be submitted in parallel.
    let mrkdwn = "";
    for (let idx = 0; idx < txns.length; ++idx) {
      const txn = txns[idx];

      if (txn.chainId !== chainId) {
        throw new Error(`chainId mismatch for method ${txn.method} (${txn.chainId} !== ${chainId})`);
      }

      const nonce = this.nonces[chainId] ? this.nonces[chainId] + 1 : undefined;

      this.logger.debug({
        at: "TransactionClient#submit",
        message: "Nonce calculation for transaction",
        chainId: chainId,
        currentNonce: this.nonces[chainId],
        calculatedNonce: nonce,
        transactionIndex: idx + 1,
      });

      // @dev It's assumed that nobody ever wants to discount the gasLimit.
      const gasLimitMultiplier = txn.gasLimitMultiplier ?? DEFAULT_GASLIMIT_MULTIPLIER;
      if (gasLimitMultiplier > DEFAULT_GASLIMIT_MULTIPLIER) {
        this.logger.debug({
          at: "TransactionClient#_submit",
          message: `Padding gasLimit estimate on ${txn.method} transaction.`,
          estimate: txn.gasLimit,
          gasLimitMultiplier,
        });
        txn.gasLimit = txn.gasLimit?.mul(toBNWei(gasLimitMultiplier)).div(fixedPoint);
      }

      let response: TransactionResponse;
      try {
        response = await this._submit(txn, nonce);
      } catch (error) {
        this.logger.info({
          at: "TransactionClient#submit",
          message: `Transaction ${idx + 1} submission on ${networkName} failed or timed out.`,
          mrkdwn,
          // @dev `error` _sometimes_ doesn't decode correctly (especially on Polygon), so fish for the reason.
          errorMessage: isError(error) ? (error as Error).message : undefined,
          error: stringifyThrownValue(error),
          notificationPath: "across-error",
        });

        if (nonce !== null) {
          this.nonces[chainId] = nonce - 1;
        } else {
          throw new Error(`Nonce management non-recoverable error, first transaction submitted on chain failed`)
        }
        // Nonce was not consumed, so prepare to decrement the nonce for the next transaction
        // Should be safe to decrement for both MEV-share and standard transactions
        // TODO: verify if it's not the first transaction on the chain
        return txnResponses;
      }

      // Special handling for MEV-Share transactions
      // Only increment nonce if the transaction is actually included in a block
      if ((response as any)._mevShareTransaction) {
        // For MEV-Share transactions, we need to wait for inclusion before updating nonce
        // This prevents nonce issues when transactions fail simulation or don't get included
        try {
          // Use the target block number from the MEV-Share transaction response
          const targetBlock = (response as any)._mevShareTargetBlock;

          if (!targetBlock) {
            throw new Error("MEV-Share transaction missing target block number");
          }

          this.logger.debug({
            at: "TransactionClient#submit",
            message: "Waiting for MEV-Share transaction inclusion at target block",
            transactionHash: response.hash,
            targetBlock: targetBlock,
          });

          // Wait for the target block to be mined, then check for inclusion
          const receipt = await this.waitForTransactionInBlock(response.hash, targetBlock, chainId);

          if (receipt && receipt.status === 1) {
            // Transaction was successfully included, update nonce
            this.nonces[chainId] = response.nonce;
            this.logger.debug({
              at: "TransactionClient#submit",
              message: "MEV-Share transaction confirmed, nonce updated",
              transactionHash: response.hash,
              nonce: response.nonce,
              blockNumber: receipt.blockNumber,
            });
          } else {
            // Transaction did not land on-chain, nonce was not consumed
            this.logger.warn({
              at: "TransactionClient#submit",
              message: "MEV-Share transaction did not land on-chain, nonce not updated (not consumed)",
              transactionHash: response.hash,
              targetBlock: targetBlock,
              nonce: response.nonce,
            });
            // Nonce was not consumed, so prepare to decrement the nonce for the next transaction
            this.nonces[chainId] = response.nonce - 1;
            return txnResponses;
          }
        } catch (waitError) {
          // If waiting fails, don't update nonce to be safe
          this.logger.warn({
            at: "TransactionClient#submit",
            message: "MEV-Share transaction wait failed, nonce not updated",
            transactionHash: response.hash,
            error: stringifyThrownValue(waitError),
          });
          // Nonce was not consumed, so prepare to decrement the nonce for the next transaction
          this.nonces[chainId] = response.nonce - 1;
          return txnResponses;
        }
      } else {
        // Standard transaction, update nonce immediately
        this.nonces[chainId] = nonce;
      }
      const blockExplorer = blockExplorerLink(response.hash, txn.chainId);
      mrkdwn += `  ${idx + 1}. ${txn.message || "No message"} (${blockExplorer}): ${txn.mrkdwn || "No markdown"}\n`;
      txnResponses.push(response);
    }

    this.logger.info({
      at: "TransactionClient#submit",
      message: `Completed ${networkName} transaction submission! 🧙`,
      mrkdwn,
    });

    return txnResponses;
  }
}