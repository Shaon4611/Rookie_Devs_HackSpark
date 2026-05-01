# Retry Mechanism Implementation Examples

## Summary of Changes

The retry mechanism has been implemented across all microservices that call the Central API:

✅ **Updated Services:**
- [rental-service/server.js](rental-service/server.js) - Lines 3, 47-50, 1807
- [user-service/server.js](user-service/server.js) - Lines 6, 29-32, 418
- [analytics-service/server.js](analytics-service/server.js) - Lines 4, 31-34, 967

---

## How It Works

### 1. **Automatic Retry on 429 (Rate Limit)**

When the Central API returns a 429 status code:
- The interceptor captures the error
- Reads `retryAfterSeconds` from the response
- Calculates exponential backoff: `retryAfter × 2^attempt`
- Adds ±20% jitter to prevent thundering herd
- Waits and retries (max 3 times)
- Logs each retry attempt

```
Central API returns 429
↓
[retry 1/3] waiting 2.1s before retrying GET /api/data/categories
↓ (wait 2.1 seconds)
↓
Retry automatically
↓
If still 429: [retry 2/3] waiting 4.3s before retrying GET /api/data/categories
↓ (wait 4.3 seconds)
↓
If still 429: [retry 3/3] waiting 8.9s before retrying GET /api/data/categories
↓ (wait 8.9 seconds)
↓
If still 429: Return 503 Service Unavailable to client
```

### 2. **No Code Changes Needed in API Calls**

Existing code continues to work unchanged:

```javascript
// No changes needed here - retry logic is automatic
const response = await centralApi.get(CENTRAL_API_CATEGORIES_URL, {
  headers: buildHeaders()
});
```

The `withRetry()` wrapper adds retry logic transparently via axios interceptors.

### 3. **Error Handling**

After all retries are exhausted, the `handleRetryExhausted` middleware converts the error:

```javascript
// Before: Response with 429
response.status = 429
response.data = { error: "Rate Limit Exceeded" }

// After: Response with 503
response.status = 503
response.data = {
  error: "Service Unavailable",
  message: "Central API rate limit exceeded. Please try again later.",
  retryAfterSeconds: 18
}
```

---

## Exponential Backoff Examples

Assuming Central API returns `retryAfterSeconds: 1`

```
Attempt 1: Failed (central api returned 429)
Attempt 2: Wait 2.0s ±20% = [1.6s - 2.4s]
Attempt 3: Wait 4.0s ±20% = [3.2s - 4.8s]
Attempt 4: Wait 8.0s ±20% = [6.4s - 9.6s]
Final: Return 503 after ~14-17 seconds total
```

### Actual Request Pattern

```
t=0s:     [GET /api/data/rentals] → 429 rate limit
t=0.1s:   [retry 1/3] waiting 2.1s
t=2.2s:   [GET /api/data/rentals] → 429 rate limit
t=2.3s:   [retry 2/3] waiting 4.4s
t=6.7s:   [GET /api/data/rentals] → 429 rate limit
t=6.8s:   [retry 3/3] waiting 8.6s
t=15.4s:  [GET /api/data/rentals] → 429 rate limit
t=15.5s:  Response: 503 Service Unavailable
```

---

## Console Output Examples

### Normal Retry (succeeds on 2nd attempt)

```
[retry 1/3] waiting 1.8s before retrying GET /api/data/products
[✓ Success on retry]
```

### Multiple Retries (succeeds on 3rd attempt)

```
[retry 1/3] waiting 2.1s before retrying GET /api/data/categories
[retry 2/3] waiting 4.3s before retrying GET /api/data/categories
[✓ Success on retry]
```

### Max Retries Exhausted (returns 503)

```
[retry 1/3] waiting 1.9s before retrying GET /api/data/rentals
[retry 2/3] waiting 4.1s before retrying GET /api/data/rentals
[retry 3/3] waiting 8.7s before retrying GET /api/data/rentals
[✗ Max retries exhausted - returning 503]
```

---

## Integration Checklist

✅ **rental-service** (Line 47)
```javascript
const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "rental-service"
);
```

✅ **user-service** (Line 29)
```javascript
const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "user-service"
);
```

✅ **analytics-service** (Line 31)
```javascript
const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "analytics-service"
);
```

✅ **Error handlers added** (Before 404 routes in each service)
```javascript
// Handle retry exhausted errors (429 after 3 retries)
app.use(handleRetryExhausted);
```

---

## Testing the Implementation

### Manual Test: Trigger Rate Limit

```bash
# In rental-service directory
for i in {1..100}; do 
  curl -H "Authorization: Bearer $CENTRAL_API_TOKEN" \
       http://localhost:8002/rentals/products?limit=100
  sleep 0.05
done
```

Watch the console for retry logs:
```
[retry 1/3] waiting 2.1s before retrying GET /api/data/products
[retry 2/3] waiting 4.3s before retrying GET /api/data/products
[retry 3/3] waiting 8.9s before retrying GET /api/data/products
```

### Expected Behavior

1. **Requests succeed within rate limit** → Normal response (200, 404, etc.)
2. **Rate limit hit** → Automatic retries with exponential backoff
3. **All retries exhausted** → 503 Service Unavailable response

```json
{
  "error": "Service Unavailable",
  "message": "Central API rate limit exceeded. Please try again later.",
  "retryAfterSeconds": 18
}
```

---

## Performance Impact

### Worst Case Scenario

- **Service latency increase:** 14-17 seconds for max retries
- **Network requests:** 4 total (1 initial + 3 retries)
- **Rate limit compliance:** 429s automatically handled

### Best Case Scenario

- **No impact:** Request succeeds on first try
- **One retry needed:** 1-2 seconds additional latency
- **Rate limit compliant:** 30 req/min maintained

---

## Monitoring

### Metrics to Track

```javascript
// Count retry attempts per service
console.log(`[metric] retries.total.rental-service = ${retryCount}`);
console.log(`[metric] retries.exhausted = ${exhaustedCount}`);

// Track service availability
console.log(`[metric] api.429_retried.rental-service = 1`);
```

### What to Watch

1. **Increasing retry count** → API near rate limit, consider caching
2. **Exhausted retries** → API consistently rate limited, batch requests
3. **High backoff delays** → Spread requests more evenly over time

---

## Troubleshooting

### Retries Not Working?

1. ✓ Check import: `const { withRetry } = require("../api-retry-utils");`
2. ✓ Check axioscreated with `withRetry()`: `const api = withRetry(axios.create(...), 'service')`
3. ✓ Check middleware added: `app.use(handleRetryExhausted);`
4. ✓ Verify status code is exactly `429`

### Still Getting 429 Responses?

This means all 3 retries were exhausted. Options:
1. Reduce request frequency in the service
2. Implement response caching
3. Use batch endpoints (`/api/data/products/batch?ids=1,2,3`)
4. Optimize queries to require fewer API calls

### Client Timeout Issues?

If client gets 503, check their timeout settings:
```javascript
// Client-side axios config
axios.create({
  timeout: 20000  // 20 seconds (max 14-17s for retries + buffer)
})
```

---

## Future Enhancements

Consider implementing:
1. **Circuit breaker** - Stop retrying if API is consistently down
2. **Request queuing** - Queue requests instead of failing immediately
3. **Caching** - Cache 429 responses with TTL from `retryAfterSeconds`
4. **Metrics dashboard** - Real-time retry and rate limit monitoring

---

## API Retry Utility Reference

Location: [api-retry-utils.js](../api-retry-utils.js)

### Exported Functions

```javascript
module.exports = {
  sleep,                          // (ms) => Promise
  addJitter,                      // (delayMs) => delayMs with ±20% jitter
  createRetryInterceptor,         // (serviceName) => axiosErrorHandler
  withRetry,                      // (axiosInstance, serviceName) => axiosInstance
  handleRetryExhausted            // Express middleware for 503 conversion
};
```

### Configuration Constants

```javascript
MAX_RETRIES = 3                   // Maximum retry attempts
JITTER_PERCENT = 0.2              // ±20% jitter applied
BACKOFF_MULTIPLIER = 2            // 2^attempt exponential backoff
```
