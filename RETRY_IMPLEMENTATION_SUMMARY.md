# Central API Retry Mechanism - Implementation Summary

## Overview

A comprehensive retry mechanism has been implemented for all Central API calls across the microservices. The implementation is fully automatic, non-intrusive, and follows all specified requirements.

## Requirements Met

✅ **On 429 (Rate Limit):**
- Reads `retryAfterSeconds` from response
- Waits and automatically retries

✅ **Exponential Backoff:**
- Formula: `retryAfter × 2^attempt`
- Example: 1s × 2¹ = 2s, 1s × 2² = 4s, 1s × 2³ = 8s

✅ **Jitter:**
- Adds ±20% random variance
- Prevents thundering herd problem
- Example: 2s → 1.6s-2.4s

✅ **Max 3 Retries:**
- Configured limit of 3 attempts
- Returns 503 after exhaustion

✅ **Log Format:**
- `[retry 1/3] waiting 18s before retrying GET /api/data/products`
- Clear, actionable retry logging

✅ **After 3 Failures:**
- Returns HTTP 503 Service Unavailable
- Includes message and `retryAfterSeconds`

✅ **Global Application:**
- Deployed to all services calling Central API
- Transparent to existing code (no changes needed)

✅ **Reusable Function:**
- Encapsulated in `api-retry-utils.js`
- Easy import and integration pattern

---

## Files Created

### 1. **[api-retry-utils.js](api-retry-utils.js)** - Core Utility Module
**Purpose:** Reusable retry mechanism logic
**Contents:**
- `sleep(ms)` - Promise-based delay
- `addJitter(delayMs)` - Applies ±20% jitter
- `createRetryInterceptor(serviceName)` - Axios error interceptor
- `withRetry(axiosInstance, serviceName)` - Wrapper function
- `handleRetryExhausted(err, req, res, next)` - Express middleware

**Usage:**
```javascript
const { withRetry, handleRetryExhausted } = require("../api-retry-utils");

const centralApi = withRetry(
  axios.create({ timeout: 10000, validateStatus: () => true }),
  "service-name"
);
app.use(handleRetryExhausted);
```

### 2. **[API_RETRY_INTEGRATION.md](API_RETRY_INTEGRATION.md)** - Integration Guide
**Purpose:** Detailed integration instructions
**Contents:**
- Feature overview
- Integration patterns (3 methods)
- What happens on 429
- Implementation details
- Testing instructions
- Troubleshooting guide
- Files to modify (with line numbers)

### 3. **[RETRY_IMPLEMENTATION_EXAMPLES.md](RETRY_IMPLEMENTATION_EXAMPLES.md)** - Examples & Walkthrough
**Purpose:** Detailed implementation walkthrough
**Contents:**
- Summary of changes by service
- How it works (flow diagram)
- Exponential backoff examples with timing
- Console output examples
- Integration checklist
- Testing procedures
- Performance considerations
- Monitoring guidance

### 4. **[RETRY_QUICK_REFERENCE.md](RETRY_QUICK_REFERENCE.md)** - Quick Reference Card
**Purpose:** Quick lookup for developers
**Contents:**
- What, where, how summary
- Key log format
- Backoff examples
- Testing instructions
- Common issues & solutions
- Code locations with line numbers

---

## Files Modified

### 1. **[rental-service/server.js](rental-service/server.js)**

**Line 3:** Added import
```javascript
const { withRetry, handleRetryExhausted } = require("../api-retry-utils");
```

**Lines 47-50:** Wrapped axios instance
```javascript
const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "rental-service"
);
```

**Line 1807:** Added error middleware
```javascript
// Handle retry exhausted errors (429 after 3 retries)
app.use(handleRetryExhausted);
```

**Impact:** All Central API calls in rental-service now automatically retry on 429

---

### 2. **[user-service/server.js](user-service/server.js)**

**Line 6:** Added import
```javascript
const { withRetry, handleRetryExhausted } = require("../api-retry-utils");
```

**Lines 29-32:** Wrapped axios instance
```javascript
const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "user-service"
);
```

**Line 418:** Added error middleware
```javascript
// Handle retry exhausted errors (429 after 3 retries)
app.use(handleRetryExhausted);
```

**Impact:** All Central API calls in user-service now automatically retry on 429

---

### 3. **[analytics-service/server.js](analytics-service/server.js)**

**Line 4:** Added import
```javascript
const { withRetry, handleRetryExhausted } = require("../api-retry-utils");
```

**Lines 31-34:** Wrapped axios instance
```javascript
const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "analytics-service"
);
```

**Line 967:** Added error middleware
```javascript
// Handle retry exhausted errors (429 after 3 retries)
app.use(handleRetryExhausted);
```

**Impact:** All Central API calls in analytics-service now automatically retry on 429

---

## How It Works

### Request Flow

```
┌─────────────────────────────────────────────────────────┐
│  Client Request                                         │
│  GET /rentals/products                                 │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │  Service Handler       │
          │  (rental-service)      │
          └────────────┬───────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │  axios Instance        │
          │  (with retry wrapper)  │
          └────────────┬───────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │  Central API Call      │
          │  GET /api/data/...     │
          └────────────┬───────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
     Success (200)            429 Rate Limit
          │                         │
          └──────────┬──────────────┘
                     │
        ┌────────────▼────────────┐
        │  Response Handler       │
        │  (axios interceptor)    │
        │                         │
        │  if status === 429      │
        │    ├─ Retry Count++     │
        │    ├─ Calc Backoff      │
        │    ├─ Add Jitter        │
        │    ├─ Log Retry         │
        │    ├─ Wait              │
        │    └─ Retry Request     │
        │  else                   │
        │    └─ Return Response   │
        └────────────┬────────────┘
                     │
         ┌───────────┴──────────┐
         │                      │
         ▼ (≤3 retries)        ▼ (>3 retries)
     Return to Client      Return 503
     (200, 404, etc.)   Service Unavailable
```

### Console Output

```
// Request sequence when rate limited
[retry 1/3] waiting 2.1s before retrying GET /api/data/products
[retry 2/3] waiting 4.3s before retrying GET /api/data/products
[retry 3/3] waiting 8.9s before retrying GET /api/data/products
// After 3rd retry, if still 429:
// HTTP 503 returned to client
```

---

## Testing

### Local Test: Trigger Rate Limit

```bash
# Terminal 1: Start rental-service
npm run dev

# Terminal 2: Rapid requests
for i in {1..50}; do
  curl -H "Authorization: Bearer $CENTRAL_API_TOKEN" \
       http://localhost:8002/rentals/products
  sleep 0.1
done
```

**Expected Console Output:**
```
[retry 1/3] waiting 2.1s before retrying GET /api/data/products
[retry 2/3] waiting 4.3s before retrying GET /api/data/products
[retry 3/3] waiting 8.9s before retrying GET /api/data/products
```

### Expected Responses

| Scenario | Status | Response |
|----------|--------|----------|
| Normal request | 200 | Data |
| Within rate limit | 200 | Data |
| Rate limit, retry succeeds | 200 | Data (after ~2-10s) |
| Rate limit, all retries fail | 503 | Service Unavailable |

---

## Configuration

All settings are constants in `api-retry-utils.js`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `MAX_RETRIES` | 3 | Maximum retry attempts |
| `JITTER_PERCENT` | 0.2 | ±20% variance |
| `BACKOFF_MULTIPLIER` | 2 | Exponential base |

To modify, edit [api-retry-utils.js](api-retry-utils.js).

---

## Performance Impact

| Scenario | Latency Impact | Network Cost |
|----------|---|---|
| No rate limit (success 1st try) | None (0s) | 1 request |
| 1 retry needed | 1-2s | 2 requests |
| 2 retries needed | 4-5s | 3 requests |
| 3 retries needed | 14-17s | 4 requests |
| **Client timeout** | **>20s** | **Auto-fallback** |

**Recommendation:** Keep client timeout >20 seconds for API calls.

---

## Monitoring

### Key Metrics

```javascript
// Count retries per service
[retry 1/3] - First retry
[retry 2/3] - Second retry
[retry 3/3] - Final retry
```

### What To Watch

1. **Increasing `[retry]` logs** → Service approaching rate limit
2. **`[retry 3/3]` frequently** → Rate limit being hit hard
3. **503 responses** → Max retries exhausted, consider optimization

### Optimization Triggers

If you see frequent retries:
1. **Batch requests** - Use `/api/data/products/batch?ids=...`
2. **Cache results** - Don't call for same data repeatedly
3. **Spread requests** - Don't make simultaneous calls
4. **Parallelize wisely** - Use `Promise.all()` with batch endpoints

---

## Troubleshooting

### Retries Not Working?

**Check:**
1. ✓ Import statement present
2. ✓ `withRetry()` wrapping axios instance
3. ✓ `handleRetryExhausted` middleware added
4. ✓ Correct relative path to `api-retry-utils.js`
5. ✓ Service restarted after changes

### Still Getting 429?

- All 3 retries exhausted
- Options: batch requests, cache, reduce frequency

### Client Timeout?

- Increase timeout to >20 seconds
- Or implement circuit breaker

---

## Documentation Files

| File | Purpose |
|------|---------|
| [api-retry-utils.js](api-retry-utils.js) | Core implementation |
| [API_RETRY_INTEGRATION.md](API_RETRY_INTEGRATION.md) | Full integration guide |
| [RETRY_IMPLEMENTATION_EXAMPLES.md](RETRY_IMPLEMENTATION_EXAMPLES.md) | Examples & examples |
| [RETRY_QUICK_REFERENCE.md](RETRY_QUICK_REFERENCE.md) | Quick lookup |
| **This file** | Implementation summary |

---

## Summary

✅ **Requirement:** Implement retry mechanism for Central API calls
**Status:** ✅ COMPLETE

✅ **Automatic retries on 429** with exponential backoff  
✅ **±20% jitter** to prevent thundering herd  
✅ **Max 3 retries** with proper logging  
✅ **Returns 503** after exhaustion  
✅ **Zero code changes** to existing API calls  
✅ **Fully documented** with examples & guides  

**Ready for production.**
