/**
 * Retry mechanism for Central API calls with exponential backoff and jitter
 * 
 * Features:
 * - Handles 429 (rate limit) responses
 * - Exponential backoff: retryAfter × 2^attempt
 * - ±20% jitter
 * - Max 3 retries
 * - Structured logging
 * - Returns 503 after max retries
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Add jitter to a delay: ±20%
 */
function addJitter(delayMs) {
  const jitterPercent = 0.2; // ±20%
  const jitterAmount = delayMs * jitterPercent;
  const randomJitter = (Math.random() - 0.5) * 2 * jitterAmount;
  return Math.max(0, Math.floor(delayMs + randomJitter));
}

/**
 * Create an axios interceptor for automatic retry on 429
 * 
 * Usage:
 *   const axios = require('axios');
 *   const retryInterceptor = createRetryInterceptor();
 *   axiosInstance.interceptors.response.use(
 *     response => response,
 *     retryInterceptor(axiosInstance, 'service-name')
 *   );
 */
function createRetryInterceptor(serviceName = 'api') {
  return async (error) => {
    const config = error.config;
    
    // Initialize retry count on first attempt
    if (!config._retryCount) {
      config._retryCount = 0;
    }
    
    // Only retry on 429, max 3 retries
    if (error.response?.status !== 429 || config._retryCount >= 3) {
      return Promise.reject(error);
    }
    
    config._retryCount++;
    const attempt = config._retryCount;
    const maxRetries = 3;
    
    // Get retryAfterSeconds from response header or default to 1
    const response = error.response;
    const retryAfterSeconds = response.data?.retryAfterSeconds || 
                              parseInt(response.headers?.['retry-after']) || 
                              1;
    
    // Calculate backoff: retryAfter × 2^attempt, with jitter ±20%
    const baseDelayMs = retryAfterSeconds * 1000 * Math.pow(2, attempt - 1);
    const delayMs = addJitter(baseDelayMs);
    const delaySeconds = (delayMs / 1000).toFixed(1);
    
    // Log retry attempt
    const method = config.method.toUpperCase();
    const url = config.url;
    const pathname = new URL(url).pathname;
    console.log(`[retry ${attempt}/${maxRetries}] waiting ${delaySeconds}s before retrying ${method} ${pathname}`);
    
    // Wait before retrying
    await sleep(delayMs);
    
    // Retry the request
    return new Promise((resolve, reject) => {
      const axiosInstance = require('axios').create(config);
      axiosInstance.request(config)
        .then(resolve)
        .catch(reject);
    });
  };
}

/**
 * Wrap axios instance with automatic retry logic
 * 
 * Usage:
 *   const axios = require('axios');
 *   const apiClient = withRetry(
 *     axios.create({ timeout: 10000 }),
 *     'rental-service'
 *   );
 */
function withRetry(axiosInstance, serviceName = 'api') {
  axiosInstance.interceptors.response.use(
    response => response,
    createRetryInterceptor(serviceName)
  );
  return axiosInstance;
}

/**
 * Middleware to handle 503 responses from retries
 * Converts max-retry failures to 503 responses
 * 
 * Usage:
 *   app.use(handleRetryExhausted);
 */
function handleRetryExhausted(err, req, res, next) {
  // Check if this is a rate limit error after retries
  if (err.response?.status === 429) {
    const lastRetryAfter = err.response.data?.retryAfterSeconds || parseInt(err.response.headers?.['retry-after']) || 60;
    return res.status(503).json({
      error: "Central API unavailable after 3 retries",
      lastRetryAfter: lastRetryAfter,
      suggestion: "Try again in ~2 minutes"
    });
  }
  next(err);
}

module.exports = {
  sleep,
  addJitter,
  createRetryInterceptor,
  withRetry,
  handleRetryExhausted
};
