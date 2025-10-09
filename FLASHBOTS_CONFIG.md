# Flashbots Configuration

This document describes how to configure Flashbots integration for the Across Protocol Relayer.

## Overview

Flashbots integration allows the relayer to send transactions privately through the Flashbots relay instead of the public mempool. This provides:

- **MEV Protection**: Transactions are not visible in the public mempool, preventing front-running
- **Failed Transaction Privacy**: Reverted transactions are not publicly visible
- **Priority Access**: Faster inclusion during network congestion
- **Strategic Privacy**: Competitors cannot observe your transaction strategy

## Environment Variables

### Required Variables

#### `FLASHBOTS_ENABLED`

- **Type**: `boolean` (string "true" or "false")
- **Default**: `false`
- **Description**: Master switch to enable/disable Flashbots integration
- **Example**: `FLASHBOTS_ENABLED=true`

#### `FLASHBOTS_AUTH_PRIVATE_KEY`

- **Type**: `string` (hex private key)
- **Required**: Yes, when `FLASHBOTS_ENABLED=true`
- **Description**: Private key used to authenticate with the Flashbots relay. This is **separate** from your transaction signing key and is used only for authentication.
- **Security**: This key does NOT need to have any funds. Generate a new key specifically for Flashbots authentication.
- **Example**: `FLASHBOTS_AUTH_PRIVATE_KEY=0x1234...`
- **Generate**: `openssl rand -hex 32` or use any Ethereum key generation tool

### Optional Variables

#### `FLASHBOTS_METHODS`

- **Type**: `string` (comma-separated list)
- **Default**: `fillRelay,fillRelayWithUpdatedDeposit,fillRelayWithUpdatedFee`
- **Description**: Comma-separated list of contract methods that should use Flashbots
- **Example**: `FLASHBOTS_METHODS=fillRelay,fillRelayWithUpdatedDeposit`

#### `FLASHBOTS_MAX_BLOCKS_IN_FUTURE`

- **Type**: `number`
- **Default**: `25`
- **Description**: Maximum number of blocks in the future the transaction is valid for. Flashbots will try to include the transaction in blocks up to this limit.
- **Example**: `FLASHBOTS_MAX_BLOCKS_IN_FUTURE=50`

#### `FLASHBOTS_RELAY_URL`

- **Type**: `string` (URL)
- **Default**: Automatic based on chain ID
  - Chain 1 (Mainnet): `https://relay.flashbots.net`
  - Chain 5 (Goerli): `https://relay-goerli.flashbots.net`
- **Description**: Override the Flashbots relay URL for all chains
- **Example**: `FLASHBOTS_RELAY_URL=https://relay.flashbots.net`

#### `FLASHBOTS_RELAY_URL_{CHAIN_ID}`

- **Type**: `string` (URL)
- **Description**: Override the Flashbots relay URL for a specific chain ID
- **Example**: `FLASHBOTS_RELAY_URL_1=https://relay.flashbots.net`

## Supported Chains

Flashbots is currently supported on:

- **Ethereum Mainnet (Chain ID: 1)**
- **Goerli Testnet (Chain ID: 5)**

Transactions on other chains will automatically fall back to standard transaction submission even if `FLASHBOTS_ENABLED=true`.

## Example Configuration

### Minimal Configuration (Mainnet)

```bash
# Enable Flashbots
FLASHBOTS_ENABLED=true

# Auth key (generate a new one, no funds needed)
FLASHBOTS_AUTH_PRIVATE_KEY=0xabcdef1234567890...

# Your transaction signing key (existing)
PRIVATE_KEY=0x1234567890abcdef...
```

### Full Configuration with Overrides

```bash
# Enable Flashbots
FLASHBOTS_ENABLED=true

# Auth key for Flashbots relay authentication
FLASHBOTS_AUTH_PRIVATE_KEY=0xabcdef1234567890...

# Only use Flashbots for specific methods
FLASHBOTS_METHODS=fillRelay,fillRelayWithUpdatedDeposit

# Extend validity window to 50 blocks
FLASHBOTS_MAX_BLOCKS_IN_FUTURE=50

# Custom relay URL (optional)
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
```

## How It Works

### Transaction Flow with Flashbots

1. **Transaction Creation**: When `fillRelay()` or other configured methods are called
2. **Flashbots Check**: System checks if Flashbots is enabled for this chain and method
3. **Populate Transaction**: Uses `contract.populateTransaction[method]()` to get unsigned transaction
4. **Submit to Relay**: Sends transaction to Flashbots relay instead of public mempool
5. **Builder Inclusion**: Flashbots builders include the transaction in their blocks
6. **Confirmation**: Transaction is mined privately without being visible in mempool

### Normal Transaction Flow (Flashbots Disabled)

1. Transaction is signed and sent to public RPC endpoint
2. Transaction appears in public mempool
3. Miners include transaction from mempool
4. Transaction is confirmed

## Logging

When Flashbots is active, you'll see log messages like:

```json
{
  "at": "FlashbotsUtils",
  "message": "Submitting transaction via Flashbots 🥷",
  "method": "fillRelay",
  "chainId": 1,
  "relayUrl": "https://relay.flashbots.net"
}
```

```json
{
  "at": "TxUtil",
  "message": "Sending via Flashbots",
  "currentBlockNumber": 18500000,
  "maxBlockNumber": 18500025,
  "method": "fillRelay"
}
```

## Security Considerations

### Two Keys Required

1. **Transaction Signing Key** (`PRIVATE_KEY`): Your existing key that signs transactions and must have funds
2. **Flashbots Auth Key** (`FLASHBOTS_AUTH_PRIVATE_KEY`): New key only for Flashbots authentication (no funds needed)

### Why Two Keys?

- **Separation of Concerns**: Authentication is separate from transaction signing
- **Security**: Flashbots auth key has no value if compromised (can't steal funds)
- **Flexibility**: Can rotate auth keys without affecting transaction keys

### Generating Auth Key

```bash
# Using OpenSSL
openssl rand -hex 32

# Using cast (Foundry)
cast wallet new

# Using ethers
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Testing

### Testing on Goerli

1. Set `FLASHBOTS_ENABLED=true`
2. Configure `FLASHBOTS_AUTH_PRIVATE_KEY`
3. Ensure you're connected to Goerli (chain ID 5)
4. Run relayer - Flashbots will automatically use the Goerli relay

### Verifying Flashbots is Active

Check logs for:

- `"message": "Submitting transaction via Flashbots 🥷"`
- Transactions will NOT appear in public mempool explorers until mined
- Transaction hashes are still returned and can be monitored

## Troubleshooting

### Error: "FLASHBOTS_AUTH_PRIVATE_KEY environment variable must be set"

**Solution**: Add `FLASHBOTS_AUTH_PRIVATE_KEY` to your `.env` file

### Error: "Flashbots relay URL not configured for chain X"

**Solution**: Flashbots only supports chains 1 and 5. The system will automatically fall back to normal transactions on other chains.

### Transactions Not Being Included

**Possible causes**:

1. **Gas price too low**: Flashbots requires competitive gas prices
2. **Transaction will revert**: Flashbots builders may not include reverting transactions
3. **Network congestion**: Try increasing `FLASHBOTS_MAX_BLOCKS_IN_FUTURE`

### Checking Transaction Status

Flashbots transactions can be monitored just like regular transactions using the transaction hash. However, they won't appear in mempool explorers until mined.

## Performance Considerations

- **Latency**: Flashbots adds minimal latency (typically <100ms)
- **Reliability**: Fallback to public mempool is automatic if Flashbots fails
- **Gas**: Flashbots requires competitive gas prices for inclusion

## References

- [Flashbots Documentation](https://docs.flashbots.net/)
- [Flashbots ethers.js Provider](https://github.com/flashbots/ethers-provider-flashbots-bundle)
- [Flashbots Relay](https://docs.flashbots.net/flashbots-auction/searchers/advanced/rpc-endpoint)
