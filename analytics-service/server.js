const express = require("express");
const axios = require("axios");
const dateFns = require("date-fns");
const { withRetry, handleRetryExhausted } = require("./api-retry-utils");

const app = express();
const PORT = process.env.PORT || 8003;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN || "";
const CENTRAL_API_RENTAL_STATS_URL =
  process.env.CENTRAL_API_RENTAL_STATS_URL ||
  "https://technocracy.brittoo.xyz/api/data/rentals/stats";
const CENTRAL_API_RENTALS_URL =
  process.env.CENTRAL_API_RENTALS_URL ||
  "https://technocracy.brittoo.xyz/api/data/rentals";
const CENTRAL_API_PRODUCTS_BATCH_URL =
  process.env.CENTRAL_API_PRODUCTS_BATCH_URL ||
  "https://technocracy.brittoo.xyz/api/data/products/batch";
const CENTRAL_API_TIMEOUT_MS = Number(process.env.CENTRAL_API_TIMEOUT_MS || 10000);
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_MONTH_RANGE = 12;
const WINDOW_SIZE = 7;
const RECOMMENDATION_WINDOW_DAYS = 7;
const RECOMMENDATION_HISTORY_YEARS = 2;
const DEFAULT_RECOMMENDATION_LIMIT = 10;
const MAX_RECOMMENDATION_LIMIT = 50;

app.use(express.json());

const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "analytics-service"
);

function buildHeaders() {
  const headers = {
    Accept: "application/json"
  };

  if (CENTRAL_API_TOKEN) {
    headers.Authorization = `Bearer ${CENTRAL_API_TOKEN}`;
  }

  return headers;
}

function parseMonth(value) {
  if (typeof value !== "string" || !MONTH_PATTERN.test(value)) {
    return null;
  }

  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    value,
    year,
    month,
    index: year * 12 + (month - 1)
  };
}

function formatMonth(year, monthIndexZeroBased) {
  const month = String(monthIndexZeroBased + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12);
  const monthIndexZeroBased = index % 12;

  return formatMonth(year, monthIndexZeroBased);
}

function listMonths(fromMonth, toMonth) {
  const months = [];

  for (let index = fromMonth.index; index <= toMonth.index; index += 1) {
    months.push(monthFromIndex(index));
  }

  return months;
}

function getMonthStart(month) {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function getMonthEnd(month) {
  const parsed = parseMonth(month);
  return new Date(Date.UTC(parsed.year, parsed.month, 0));
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function listDates(fromDate, toDate) {
  const dates = [];

  for (let cursor = fromDate; cursor <= toDate; cursor = addDays(cursor, 1)) {
    dates.push(formatDateOnly(cursor));
  }

  return dates;
}

function firstArrayFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload.data && typeof payload.data === "object") {
    if (Array.isArray(payload.data.data)) {
      return payload.data.data;
    }

    if (Array.isArray(payload.data.stats)) {
      return payload.data.stats;
    }

    if (Array.isArray(payload.data.items)) {
      return payload.data.items;
    }

    if (Array.isArray(payload.data.results)) {
      return payload.data.results;
    }

    if (Array.isArray(payload.data.rentals)) {
      return payload.data.rentals;
    }

    if (Array.isArray(payload.data.products)) {
      return payload.data.products;
    }
  }

  if (Array.isArray(payload.stats)) {
    return payload.stats;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (Array.isArray(payload.rentals)) {
    return payload.rentals;
  }

  if (Array.isArray(payload.products)) {
    return payload.products;
  }

  return [];
}

function getNestedValue(payload, keys) {
  for (const key of keys) {
    if (payload && payload[key] !== undefined && payload[key] !== null) {
      return payload[key];
    }
  }

  return undefined;
}

function getTotalPagesFromPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const directTotalPages = getNestedValue(payload, [
    "totalPages",
    "total_pages",
    "pageCount",
    "page_count",
    "pages"
  ]);

  if (directTotalPages !== undefined) {
    return Number(directTotalPages);
  }

  const nestedContainers = [payload.meta, payload.pagination, payload.pageInfo, payload.data];

  for (const container of nestedContainers) {
    if (container && typeof container === "object" && !Array.isArray(container)) {
      const nestedTotalPages = getNestedValue(container, [
        "totalPages",
        "total_pages",
        "pageCount",
        "page_count",
        "pages"
      ]);

      if (nestedTotalPages !== undefined) {
        return Number(nestedTotalPages);
      }
    }
  }

  return undefined;
}

function dateFromStat(stat) {
  if (!stat || typeof stat !== "object") {
    return "";
  }

  const value =
    stat.date ||
    stat.day ||
    stat.rental_date ||
    stat.rentalDate ||
    stat.created_at ||
    stat.createdAt ||
    stat.start_date ||
    stat.startDate ||
    "";

  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 10);
}

function countFromStat(stat) {
  if (!stat || typeof stat !== "object") {
    return 0;
  }

  const value =
    stat.count ??
    stat.total ??
    stat.totalRentals ??
    stat.total_rentals ??
    stat.rentals ??
    stat.value ??
    0;
  const count = Number(value);

  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function fetchStatsForMonth(month) {
  const response = await centralApi.get(CENTRAL_API_RENTAL_STATS_URL, {
    headers: buildHeaders(),
    params: {
      group_by: "date",
      month
    }
  });

  if (response.status === 429) {
    const error = new Error("Central API rate limit exceeded");
    error.statusCode = 429;
    throw error;
  }

  if (response.status >= 500) {
    const error = new Error("Central API service error");
    error.statusCode = 502;
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    const error = new Error("Unable to fetch rental stats");
    error.statusCode = response.status;
    error.payload = response.data;
    throw error;
  }

  return firstArrayFromPayload(response.data);
}

function combineStats(months, statsByMonth) {
  const countsByDate = new Map();

  for (const month of months) {
    const monthStart = getMonthStart(month);
    const monthEnd = getMonthEnd(month);

    for (const date of listDates(monthStart, monthEnd)) {
      countsByDate.set(date, 0);
    }
  }

  for (const stats of statsByMonth) {
    for (const stat of stats) {
      const date = dateFromStat(stat);

      if (countsByDate.has(date)) {
        countsByDate.set(date, countsByDate.get(date) + countFromStat(stat));
      }
    }
  }

  return Array.from(countsByDate.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, count]) => ({
      date,
      count
    }));
}

function findPeakWindow(dailyCounts) {
  if (dailyCounts.length === 0) {
    return {
      from: null,
      to: null,
      totalRentals: 0
    };
  }

  const windowSize = Math.min(WINDOW_SIZE, dailyCounts.length);
  let runningSum = 0;
  let bestSum = -1;
  let bestStartIndex = 0;

  for (let index = 0; index < dailyCounts.length; index += 1) {
    runningSum += dailyCounts[index].count;

    if (index >= windowSize) {
      runningSum -= dailyCounts[index - windowSize].count;
    }

    if (index >= windowSize - 1 && runningSum > bestSum) {
      bestSum = runningSum;
      bestStartIndex = index - windowSize + 1;
    }
  }

  return {
    from: dailyCounts[bestStartIndex].date,
    to: dailyCounts[bestStartIndex + windowSize - 1].date,
    totalRentals: bestSum
  };
}

function buildSurgeDays(dailyCounts) {
  const data = new Array(dailyCounts.length);
  const stack = [];

  for (let index = dailyCounts.length - 1; index >= 0; index -= 1) {
    const current = dailyCounts[index];

    while (stack.length > 0 && dailyCounts[stack[stack.length - 1]].count <= current.count) {
      stack.pop();
    }

    const nextIndex = stack.length > 0 ? stack[stack.length - 1] : null;

    data[index] = {
      date: current.date,
      count: current.count,
      nextSurgeDate: nextIndex === null ? null : dailyCounts[nextIndex].date,
      daysUntil: nextIndex === null ? null : nextIndex - index
    };

    stack.push(index);
  }

  return data;
}

function parseDateInput(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return null;
  }

  const parsed = dateFns.parse(value, "yyyy-MM-dd", new Date());

  if (!dateFns.isValid(parsed) || dateFns.format(parsed, "yyyy-MM-dd") !== value) {
    return null;
  }

  return dateFns.startOfDay(parsed);
}

function formatDateInput(date) {
  return dateFns.format(date, "yyyy-MM-dd");
}

function parseRecommendationLimit(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_RECOMMENDATION_LIMIT;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOMMENDATION_LIMIT) {
    return null;
  }

  return limit;
}

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return dateFns.isValid(value) ? dateFns.startOfDay(value) : null;
  }

  if (typeof value === "number") {
    const parsedNumberDate = new Date(value);
    return dateFns.isValid(parsedNumberDate) ? dateFns.startOfDay(parsedNumberDate) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (DATE_PATTERN.test(trimmed)) {
      return parseDateInput(trimmed);
    }

    const parsedIsoDate = dateFns.parseISO(trimmed);
    return dateFns.isValid(parsedIsoDate) ? dateFns.startOfDay(parsedIsoDate) : null;
  }

  return null;
}

function getRentalProductId(rental) {
  if (!rental || typeof rental !== "object") {
    return "";
  }

  const value =
    rental.product_id ||
    rental.productId ||
    rental.productID ||
    rental.product ||
    rental.item_id ||
    rental.itemId ||
    rental.asset_id ||
    rental.assetId ||
    rental.listing_id ||
    rental.listingId ||
    "";

  if (value && typeof value === "object") {
    return String(value.id || value._id || value.product_id || value.productId || "");
  }

  return String(value || "");
}

function getRentalDateRange(rental) {
  if (!rental || typeof rental !== "object") {
    return null;
  }

  const startValue =
    rental.date ||
    rental.day ||
    rental.from ||
    rental.start ||
    rental.start_date ||
    rental.startDate ||
    rental.rental_date ||
    rental.rentalDate ||
    rental.rental_start ||
    rental.rentalStart ||
    rental.booking_start ||
    rental.bookingStart ||
    rental.rented_from ||
    rental.rentedFrom ||
    rental.pickup_date ||
    rental.pickupDate ||
    rental.created_at ||
    rental.createdAt;

  const endValue =
    rental.to ||
    rental.end ||
    rental.end_date ||
    rental.endDate ||
    rental.rental_end ||
    rental.rentalEnd ||
    rental.booking_end ||
    rental.bookingEnd ||
    rental.rented_to ||
    rental.rentedTo ||
    rental.return_date ||
    rental.returnDate ||
    startValue;

  const start = normalizeDateValue(startValue);
  const end = normalizeDateValue(endValue);

  if (!start || !end) {
    return null;
  }

  if (dateFns.isAfter(start, end)) {
    return null;
  }

  return {
    start,
    end
  };
}

function rangesOverlap(startA, endA, startB, endB) {
  return !dateFns.isAfter(startA, endB) && !dateFns.isBefore(endA, startB);
}

function getSeasonalCenterForYear(targetDate, year) {
  const monthIndex = dateFns.getMonth(targetDate);
  const targetDay = dateFns.getDate(targetDate);
  const daysInTargetMonth = dateFns.getDaysInMonth(new Date(year, monthIndex, 1));

  return dateFns.startOfDay(new Date(year, monthIndex, Math.min(targetDay, daysInTargetMonth)));
}

function buildSeasonalWindows(targetDate, historyStart, historyEnd) {
  const windows = [];
  const startYear = dateFns.getYear(historyStart) - 1;
  const endYear = dateFns.getYear(historyEnd) + 1;

  for (let year = startYear; year <= endYear; year += 1) {
    const center = getSeasonalCenterForYear(targetDate, year);
    const windowStart = dateFns.startOfDay(dateFns.subDays(center, RECOMMENDATION_WINDOW_DAYS));
    const windowEnd = dateFns.startOfDay(dateFns.addDays(center, RECOMMENDATION_WINDOW_DAYS));

    if (rangesOverlap(windowStart, windowEnd, historyStart, historyEnd)) {
      windows.push({
        from: dateFns.max([windowStart, historyStart]),
        to: dateFns.min([windowEnd, historyEnd])
      });
    }
  }

  return windows;
}

function rentalOverlapsSeasonalWindows(rentalRange, seasonalWindows) {
  return seasonalWindows.some((window) =>
    rangesOverlap(rentalRange.start, rentalRange.end, window.from, window.to)
  );
}

function createCentralApiError(response, fallbackMessage) {
  const error = new Error(fallbackMessage);

  if (response.status === 429) {
    error.message = "Central API rate limit exceeded";
    error.statusCode = 429;
    return error;
  }

  if (response.status >= 500) {
    error.message = "Central API service error";
    error.statusCode = 502;
    return error;
  }

  error.statusCode = response.status;
  error.payload = response.data;
  return error;
}

async function fetchRentalsPage(params) {
  const response = await centralApi.get(CENTRAL_API_RENTALS_URL, {
    headers: buildHeaders(),
    params
  });

  if (response.status < 200 || response.status >= 300) {
    throw createCentralApiError(response, "Unable to fetch rentals");
  }

  return response.data;
}

async function fetchRentalsForRecommendation(historyStart, historyEnd) {
  const limit = 100;
  const firstPagePayload = await fetchRentalsPage({
    from: formatDateInput(historyStart),
    to: formatDateInput(historyEnd),
    page: 1,
    limit
  });
  const rentals = firstArrayFromPayload(firstPagePayload);
  const totalPages = getTotalPagesFromPayload(firstPagePayload);

  if (!Number.isFinite(totalPages) || totalPages <= 1) {
    return rentals;
  }

  const pageRequests = [];

  for (let page = 2; page <= totalPages; page += 1) {
    pageRequests.push(
      fetchRentalsPage({
        from: formatDateInput(historyStart),
        to: formatDateInput(historyEnd),
        page,
        limit
      })
    );
  }

  const pages = await Promise.all(pageRequests);

  for (const pagePayload of pages) {
    rentals.push(...firstArrayFromPayload(pagePayload));
  }

  return rentals;
}

function countProductsForSeasonalWindow(rentals, seasonalWindows) {
  const counts = new Map();

  for (const rental of rentals) {
    const productId = getRentalProductId(rental);
    const rentalRange = getRentalDateRange(rental);

    if (!productId || !rentalRange) {
      continue;
    }

    if (rentalOverlapsSeasonalWindows(rentalRange, seasonalWindows)) {
      counts.set(productId, (counts.get(productId) || 0) + 1);
    }
  }

  return counts;
}

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) {
      return null;
    }

    if (this.items.length === 1) {
      return this.items.pop();
    }

    const root = this.items[0];
    this.items[0] = this.items.pop();
    this.bubbleDown(0);
    return root;
  }

  bubbleUp(index) {
    let currentIndex = index;

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);

      if (this.compare(this.items[currentIndex], this.items[parentIndex]) >= 0) {
        break;
      }

      [this.items[currentIndex], this.items[parentIndex]] = [
        this.items[parentIndex],
        this.items[currentIndex]
      ];
      currentIndex = parentIndex;
    }
  }

  bubbleDown(index) {
    let currentIndex = index;

    while (true) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = currentIndex * 2 + 2;
      let smallestIndex = currentIndex;

      if (
        leftIndex < this.items.length &&
        this.compare(this.items[leftIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        this.compare(this.items[rightIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === currentIndex) {
        break;
      }

      [this.items[currentIndex], this.items[smallestIndex]] = [
        this.items[smallestIndex],
        this.items[currentIndex]
      ];
      currentIndex = smallestIndex;
    }
  }

  toArray() {
    return this.items.slice();
  }
}

function topProductsByCount(counts, limit) {
  const heap = new MinHeap((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }

    return b.productId.localeCompare(a.productId);
  });

  for (const [productId, score] of counts.entries()) {
    const item = {
      productId,
      score
    };

    if (heap.size() < limit) {
      heap.push(item);
      continue;
    }

    const smallest = heap.peek();

    if (
      item.score > smallest.score ||
      (item.score === smallest.score && item.productId.localeCompare(smallest.productId) < 0)
    ) {
      heap.pop();
      heap.push(item);
    }
  }

  return heap.toArray().sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.productId.localeCompare(b.productId);
  });
}

function getProductId(product) {
  if (!product || typeof product !== "object") {
    return "";
  }

  return String(product.id || product._id || product.product_id || product.productId || "");
}

function productDetailsMapFromPayload(payload) {
  const products = firstArrayFromPayload(payload);
  const map = new Map();

  for (const product of products) {
    const productId = getProductId(product);

    if (productId) {
      map.set(productId, product);
    }
  }

  return map;
}

async function fetchProductDetailsBatch(productIds) {
  if (productIds.length === 0) {
    return new Map();
  }

  const response = await centralApi.post(
    CENTRAL_API_PRODUCTS_BATCH_URL,
    {
      ids: productIds,
      productIds
    },
    {
      headers: {
        ...buildHeaders(),
        "Content-Type": "application/json"
      }
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw createCentralApiError(response, "Unable to fetch product details");
  }

  return productDetailsMapFromPayload(response.data);
}

function recommendationFromProduct(item, productDetails) {
  const product = productDetails.get(item.productId) || {};

  return {
    productId: item.productId,
    name: product.name || product.title || product.product_name || product.productName || null,
    category: product.category || product.category_name || product.categoryName || null,
    score: item.score
  };
}

app.get("/status", (req, res) => {
  res.json({
    service: "analytics-service",
    status: "OK"
  });
});

app.get("/analytics/peak-window", async (req, res, next) => {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const fromMonth = parseMonth(from);
    const toMonth = parseMonth(to);

    if (!fromMonth || !toMonth) {
      return res.status(400).json({
        error: "Bad Request",
        message: "from and to must use YYYY-MM format"
      });
    }

    if (fromMonth.index > toMonth.index) {
      return res.status(400).json({
        error: "Bad Request",
        message: "from must be before or equal to to"
      });
    }

    const monthCount = toMonth.index - fromMonth.index + 1;

    if (monthCount > MAX_MONTH_RANGE) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Range cannot exceed 12 months"
      });
    }

    const months = listMonths(fromMonth, toMonth);
    const statsByMonth = await Promise.all(months.map(fetchStatsForMonth));
    const dailyCounts = combineStats(months, statsByMonth);
    const peakWindow = findPeakWindow(dailyCounts);

    return res.json({
      from,
      to,
      peakWindow
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/analytics/surge-days", async (req, res, next) => {
  try {
    const month = String(req.query.month || "").trim();
    const parsedMonth = parseMonth(month);

    if (!parsedMonth) {
      return res.status(400).json({
        error: "Bad Request",
        message: "month must use YYYY-MM format"
      });
    }

    const stats = await fetchStatsForMonth(month);
    const dailyCounts = combineStats([month], [stats]);

    return res.json({
      month,
      data: buildSurgeDays(dailyCounts)
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/analytics/recommendations", async (req, res, next) => {
  try {
    const date = String(req.query.date || "").trim();
    const targetDate = parseDateInput(date);
    const limit = parseRecommendationLimit(req.query.limit);

    if (!targetDate) {
      return res.status(400).json({
        error: "Bad Request",
        message: "date must use YYYY-MM-DD format"
      });
    }

    if (!limit) {
      return res.status(400).json({
        error: "Bad Request",
        message: "limit must be an integer between 1 and 50"
      });
    }

    const historyStart = dateFns.startOfDay(
      dateFns.subYears(targetDate, RECOMMENDATION_HISTORY_YEARS)
    );
    const historyEnd = dateFns.startOfDay(dateFns.subDays(targetDate, 1));
    const seasonalWindows = buildSeasonalWindows(targetDate, historyStart, historyEnd);
    const rentals = await fetchRentalsForRecommendation(historyStart, historyEnd);
    const counts = countProductsForSeasonalWindow(rentals, seasonalWindows);
    const topProducts = topProductsByCount(counts, limit);
    const productIds = topProducts.map((product) => product.productId);
    const productDetails = await fetchProductDetailsBatch(productIds);

    return res.json({
      date,
      recommendations: topProducts.map((product) =>
        recommendationFromProduct(product, productDetails)
      )
    });
  } catch (error) {
    return next(error);
  }
});

// Handle retry exhausted errors (429 after 3 retries)
app.use(handleRetryExhausted);

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

app.use((err, req, res, next) => {
  if (err.statusCode === 429) {
    return res.status(429).json({
      error: "Rate Limit Exceeded",
      message: err.message || "Central API rate limit exceeded"
    });
  }

  if (err.statusCode === 502) {
    return res.status(502).json({
      error: "Bad Gateway",
      message: err.message || "Central API service error"
    });
  }

  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json({
      error: "Central API Error",
      message: err.message || "Central API rejected request",
      details: err.payload || null
    });
  }

  if (err.code === "ECONNABORTED") {
    return res.status(504).json({
      error: "Gateway Timeout",
      message: "Central API request timed out"
    });
  }

  res.status(500).json({
    error: "Internal Server Error",
    message: "Unexpected error while processing request"
  });
});

app.listen(PORT, () => {
  console.log(`analytics-service listening on port ${PORT}`);
});
