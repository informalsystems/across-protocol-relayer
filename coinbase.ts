const { Transaction, keccak256 } = require("ethers");
const mev_sendBundle = async (
    fbProvider,
    signedBundledTransactions,
    targetBlockNumber,
    maxBlock,
    opts = {}
) => {
    const params = {
        version: 'v0.1',
        inclusion: {
            block: `0x${targetBlockNumber.toString(16)}`,
            maxBlock: `0x${maxBlock.toString(16)}`,
        },
        body: signedBundledTransactions.map((tx) => {
            return {
                tx,
                canRevert: false,
            }
        }),
        privacy: {
            // what searchers can see... :)
            hints: [
                'calldata',
                'contract_address',
                'logs',
                'function_selector',
                'hash',
                'tx_hash',
            ],
            builders: [
                'flashbots',
                'rsync',
                'beaverbuild.org',
                'Titan'
            ],
        },
    }

    const request = JSON.stringify(fbProvider.prepareRelayRequest('mev_sendBundle', [params]))
    const response = await fbProvider.request(request)
    if (response.error !== undefined && response.error !== null) {
        return {
            error: {
                message: response.error.message,
                code: response.error.code
            }
        }
    }

    const bundleTransactions = signedBundledTransactions.map((signedTransaction) => {
        const transactionDetails = Transaction.from(signedTransaction)
        return {
            signedTransaction,
            hash: keccak256(signedTransaction),
            account: transactionDetails.from || '0x0',
            nonce: transactionDetails.nonce
        }
    })

    return {
        bundleTransactions,
        wait: (timeout) => fbProvider.waitForBundleInclusion(bundleTransactions, maxBlock, timeout),
        simulate: () =>
            fbProvider.simulate(
                bundleTransactions.map((tx) => tx.signedTransaction),
                targetBlockNumber,
                undefined,
                opts.minTimestamp
            ),
        receipts: () => fbProvider.fetchReceipts(bundleTransactions),
        bundleHash: response.result.bundleHash
    }
}

const mev_simBundle = async (
    fbProvider,
    signedBundledTransactions,
    targetBlockNumber,
    maxBlock,
    timestamp,
    opts = {}
) => {
    const params = {
        version: "beta-1",
        inclusion: {
            block: `0x${targetBlockNumber.toString(16)}`,
            maxBlock: `0x${maxBlock.toString(16)}`,
        },
        body: signedBundledTransactions.map((tx) => {
            return {
                tx,
                canRevert: true,
            }
        }),
        privacy: {
            // what searchers can see... :)
            hints: [
                'calldata',
                'contract_address',
                'logs',
                'function_selector',
                'hash',
                'tx_hash',
            ],
            builders: [
                'flashbots',
                'rsync',
                'beaverbuild.org',
                'Titan'
            ],
        },
        simOptions: { /* SimBundleOptions */
            // parentBlock?: number | string, // Block used for simulation state. Defaults to latest block.
            // blockNumber?: number, // default = parentBlock.number + 1
            // coinbase?: string, // default = parentBlock.coinbase
            // timestamp?: number, // default = parentBlock.timestamp + 12
            // gasLimit?: number, // default = parentBlock.gasLimit
            // baseFee?: bigint, // default = parentBlock.baseFeePerGas
            // timeout?: number, // default = 5 (defined in seconds)
            // blockNumber: targetBlockNumber,
            // timestamp,
        }
    }

    const request = JSON.stringify(fbProvider.prepareRelayRequest('mev_simBundle', [params]))
    const response = await fbProvider.request(request)
    if (response.error !== undefined && response.error !== null) {
        return {
            error: {
                message: response.error.message,
                code: response.error.code
            }
        }
    }

    return { ...response.result };
}

module.exports = {
    mev_sendBundle,
    mev_simBundle,
};
