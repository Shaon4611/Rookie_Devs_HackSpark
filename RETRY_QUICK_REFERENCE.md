# Retry Mechanism - Quick Reference

## What Is This?

Automatic retry mechanism for Central API calls with:
- ✅ Handles 429 rate limit status
- ✅ Exponential backoff: retryAfter × 2^attempt
- ✅ ±20% jitter to prevent thundering herd
- ✅ Max 3 retries
- ✅ Logs: `[retry 1/3] waiting 18s before retrying GET /api/data/products`
- ✅ Returns 503 after max retries

## Where Is It?

| File | Purpose |
|------|---------|
| [api-retry-utils.js](api-retry-utils.js) | Core retry logic utility |
| [rental-service/server.js](rental-service/server.js) | Integrated (line 47) |
| [user-service/server.js](user-service/server.js) | Integrated (line 29) |
| [analytics-service/server.js](analytics-service/server.js) | Integrated (line 31) |
| [API_RETRY_INTEGRATION.md](API_RETRY_INTEGRATION.md) | Detailed integration guide |
| [RETRY_IMPLEMENTATION_EXAMPLES.md](RETRY_IMPLEMENTATION_EXAMPLES.md) | Implementation examples |

## How Does It Work?

```
Request made → 429? → Yes → Wait (retryAfter × 2^attempt ± 20%)
                              ↓
                              Log: [retry 1/3] waiting Xs...
                              ↓
                              Retry → 429? → Yes → Retry again
                                           ↓ No
                                           Success! Return to client
```

## Key Log Format

```
[retry 1/3] waiting 2.1s before retrying GET /api/data/products
[retry 2/3] waiting 4.3s before retrying GET /api/data/products
[retry 3/3] waiting 8.9s before retrying GET /api/data/products
```

## What Happens After 3 Retries?

**HTTP 503 Service Unavailable:**
```json
{
  "error": "Service Unavailable",
  "message": "Central API rate limit exceeded. Please try again later.",
  "retryAfterSeconds": 18
}
```

## Do I Need to Change My Code?

**No!** Existing API calls work as-is:
```javascript
// This automatically retries on 429
const response = await centralApi.get(url, { headers });
```

## What Changed in My Service?

### 1. Import the utilities (already done)
```javascript
const { withRetry, handleRetryExhausted } = require("../api-retry-utils");
```

### 2. Wrap axios instance (already done)
```javascript
const centralApi = withRetry(
  axios.create({ timeout: 10000, validateStatus: () => true }),
  "service-name"
);
```

### 3. Add error middleware (already done)
```javascript
app.use(handleRetryExhausted);  // Before 404 handler
```

## Backoff Example

If Central API says `retryAfterSeconds: 1`:

```
Attempt 1: Request fails with 429
Attempt 2: Wait 1×2¹±20% = 1.6-2.4 seconds
Attempt 3: Wait 1×2²±20% = 3.2-4.8 seconds
Attempt 4: Wait 1×2³±20% = 6.4-9.6 seconds
Final:     Return 503 if still failing
```

## Testing Locally

Trigger rate limit by making many rapid requests:
```bash
for i in {1..50}; do
  curl http://localhost:8002/rentals/products
  sleep 0.1
done
```

Watch console for:
```
[retry 1/3] waiting 2.1s before retrying GET /api/data/products
```

## Monitoring

### What to Look For

- **Increasing `[retry X/3]` logs** → Approaching rate limit
- **Returning 503** → Rate limit breached, retries exhausted
- **No `[retry]` logs** → Requests within rate limit (good!)

### Rate Limit Status

Central API: **30 requests per minute per token**

Each violation: **-20 points penalty**

## Common Issues

| Problem | Solution |
|---------|----------|
| Retry logs not appearing | Verify `withRetry()` is used for axios instance |
| Getting 429 responses | All 3 retries exhausted - reduce request frequency |
| Client timeout errors | Increase client timeout to >20s |
| Service not starting | Check `api-retry-utils.js` path is correct |

## Performance

| Scenario | Impact |
|----------|--------|
| Request succeeds first try | None (0s extra) |
| Needs 1 retry | 1-2 seconds added |
| Needs 2 retries | 4-5 seconds added |
| Needs 3 retries | 14-17 seconds added |

## If Everything is Failing

1. Check token is valid
2. Check API is online
3. Check request frequency < 30/min
4. Check service has correct `withRetry()` wrapper

## Code Locations

**Retry utility:**
```javascript
require("../api-retry-utils")
```

**Integration points (already done):**
- [rental-service/server.js line 3](rental-service/server.js#L3)
- [rental-service/server.js line 47](rental-service/server.js#L47)
- [rental-service/server.js line 1807](rental-service/server.js#L1807)
- [user-service/server.js line 6](user-service/server.js#L6)
- [user-service/server.js line 29](user-service/server.js#L29)
- [user-service/server.js line 418](user-service/server.js#L418)
- [analytics-service/server.js line 4](analytics-service/server.js#L4)
- [analytics-service/server.js line 31](analytics-service/server.js#L31)
- [analytics-service/server.js line 967](analytics-service/server.js#L967)

## Next Steps

1. **Test locally** - Make rapid requests and watch retry logs
2. **Monitor in production** - Track `[retry X/3]` patterns
3. **Optimize requests** - Batch when possible, cache results
4. **Set up alerting** - Alert on `[retry 3/3]` patterns

## Questions?

Refer to:
- [API_RETRY_INTEGRATION.md](API_RETRY_INTEGRATION.md) - Full integration guide
- [RETRY_IMPLEMENTATION_EXAMPLES.md](RETRY_IMPLEMENTATION_EXAMPLES.md) - Implementation examples
- [api-retry-utils.js](api-retry-utils.js) - Source code with detailed comments
