import { ethers, Wallet } from "ethers";
import { winston } from "../utils";

// Import MEV-Share client with proper default import
import MevShareClientModule, { BundleParams } from "@flashbots/mev-share-client";
const MevShareClient = (MevShareClientModule as any).default || MevShareClientModule;

import { TransactionOptions, HintPreferences } from "@flashbots/mev-share-client";
import networks from "@flashbots/mev-share-client/build/api/networks";

// Note: Logger will be passed as parameter to functions

// MEV-Share supported networks (using official network configurations)
const MEV_SHARE_SUPPORTED_CHAINS = [1, 11155111, 17000]; // Mainnet, Sepolia, Holesky

export function isMevShareSupportedChain(chainId: number): boolean {
    return MEV_SHARE_SUPPORTED_CHAINS.includes(chainId);
}

export function getMevShareNetwork(chainId: number) {
    try {
        return networks.getNetwork(chainId);
    } catch (error) {
        throw new Error(`MEV-Share not supported on chain ${chainId}`);
    }
}

export function getMevShareRelayUrl(chainId: number): string {
    return getMevShareNetwork(chainId).apiUrl;
}

export function getMevShareStreamUrl(chainId: number): string {
    return getMevShareNetwork(chainId).streamUrl;
}

export async function getMevShareClient(
    provider: ethers.providers.Provider,
    chainId: number,
): Promise<any> {
    if (!isMevShareSupportedChain(chainId)) {
        throw new Error(`MEV-Share not supported on chain ${chainId}`);
    }

    try {
        // Get official network configuration
        const network = getMevShareNetwork(chainId);

        // Check if auth private key is provided
        const authPrivateKey = process.env.FLASHBOTS_AUTH_PRIVATE_KEY;
        if (!authPrivateKey) {
            throw new Error("FLASHBOTS_AUTH_PRIVATE_KEY environment variable is required for MEV-Share");
        }

        const wallet = new Wallet(authPrivateKey);

        console.log("Creating MEV-Share client with:", {
            chainId,
            networkUrl: network.apiUrl,
            walletAddress: wallet.address,
            hasPrivateKey: !!authPrivateKey
        });

        // Create MEV-Share client with official network configuration
        const mevShareClient = new MevShareClient(wallet, network);

        // // Add debugging to the client's sendTransaction method
        // const originalSendTransaction = mevShareClient.sendTransaction.bind(mevShareClient);
        // mevShareClient.sendTransaction = async (signedTx: string, options: any) => {
        //     console.log("MEV-Share sendTransaction called with:", {
        //         signedTx: signedTx.substring(0, 100) + "...",
        //         signedTxLength: signedTx.length,
        //         options: JSON.stringify(options, null, 2),
        //         walletAddress: wallet.address,
        //         chainId: chainId
        //     });

        //     try {
        //         const result = await originalSendTransaction(signedTx, options);
        //         console.log("MEV-Share sendTransaction result:", result);
        //         return result;
        //     } catch (error) {
        //         console.error("MEV-Share sendTransaction error:", {
        //             error: error instanceof Error ? error.message : String(error),
        //             stack: error instanceof Error ? error.stack : undefined,
        //             signedTx: signedTx.substring(0, 100) + "...",
        //             options: JSON.stringify(options, null, 2)
        //         });
        //         throw error;
        //     }
        // };

        // // Add debugging to intercept HTTP requests
        // const axios = require('axios');
        // const originalAxiosPost = axios.post;
        // axios.post = async (url: string, data: any, config: any) => {
        //     console.log("MEV-Share HTTP POST request:", {
        //         url: url,
        //         data: JSON.stringify(data, null, 2),
        //         headers: config?.headers,
        //         config: config
        //     });

        //     try {
        //         const result = await originalAxiosPost(url, data, config);
        //         console.log("MEV-Share HTTP POST response:", {
        //             status: result.status,
        //             statusText: result.statusText,
        //             data: result.data
        //         });
        //         return result;
        //     } catch (error) {
        //         console.error("MEV-Share HTTP POST error:", {
        //             error: error instanceof Error ? error.message : String(error),
        //             response: (error as any)?.response?.data,
        //             status: (error as any)?.response?.status,
        //             statusText: (error as any)?.response?.statusText
        //         });
        //         throw error;
        //     }
        // };

        return mevShareClient;
    } catch (error) {
        throw new Error(`Failed to create MEV-Share client: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function getBundleParams(
    signedTx: string,
    currentBlockNumber: number,
    hints?: HintPreferences,
): Promise<BundleParams> {
    const targetBlock = currentBlockNumber + 1;
    const maxBlockNumber = currentBlockNumber + Number(process.env.FLASHBOTS_MAX_BLOCKS_IN_FUTURE);

    const bundle = [
        { tx: signedTx, canRevert: false },
    ]

    return {
        inclusion: {
            block: targetBlock,
            maxBlock: maxBlockNumber,
        },
        body: bundle,
        privacy: {
            hints: {
                txHash: false,
                calldata: false,
                logs: false,
                functionSelector: true,
                contractAddress: true,
            },
            builders: getBuilders()
        }
    }
}

export function createHintPreferences(
    logs: boolean = false,
    calldata: boolean = false,
    functionSelector: boolean = true,
    contractAddress: boolean = true,
    txHash: boolean = false,
): HintPreferences {
    return {
        logs,
        calldata,
        functionSelector,
        contractAddress,
        txHash,
    };
}

export function createTransactionOptions(
    maxBlockNumber: number,
    builders?: string[],
    hints?: HintPreferences
): TransactionOptions {
    return {
        maxBlockNumber,
        builders,
        hints
    };
}

export function logMevShareSubmission(
    logger: any,
    method: string,
    chainId: number,
    hints: HintPreferences
): void {
    logger.info({
        at: "MevShareUtils#logMevShareSubmission",
        message: "Submitting transaction via MEV-Share with partial privacy",
        method,
        chainId,
        hints,
        privacyLevel: {
            logs: hints.logs ? "shared" : "private",
            calldata: hints.calldata ? "shared" : "private",
            functionSelector: hints.functionSelector ? "shared" : "private",
            contractAddress: hints.contractAddress ? "shared" : "private",
            txHash: hints.txHash ? "shared" : "private",
        },
    });
}

export function getBuilders(): string[] {
    return ["flashbots", "beaverbuild.org", "rsync", "Titan", "EigenPhi", "Quasar", "BTCS", "penguinbuild"];
}

export { Wallet };
