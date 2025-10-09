import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { ethers, Wallet, Signer, winston } from "../utils";

// Cache Flashbots providers by chainId to avoid recreating them
const flashbotsProviders: Map<number, FlashbotsBundleProvider> = new Map();

/**
 * Checks if Flashbots is enabled via environment variables
 */
export function isFlashbotsEnabled(): boolean {
    return process.env.FLASHBOTS_ENABLED === "true";
}

/**
 * Checks if a specific method should use Flashbots
 * @param method The contract method name
 * @returns True if the method should use Flashbots
 */
export function shouldUseFlashbotsForMethod(method: string): boolean {
    if (!isFlashbotsEnabled()) {
        return false;
    }

    // Methods that should use Flashbots (can be configured via env)
    const flashbotsMethods = new Set(
        (process.env.FLASHBOTS_METHODS || "fillRelay,fillRelayWithUpdatedDeposit,fillRelayWithUpdatedFee")
            .split(",")
            .map((m) => m.trim())
            .filter((m) => m.length > 0)
    );

    return flashbotsMethods.has(method);
}

/**
 * Checks if Flashbots is supported on the given chain
 * @param chainId The chain ID to check
 * @returns True if Flashbots is supported on the chain
 */
export function isFlashbotsSupportedChain(chainId: number): boolean {
    // Flashbots currently supports Ethereum mainnet (1) and Sepolia testnet (11155111)
    const supportedChains = new Set([1, 11155111]);
    return supportedChains.has(chainId);
}

/**
 * Determines if a transaction should use Flashbots based on chain, method, and configuration
 * @param chainId The chain ID
 * @param method The contract method name (empty string for raw transactions)
 * @returns True if Flashbots should be used
 */
export function shouldUseFlashbots(chainId: number, method: string): boolean {
    return isFlashbotsEnabled() && isFlashbotsSupportedChain(chainId) && shouldUseFlashbotsForMethod(method);
}

/**
 * TODO: load Flashbots relay urls from .env config file
 * Gets the Flashbots relay URL for a given chain
 * @param chainId The chain ID
 * @returns The Flashbots relay URL
 * @throws If the chain is not supported
 */
export function getFlashbotsRelayUrl(chainId: number): string {
    // Allow override via environment variable
    const envUrl = process.env[`FLASHBOTS_RELAY_URL_${chainId}`] || process.env.FLASHBOTS_RELAY_URL;
    if (envUrl) {
        return envUrl;
    }

    switch (chainId) {
        case 1:
            return "https://relay.flashbots.net";
        case 11155111:
            return "https://relay-sepolia.flashbots.net";
        default:
            throw new Error(`Flashbots relay URL not configured for chain ${chainId}`);
    }
}

/**
 * Gets the network name for Flashbots
 * @param chainId The chain ID
 * @returns The network name
 */
function getFlashbotsNetworkName(chainId: number): string {
    switch (chainId) {
        case 1:
            return "mainnet";
        case 11155111:
            return "sepolia";
        default:
            return "mainnet"; // Default fallback
    }
}

/**
 * Creates or retrieves a cached FlashbotsBundleProvider for the given chain
 * @param provider The base ethers provider (for nonce, gas estimation, etc.)
 * @param chainId The chain ID
 * @returns A FlashbotsBundleProvider instance
 */
export async function getFlashbotsProvider(
    provider: ethers.providers.Provider,
    chainId: number
): Promise<FlashbotsBundleProvider> {
    // Return cached provider if available
    if (flashbotsProviders.has(chainId)) {
        return flashbotsProviders.get(chainId)!;
    }

    // Get auth signer from environment
    const authSigner = getFlashbotsAuthSigner();

    // Create new Flashbots provider
    const relayUrl = getFlashbotsRelayUrl(chainId);
    const networkName = getFlashbotsNetworkName(chainId);

    const flashbotsProvider = await FlashbotsBundleProvider.create(
        provider,
        authSigner,
        relayUrl,
        networkName
    );

    // Cache for future use
    flashbotsProviders.set(chainId, flashbotsProvider);

    return flashbotsProvider;
}

/**
 * Gets the auth signer for Flashbots authentication
 * This is a separate signer from the transaction signer, used only for signing Flashbots payloads
 * @returns A Wallet instance for Flashbots authentication
 * @throws If FLASHBOTS_AUTH_PRIVATE_KEY is not set
 */
function getFlashbotsAuthSigner(): Wallet {
    const authKey = process.env.FLASHBOTS_AUTH_PRIVATE_KEY;

    if (!authKey) {
        throw new Error(
            "FLASHBOTS_AUTH_PRIVATE_KEY environment variable must be set when FLASHBOTS_ENABLED=true. " +
            "This is a separate key used only for authenticating with the Flashbots relay."
        );
    }

    return new Wallet(authKey);
}

/**
 * Gets the maximum block number for Flashbots transaction validity
 * @param currentBlockNumber The current block number
 * @returns The maximum block number (current + configured blocks)
 */
export function getFlashbotsMaxBlockNumber(currentBlockNumber: number): number {
    const maxBlocks = parseInt(process.env.FLASHBOTS_MAX_BLOCKS_IN_FUTURE || "25", 10);
    return currentBlockNumber + maxBlocks;
}

/**
 * Logs Flashbots transaction submission details
 * @param logger Winston logger instance
 * @param method Contract method name
 * @param chainId Chain ID
 * @param targetBlockNumber Target block number for inclusion
 */
export function logFlashbotsSubmission(
    logger: winston.Logger,
    method: string,
    chainId: number,
    targetBlockNumber?: number
): void {
    logger.debug({
        at: "FlashbotsUtils",
        message: "Submitting transaction via Flashbots 🥷",
        method,
        chainId,
        targetBlockNumber,
        relayUrl: getFlashbotsRelayUrl(chainId),
    });
}

/**
 * Clears the Flashbots provider cache
 * Useful for testing or when providers need to be recreated
 */
export function clearFlashbotsProviderCache(): void {
    flashbotsProviders.clear();
}

