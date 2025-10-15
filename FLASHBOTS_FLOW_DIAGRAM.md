# Flashbots Async Flow Diagram

## 🔄 Visual Flow Breakdown

```
┌─────────────────────────────────────────────────────────────────┐
│                    RELAYER TRANSACTION FLOW                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PHASE 1       │    │   PHASE 2       │    │   PHASE 3       │
│  PREPARATION    │    │   PROVIDER      │    │  SIMULATION     │
│   (1-5ms)       │    │   SETUP         │    │  (500-2000ms)   │
│                 │    │  (50-200ms)     │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ • Populate Tx   │    │ • Get Provider  │    │ • Simulate Tx   │
│ • Convert EIP   │    │ • Get Block #   │    │ • Check Success │
│   1559 → Legacy │    │ • Calc Max Block│    │ • Abort if Fail │
│ • Sign Tx       │    │ • Cache Provider│    │   (optional)    │
│ • Get Hash      │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
    ⚡ FAST                 ⚠️ MEDIUM                🐌 SLOW
   (No Blockers)          (RPC Latency)          (Major Blocker)

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PHASE 4       │    │   PHASE 5       │    │   PHASE 6       │
│  SUBMISSION     │    │   WAITING       │    │   RESOLUTION    │
│  (100-500ms)    │    │  (2000-12000ms) │    │   (Optional)    │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ • Send to       │    │ • Wait for      │    │ • Get Receipts  │
│   Flashbots     │    │   Inclusion     │    │ • Log Results   │
│ • Get Response  │    │ • Monitor       │    │ • Return Data   │
│ • Check Errors  │    │   Resolution    │    │                 │
│                 │    │ • Handle Timeout│    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
    ⚠️ MEDIUM                🐌🐌 VERY SLOW           ⚡ FAST
  (Network Latency)        (MAJOR BLOCKER)         (Local Operation)
```

## 🚦 Performance Impact by Configuration

### Configuration 1: FASTEST (Production)

```
FLASHBOTS_SIMULATE=false
FLASHBOTS_WAIT=false

Flow: Phase 1 → Phase 2 → Phase 4 → Return
Time: 1-5ms + 50-200ms + 100-500ms = 151-705ms
```

### Configuration 2: BALANCED (Recommended)

```
FLASHBOTS_SIMULATE=true
FLASHBOTS_ABORT_ON_SIMULATION_FAIL=false
FLASHBOTS_WAIT=false

Flow: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Return
Time: 1-5ms + 50-200ms + 500-2000ms + 100-500ms = 651-2705ms
```

### Configuration 3: FULL MONITORING (Development)

```
FLASHBOTS_SIMULATE=true
FLASHBOTS_WAIT=true

Flow: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
Time: 1-5ms + 50-200ms + 500-2000ms + 100-500ms + 2000-12000ms = 2651-14705ms
```

## 🔍 Blocker Analysis

### 🚫 MAJOR BLOCKERS (Avoid in Production)

#### 1. Simulation (Phase 3)

```
What it does:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Send Tx to      │    │ Flashbots       │    │ Return          │
│ Flashbots       │───▶│ Simulates       │───▶│ Results         │
│ Relay           │    │ Against Next    │    │                 │
│                 │    │ Block           │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
    100-200ms              300-1500ms             100-300ms
```

**Blockers:**

- Network latency to Flashbots relay
- Block production time (must wait for next block)
- Simulation complexity (gas estimation, state changes)
- Relay server load

#### 2. Waiting (Phase 5)

```
What it does:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Send to         │    │ Builders        │    │ Block           │
│ Builders        │───▶│ Evaluate &      │───▶│ Production      │
│                 │    │ Compete         │    │ & Propagation   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
    100-500ms              1000-8000ms           1000-4000ms
```

**Blockers:**

- Builder competition (other transactions may be more profitable)
- Gas price competition (low gas = low priority)
- Network congestion (high mempool activity)
- Block production time (Ethereum blocks every ~12 seconds)

### ⚠️ MINOR BLOCKERS (Acceptable)

#### 1. Provider Setup (Phase 2)

```
What it does:
┌─────────────────┐    ┌─────────────────┐
│ Get Provider    │───▶│ Get Block #     │
│ (Cached)        │    │ (RPC Call)      │
└─────────────────┘    └─────────────────┘
    10-50ms              40-150ms
```

**Blockers:**

- RPC latency (connection to Ethereum node)
- Network issues (slow connection)
- Provider initialization (first time only)

#### 2. Submission (Phase 4)

```
What it does:
┌─────────────────┐    ┌─────────────────┐
│ Send to         │───▶│ Get Response    │
│ Flashbots       │    │ & Check Errors  │
└─────────────────┘    └─────────────────┘
    50-300ms             50-200ms
```

**Blockers:**

- Flashbots relay latency
- Relay capacity (high load)
- Transaction size (large transactions)

## 🎯 Async/Await Concepts

### What is Async/Await?

```typescript
// ❌ SYNCHRONOUS (Blocking)
function slowOperation() {
  const result = doSomethingSlow(); // Blocks for 5 seconds
  return result; // Can't do anything else during those 5 seconds
}

// ✅ ASYNCHRONOUS (Non-blocking)
async function slowOperation() {
  const result = await doSomethingSlow(); // Waits but doesn't block
  return result; // Other code can run while waiting
}
```

### In Flashbots Context

```typescript
// ❌ BLOCKING - Relayer stops for 2-12 seconds
async function submitTransaction() {
  const response = await flashbotsProvider.sendPrivateTransaction(...);
  const resolution = await flashbotsResponse.wait(); // 🚫 BLOCKS HERE!
  return resolution;
}

// ✅ NON-BLOCKING - Relayer continues immediately
async function submitTransaction() {
  const response = await flashbotsProvider.sendPrivateTransaction(...);
  return response; // ✅ Returns immediately, caller decides whether to wait
}
```

### Promise States

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PENDING       │───▶│   FULFILLED     │    │   REJECTED      │
│ (Waiting)       │    │ (Success)       │    │ (Error)         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Performance Optimization

### 1. Parallel Processing

```typescript
// ❌ SEQUENTIAL - Each transaction waits for previous
for (const tx of transactions) {
  await submitTransaction(tx); // 2-12 seconds each
}

// ✅ PARALLEL - All transactions submitted simultaneously
const promises = transactions.map(tx => submitTransaction(tx));
const results = await Promise.allSettled(promises);
```

### 2. Timeout Protection

```typescript
// ✅ TIMEOUT - Don't wait forever
const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Timeout')), 30000)
);

const result = await Promise.race([
  flashbotsResponse.wait(),
  timeoutPromise
]);
```

### 3. Error Handling

```typescript
// ✅ GRACEFUL - Handle failures without crashing
try {
  const result = await flashbotsResponse.wait();
} catch (error) {
  logger.warn("Flashbots wait failed", { error });
  // Continue with other transactions
}
```

## 📊 Real-World Performance

### Your Successful Transaction

```
09:09:30 - Transaction submitted to Flashbots
09:09:37 - Transaction mined (7 seconds later)
         - Block: 9408986
         - Status: 1 (success)
         - Gas used: 102,485
         - Included in block: 3
```

**Analysis:**

- **Submission time:** ~100-500ms (Phase 4)
- **Inclusion time:** ~7 seconds (Phase 5)
- **Total time:** ~7.1-7.5 seconds
- **Performance:** Excellent (3 blocks to inclusion)

### Without Waiting (Production)

```
09:09:30 - Transaction submitted to Flashbots
09:09:30 - Function returns immediately (100-500ms total)
         - Transaction continues processing in background
         - Relayer can submit next transaction immediately
```

**Analysis:**

- **Submission time:** ~100-500ms
- **Inclusion time:** Background (not blocking)
- **Total time:** ~100-500ms
- **Performance:** 14x faster!

## 🎯 Key Takeaways

1. **Simulation is slow** (500-2000ms) - Disable in production
2. **Waiting is very slow** (2000-12000ms) - Disable in production  
3. **Submission is fast** (100-500ms) - Keep this
4. **Provider setup is cached** - Only slow on first use
5. **Parallel processing** - Submit multiple transactions simultaneously
6. **Error handling** - Don't let failures block other transactions

**Recommended Production Setup:**

```bash
FLASHBOTS_ENABLED=true
FLASHBOTS_SIMULATE=false    # Skip slow simulation
FLASHBOTS_WAIT=false        # Skip slow waiting
```

**Result:** ~150-700ms per transaction (vs 2-12 seconds with waiting)
