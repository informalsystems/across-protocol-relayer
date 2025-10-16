# Flashbots User Stats Logging (v0.6.1)

## 🎯 Overview

Added **Flashbots user stats logging** using `getUserStatsV2()` before sending private transactions. This provides comprehensive visibility into your Flashbots usage, performance metrics, and validator payments.

## 📊 Stats Tracked (Flashbots 0.6.1)

### **Priority Status**

- **`isHighPriority`** - Whether your account has high priority status
- **Benefits:** Higher inclusion rates, better performance

### **All Time Performance**

- **`allTimeValidatorPayments`** - Total ETH paid to validators (all time)
- **`allTimeGasSimulated`** - Total gas simulated (all time)

### **Last 7 Days**

- **`last7dValidatorPayments`** - ETH paid to validators in last 7 days
- **`last7dGasSimulated`** - Gas simulated in last 7 days

### **Last 24 Hours**

- **`last1dValidatorPayments`** - ETH paid to validators in last 24 hours
- **`last1dGasSimulated`** - Gas simulated in last 24 hours

---

## 📝 Log Output

### **Successful Stats Retrieval**

```json
{
  "at": "TxUtil#Flashbots",
  "message": "Flashbots user stats before submission",
  "stats": {
    "isHighPriority": true,
    "allTimeValidatorPayments": "0.123456789012345678",
    "allTimeGasSimulated": "15000000000",
    "last7dValidatorPayments": "0.045678901234567890",
    "last7dGasSimulated": "5000000000",
    "last1dValidatorPayments": "0.012345678901234567",
    "last1dGasSimulated": "1000000000"
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

### **High Priority Status**

- **`isHighPriority`** - Indicates if you have priority access to Flashbots
- **Benefits:** Higher inclusion rates, better performance

### **Validator Payments**

- **All time** - Total ETH paid to validators
- **Last 7 days** - Recent validator payments
- **Last 24 hours** - Daily validator payments

### **Gas Simulation**

- **All time** - Total gas simulated across all transactions
- **Last 7 days** - Recent gas simulation activity
- **Last 24 hours** - Daily gas simulation activity

### **Usage Patterns**

- **Payment trends** - Track validator payment patterns over time
- **Gas efficiency** - Monitor gas simulation vs actual usage
- **Activity levels** - See recent vs historical activity

---

## 📈 Performance Analysis

### **High Priority Indicators**

- **`isHighPriority: true`** - You have priority access
- **Consistent payments** - Regular validator payments
- **High gas simulation** - Active usage

### **Usage Patterns**

- **Increasing payments** - Growing Flashbots usage
- **Consistent simulation** - Regular transaction activity
- **Recent activity** - Active in last 24h/7d

### **Optimization Opportunities**

- **Payment analysis** - Compare your payments to network averages
- **Gas efficiency** - Monitor simulation vs actual gas usage
- **Activity timing** - Identify optimal usage patterns

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

- Track your Flashbots priority status
- Monitor validator payment patterns
- Identify usage trends over time

### **Optimization**

- Compare your payments to network averages
- Track gas simulation efficiency
- Monitor activity patterns

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
  "isHighPriority": true,
  "allTimeValidatorPayments": "0.123456789012345678",
  "allTimeGasSimulated": "15000000000",
  "last7dValidatorPayments": "0.045678901234567890",
  "last7dGasSimulated": "5000000000"
}
```

**Analysis:** High priority status, consistent payments, active usage!

### **New User**

```json
{
  "isHighPriority": false,
  "allTimeValidatorPayments": "0.000000000000000000",
  "allTimeGasSimulated": "0",
  "last7dValidatorPayments": "0.000000000000000000",
  "last7dGasSimulated": "0"
}
```

**Analysis:** New user, no activity yet - normal for first-time usage

### **High Activity User**

```json
{
  "isHighPriority": true,
  "allTimeValidatorPayments": "1.234567890123456789",
  "allTimeGasSimulated": "100000000000",
  "last1dValidatorPayments": "0.123456789012345678",
  "last1dGasSimulated": "10000000000"
}
```

**Analysis:** Very active user with high priority status

---

## 🚀 Benefits

### **Visibility**

- **Real-time monitoring** - See stats before each transaction
- **Historical tracking** - Multiple time windows for analysis
- **Performance trends** - Identify patterns over time

### **Optimization**

- **Payment analysis** - Compare to network averages
- **Priority tracking** - Monitor high priority status
- **Usage monitoring** - Track activity levels

### **Debugging**

- **Correlation analysis** - Link stats to transaction outcomes
- **Performance baselines** - Establish normal operating ranges
- **Issue identification** - Spot problems early

---

## 📚 Summary

✅ **Added:** Flashbots user stats logging using getUserStatsV2()  
✅ **Updated:** Compatible with Flashbots 0.6.1 API  
✅ **Comprehensive:** Tracks priority status, payments, and gas simulation  
✅ **Error handling:** Graceful failure without breaking transactions  
✅ **Performance monitoring:** Priority status, validator payments, gas simulation  

**Your Flashbots integration now provides detailed performance monitoring with the latest API!** 📊

---

For more details:

- [FLASHBOTS_BEHAVIOR.md](./FLASHBOTS_BEHAVIOR.md) - Expected behavior
- [FLASHBOTS_USAGE.md](./FLASHBOTS_USAGE.md) - Configuration guide
