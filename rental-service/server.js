const express = require("express");
const axios = require("axios");
const { withRetry, handleRetryExhausted } = require("./api-retry-utils");

const app = express();
const PORT = process.env.PORT || 8002;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN || "";
const CENTRAL_API_PRODUCTS_URL =
  process.env.CENTRAL_API_PRODUCTS_URL ||
  "https://technocracy.brittoo.xyz/api/data/products";
const CENTRAL_API_CATEGORIES_URL =
  process.env.CENTRAL_API_CATEGORIES_URL ||
  "https://technocracy.brittoo.xyz/api/data/categories";
const CENTRAL_API_RENTALS_URL =
  process.env.CENTRAL_API_RENTALS_URL ||
  "https://technocracy.brittoo.xyz/api/data/rentals";
const CENTRAL_API_RENTAL_STATS_URL =
  process.env.CENTRAL_API_RENTAL_STATS_URL ||
  "https://technocracy.brittoo.xyz/api/data/rentals/stats";
const CENTRAL_API_PRODUCTS_BATCH_URL =
  process.env.CENTRAL_API_PRODUCTS_BATCH_URL ||
  "https://technocracy.brittoo.xyz/api/data/products/batch";
const CENTRAL_API_TIMEOUT_MS = Number(process.env.CENTRAL_API_TIMEOUT_MS || 10000);
const ALLOWED_QUERY_PARAMS = ["category", "page", "limit", "owner_id"];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_TOP_CATEGORIES_LIMIT = 5;
const DEFAULT_MERGED_FEED_LIMIT = 30;
const MAX_MERGED_FEED_LIMIT = 100;
const MAX_MERGED_FEED_PRODUCTS = 10;
const PRODUCT_BATCH_SIZE = 50;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

let categoriesCache = null;
let categoriesCachePromise = null;

app.use(express.json());

const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "rental-service"
);

function buildForwardedQuery(query) {
  const params = {};

  for (const key of ALLOWED_QUERY_PARAMS) {
    if (query[key] !== undefined) {
      params[key] = query[key];
    }
  }

  return params;
}

function buildHeaders() {
  const headers = {
    Accept: "application/json"
  };

  if (CENTRAL_API_TOKEN) {
    headers.Authorization = `Bearer ${CENTRAL_API_TOKEN}`;
  }

  return headers;
}

function normalizeCategory(category) {
  return String(category || "").trim().toUpperCase();
}

function parsePositiveInteger(value, fallback, maxValue) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  if (maxValue && parsed > maxValue) {
    return maxValue;
  }

  return parsed;
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

    if (Array.isArray(payload.data.categories)) {
      return payload.data.categories;
    }

    if (Array.isArray(payload.data.items)) {
      return payload.data.items;
    }

    if (Array.isArray(payload.data.results)) {
      return payload.data.results;
    }

    if (Array.isArray(payload.data.products)) {
      return payload.data.products;
    }

    if (Array.isArray(payload.data.rentals)) {
      return payload.data.rentals;
    }

    if (Array.isArray(payload.data.stats)) {
      return payload.data.stats;
    }
  }

  if (Array.isArray(payload.categories)) {
    return payload.categories;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (Array.isArray(payload.products)) {
    return payload.products;
  }

  if (Array.isArray(payload.rentals)) {
    return payload.rentals;
  }

  if (Array.isArray(payload.stats)) {
    return payload.stats;
  }

  return [];
}

function extractCategoryValue(category) {
  if (typeof category === "string") {
    return category;
  }

  if (!category || typeof category !== "object") {
    return "";
  }

  return (
    category.slug ||
    category.code ||
    category.key ||
    category.value ||
    category.name ||
    category.title ||
    category.category ||
    category.id ||
    ""
  );
}

function extractCategories(payload) {
  const source = firstArrayFromPayload(payload);
  const categories = source
    .map(extractCategoryValue)
    .map(normalizeCategory)
    .filter(Boolean);

  return Array.from(new Set(categories));
}

async function fetchCategories() {
  const response = await centralApi.get(CENTRAL_API_CATEGORIES_URL, {
    headers: buildHeaders()
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
    const error = new Error("Unable to fetch categories");
    error.statusCode = 502;
    throw error;
  }

  const categories = extractCategories(response.data);

  if (categories.length === 0) {
    const error = new Error("Central API returned no categories");
    error.statusCode = 502;
    throw error;
  }

  return categories;
}

async function getCachedCategories() {
  if (categoriesCache) {
    return categoriesCache;
  }

  if (!categoriesCachePromise) {
    categoriesCachePromise = fetchCategories()
      .then((categories) => {
        categoriesCache = categories;
        return categoriesCache;
      })
      .finally(() => {
        categoriesCachePromise = null;
      });
  }

  return categoriesCachePromise;
}

function getNestedValue(payload, keys) {
  for (const key of keys) {
    if (payload && payload[key] !== undefined && payload[key] !== null) {
      return payload[key];
    }
  }

  return undefined;
}

function getTotalFromPayload(payload, dataLength) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return dataLength;
  }

  const directTotal = getNestedValue(payload, [
    "total",
    "count",
    "totalItems",
    "total_items",
    "totalCount",
    "total_count"
  ]);

  if (directTotal !== undefined) {
    return Number(directTotal);
  }

  const nestedContainers = [payload.meta, payload.pagination, payload.pageInfo, payload.data];

  for (const container of nestedContainers) {
    if (container && typeof container === "object" && !Array.isArray(container)) {
      const nestedTotal = getNestedValue(container, [
        "total",
        "count",
        "totalItems",
        "total_items",
        "totalCount",
        "total_count"
      ]);

      if (nestedTotal !== undefined) {
        return Number(nestedTotal);
      }
    }
  }

  return dataLength;
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

function buildPaginatedProducts(payload, page, limit) {
  const data = firstArrayFromPayload(payload);
  const total = getTotalFromPayload(payload, data.length);
  const payloadTotalPages = getTotalPagesFromPayload(payload);
  const safeTotal = Number.isFinite(total) && total >= 0 ? total : data.length;
  const computedTotalPages = Math.ceil(safeTotal / limit);
  const totalPages =
    Number.isFinite(payloadTotalPages) && payloadTotalPages >= 0
      ? payloadTotalPages
      : computedTotalPages;

  return {
    data,
    page,
    limit,
    total: safeTotal,
    totalPages
  };
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
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

function parseYear(value) {
  if (typeof value !== "string" || !YEAR_PATTERN.test(value)) {
    return null;
  }

  const year = Number(value);

  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    return null;
  }

  return year;
}

function formatMonthFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = String((index % 12) + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function listMonths(fromMonth, toMonth) {
  const months = [];

  for (let index = fromMonth.index; index <= toMonth.index; index += 1) {
    months.push(formatMonthFromIndex(index));
  }

  return months;
}

function parseRequiredPositiveInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function parseOptionalPositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function parseLimitedPositiveInteger(value, fallback, maxValue) {
  const parsed = parseOptionalPositiveInteger(value, fallback);

  if (!parsed || parsed > maxValue) {
    return null;
  }

  return parsed;
}

function parseProductIdsParam(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const rawProductIds = value.split(",").map((productId) => productId.trim());

  if (rawProductIds.some((productId) => !productId)) {
    return null;
  }

  const seen = new Set();
  const productIds = [];

  for (const productId of rawProductIds) {
    if (seen.has(productId)) {
      continue;
    }

    seen.add(productId);
    productIds.push(productId);
  }

  if (productIds.length < 1 || productIds.length > MAX_MERGED_FEED_PRODUCTS) {
    return null;
  }

  return productIds;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function daysInclusive(from, to) {
  if (from > to) {
    return 0;
  }

  return Math.floor((to.getTime() - from.getTime()) / DAY_IN_MS) + 1;
}

function toDateOnlyString(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateOnly(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (DATE_ONLY_PATTERN.test(trimmed)) {
      return trimmed;
    }

    const parsed = new Date(trimmed);

    if (!Number.isNaN(parsed.getTime())) {
      return formatDateOnly(parsed);
    }
  }

  return "";
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
    "";

  if (value && typeof value === "object") {
    return String(value.id || value._id || value.product_id || value.productId || "");
  }

  return String(value || "");
}

function getRentalUserId(rental) {
  if (!rental || typeof rental !== "object") {
    return "";
  }

  const value =
    rental.user_id ||
    rental.userId ||
    rental.userID ||
    rental.renter_id ||
    rental.renterId ||
    rental.customer_id ||
    rental.customerId ||
    rental.borrower_id ||
    rental.borrowerId ||
    rental.owner_id ||
    rental.ownerId ||
    rental.user ||
    rental.renter ||
    rental.customer ||
    "";

  if (value && typeof value === "object") {
    return String(value.id || value._id || value.user_id || value.userId || "");
  }

  return String(value || "");
}

function getRentalInterval(rental) {
  if (!rental || typeof rental !== "object") {
    return null;
  }

  const startValue =
    rental.from ||
    rental.start ||
    rental.start_date ||
    rental.startDate ||
    rental.rental_start ||
    rental.rentalStart ||
    rental.booking_start ||
    rental.bookingStart ||
    rental.rented_from ||
    rental.rentedFrom ||
    rental.pickup_date ||
    rental.pickupDate ||
    rental.begin_date ||
    rental.beginDate;

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
    rental.finish_date ||
    rental.finishDate;

  const startDateString = toDateOnlyString(startValue);
  const endDateString = toDateOnlyString(endValue);
  const startDate = parseDateOnly(startDateString);
  const endDate = parseDateOnly(endDateString);

  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  return {
    from: startDateString,
    to: endDateString,
    startDate,
    endDate
  };
}

function getRentalFeedTimestamp(rental) {
  if (!rental || typeof rental !== "object") {
    return 0;
  }

  const interval = getRentalInterval(rental);

  if (interval) {
    return interval.startDate.getTime();
  }

  const value =
    rental.date ||
    rental.day ||
    rental.rental_date ||
    rental.rentalDate ||
    rental.start_date ||
    rental.startDate ||
    rental.created_at ||
    rental.createdAt ||
    rental.updated_at ||
    rental.updatedAt ||
    "";
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeIntervals(intervals) {
  const sortedIntervals = intervals
    .slice()
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const merged = [];

  for (const interval of sortedIntervals) {
    const previous = merged[merged.length - 1];

    if (!previous || interval.startDate > previous.endDate) {
      merged.push({ ...interval });
      continue;
    }

    if (interval.endDate > previous.endDate) {
      previous.endDate = interval.endDate;
      previous.to = formatDateOnly(interval.endDate);
    }
  }

  return merged;
}

function intervalOverlapsRange(interval, rangeStart, rangeEnd) {
  return interval.startDate <= rangeEnd && interval.endDate >= rangeStart;
}

function clipIntervalsToRange(intervals, rangeStart, rangeEnd) {
  return intervals
    .filter((interval) => intervalOverlapsRange(interval, rangeStart, rangeEnd))
    .map((interval) => {
      const clippedStart = interval.startDate < rangeStart ? rangeStart : interval.startDate;
      const clippedEnd = interval.endDate > rangeEnd ? rangeEnd : interval.endDate;

      return {
        from: formatDateOnly(clippedStart),
        to: formatDateOnly(clippedEnd),
        startDate: clippedStart,
        endDate: clippedEnd
      };
    });
}

function buildFreeWindows(busyPeriods, rangeStart, rangeEnd) {
  const freeWindows = [];
  let cursor = rangeStart;

  for (const period of busyPeriods) {
    if (cursor < period.startDate) {
      freeWindows.push({
        from: formatDateOnly(cursor),
        to: formatDateOnly(addDays(period.startDate, -1))
      });
    }

    const nextCursor = addDays(period.endDate, 1);

    if (nextCursor > cursor) {
      cursor = nextCursor;
    }
  }

  if (cursor <= rangeEnd) {
    freeWindows.push({
      from: formatDateOnly(cursor),
      to: formatDateOnly(rangeEnd)
    });
  }

  return freeWindows;
}

function serializeBusyPeriods(busyPeriods) {
  return busyPeriods.map((period) => ({
    from: period.from,
    to: period.to
  }));
}

function getYearBounds(year) {
  const yearText = String(year).padStart(4, "0");

  return {
    start: parseDateOnly(`${yearText}-01-01`),
    end: parseDateOnly(`${yearText}-12-31`)
  };
}

function findLongestFreeStreak(mergedBusyPeriods, yearStart, yearEnd) {
  let cursor = yearStart;
  let best = {
    from: formatDateOnly(yearStart),
    to: formatDateOnly(yearEnd),
    days: daysInclusive(yearStart, yearEnd)
  };

  if (mergedBusyPeriods.length > 0) {
    best = {
      from: null,
      to: null,
      days: 0
    };
  }

  for (const period of mergedBusyPeriods) {
    const gapStart = cursor;
    const gapEnd = addDays(period.startDate, -1);
    const gapDays = daysInclusive(gapStart, gapEnd);

    if (
      gapDays > best.days ||
      (gapDays === best.days &&
        gapDays > 0 &&
        (!best.from || formatDateOnly(gapStart).localeCompare(best.from) < 0))
    ) {
      best = {
        from: formatDateOnly(gapStart),
        to: formatDateOnly(gapEnd),
        days: gapDays
      };
    }

    const nextCursor = addDays(period.endDate, 1);

    if (nextCursor > cursor) {
      cursor = nextCursor;
    }
  }

  const trailingGapDays = daysInclusive(cursor, yearEnd);

  if (
    trailingGapDays > best.days ||
    (trailingGapDays === best.days &&
      trailingGapDays > 0 &&
      (!best.from || formatDateOnly(cursor).localeCompare(best.from) < 0))
  ) {
    best = {
      from: formatDateOnly(cursor),
      to: formatDateOnly(yearEnd),
      days: trailingGapDays
    };
  }

  if (!best.from || !best.to) {
    return {
      from: null,
      to: null,
      days: 0
    };
  }

  return best;
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
    stat.rentalCount ??
    stat.rental_count ??
    stat.value ??
    0;
  const count = Number(value);

  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function fetchRentalStatsForMonth(month) {
  const response = await centralApi.get(CENTRAL_API_RENTAL_STATS_URL, {
    headers: buildHeaders(),
    params: {
      group_by: "date",
      month
    }
  });

  if (response.status < 200 || response.status >= 300) {
    throw createCentralApiError(response, "Unable to fetch rental stats");
  }

  return firstArrayFromPayload(response.data);
}

function combineRentalStats(statsByMonth) {
  const countsByDate = new Map();

  for (const stats of statsByMonth) {
    for (const stat of stats) {
      const date = dateFromStat(stat);

      if (!parseDateOnly(date)) {
        continue;
      }

      countsByDate.set(date, (countsByDate.get(date) || 0) + countFromStat(stat));
    }
  }

  return countsByDate;
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
    return this.items[0] || null;
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
}

function compareBusiestDateWorstFirst(a, b) {
  if (a.rentalCount !== b.rentalCount) {
    return a.rentalCount - b.rentalCount;
  }

  return b.date.localeCompare(a.date);
}

function isBusiestCandidateBetter(candidate, currentWorst) {
  if (candidate.rentalCount !== currentWorst.rentalCount) {
    return candidate.rentalCount > currentWorst.rentalCount;
  }

  return candidate.date.localeCompare(currentWorst.date) < 0;
}

function findKthBusiestDate(countsByDate, k) {
  const heap = new MinHeap(compareBusiestDateWorstFirst);

  for (const [date, rentalCount] of countsByDate.entries()) {
    const candidate = {
      date,
      rentalCount
    };

    if (heap.size() < k) {
      heap.push(candidate);
      continue;
    }

    const currentWorst = heap.peek();

    if (isBusiestCandidateBetter(candidate, currentWorst)) {
      heap.pop();
      heap.push(candidate);
    }
  }

  if (heap.size() < k) {
    return null;
  }

  return heap.peek();
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchUserRentalsPage(userId, page, limit) {
  const response = await centralApi.get(CENTRAL_API_RENTALS_URL, {
    headers: buildHeaders(),
    params: {
      user_id: userId,
      page,
      limit
    }
  });

  if (response.status < 200 || response.status >= 300) {
    throw createCentralApiError(response, "Unable to fetch user rentals");
  }

  return response.data;
}

async function fetchAllRentalsForUser(userId) {
  const limit = 100;
  const firstPayload = await fetchUserRentalsPage(userId, 1, limit);
  const rentals = firstArrayFromPayload(firstPayload);
  const totalPages = getTotalPagesFromPayload(firstPayload);

  if (Number.isFinite(totalPages) && totalPages > 1) {
    const pageRequests = [];

    for (let page = 2; page <= totalPages; page += 1) {
      pageRequests.push(fetchUserRentalsPage(userId, page, limit));
    }

    const pagePayloads = await Promise.all(pageRequests);

    for (const payload of pagePayloads) {
      rentals.push(...firstArrayFromPayload(payload));
    }

    return filterRentalsByUserId(rentals, userId);
  }

  if (Number.isFinite(totalPages)) {
    return filterRentalsByUserId(rentals, userId);
  }

  let page = 2;
  let lastPageSize = rentals.length;

  while (lastPageSize === limit) {
    const payload = await fetchUserRentalsPage(userId, page, limit);
    const pageRentals = firstArrayFromPayload(payload);

    rentals.push(...pageRentals);
    lastPageSize = pageRentals.length;
    page += 1;
  }

  return filterRentalsByUserId(rentals, userId);
}

function filterRentalsByUserId(rentals, userId) {
  const rentalsWithUserIds = rentals.map((rental) => ({
    rental,
    userId: getRentalUserId(rental)
  }));
  const hasUserIds = rentalsWithUserIds.some((rental) => rental.userId);

  if (!hasUserIds) {
    return rentals;
  }

  return rentalsWithUserIds
    .filter((rental) => rental.userId === userId)
    .map((rental) => rental.rental);
}

function uniqueProductIdsFromRentals(rentals) {
  const productIds = [];
  const seen = new Set();

  for (const rental of rentals) {
    const productId = getRentalProductId(rental);

    if (!productId || seen.has(productId)) {
      continue;
    }

    seen.add(productId);
    productIds.push(productId);
  }

  return productIds;
}

function getProductId(product) {
  if (!product || typeof product !== "object") {
    return "";
  }

  return String(product.id || product._id || product.product_id || product.productId || "");
}

function getProductCategory(product) {
  if (!product || typeof product !== "object") {
    return "";
  }

  const value =
    product.category ||
    product.category_name ||
    product.categoryName ||
    product.category_slug ||
    product.categorySlug ||
    product.type ||
    "";

  if (value && typeof value === "object") {
    return String(value.name || value.slug || value.code || value.id || "");
  }

  return String(value || "");
}

async function fetchProductsBatch(productIds) {
  if (productIds.length === 0) {
    return [];
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

  return firstArrayFromPayload(response.data);
}

async function fetchProductsByIds(productIds) {
  const productsById = new Map();
  const chunks = chunkArray(productIds, PRODUCT_BATCH_SIZE);
  const chunkResults = await Promise.all(chunks.map(fetchProductsBatch));

  for (const products of chunkResults) {
    for (const product of products) {
      const productId = getProductId(product);

      if (productId) {
        productsById.set(productId, product);
      }
    }
  }

  return productsById;
}

function countCategoriesFromRentals(rentals, productsById) {
  const categoryCounts = new Map();

  for (const rental of rentals) {
    const productId = getRentalProductId(rental);
    const product = productsById.get(productId);
    const category = getProductCategory(product);

    if (!category) {
      continue;
    }

    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }

  return categoryCounts;
}

function compareCategoryWorstFirst(a, b) {
  if (a.rentalCount !== b.rentalCount) {
    return a.rentalCount - b.rentalCount;
  }

  return b.category.localeCompare(a.category);
}

function isCategoryCandidateBetter(candidate, currentWorst) {
  if (candidate.rentalCount !== currentWorst.rentalCount) {
    return candidate.rentalCount > currentWorst.rentalCount;
  }

  return candidate.category.localeCompare(currentWorst.category) < 0;
}

function topCategoriesByCount(categoryCounts, k) {
  const heap = new MinHeap(compareCategoryWorstFirst);

  for (const [category, rentalCount] of categoryCounts.entries()) {
    const candidate = {
      category,
      rentalCount
    };

    if (heap.size() < k) {
      heap.push(candidate);
      continue;
    }

    const currentWorst = heap.peek();

    if (isCategoryCandidateBetter(candidate, currentWorst)) {
      heap.pop();
      heap.push(candidate);
    }
  }

  return heap.items.slice().sort((a, b) => {
    if (b.rentalCount !== a.rentalCount) {
      return b.rentalCount - a.rentalCount;
    }

    return a.category.localeCompare(b.category);
  });
}

async function fetchRentalFeedForProduct(productId, limit) {
  const response = await centralApi.get(CENTRAL_API_RENTALS_URL, {
    headers: buildHeaders(),
    params: {
      product_id: productId,
      page: 1,
      limit,
      sort_by: "start_date",
      sort: "start_date",
      order: "desc"
    }
  });

  if (response.status === 404) {
    return [];
  }

  if (response.status < 200 || response.status >= 300) {
    throw createCentralApiError(response, "Unable to fetch product rental feed");
  }

  const rentals = firstArrayFromPayload(response.data);
  const rentalsWithProductIds = rentals.map((rental) => ({
    rental,
    productId: getRentalProductId(rental)
  }));
  const hasProductIds = rentalsWithProductIds.some((rental) => rental.productId);
  const productRentals = hasProductIds
    ? rentalsWithProductIds
        .filter((rental) => rental.productId === productId)
        .map((rental) => rental.rental)
    : rentals;

  return productRentals
    .slice()
    .sort((a, b) => getRentalFeedTimestamp(b) - getRentalFeedTimestamp(a));
}

function compareMergedFeedNewestFirst(a, b) {
  if (a.timestamp !== b.timestamp) {
    return b.timestamp - a.timestamp;
  }

  if (a.listIndex !== b.listIndex) {
    return a.listIndex - b.listIndex;
  }

  return a.itemIndex - b.itemIndex;
}

function mergeRentalFeeds(sortedRentalLists, limit) {
  const heap = new MinHeap(compareMergedFeedNewestFirst);
  const feed = [];

  for (let listIndex = 0; listIndex < sortedRentalLists.length; listIndex += 1) {
    const rentalList = sortedRentalLists[listIndex];

    if (rentalList.length === 0) {
      continue;
    }

    heap.push({
      listIndex,
      itemIndex: 0,
      rental: rentalList[0],
      timestamp: getRentalFeedTimestamp(rentalList[0])
    });
  }

  while (heap.size() > 0 && feed.length < limit) {
    const current = heap.pop();
    feed.push(current.rental);

    const nextItemIndex = current.itemIndex + 1;
    const rentalList = sortedRentalLists[current.listIndex];

    if (nextItemIndex < rentalList.length) {
      const rental = rentalList[nextItemIndex];

      heap.push({
        listIndex: current.listIndex,
        itemIndex: nextItemIndex,
        rental,
        timestamp: getRentalFeedTimestamp(rental)
      });
    }
  }

  return feed;
}

function sendCentralApiResponse(res, response) {
  if (response.status === 404) {
    return res.status(404).json({
      error: "Not Found",
      message: "Product not found"
    });
  }

  if (response.status === 429) {
    return res.status(429).json({
      error: "Rate Limit Exceeded",
      message: "Central API rate limit exceeded"
    });
  }

  if (response.status >= 500) {
    return res.status(502).json({
      error: "Bad Gateway",
      message: "Central API service error"
    });
  }

  return res.status(response.status).send(response.data);
}

async function proxyProducts(req, res, next) {
  try {
    const category = normalizeCategory(req.query.category);
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);

    if (category) {
      const validCategories = await getCachedCategories();

      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid category",
          validCategories
        });
      }
    }

    const response = await centralApi.get(CENTRAL_API_PRODUCTS_URL, {
      headers: buildHeaders(),
      params: {
        ...buildForwardedQuery(req.query),
        ...(category ? { category } : {}),
        page,
        limit
      }
    });

    if (response.status === 404) {
      return res.status(404).json({
        error: "Not Found",
        message: "Products not found"
      });
    }

    if (response.status === 429) {
      return res.status(429).json({
        error: "Rate Limit Exceeded",
        message: "Central API rate limit exceeded"
      });
    }

    if (response.status >= 500) {
      return res.status(502).json({
        error: "Bad Gateway",
        message: "Central API service error"
      });
    }

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).send(response.data);
    }

    return res.json(buildPaginatedProducts(response.data, page, limit));
  } catch (error) {
    return next(error);
  }
}

async function proxyProductById(req, res, next) {
  try {
    const productUrl = `${CENTRAL_API_PRODUCTS_URL}/${encodeURIComponent(req.params.id)}`;

    const response = await centralApi.get(productUrl, {
      headers: buildHeaders(),
      params: buildForwardedQuery(req.query)
    });

    return sendCentralApiResponse(res, response);
  } catch (error) {
    return next(error);
  }
}

async function getMergedFeed(req, res, next) {
  try {
    const productIds = parseProductIdsParam(req.query.productIds);
    const limit = parseLimitedPositiveInteger(
      req.query.limit,
      DEFAULT_MERGED_FEED_LIMIT,
      MAX_MERGED_FEED_LIMIT
    );

    if (!productIds) {
      return res.status(400).json({
        error: "Bad Request",
        message: "productIds must contain 1 to 10 comma-separated values"
      });
    }

    if (!limit) {
      return res.status(400).json({
        error: "Bad Request",
        message: "limit must be an integer between 1 and 100"
      });
    }

    const rentalLists = await Promise.all(
      productIds.map((productId) => fetchRentalFeedForProduct(productId, limit))
    );

    return res.json({
      productIds,
      limit,
      feed: mergeRentalFeeds(rentalLists, limit)
    });
  } catch (error) {
    return next(error);
  }
}

async function getProductAvailability(req, res, next) {
  try {
    const productId = String(req.params.id || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const requestedStart = parseDateOnly(from);
    const requestedEnd = parseDateOnly(to);

    if (!productId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Product id is required"
      });
    }

    if (!requestedStart || !requestedEnd) {
      return res.status(400).json({
        error: "Bad Request",
        message: "from and to must use YYYY-MM-DD format"
      });
    }

    if (requestedStart > requestedEnd) {
      return res.status(400).json({
        error: "Bad Request",
        message: "from must be before or equal to to"
      });
    }

    const response = await centralApi.get(CENTRAL_API_RENTALS_URL, {
      headers: buildHeaders(),
      params: {
        product_id: productId
      }
    });

    if (response.status === 404) {
      return res.status(404).json({
        error: "Not Found",
        message: "Rentals not found for product"
      });
    }

    if (response.status === 429) {
      return res.status(429).json({
        error: "Rate Limit Exceeded",
        message: "Central API rate limit exceeded"
      });
    }

    if (response.status >= 500) {
      return res.status(502).json({
        error: "Bad Gateway",
        message: "Central API service error"
      });
    }

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).send(response.data);
    }

    const rentals = firstArrayFromPayload(response.data);
    const rentalsWithProductIds = rentals.map((rental) => ({
      rental,
      productId: getRentalProductId(rental)
    }));
    const hasProductIds = rentalsWithProductIds.some((rental) => rental.productId);
    const productRentals = hasProductIds
      ? rentalsWithProductIds
          .filter((rental) => rental.productId === productId)
          .map((rental) => rental.rental)
      : rentals;

    const intervals = productRentals.map(getRentalInterval).filter(Boolean);
    const mergedIntervals = mergeIntervals(intervals);
    const busyPeriods = clipIntervalsToRange(mergedIntervals, requestedStart, requestedEnd);
    const freeWindows = buildFreeWindows(busyPeriods, requestedStart, requestedEnd);

    return res.json({
      productId,
      from,
      to,
      available: busyPeriods.length === 0,
      busyPeriods: serializeBusyPeriods(busyPeriods),
      freeWindows
    });
  } catch (error) {
    return next(error);
  }
}

async function getProductFreeStreak(req, res, next) {
  try {
    const productId = String(req.params.id || "").trim();
    const yearValue = String(req.query.year || "").trim();
    const year = parseYear(yearValue);

    if (!productId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Product id is required"
      });
    }

    if (!year) {
      return res.status(400).json({
        error: "Bad Request",
        message: "year must use YYYY format"
      });
    }

    const { start: yearStart, end: yearEnd } = getYearBounds(year);
    const response = await centralApi.get(CENTRAL_API_RENTALS_URL, {
      headers: buildHeaders(),
      params: {
        product_id: productId,
        from: formatDateOnly(yearStart),
        to: formatDateOnly(yearEnd)
      }
    });

    if (response.status === 404) {
      return res.json({
        productId,
        year: yearValue,
        longestFreeStreak: {
          from: formatDateOnly(yearStart),
          to: formatDateOnly(yearEnd),
          days: daysInclusive(yearStart, yearEnd)
        }
      });
    }

    if (response.status === 429) {
      return res.status(429).json({
        error: "Rate Limit Exceeded",
        message: "Central API rate limit exceeded"
      });
    }

    if (response.status >= 500) {
      return res.status(502).json({
        error: "Bad Gateway",
        message: "Central API service error"
      });
    }

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).send(response.data);
    }

    const rentals = firstArrayFromPayload(response.data);
    const rentalsWithProductIds = rentals.map((rental) => ({
      rental,
      productId: getRentalProductId(rental)
    }));
    const hasProductIds = rentalsWithProductIds.some((rental) => rental.productId);
    const productRentals = hasProductIds
      ? rentalsWithProductIds
          .filter((rental) => rental.productId === productId)
          .map((rental) => rental.rental)
      : rentals;
    const intervals = productRentals.map(getRentalInterval).filter(Boolean);
    const mergedIntervals = mergeIntervals(intervals);
    const busyPeriods = clipIntervalsToRange(mergedIntervals, yearStart, yearEnd);
    const longestFreeStreak = findLongestFreeStreak(busyPeriods, yearStart, yearEnd);

    return res.json({
      productId,
      year: yearValue,
      longestFreeStreak
    });
  } catch (error) {
    return next(error);
  }
}

async function getKthBusiestDate(req, res, next) {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const k = parseRequiredPositiveInteger(req.query.k);
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

    if (!k) {
      return res.status(400).json({
        error: "Bad Request",
        message: "k must be a positive integer"
      });
    }

    const months = listMonths(fromMonth, toMonth);
    const statsByMonth = await Promise.all(months.map(fetchRentalStatsForMonth));
    const countsByDate = combineRentalStats(statsByMonth);

    if (k > countsByDate.size) {
      return res.status(404).json({
        error: "Not Found",
        message: "k is larger than the number of dates in the dataset"
      });
    }

    const kthBusiestDate = findKthBusiestDate(countsByDate, k);

    if (!kthBusiestDate) {
      return res.status(404).json({
        error: "Not Found",
        message: "No rental stats found for the requested range"
      });
    }

    return res.json({
      from,
      to,
      k,
      date: kthBusiestDate.date,
      rentalCount: kthBusiestDate.rentalCount
    });
  } catch (error) {
    return next(error);
  }
}

async function getUserTopCategories(req, res, next) {
  try {
    const userId = String(req.params.id || "").trim();
    const k = parseOptionalPositiveInteger(req.query.k, DEFAULT_TOP_CATEGORIES_LIMIT);

    if (!userId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "user id is required"
      });
    }

    if (!k) {
      return res.status(400).json({
        error: "Bad Request",
        message: "k must be a positive integer"
      });
    }

    const rentals = await fetchAllRentalsForUser(userId);
    const productIds = uniqueProductIdsFromRentals(rentals);
    const productsById = await fetchProductsByIds(productIds);
    const categoryCounts = countCategoriesFromRentals(rentals, productsById);

    return res.json({
      userId,
      topCategories: topCategoriesByCount(categoryCounts, k)
    });
  } catch (error) {
    return next(error);
  }
}

app.get("/status", (req, res) => {
  res.json({
    service: "rental-service",
    status: "OK"
  });
});

app.get("/rentals/kth-busiest-date", getKthBusiestDate);
app.get("/rentals/merged-feed", getMergedFeed);
app.get("/rentals/users/:id/top-categories", getUserTopCategories);
app.get("/rentals/products", proxyProducts);
app.get("/rentals/products/:id/availability", getProductAvailability);
app.get("/rentals/products/:id/free-streak", getProductFreeStreak);
app.get("/rentals/products/:id", proxyProductById);

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

  if (err.response && err.response.status >= 500) {
    return res.status(502).json({
      error: "Bad Gateway",
      message: "Central API service error"
    });
  }

  res.status(500).json({
    error: "Internal Server Error",
    message: "Unexpected error while processing request"
  });
});

app.listen(PORT, () => {
  console.log(`rental-service listening on port ${PORT}`);
});
