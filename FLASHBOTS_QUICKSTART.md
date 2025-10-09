# Flashbots Quick Start Guide

Get started with Flashbots integration in 3 simple steps.

## Step 1: Generate Auth Key

Generate a new private key for Flashbots authentication (this key doesn't need funds):

```bash
# Using OpenSSL
openssl rand -hex 32

# Or using Node.js
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output - you'll need it in the next step.

## Step 2: Configure Environment

Add these to your `.env` file:

```bash
# Enable Flashbots
FLASHBOTS_ENABLED=true

# Add your auth key from Step 1
FLASHBOTS_AUTH_PRIVATE_KEY=0x<your_generated_key_here>
```

That's it! Your existing `PRIVATE_KEY` and other configuration remain unchanged.

## Step 3: Run Your Relayer

Start your relayer normally:

```bash
yarn relay
```

### Verify It's Working

Look for these log messages:

```json
{
  "message": "Submitting transaction via Flashbots 🥷",
  "method": "fillRelay",
  "chainId": 1
}
```

## What Happens Now?

✅ **fillRelay transactions on Mainnet** → Sent via Flashbots (private)  
✅ **Other transactions** → Sent normally (public mempool)  
✅ **Transactions on other chains** → Sent normally (public mempool)

## Configuration Options

### Change Which Methods Use Flashbots

```bash
# Only use Flashbots for specific methods
FLASHBOTS_METHODS=fillRelay,fillRelayWithUpdatedDeposit
```

### Extend Transaction Validity Window

```bash
# Try to include transaction up to 50 blocks in the future
FLASHBOTS_MAX_BLOCKS_IN_FUTURE=50
```

## Testing on Goerli

Same configuration works on Goerli testnet automatically:

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x<your_key>
```

Just connect your relayer to Goerli (chain ID 5) and it will use the Goerli Flashbots relay.

## Benefits You Get

1. **MEV Protection**: Your fillRelay transactions are hidden from front-runners
2. **Failed Tx Privacy**: Reverted transactions aren't publicly visible
3. **Competitive Edge**: Other relayers can't see your strategy
4. **Same UX**: Transaction hashes, monitoring, and receipts work the same

## Troubleshooting

**Problem**: `FLASHBOTS_AUTH_PRIVATE_KEY environment variable must be set`  
**Solution**: Add `FLASHBOTS_AUTH_PRIVATE_KEY` to your `.env` file

**Problem**: Transactions not being included  
**Solution**: Ensure gas prices are competitive. Check logs for errors.

**Problem**: Want to disable Flashbots temporarily  
**Solution**: Set `FLASHBOTS_ENABLED=false` or remove the variable

## Full Documentation

For advanced configuration and detailed information, see:

- [`FLASHBOTS_CONFIG.md`](./FLASHBOTS_CONFIG.md) - Complete configuration guide
- [Flashbots Docs](https://docs.flashbots.net/) - Official Flashbots documentation

## Need Help?

- Check logs for `"Flashbots"` messages
- Verify you're on Mainnet (chain ID 1) or Goerli (chain ID 5)
- Confirm `FLASHBOTS_ENABLED=true` is in your `.env`
- Make sure `FLASHBOTS_AUTH_PRIVATE_KEY` is set
