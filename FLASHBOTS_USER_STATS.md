# Flashbots User Stats Logging

## 🎯 Overview

Added **Flashbots user stats logging** using `getUserStats()` before sending private transactions. This provides comprehensive visibility into your Flashbots usage, performance metrics, and success rates.

## 📊 Stats Tracked

### **Overall Performance**

- **`signingAddress`** - Your signing address
- **`blocksWonTotal`** - Total blocks won (all time)
- **`bundlesSubmittedTotal`** - Total bundles submitted (all time)
- **`bundlesErrorTotal`** - Total bundle errors (all time)
- **`avgGasPriceGwei`** - Average gas price in Gwei (all time)

### **Last 7 Days**

- **`blocksWonLast7d`** - Blocks won in last 7 days
- **`bundlesSubmittedLast7d`** - Bundles submitted in last 7 days
- **`bundlesError7d`** - Bundle errors in last 7 days
- **`avgGasPriceGweiLast7d`** - Average gas price in last 7 days

### **Last 24 Hours**

- **`blocksWonLast24h`** - Blocks won in last 24 hours
- **`bundlesSubmittedLast24h`** - Bundles submitted in last 24 hours
- **`bundlesError24h`** - Bundle errors in last 24 hours
- **`avgGasPriceGweiLast24h`** - Average gas price in last 24 hours

### **Last 1 Hour**

- **`blocksWonLast1h`** - Blocks won in last hour
- **`bundlesSubmittedLast1h`** - Bundles submitted in last hour
- **`bundlesError1h`** - Bundle errors in last hour
- **`avgGasPriceGweiLast1h`** - Average gas price in last hour

### **Last 5 Minutes**

- **`blocksWonLast5m`** - Blocks won in last 5 minutes
- **`bundlesSubmittedLast5m`** - Bundles submitted in last 5 minutes
- **`bundlesError5m`** - Bundle errors in last 5 minutes
- **`avgGasPriceGweiLast5m`** - Average gas price in last 5 minutes

---

## 📝 Log Output

### **Successful Stats Retrieval**

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Flashbots user stats before submission",
  "stats": {
    "signingAddress": "0x1234...",
    "blocksWonTotal": 42,
    "bundlesSubmittedTotal": 156,
    "bundlesErrorTotal": 3,
    "avgGasPriceGwei": 25.5,
    "blocksWonLast7d": 8,
    "bundlesSubmittedLast7d": 23,
    "bundlesError7d": 1,
    "avgGasPriceGweiLast7d": 28.2,
    "blocksWonLast24h": 2,
    "bundlesSubmittedLast24h": 5,
    "bundlesError24h": 0,
    "avgGasPriceGweiLast24h": 30.1,
    "blocksWonLast1h": 0,
    "bundlesSubmittedLast1h": 1,
    "bundlesError1h": 0,
    "avgGasPriceGweiLast1h": 32.0,
    "blocksWonLast5m": 0,
    "bundlesSubmittedLast5m": 0,
    "bundlesError5m": 0,
    "avgGasPriceGweiLast5m": 0
  },
  "method": "fillRelay",
  "hash": "0xabc123..."
}
```

### **Stats API Error**

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Flashbots user stats returned error",
  "error": {
    "message": "Rate limit exceeded",
    "code": 429
  },
  "method": "fillRelay",
  "hash": "0xabc123..."
}
```

### **Stats Retrieval Failure**

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Failed to get Flashbots user stats",
  "error": "Network timeout",
  "method": "fillRelay",
  "hash": "0xabc123..."
}
```

---

## 🔍 Key Metrics to Monitor

### **Success Rate**

```
Success Rate = (blocksWonTotal / bundlesSubmittedTotal) × 100
```

**Example:**

- 42 blocks won / 156 bundles submitted = 26.9% success rate

### **Error Rate**

```
Error Rate = (bundlesErrorTotal / bundlesSubmittedTotal) × 100
```

**Example:**

- 3 errors / 156 bundles submitted = 1.9% error rate

### **Recent Activity**

- **Last 5 minutes** - Shows immediate activity
- **Last 1 hour** - Shows recent trends
- **Last 24 hours** - Shows daily patterns
- **Last 7 days** - Shows weekly trends

### **Gas Price Trends**

- **Current vs Average** - Compare current gas price to historical averages
- **Time-based patterns** - See if gas prices are rising/falling
- **Optimization opportunities** - Identify if you're overpaying

---

## 📈 Performance Analysis

### **High Success Rate Indicators**

- **`blocksWonTotal`** increasing steadily
- **`bundlesErrorTotal`** low relative to submissions
- **`avgGasPriceGwei`** competitive but not excessive

### **Warning Signs**

- **High error rate** - Check bundle construction
- **Low success rate** - May need higher gas prices
- **Increasing errors** - Possible nonce issues or network problems

### **Optimization Opportunities**

- **Gas price analysis** - Compare your average to network average
- **Timing patterns** - Look for optimal submission times
- **Error patterns** - Identify common failure causes

---

## 🛠️ Implementation Details

### **When Stats Are Logged**

- **Before every Flashbots transaction** - Provides context for each submission
- **Only for Flashbots transactions** - Standard transactions don't log stats
- **Error handling included** - Won't break transaction flow if stats fail

### **Error Handling**

- **API errors** - Logged as warnings, transaction continues
- **Network errors** - Logged as warnings, transaction continues
- **Rate limiting** - Logged as warnings, transaction continues

### **Performance Impact**

- **Minimal overhead** - Single API call before transaction
- **Non-blocking** - Errors don't prevent transaction submission
- **Cached by Flashbots** - Stats are typically cached for efficiency

---

## 🎯 Use Cases

### **Monitoring Performance**

- Track your Flashbots success rate over time
- Identify patterns in gas price usage
- Monitor error rates and types

### **Optimization**

- Compare your gas prices to network averages
- Identify optimal submission times
- Track the impact of gas price changes

### **Debugging**

- Correlate transaction failures with stats
- Identify if issues are Flashbots-specific
- Monitor the health of your Flashbots integration

### **Reporting**

- Generate performance reports
- Track usage patterns
- Monitor costs and efficiency

---

## 🔧 Configuration

### **Automatic Activation**

The stats logging is **automatically enabled** when:

- `FLASHBOTS_ENABLED=true`
- Transaction uses Flashbots path
- No additional configuration needed

### **Log Level**

- **Info level** - Successful stats retrieval
- **Warn level** - API errors or retrieval failures
- **Debug level** - Not used (to avoid spam)

---

## 📊 Example Analysis

### **Healthy Flashbots Usage**

```json
{
  "blocksWonTotal": 42,
  "bundlesSubmittedTotal": 156,
  "bundlesErrorTotal": 3,
  "avgGasPriceGwei": 25.5
}
```

**Analysis:** 26.9% success rate, 1.9% error rate - Good performance!

### **High Error Rate**

```json
{
  "bundlesSubmittedTotal": 100,
  "bundlesErrorTotal": 25,
  "avgGasPriceGwei": 15.0
}
```

**Analysis:** 25% error rate - Check bundle construction and gas prices

### **Low Success Rate**

```json
{
  "blocksWonTotal": 5,
  "bundlesSubmittedTotal": 100,
  "avgGasPriceGwei": 10.0
}
```

**Analysis:** 5% success rate - May need higher gas prices

---

## 🚀 Benefits

### **Visibility**

- **Real-time monitoring** - See stats before each transaction
- **Historical tracking** - Multiple time windows for analysis
- **Performance trends** - Identify patterns over time

### **Optimization**

- **Gas price analysis** - Compare to network averages
- **Success rate tracking** - Monitor effectiveness
- **Error monitoring** - Identify and fix issues

### **Debugging**

- **Correlation analysis** - Link stats to transaction outcomes
- **Performance baselines** - Establish normal operating ranges
- **Issue identification** - Spot problems early

---

## 📚 Summary

✅ **Added:** Flashbots user stats logging before each transaction  
✅ **Comprehensive:** Tracks performance across multiple time windows  
✅ **Error handling:** Graceful failure without breaking transactions  
✅ **Performance monitoring:** Success rates, error rates, gas prices  
✅ **Optimization insights:** Data for improving Flashbots usage  

**Your Flashbots integration now provides detailed performance monitoring!** 📊

---

For more details:

- [FLASHBOTS_BEHAVIOR.md](./FLASHBOTS_BEHAVIOR.md) - Expected behavior
- [FLASHBOTS_USAGE.md](./FLASHBOTS_USAGE.md) - Configuration guide
