# MEV-Share Configuration

This document describes how to configure and use MEV-Share for partial privacy transactions in the Across Protocol relayer.

## Overview

MEV-Share allows transactions to be submitted with partial privacy, where certain transaction details are shared with MEV searchers while others remain private. This can help with transaction inclusion and potentially reduce MEV extraction.

## Environment Variables

### Core Configuration

- `PRIVATE_TX_ENABLED`: Set to `"true"` to submit private transaction using eth_submitPrivateTransaction RPC endpoint.
- `MEV_SHARE_BUNDLE_ENABLED`: Set to `"true"` to submit transaction in a bundle to mev_sendBundle RPC endpoint.
- `FLASHBOTS_AUTH_PRIVATE_KEY`: **REQUIRED** - Private key for MEV-Share authentication
- `MEV_SHARE_SIMULATE`: Enable transaction simulation before sending (default: `true`)
- `FLASHBOTS_MAX_BLOCKS_INCLUSION`: Maximum block number for transaction inclusion (optional)
- `MEV_SHARE_CONFIRMATION_TIMEOUT`: Maximum timeout to wait for a transaction inclusion submitted using Flashbots

### (TODO) Privacy Hints Configuration

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
