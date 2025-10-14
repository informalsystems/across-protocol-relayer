# Flashbots Usage Guide

## Quick Start

### Minimal Configuration

```bash
# .env
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x<your_auth_key>
```

Run:

```bash
yarn build && yarn relay
```

---

## Advanced Features

### 1. Transaction Simulation (Recommended)

Simulate transactions before sending to validate they will succeed:

```bash
# .env
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
FLASHBOTS_SIMULATE=true
```

**Benefits:**

- Catches reverting transactions before submission
- Shows gas usage estimates
- Displays coinbase diff (miner payment)
- Provides bundle hash for tracking

**Expected Logs:**

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Flashbots simulation result",
  "bundleHash": "0x...",
  "coinbaseDiff": "0",
  "totalGasUsed": 112137,
  "firstResult": {
    "success": true,
    "gasUsed": 112137
  }
}
```

**If simulation fails:**

```json
{
  "firstResult": {
    "success": false,
    "error": "execution reverted",
    "revert": "RelayFilled"
  }
}
```

### 2. Abort on Simulation Failure

Prevent submitting transactions that would revert:

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=true  # ← Strict mode
```

**Behavior:**

- ✅ Simulation succeeds → Submit transaction
- ❌ Simulation fails → Abort, don't submit

**Use case:** Prevent wasting gas on known failures

### 3. Wait for Transaction Inclusion

Monitor transactions until they're mined:

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_WAIT=true
```

**Behavior:**

- Waits up to 30 seconds for transaction to be mined
- Logs when transaction is included in a block
- Shows gas used and block number
- Continues even if timeout (transaction may still be pending)

**Expected Logs:**

```json
{
  "message": "Waiting for Flashbots transaction to be mined...",
  "hash": "0x...",
  "maxBlockNumber": 9403534
}
```

**When mined:**

```json
{
  "message": "Flashbots transaction mined ⛏️",
  "hash": "0x...",
  "blockNumber": 9403510,
  "status": 1,
  "gasUsed": "112137",
  "includedInBlock": 1
}
```

**If timeout:**

```json
{
  "message": "Transaction not mined within timeout (may still be pending)",
  "hash": "0x..."
}
```

---

## Complete Configuration

```bash
# Required
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x<auth_key>

# Optional - Simulation
FLASHBOTS_SIMULATE=true                    # Enable pre-submission simulation
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=true    # Abort if simulation fails

# Optional - Waiting
FLASHBOTS_WAIT=true                        # Wait for transaction to be mined

# Optional - Methods
FLASHBOTS_METHODS=fillRelay,fillRelayWithUpdatedDeposit

# Optional - Block Range
FLASHBOTS_MAX_BLOCKS_IN_FUTURE=25          # How many blocks tx is valid for

# Optional - Custom Relay
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
```

---

## Configuration Combinations

### Production (Fast, No Waiting)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
# Don't simulate or wait - fastest submission
```

### Production (With Validation)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
FLASHBOTS_SIMULATE=true                    # Validate before sending
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=true    # Skip known failures
```

### Development (Full Monitoring)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
FLASHBOTS_SIMULATE=true         # See simulation results
FLASHBOTS_WAIT=true             # Wait for confirmation
LOG_LEVEL=debug                 # Verbose logging
```

### Testing on Sepolia

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
FLASHBOTS_SIMULATE=true
FLASHBOTS_WAIT=true
# Connects to https://relay-sepolia.flashbots.net automatically
```

---

## Transaction Flow

### Without Optional Features

```
1. Sign transaction
2. Submit to Flashbots relay
3. Return immediately
4. Transaction propagates to builders
```

### With Simulation

```
1. Sign transaction
2. Simulate on Flashbots ← NEW
3. Check if would revert ← NEW
4. Submit to Flashbots relay (if simulation OK)
5. Return immediately
```

### With Waiting

```
1. Sign transaction
2. Submit to Flashbots relay
3. Wait for transaction to be mined ← NEW
4. Log confirmation details ← NEW
5. Return with receipt
```

### With Everything Enabled

```
1. Sign transaction
2. Simulate on Flashbots ← Validate
3. Abort if simulation fails ← Safety
4. Submit to Flashbots relay
5. Wait for mining ← Confirmation
6. Log success/failure ← Monitoring
7. Return with receipt
```

---

## Important Notes

### Legacy Transaction Format

Flashbots v0.5.0 requires **legacy transactions** (type 0), not EIP-1559 (type 2).

**Automatic conversion:**

```typescript
// Your code uses EIP-1559 (maxFeePerGas)
gas = {
  maxFeePerGas: BigNumber,
  maxPriorityFeePerGas: BigNumber
}

// Flashbots converts to legacy (gasPrice)
unsignedTx = {
  gasPrice: maxFeePerGas,  // Uses your max as gasPrice
  type: 0                   // Legacy transaction
}
```

**Gas Price Strategy:**

- Uses `maxFeePerGas` as `gasPrice`
- You pay the maximum you were willing to pay
- Ensures competitive pricing
- Simpler than EIP-1559 priority fee calculation

### Pre-Signed Transactions

Transactions are **signed BEFORE** sending to Flashbots:

```typescript
// 1. Sign locally (supports all transaction types)
const signedTx = await signer.signTransaction(unsignedTx);

// 2. Send signed transaction to Flashbots
await flashbotsProvider.sendPrivateTransaction({
  signedTransaction: signedTx  // Already signed
});
```

**Benefits:**

- Bypasses Flashbots transaction validation
- We control the signing process
- Full compatibility with legacy format

---

## Monitoring & Logs

### Key Log Messages

#### Submission Started

```json
{
  "at": "FlashbotsUtils",
  "message": "Submitting transaction via Flashbots 🥷",
  "method": "fillRelay",
  "chainId": 11155111
}
```

#### Legacy Conversion

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Transaction converted to legacy format for Flashbots",
  "converted": {
    "gasPrice": "0x1cdc49",
    "type": 0,
    "note": "Using maxFeePerGas as gasPrice for Flashbots compatibility"
  }
}
```

#### Transaction Signed

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Transaction signed",
  "txHash": "0x...",
  "signedTxLength": 542
}
```

#### Simulation Result (if enabled)

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Flashbots simulation result",
  "bundleHash": "0x...",
  "coinbaseDiff": "0",
  "totalGasUsed": 112137,
  "firstResult": {
    "success": true,
    "gasUsed": 112137
  }
}
```

#### Submission Complete

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Transaction submitted to Flashbots relay 🥷",
  "hash": "0x...",
  "currentBlock": 9403617,
  "maxBlockNumber": 9403642,
  "validForBlocks": 25
}
```

#### Transaction Mined (if waiting enabled)

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Flashbots transaction mined ⛏️",
  "hash": "0x...",
  "blockNumber": 9403618,
  "status": 1,
  "gasUsed": "112137",
  "includedInBlock": 1
}
```

---

## Troubleshooting

### Transaction Not Mined

**Possible reasons:**

1. **Gas price too low** - Builders didn't find it profitable
2. **Transaction would revert** - Builders skip reverting transactions
3. **Competition** - Another transaction filled the deposit first
4. **Network congestion** - Not enough block space

**Solutions:**

- Enable simulation to check for reverts
- Increase `FLASHBOTS_MAX_BLOCKS_IN_FUTURE`
- Check gas prices are competitive
- Monitor for nonce conflicts

### Simulation Shows Revert

**Action:**

```json
{
  "firstResult": {
    "success": false,
    "error": "execution reverted",
    "revert": "RelayFilled"
  }
}
```

**Meaning:** Transaction would revert (e.g., deposit already filled)

**Solution:** This is expected! Enable `FLASHBOTS_ABORT_ON_SIMULATION_FAIL=true` to skip these automatically.

### Transaction Timeout

**Action:**

```json
{
  "message": "Transaction not mined within timeout (may still be pending)"
}
```

**Meaning:** Transaction wasn't mined within 30 seconds

**What to do:**

- Check transaction on Etherscan using the hash
- It may still be pending with builders
- May be included in future blocks
- May have been dropped if no longer profitable

---

## Performance Considerations

### Simulation Impact

- **Latency**: +200-500ms per transaction
- **Cost**: Free (no gas cost)
- **Benefit**: Prevents failed submissions

**Recommendation:** Enable for high-value transactions, disable for high-frequency fills

### Waiting Impact

- **Latency**: +2-30 seconds per transaction
- **Benefit**: Immediate confirmation feedback

**Recommendation:**

- **Disable in production** for speed
- **Enable in testing** for monitoring

### Optimal Production Config

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
# No simulation (fastest)
# No waiting (fastest)
# Let monitoring tools track confirmations separately
```

---

## Testing Workflow

### Step 1: Test with Simulation

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true
```

Run relayer and verify simulations pass.

### Step 2: Test with Waiting

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_WAIT=true
```

Verify transactions are mined successfully.

### Step 3: Test Full Flow

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true
FLASHBOTS_WAIT=true
```

Complete monitoring from submission to confirmation.

### Step 4: Production Deploy

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_AUTH_PRIVATE_KEY=0x...
# Remove SIMULATE and WAIT for speed
```

Fast submission, monitor externally.

---

## Environment Variables Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FLASHBOTS_ENABLED` | boolean | `false` | Master enable switch |
| `FLASHBOTS_AUTH_PRIVATE_KEY` | string | Required | Auth key for relay |
| `FLASHBOTS_METHODS` | string | `fillRelay,...` | Methods to use Flashbots |
| `FLASHBOTS_MAX_BLOCKS_IN_FUTURE` | number | `25` | Transaction validity window |
| `FLASHBOTS_SIMULATE` | boolean | `false` | Enable pre-submission simulation |
| `FLASHBOTS_ABORT_ON_SIMULATION_FAIL` | boolean | `false` | Skip transactions that would revert |
| `FLASHBOTS_WAIT` | boolean | `false` | Wait for transaction mining |
| `FLASHBOTS_RELAY_URL` | string | Auto | Custom relay URL |
| `FLASHBOTS_RELAY_URL_{CHAIN_ID}` | string | Auto | Chain-specific relay URL |

---

## Transaction Lifecycle

### Without Flashbots (Public Mempool)

```
Sign → Send to RPC → Mempool → Miner picks → Mined
         ↑ Visible to everyone
```

### With Flashbots (Private)

```
Sign → Send to Flashbots → Builders only → Mined
         ↑ Hidden from public
```

### With Flashbots + Simulation

```
Sign → Simulate → Pass? → Send to Flashbots → Builders → Mined
                   ↓ Fail
                   Abort (optional)
```

### With Flashbots + Simulation + Waiting

```
Sign → Simulate → Send → Wait → Mined? → Success ✅
                            ↓ Timeout
                            Pending (check later)
```

---

## Success Indicators

✅ **Transaction successfully sent when you see:**

```json
{"message": "Transaction submitted to Flashbots relay 🥷"}
```

✅ **Simulation passed:**

```json
{"firstResult": {"success": true}}
```

✅ **Transaction mined:**

```json
{"message": "Flashbots transaction mined ⛏️", "status": 1}
```

---

## Next Steps

1. ✅ Basic submission working
2. 🔄 Enable simulation for validation
3. 🔄 Monitor transaction inclusion rates
4. 🔄 Tune `FLASHBOTS_MAX_BLOCKS_IN_FUTURE` based on inclusion times
5. 🚀 Deploy to production

---

For more details, see:

- [FLASHBOTS_CONFIG.md](./FLASHBOTS_CONFIG.md) - Complete configuration
- [FLASHBOTS_FIXES.md](./FLASHBOTS_FIXES.md) - Technical details
