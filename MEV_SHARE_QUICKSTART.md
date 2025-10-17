# MEV-Share Quick Start Guide

This guide will help you quickly set up and test MEV-Share partial privacy transactions in the Across Protocol relayer.

## Prerequisites

- Node.js and Yarn installed
- Across Protocol relayer configured
- Ethereum testnet account with funds (Sepolia recommended)

## Step 1: Enable MEV-Share

Add these environment variables to your `.env` file:

```bash
# Enable MEV-Share
MEV_SHARE_ENABLED=true

# Privacy hints (customize based on your needs)
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=false

# Optional: Set max block number for inclusion
MEV_SHARE_MAX_BLOCK_NUMBER=10
```

## Step 2: Test on Sepolia

1. **Start the relayer** with MEV-Share enabled:

   ```bash
   MEV_SHARE_ENABLED=true yarn run-relayer
   ```

2. **Monitor logs** for MEV-Share activity:

   ```bash
   # Look for these log patterns:
   # "Submitting transaction via MEV-Share with partial privacy"
   # "Transaction submitted to MEV-Share relay 🎭"
   ```

3. **Check transaction status** - MEV-Share transactions will appear in logs with:
   - Privacy level details
   - Hint configuration
   - Transaction hash

## Step 3: Verify MEV-Share Integration

### Expected Log Output

When a transaction is sent via MEV-Share, you should see:

```json
{
  "at": "TxUtil#MEV-Share",
  "message": "Submitting transaction via MEV-Share with partial privacy",
  "method": "fillRelay",
  "chainId": 11155111,
  "hints": {
    "logs": true,
    "calldata": false,
    "functionSelector": true,
    "contractAddress": true,
    "txHash": false
  },
  "privacyLevel": {
    "logs": "shared",
    "calldata": "private",
    "functionSelector": "shared",
    "contractAddress": "shared",
    "txHash": "private"
  }
}
```

### Success Confirmation

```json
{
  "at": "TxUtil#MEV-Share",
  "message": "Transaction submitted to MEV-Share relay 🎭",
  "hash": "0x...",
  "hints": { ... },
  "privacyLevel": { ... }
}
```

## Step 4: Customize Privacy Settings

### High Privacy (Maximum Protection)

```bash
MEV_SHARE_HINTS_LOGS=false
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=false
MEV_SHARE_HINTS_CONTRACT_ADDRESS=false
MEV_SHARE_HINTS_TX_HASH=false
```

### Medium Privacy (Balanced)

```bash
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=false
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=false
```

### Low Privacy (Maximum Sharing)

```bash
MEV_SHARE_HINTS_LOGS=true
MEV_SHARE_HINTS_CALLDATA=true
MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
MEV_SHARE_HINTS_TX_HASH=true
```

## Step 5: Production Deployment

For mainnet deployment:

1. **Set production environment variables**:

   ```bash
   MEV_SHARE_ENABLED=true
   MEV_SHARE_HINTS_LOGS=true
   MEV_SHARE_HINTS_CALLDATA=false
   MEV_SHARE_HINTS_FUNCTION_SELECTOR=true
   MEV_SHARE_HINTS_CONTRACT_ADDRESS=true
   MEV_SHARE_HINTS_TX_HASH=false
   ```

2. **Monitor performance** - Check logs for:
   - Transaction inclusion rates
   - MEV-Share vs standard mempool performance
   - Any errors or issues

3. **Adjust settings** based on performance and requirements

## Troubleshooting

### Common Issues

1. **"MEV-Share not supported on chain X"**
   - Ensure you're using a supported chain (1, 5, 11155111)
   - Check `MEV_SHARE_ENABLED=true`

2. **"Failed to create MEV-Share client"**
   - Verify your signer is a valid Wallet instance
   - Check network connectivity

3. **Transactions not appearing in MEV-Share**
   - Check privacy hints configuration
   - Verify transaction is competitive enough
   - Monitor logs for submission confirmations

### Debug Mode

Enable detailed logging:

```bash
LOG_LEVEL=debug MEV_SHARE_ENABLED=true yarn run-relayer
```

## Next Steps

- **Monitor MEV-Share performance** vs standard mempool
- **Experiment with different privacy settings** to find optimal balance
- **Consider MEV-Share for specific transaction types** (e.g., high-value fills)
- **Integrate with monitoring tools** for production deployment

## Support

- Check logs for detailed error messages
- Review [MEV_SHARE_CONFIG.md](./MEV_SHARE_CONFIG.md) for advanced configuration
- Monitor transaction inclusion rates and adjust settings accordingly

