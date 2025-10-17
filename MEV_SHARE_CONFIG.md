# MEV-Share Configuration

This document describes how to configure and use MEV-Share for partial privacy transactions in the Across Protocol relayer.

## Overview

MEV-Share allows transactions to be submitted with partial privacy, where certain transaction details are shared with MEV searchers while others remain private. This can help with transaction inclusion and potentially reduce MEV extraction.

## Environment Variables

### Core Configuration

- `MEV_SHARE_ENABLED`: Set to `"true"` to enable MEV-Share for supported chains
- `FLASHBOTS_AUTH_PRIVATE_KEY`: **REQUIRED** - Private key for MEV-Share authentication
- `MEV_SHARE_SIMULATE`: Enable transaction simulation before sending (default: `true`)
- `MEV_SHARE_MAX_BLOCK_NUMBER`: Maximum block number for transaction inclusion (optional)

### Privacy Hints Configuration

Control which transaction details are shared with MEV searchers:

- `MEV_SHARE_HINTS_LOGS`: Share transaction logs (default: `true`)
- `MEV_SHARE_HINTS_CALLDATA`: Share transaction calldata (default: `false`)
- `MEV_SHARE_HINTS_FUNCTION_SELECTOR`: Share function selector (default: `true`)
- `MEV_SHARE_HINTS_CONTRACT_ADDRESS`: Share contract address (default: `true`)
- `MEV_SHARE_HINTS_TX_HASH`: Share transaction hash (default: `false`)

## Supported Networks

MEV-Share is currently supported on:

- **Ethereum Mainnet** (Chain ID: 1)
- **Goerli Testnet** (Chain ID: 5)
- **Sepolia Testnet** (Chain ID: 11155111)

## Privacy Levels

### High Privacy (Recommended for sensitive transactions)

```bash
MEV_SHARE_HINTS_LOGS=false
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=false
MEV_SHARE_HINTS_CONTRACT_ADDRESS=false
MEV_SHARE_HINTS_TX_HASH=false
```

### Medium Privacy (Balanced approach)

```bash
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=false
```

### Low Privacy (Maximum sharing for better inclusion)

```bash
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=true
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=true
```

## Authentication Setup

MEV-Share requires authentication using a private key. This key is used to sign requests to the MEV-Share API.

### Generate a Private Key

You can generate a new private key using ethers.js:

```bash
node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
```

### Set Environment Variable

```bash
export FLASHBOTS_AUTH_PRIVATE_KEY=0x8e298e0993e99b1f293dcf9c705adff7944b15cece6ecace53b58d5b3b218b0f
```

**Important**: This private key is only used for authentication with MEV-Share and does not need to hold any funds. It's safe to use a newly generated key.

## Example Configuration

### For Testing on Sepolia

```bash
MEV_SHARE_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x8e298e0993e99b1f293dcf9c705adff7944b15cece6ecace53b58d5b3b218b0f
MEV_SHARE_SIMULATE=true
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=false
MEV_SHARE_MAX_BLOCK_NUMBER=10
```

### For Production on Mainnet

```bash
MEV_SHARE_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=your_production_private_key_here
MEV_SHARE_SIMULATE=true
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=false
```

## How It Works

1. **Transaction Preparation**: The relayer prepares the transaction as usual
2. **Transaction Simulation** (if enabled): The transaction is simulated using both standard provider simulation and MEV-Share bundle simulation
3. **Privacy Hints**: Based on configuration, certain transaction details are marked for sharing
4. **MEV-Share Submission**: The transaction is submitted to the MEV-Share relay with privacy hints
5. **MEV Searcher Visibility**: Searchers can see the shared hints but not the full transaction details
6. **Bundle Creation**: Searchers can create bundles that include your transaction
7. **Inclusion**: The transaction is included in a block, potentially with MEV kickbacks

## Transaction Simulation

MEV-Share transactions are automatically simulated before sending to ensure they will succeed:

### Standard Simulation

- Uses the provider's `call` method to simulate the transaction
- Checks if the transaction would succeed without actually executing it
- Provides the return data from the simulation

### MEV-Share Bundle Simulation

- Uses MEV-Share's own `simulateBundle` method
- Provides additional information about gas usage, fees, and MEV potential
- Shows coinbase differences and refundable values

### Simulation Control

- Set `MEV_SHARE_SIMULATE=false` to disable simulation
- Simulation failures are logged but don't prevent transaction submission
- Both simulation methods are attempted for maximum coverage

## Benefits

- **Better Inclusion**: MEV searchers can see transaction hints and create profitable bundles
- **MEV Protection**: Partial privacy reduces the risk of frontrunning
- **Flexible Privacy**: Configure exactly what information to share
- **MEV Kickbacks**: Potential rewards from successful bundles

## Considerations

- **Privacy Trade-offs**: More hints shared = better inclusion but less privacy
- **MEV Risk**: Even with hints, there's still some MEV risk
- **Network Support**: Only works on supported networks
- **Gas Costs**: May have different gas dynamics than standard transactions

## Monitoring

The relayer will log MEV-Share transactions with:

- Privacy level details
- Hint configuration
- Transaction hash
- Submission status

Look for logs with `at: "TxUtil#MEV-Share"` to monitor MEV-Share activity.

## Troubleshooting

### Common Issues

1. **Unsupported Network**: Ensure you're using a supported chain ID
2. **Configuration Errors**: Check that all environment variables are properly set
3. **Transaction Failures**: MEV-Share transactions may fail if not competitive enough

### Debug Mode

Enable debug logging to see detailed MEV-Share information:

```bash
LOG_LEVEL=debug
```

## Integration with Flashbots

MEV-Share and Flashbots can be used together:

- MEV-Share for partial privacy
- Flashbots for private transactions
- The relayer will choose MEV-Share if enabled and supported, otherwise fall back to Flashbots or standard mempool
