# Flashbots Integration Fixes

## Issues Fixed

### 1. ✅ BigNumber Serialization Error

**Problem:**

```
invalid object key - maxFeePerGas
value={"maxFeePerGas":{"type":"BigNumber","hex":"0x178873"},...}
```

**Root Cause:**
When using `contract.populateTransaction[method]()`, ethers returns a transaction object where BigNumber fields are in a serialized format: `{"type":"BigNumber","hex":"0x..."}`. When this object is passed to Flashbots and then to the signer, ethers can't properly serialize these nested objects.

**Solution:**
Normalize all BigNumber fields by reconstructing them with `BigNumber.from()` before passing to Flashbots:

```typescript
// Lines 207-222 in TransactionUtils.ts
const populatedTx = await contract.populateTransaction[method](...args, txConfig);

// Normalize BigNumber fields for Flashbots
unsignedTx = {
  ...populatedTx,
  gasLimit: populatedTx.gasLimit ? BigNumber.from(populatedTx.gasLimit) : undefined,
  maxFeePerGas: populatedTx.maxFeePerGas ? BigNumber.from(populatedTx.maxFeePerGas) : undefined,
  maxPriorityFeePerGas: populatedTx.maxPriorityFeePerGas 
    ? BigNumber.from(populatedTx.maxPriorityFeePerGas) 
    : undefined,
  gasPrice: populatedTx.gasPrice ? BigNumber.from(populatedTx.gasPrice) : undefined,
  value: populatedTx.value ? BigNumber.from(populatedTx.value) : undefined,
  nonce: populatedTx.nonce,
};
```

**Why This Works:**
`BigNumber.from()` accepts:

- Plain BigNumber instances → returns as-is
- Serialized BigNumber objects `{"type":"BigNumber","hex":"0x..."}` → reconstructs to proper BigNumber
- Hex strings → converts to BigNumber
- Numbers → converts to BigNumber

This ensures all fields are proper BigNumber instances that ethers can serialize correctly.

---

### 2. ✅ Undefined Parameter Formatting Error (Already Fixed)

**Problem:**

```
invalid BigNumber value (argument="value", value=undefined, ...)
at getGasPrice (.../TransactionUtils.js:221:41)
```

**Solution:**
Added conditional checks before formatting optional parameters:

```typescript
// Lines 327, 331, 356, 385 in TransactionUtils.ts
depositId: depositId ? ethers.utils.formatUnits(depositId, "wei") : undefined,
gasLimit: gasLimit ? ethers.utils.formatUnits(gasLimit, "wei") : undefined,
```

---

## Testing the Fixes

### 1. Verify Source Maps Work

Run the relayer and check that stack traces show TypeScript files:

```bash
yarn relay
```

**Before (no source maps):**

```
at getGasPrice (.../dist/src/utils/TransactionUtils.js:221:41)
```

**After (with source maps):**

```
at getGasPrice (.../src/utils/TransactionUtils.ts:327:5)
```

### 2. Test Flashbots Transaction Submission

Enable Flashbots and attempt a fill:

```bash
# .env
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...

# Run
yarn relay
```

**Expected logs:**

```json
{
  "at": "FlashbotsUtils",
  "message": "Submitting transaction via Flashbots 🥷",
  "method": "fillRelay",
  "chainId": 11155111
}

{
  "at": "TxUtil",
  "message": "Sending via Flashbots",
  "currentBlockNumber": 123456,
  "maxBlockNumber": 123481,
  "method": "fillRelay",
  "unsignedTx": {
    "to": "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662",
    "nonce": 10,
    "gasLimit": "137533",
    "maxFeePerGas": "1542259"
  }
}

{
  "at": "TxUtil",
  "message": "Transaction sent via Flashbots",
  "hash": "0x1234...",
  "maxBlockNumber": 123481
}
```

---

## Key Improvements

### 1. Source Maps Enabled

**`tsconfig.json` changes:**

```json
{
  "compilerOptions": {
    "sourceMap": true,
    "inlineSources": true
  }
}
```

**`package.json` script changes:**

```json
{
  "relay": "node --enable-source-maps ./dist/index.js --relayer",
  "relay:dev": "ts-node ./src/index.ts --relayer",
  "relay:debug": "node --inspect --enable-source-maps ./dist/index.js --relayer"
}
```

**Benefits:**

- Stack traces point to TypeScript files
- Line numbers match your source code
- Faster debugging

### 2. Enhanced Flashbots Logging

Added detailed logging before Flashbots submission (line 230-242):

```typescript
logger.debug({
  at: "TxUtil",
  message: "Sending via Flashbots",
  currentBlockNumber,
  maxBlockNumber,
  method,
  unsignedTx: {
    to: unsignedTx.to,
    nonce: unsignedTx.nonce,
    gasLimit: unsignedTx.gasLimit?.toString(),
    maxFeePerGas: unsignedTx.maxFeePerGas?.toString(),
  },
});
```

This helps verify transaction parameters before submission.

---

## Common Pitfalls & Solutions

### Pitfall 1: Forgetting to Rebuild

**Error:** Changes don't take effect

**Solution:**

```bash
yarn build
```

Or use watch mode during development:

```bash
yarn watch
```

### Pitfall 2: Old Source Maps

**Error:** Line numbers don't match after editing

**Solution:** Always rebuild after code changes

```bash
yarn build && yarn relay
```

### Pitfall 3: Flashbots Version Compatibility

**Current version:** `@flashbots/ethers-provider-bundle@0.5.0` (downgraded from 1.0.0)

**Why:** Version 1.0.0 uses ethers v6, but this project uses ethers v5. Using v0.5.0 ensures compatibility.

**Check your version:**

```bash
grep "@flashbots/ethers-provider-bundle" package.json
```

Should show: `"@flashbots/ethers-provider-bundle": "^0.5.0"`

---

## Debugging Checklist

When encountering Flashbots errors:

- [ ] Verify Flashbots is enabled: `FLASHBOTS_ENABLED=true`
- [ ] Check auth key is set: `FLASHBOTS_AUTH_PRIVATE_KEY=0x...`
- [ ] Confirm chain support: Sepolia (11155111) or Mainnet (1)
- [ ] Check logs for "Submitting transaction via Flashbots 🥷"
- [ ] Verify BigNumber fields are proper instances (not serialized objects)
- [ ] Check source maps are working (stack traces show .ts files)
- [ ] Review gas prices are competitive
- [ ] Confirm transaction nonce is correct

---

## Files Modified

1. `src/utils/TransactionUtils.ts` - Lines 207-222, 230-242
   - Added BigNumber normalization for Flashbots
   - Enhanced logging for debugging

2. `tsconfig.json` - Lines 8-10
   - Enabled source maps
   - Added inline sources

3. `package.json` - Lines 71-78
   - Updated scripts to use `--enable-source-maps`
   - Added `relay:dev` and `relay:debug` scripts

---

## Quick Commands

```bash
# Development with instant feedback
yarn relay:dev

# Production with source maps
yarn relay

# Debug with Chrome DevTools
yarn relay:debug
# Then open: chrome://inspect

# Build and run
yarn build && yarn relay

# Watch mode (auto-rebuild on changes)
yarn watch
# In another terminal:
yarn relay
```

---

## Success Indicators

✅ **Flashbots working when you see:**

- "Submitting transaction via Flashbots 🥷" in logs
- "Transaction sent via Flashbots" with transaction hash
- Transaction hash can be monitored (though not visible in mempool)
- Transaction confirms after a few blocks

❌ **Issues if you see:**

- "invalid object key" errors → BigNumber serialization problem
- "FLASHBOTS_AUTH_PRIVATE_KEY must be set" → Missing env var
- Stack traces pointing to `.js` files → Source maps not working
- Transactions in public mempool → Flashbots not enabled or chain not supported

---

For more debugging tips, see the stack traces - they now point directly to TypeScript source files! 🎯
