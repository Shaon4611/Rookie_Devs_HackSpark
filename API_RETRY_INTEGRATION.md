# API Retry Mechanism - Integration Guide

## Overview

The `api-retry-utils.js` module provides a reusable retry mechanism for Central API calls with automatic exponential backoff, jitter, and comprehensive logging.

## Features

✅ **429 Status Code Handling** - Automatically retries on rate limit  
✅ **Exponential Backoff** - Delay = retryAfter × 2^attempt  
✅ **Jitter ±20%** - Prevents thundering herd problem  
✅ **Max 3 Retries** - Configurable max attempts  
✅ **Structured Logging** - `[retry 1/3] waiting 18s before retrying GET /api/data/products`  
✅ **503 Fallback** - Returns Service Unavailable after max retries  
✅ **Zero Code Changes** - Works with existing axios instances  

## Log Output Example

```
[retry 1/3] waiting 2.4s before retrying GET /api/data/categories
[retry 2/3] waiting 4.1s before retrying GET /api/data/categories
[retry 3/3] waiting 8.7s before retrying GET /api/data/categories
```

## Integration Patterns

### Pattern 1: Using `withRetry()` (Recommended)

Replace the axios instance creation with `withRetry()`:

```javascript
const { withRetry } = require('../api-retry-utils');

// Before:
// const centralApi = axios.create({ timeout: 10000, validateStatus: () => true });

// After:
const centralApi = withRetry(
  axios.create({ timeout: 10000, validateStatus: () => true }),
  'rental-service'  // service name for logging
);

// Now all requests using centralApi automatically retry on 429
const response = await centralApi.get(url, { headers: buildHeaders() });
```

### Pattern 2: Manual Interceptor Setup

For more control, use the interceptor directly:

```javascript
const { createRetryInterceptor } = require('../api-retry-utils');

const centralApi = axios.create({ timeout: 10000, validateStatus: () => true });

// Add retry logic to response interceptors
centralApi.interceptors.response.use(
  response => response,
  createRetryInterceptor('user-service')
);
```

### Pattern 3: Error Handler Middleware

Add this Express middleware to catch exhausted retries:

```javascript
const { handleRetryExhausted } = require('../api-retry-utils');

// ... other middleware ...
app.use(express.json());

// ... routes ...

// Add this BEFORE final error handler
app.use(handleRetryExhausted);

// Final error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});
```

## What Happens on 429?

**Request Flow:**
1. Client makes request → `GET /api/data/products`
2. Central API returns **429 Rate Limit Exceeded**
3. Interceptor catches the 429 response
4. **[retry 1/3]** waits `retryAfter × 2^1 ± 20%` ms
5. Automatically retries the **exact same request**
6. If still 429, **[retry 2/3]** waits `retryAfter × 2^2 ± 20%` ms
7. If still 429, **[retry 3/3]** waits `retryAfter × 2^3 ± 20%` ms
8. If **still 429 after 3 retries**: returns **503 Service Unavailable**

```javascript
{
  "error": "Service Unavailable",
  "message": "Central API rate limit exceeded. Please try again later.",
  "retryAfterSeconds": 18
}
```

## Implementation Details

### Exponential Backoff Formula
```
delay = retryAfter × 2^attempt ± 20% random jitter
```

Example with retryAfter=1s:
- Attempt 1: 1 × 2¹ = 2s (±20% = 1.6s – 2.4s)
- Attempt 2: 1 × 2² = 4s (±20% = 3.2s – 4.8s)
- Attempt 3: 1 × 2³ = 8s (±20% = 6.4s – 9.6s)

### Which Services Need This?

✅ **Must have:** Any service calling the Central API
- `user-service` - Calls `/api/data/users/:id`
- `rental-service` - Calls `/api/data/products`, `/api/data/rentals`, etc.
- `analytics-service` - Calls `/api/data/rentals/stats`
- `agentic-service` - Indirectly through other services

❌ **Don't need:** API gateway (routes internal calls)

## Testing the Retry Logic

### Simulate Rate Limit

```bash
# Terminal 1: Start your service
npm run dev

# Terminal 2: Trigger multiple requests
for i in {1..50}; do
  curl -H "Authorization: Bearer YOUR_TOKEN" \
       http://localhost:8002/rentals/products
  sleep 0.1
done
```

Watch the console logs:
```
[retry 1/3] waiting 2.1s before retrying GET /api/data/products
[retry 2/3] waiting 4.3s before retrying GET /api/data/products
[retry 3/3] waiting 8.9s before retrying GET /api/data/products
```

### Verify 503 Response

After 3 retries fail:
```bash
curl http://localhost:8002/rentals/products
```

Response:
```json
{
  "error": "Service Unavailable",
  "message": "Central API rate limit exceeded. Please try again later.",
  "retryAfterSeconds": 18
}
```

## Troubleshooting

### Retries Not Working?

Check:
1. ✓ Module is required: `const { withRetry } = require('../api-retry-utils');`
2. ✓ Axios instance wrapped: `const api = withRetry(axios.create(...), 'service-name');`
3. ✓ Using that instance for requests: `await api.get(url, { headers })`
4. ✓ Response code is exactly **429** (not 400, 403, 500)

### Still Failing After Retries?

Central API is consistently rate limited. Options:
- Reduce request frequency in your service
- Implement client-side request batching
- Cache responses when possible
- Use `/api/data/products/batch?ids=...` instead of multiple single requests

## Performance Considerations

### Worst Case: Max Retries + Backoff

```
Attempt 1: Immediate
Attempt 2: Wait ~2-2.4 seconds
Attempt 3: Wait ~4-4.8 seconds
Attempt 4: Wait ~8-9.6 seconds
---
Total: ~14-17 seconds before 503 response
```

**Recommendation:** Keep client timeout >20s for API requests that might hit rate limits.

## Metrics to Monitor

Add these to your monitoring:
```javascript
// Count retries per service
console.log(`[metric] retries.total.rental-service = ${retryCount}`);
console.log(`[metric] retries.exhausted = ${exhaustedCount}`);
```

## Files to Modify

- [rental-service/server.js](rental-service/server.js) - Lines 46-48
- [user-service/server.js](user-service/server.js) - Lines 30-32
- [analytics-service/server.js](analytics-service/server.js) - Lines 32-34
- [agentic-service/server.js](agentic-service/server.js) - Lines 20-22 (for internal calls)
