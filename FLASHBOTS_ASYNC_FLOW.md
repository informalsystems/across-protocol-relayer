# Flashbots Async Flow & Performance Analysis

## 🔄 Complete Async Flow Breakdown

### Phase 1: Transaction Preparation (Synchronous - Fast ⚡)

```typescript
// 1. Populate transaction (fast - local operation)
const populatedTx = await contract.populateTransaction[method](...args, txConfig);

// 2. Convert to legacy format (fast - local operation)  
const unsignedTx = {
  to: populatedTx.to,
  data: populatedTx.data,
  gasLimit: toHexString(populatedTx.gasLimit),
  gasPrice: toHexString(gasPriceForFlashbots), // ← Convert EIP-1559 to legacy
  value: toHexString(populatedTx.value),
  nonce: populatedTx.nonce,
  chainId: populatedTx.chainId,
  type: 0, // ← Force legacy transaction type
};

// 3. Sign transaction (fast - local crypto operation)
const signedTx = await contract.signer.signTransaction(unsignedTx);
const txHash = ethers.utils.parseTransaction(signedTx).hash;
```

**⏱️ Time:** ~1-5ms  
**🚫 Blockers:** None (all local operations)

---

### Phase 2: Flashbots Provider Setup (Async - Medium ⚠️)

```typescript
// Get or create Flashbots provider (cached after first use)
const flashbotsProvider = await getFlashbotsProvider(provider, chainId);

// Get current block number (RPC call)
const currentBlockNumber = await provider.getBlockNumber();

// Calculate max block number
const maxBlockNumber = getFlashbotsMaxBlockNumber(currentBlockNumber);
```

**⏱️ Time:** ~50-200ms  
**🚫 Potential Blockers:**

- **RPC latency** - `getBlockNumber()` call to Ethereum node
- **Network issues** - Slow connection to RPC provider
- **Provider initialization** - First-time Flashbots provider creation

**💡 Performance Tips:**

- Provider is cached after first use
- Use fast RPC endpoints (Infura, Alchemy)
- Consider connection pooling

---

### Phase 3: Simulation (Optional - Async - Slow 🐌)

```typescript
if (shouldSimulate) {
  // This is a BLOCKING operation!
  const simulation = await flashbotsProvider.simulate([signedTx], currentBlockNumber + 1);
  
  // Process simulation results...
  if (!isSuccess && abortOnSimFail) {
    throw new Error(`Simulation failed: ${error}`);
  }
}
```

**⏱️ Time:** ~500-2000ms  
**🚫 Major Blockers:**

- **Simulation is SLOW** - Flashbots must simulate the transaction
- **Network latency** - Round trip to Flashbots relay
- **Block production time** - Waits for next block to simulate against
- **Gas estimation** - Complex computation on Flashbots side

**💡 Performance Impact:**

- **Production:** Disable simulation (`FLASHBOTS_SIMULATE=false`)
- **Development:** Enable for safety (`FLASHBOTS_SIMULATE=true`)
- **Hybrid:** Enable but don't abort on failure

---

### Phase 4: Transaction Submission (Async - Medium ⚠️)

```typescript
// Submit to Flashbots relay
const flashbotsResponse = await flashbotsProvider.sendPrivateTransaction(
  { signedTransaction: signedTx },
  { maxBlockNumber }
);
```

**⏱️ Time:** ~100-500ms  
**🚫 Potential Blockers:**

- **Flashbots relay latency** - Network to Flashbots servers
- **Relay capacity** - High load on Flashbots infrastructure
- **Transaction size** - Large transactions take longer to process
- **Authentication** - Flashbots auth signer validation

**💡 Performance Tips:**

- Use reliable network connection
- Monitor Flashbots relay status
- Keep transactions small when possible

---

### Phase 5: Waiting for Inclusion (Optional - Async - Very Slow 🐌🐌)

```typescript
if (shouldWait) {
  // This is the BIGGEST blocker!
  const resolution = await flashbotsResponse.wait();
  const receipts = await flashbotsResponse.receipts();
}
```

**⏱️ Time:** ~2000-12000ms (2-12 seconds)  
**🚫 Major Blockers:**

- **Block production time** - Ethereum blocks every ~12 seconds
- **Builder competition** - Other transactions may be more profitable
- **Gas price competition** - Low gas price = lower priority
- **Network congestion** - High mempool activity
- **Flashbots builder selection** - Not all builders may include your tx

**💡 Performance Impact:**

- **Production:** Disable waiting (`FLASHBOTS_WAIT=false`)
- **Development:** Enable for monitoring (`FLASHBOTS_WAIT=true`)
- **Critical:** Enable with timeout handling

---

## 🚦 Performance Comparison

### Configuration 1: Fastest (Production)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=false    # ← Skip simulation
FLASHBOTS_WAIT=false        # ← Skip waiting
```

**Total Time:** ~150-700ms  
**Blockers:** Minimal

### Configuration 2: Balanced (Recommended)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true     # ← Safety check
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=false  # ← Don't abort on sim failure
FLASHBOTS_WAIT=false        # ← Skip waiting
```

**Total Time:** ~650-2700ms  
**Blockers:** Simulation only

### Configuration 3: Full Monitoring (Development)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true
FLASHBOTS_WAIT=true         # ← Wait for inclusion
```

**Total Time:** ~2650-14700ms (2.6-14.7 seconds)  
**Blockers:** Simulation + Waiting

---

## 🔍 Detailed Blocker Analysis

### 1. Simulation Blockers

**What happens during simulation:**

```typescript
// Flashbots must:
// 1. Receive your transaction
// 2. Simulate it against the next block
// 3. Check if it would succeed
// 4. Calculate gas usage
// 5. Return results
```

**Blockers:**

- **Network latency** to Flashbots relay
- **Block production** - Must wait for next block
- **Simulation complexity** - Gas estimation, state changes
- **Relay load** - High traffic = slower responses

**Mitigation:**

```typescript
// Don't abort on simulation failure
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=false

// This allows submission even if simulation fails
// Useful when simulation is unreliable but transaction is valid
```

### 2. Waiting Blockers

**What happens during waiting:**

```typescript
// Flashbots must:
// 1. Send transaction to builders
// 2. Wait for builders to include it
// 3. Wait for block production
// 4. Wait for block propagation
// 5. Return resolution
```

**Blockers:**

- **Builder competition** - Other transactions may be more profitable
- **Gas price** - Too low = not competitive
- **Network congestion** - High activity = slower inclusion
- **Builder selection** - Not all builders may see your transaction

**Timeline Example:**

```
Time 0s:   Transaction submitted to Flashbots
Time 1s:   Sent to builders
Time 2s:   Builders evaluating (competition with other txs)
Time 8s:   Builder includes in block
Time 12s:  Block produced and propagated
Time 12s:  Resolution returned
```

### 3. Network Blockers

**RPC Provider Issues:**

```typescript
// These calls can be slow:
const currentBlockNumber = await provider.getBlockNumber();  // RPC call
const flashbotsProvider = await getFlashbotsProvider(...);   // Network setup
```

**Blockers:**

- **RPC latency** - Slow connection to Ethereum node
- **RPC rate limits** - Too many requests
- **RPC reliability** - Unstable connections
- **Geographic distance** - Far from RPC servers

**Mitigation:**

```typescript
// Use fast, reliable RPC providers:
// - Infura (global CDN)
// - Alchemy (optimized endpoints)
// - Multiple providers for redundancy
```

---

## 🎯 Relayer Performance Impact

### Transaction Throughput

**Without Flashbots:**

- Submit → Return immediately (~100ms)
- Can submit many transactions quickly
- High throughput possible

**With Flashbots (waiting enabled):**

- Submit → Wait for inclusion (~2-12 seconds)
- **Severely limits throughput**
- Only 1 transaction every 2-12 seconds

**With Flashbots (no waiting):**

- Submit → Return immediately (~150-700ms)
- **Minimal impact on throughput**
- Can still submit many transactions

### Memory Usage

**Waiting transactions consume memory:**

```typescript
// Each waiting transaction holds:
// - Transaction data
// - Flashbots response object
// - Promise resolution state
// - Network connections
```

**Impact:**

- **High memory usage** with many waiting transactions
- **Connection limits** - Too many open connections
- **Resource exhaustion** - CPU/memory pressure

---

## 🚀 Optimization Strategies

### 1. Production Configuration (Fastest)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=false
FLASHBOTS_WAIT=false
LOG_LEVEL=info
```

**Result:** ~150-700ms per transaction

### 2. Monitoring Configuration (Balanced)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=false
FLASHBOTS_WAIT=false
```

**Result:** ~650-2700ms per transaction

### 3. Development Configuration (Full Visibility)

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=true
FLASHBOTS_WAIT=true
LOG_LEVEL=debug
```

**Result:** ~2650-14700ms per transaction

### 4. Hybrid Approach (Recommended)

```typescript
// Use different configs for different transaction types:

// Critical transactions (high value)
FLASHBOTS_SIMULATE=true
FLASHBOTS_WAIT=true

// Regular transactions (normal value)  
FLASHBOTS_SIMULATE=false
FLASHBOTS_WAIT=false

// Batch transactions (low value)
FLASHBOTS_ENABLED=false  // Use public mempool
```

---

## 🔧 Async/Await Best Practices

### 1. Don't Block the Event Loop

```typescript
// ❌ BAD - Blocks entire relayer
const result = await flashbotsResponse.wait(); // 2-12 seconds!

// ✅ GOOD - Non-blocking
const response = await flashbotsProvider.sendPrivateTransaction(...);
// Return immediately, let caller decide whether to wait
```

### 2. Handle Errors Gracefully

```typescript
// ❌ BAD - Unhandled rejection
const result = await flashbotsResponse.wait();

// ✅ GOOD - Error handling
try {
  const result = await flashbotsResponse.wait();
} catch (error) {
  logger.warn("Flashbots wait failed", { error });
  // Continue with other transactions
}
```

### 3. Use Timeouts

```typescript
// ✅ GOOD - Timeout protection
const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Timeout')), 30000)
);

const result = await Promise.race([
  flashbotsResponse.wait(),
  timeoutPromise
]);
```

### 4. Parallel Processing

```typescript
// ✅ GOOD - Submit multiple transactions in parallel
const promises = transactions.map(tx => 
  flashbotsProvider.sendPrivateTransaction(tx)
);

const results = await Promise.allSettled(promises);
// Don't wait for inclusion - just submit all
```

---

## 📊 Performance Monitoring

### Key Metrics to Track

1. **Submission Time**

   ```typescript
   const start = Date.now();
   await flashbotsProvider.sendPrivateTransaction(...);
   const submissionTime = Date.now() - start;
   ```

2. **Inclusion Rate**

   ```typescript
   const resolution = await flashbotsResponse.wait();
   const included = resolution === 0; // 0 = TransactionIncluded
   ```

3. **Gas Efficiency**

   ```typescript
   const receipt = await flashbotsResponse.receipts();
   const gasUsed = receipt[0].gasUsed;
   const gasPrice = receipt[0].effectiveGasPrice;
   ```

4. **Error Rates**

   ```typescript
   // Track simulation failures
   // Track submission failures  
   // Track inclusion failures
   ```

### Recommended Monitoring

```typescript
// Log performance metrics
logger.info({
  at: "FlashbotsPerformance",
  submissionTime: Date.now() - start,
  included: resolution === 0,
  gasUsed: receipt?.gasUsed?.toString(),
  blocksToInclusion: receipt?.blockNumber - currentBlock,
});
```

---

## 🎯 Summary

### Major Blockers (Avoid in Production)

1. **Simulation** - Adds 500-2000ms
2. **Waiting** - Adds 2000-12000ms  
3. **Network latency** - Adds 50-500ms

### Minor Blockers (Acceptable)

1. **Provider setup** - 50-200ms (cached after first use)
2. **Transaction signing** - 1-5ms
3. **Format conversion** - <1ms

### Recommended Production Setup

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=false    # Skip simulation
FLASHBOTS_WAIT=false        # Skip waiting
LOG_LEVEL=info             # Hide debug messages
```

**Result:** ~150-700ms per transaction (vs 2-12 seconds with waiting)

This gives you Flashbots protection without blocking your relayer's performance! 🚀
