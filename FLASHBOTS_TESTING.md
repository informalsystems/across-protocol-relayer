# Flashbots Testing & Verification Guide

This guide helps you test and verify the Flashbots integration.

## Pre-Test Checklist

Before testing, ensure you have:

- [x] Generated a Flashbots auth key
- [x] Added `FLASHBOTS_ENABLED=true` to `.env`
- [x] Added `FLASHBOTS_AUTH_PRIVATE_KEY` to `.env`
- [x] Built the project: `yarn build` ✅ (completed)

## Verification Methods

### Method 1: Check Build

Verify the implementation compiles:

```bash
yarn build
```

Expected: Build succeeds with no errors ✅

### Method 2: Dry Run with Logs

Enable debug logging and run the relayer:

```bash
# In your .env
LOG_LEVEL=debug
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...

# Run
yarn relay
```

Look for these log messages:

#### When Flashbots is Enabled

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

#### When Transaction is Submitted

```json
{
  "at": "TxUtil",
  "message": "Transaction sent via Flashbots",
  "hash": "0x1234...",
  "maxBlockNumber": 18500025
}
```

### Method 3: Test on Goerli First

Recommended: Test on Goerli testnet before mainnet:

```bash
# .env
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...

# Connect to Goerli RPC
# Your existing Goerli configuration
```

Expected behavior:

- Logs show Goerli relay URL: `https://relay-goerli.flashbots.net`
- Transactions sent via Flashbots on chain ID 5
- Other chains use normal submission

### Method 4: Verify Transaction Privacy

When a fillRelay transaction is submitted via Flashbots:

1. **Before Mining**: Transaction hash exists but won't appear on:
   - Etherscan pending transactions
   - Public mempool explorers
   - Other mempool monitoring tools

2. **After Mining**: Transaction appears normally on:
   - Etherscan
   - Block explorers
   - Your monitoring tools

**Test**: Submit a fillRelay and check if it appears in mempool before mining. If using Flashbots, it should NOT appear.

### Method 5: Compare Behavior

Test both modes to verify fallback works:

#### Test A: Flashbots Enabled (Chain 1)

```bash
FLASHBOTS_ENABLED=true
# On Mainnet
```

Expected: fillRelay uses Flashbots ✓

#### Test B: Flashbots Disabled

```bash
FLASHBOTS_ENABLED=false
# On Mainnet
```

Expected: fillRelay uses public mempool ✓

#### Test C: Unsupported Chain

```bash
FLASHBOTS_ENABLED=true
# On Arbitrum (chain 42161)
```

Expected: Automatically falls back to public mempool ✓

## Unit Testing (Code Verification)

### Test Utility Functions

Create a simple test file `test-flashbots.ts`:

```typescript
import { 
  shouldUseFlashbots, 
  isFlashbotsEnabled,
  isFlashbotsSupportedChain 
} from "./src/utils/FlashbotsUtils";

// Test 1: Check if Flashbots is enabled
console.log("Flashbots enabled:", isFlashbotsEnabled());

// Test 2: Check supported chains
console.log("Mainnet supported:", isFlashbotsSupportedChain(1)); // Should be true
console.log("Arbitrum supported:", isFlashbotsSupportedChain(42161)); // Should be false

// Test 3: Check method routing
process.env.FLASHBOTS_ENABLED = "true";
console.log("fillRelay should use Flashbots:", shouldUseFlashbots(1, "fillRelay")); // true
console.log("approve should use Flashbots:", shouldUseFlashbots(1, "approve")); // false
console.log("fillRelay on Arbitrum:", shouldUseFlashbots(42161, "fillRelay")); // false

// Test 4: Method filtering
process.env.FLASHBOTS_METHODS = "fillRelay";
console.log("Custom methods work:", shouldUseFlashbots(1, "fillRelay")); // true
console.log("Other methods excluded:", shouldUseFlashbots(1, "fillRelayWithUpdatedDeposit")); // false
```

Run:

```bash
ts-node test-flashbots.ts
```

## Integration Testing

### Scenario 1: Normal Fill Flow

1. Wait for a deposit on mainnet
2. Relayer identifies profitable fill
3. Check logs show Flashbots submission
4. Verify transaction mines successfully
5. Confirm transaction receipt is returned

### Scenario 2: Failed Transaction Handling

1. Submit a fillRelay that will revert (e.g., already filled)
2. Verify error handling works
3. Confirm retry logic functions correctly

### Scenario 3: Gas Price Competition

1. Submit fillRelay during high gas periods
2. Verify transaction is included within `FLASHBOTS_MAX_BLOCKS_IN_FUTURE`
3. Check gas price is competitive

## Expected Results Summary

| Scenario | Chain | Flashbots Enabled | Expected Behavior |
|----------|-------|-------------------|-------------------|
| fillRelay | Mainnet (1) | Yes | ✅ Uses Flashbots |
| fillRelay | Mainnet (1) | No | ✅ Uses public mempool |
| fillRelay | Goerli (5) | Yes | ✅ Uses Flashbots (Goerli relay) |
| fillRelay | Arbitrum (42161) | Yes | ✅ Falls back to public mempool |
| approve | Mainnet (1) | Yes | ✅ Uses public mempool (not in method list) |
| Other methods | Any | Yes | ✅ Uses public mempool (not in method list) |

## Monitoring in Production

### Key Metrics to Track

1. **Success Rate**: Percentage of Flashbots transactions that get mined
2. **Inclusion Time**: How many blocks until inclusion
3. **Fallback Rate**: How often fallback to public mempool occurs
4. **Gas Efficiency**: Compare gas costs vs public mempool

### Log Monitoring

Set up alerts for:

```json
// Successful Flashbots submission
{"message": "Transaction sent via Flashbots"}

// Flashbots errors
{"message": "Error executing tx", "method": "fillRelay"}

// Fallback to public mempool
{"message": "Send tx", "method": "fillRelay"} // Without Flashbots log
```

## Troubleshooting Tests

### Build Errors

**Problem**: TypeScript compilation fails  
**Check**:

- `yarn build` output
- Import statements in FlashbotsUtils.ts
- Type definitions

### Runtime Errors

**Problem**: `Cannot find module '@flashbots/ethers-provider-bundle'`  
**Solution**: `yarn add @flashbots/ethers-provider-bundle`

**Problem**: `FLASHBOTS_AUTH_PRIVATE_KEY environment variable must be set`  
**Solution**: Add key to `.env` file

### Unexpected Behavior

**Problem**: Transactions still appearing in mempool  
**Check**:

1. Is `FLASHBOTS_ENABLED=true`?
2. Is chain ID 1 or 5?
3. Is method in `FLASHBOTS_METHODS` list?
4. Check logs for Flashbots confirmation

**Problem**: Transactions not being mined  
**Possible causes**:

1. Gas price too low
2. Transaction would revert
3. Network congestion
4. Try increasing `FLASHBOTS_MAX_BLOCKS_IN_FUTURE`

## Performance Testing

### Latency Test

Measure time difference:

```typescript
// Before (public mempool)
const start = Date.now();
await contract.fillRelay(...);
console.log("Public mempool:", Date.now() - start, "ms");

// After (Flashbots)
const start = Date.now();
await contract.fillRelay(...); // With Flashbots enabled
console.log("Flashbots:", Date.now() - start, "ms");
```

Expected: Similar latency (< 100ms difference)

### Throughput Test

Submit multiple fills:

- Public mempool: Sequential due to nonce management
- Flashbots: Also sequential (same nonce management)

Expected: Similar throughput

## Security Verification

### Key Separation Test

Verify two separate keys are used:

```bash
# Transaction signing key (has funds)
echo $PRIVATE_KEY

# Flashbots auth key (no funds needed)
echo $FLASHBOTS_AUTH_PRIVATE_KEY
```

These should be DIFFERENT keys.

### Auth Key Safety Test

1. Check that `FLASHBOTS_AUTH_PRIVATE_KEY` has no funds
2. Verify it's not used for transaction signing
3. Confirm it's only for Flashbots authentication

## Next Steps After Testing

Once testing is complete:

1. ✅ Verify build succeeds
2. ✅ Test on Goerli
3. ✅ Monitor logs for Flashbots messages
4. ✅ Verify transactions mine correctly
5. ✅ Test fallback on unsupported chains
6. 🚀 Deploy to mainnet with monitoring
7. 📊 Track metrics and adjust configuration

## Questions?

- Review [FLASHBOTS_CONFIG.md](./FLASHBOTS_CONFIG.md) for configuration details
- Review [FLASHBOTS_QUICKSTART.md](./FLASHBOTS_QUICKSTART.md) for setup
- Check [Flashbots Documentation](https://docs.flashbots.net/)
