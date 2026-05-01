const express = require("express");
const axios = require("axios");
const dateFns = require("date-fns");
const { withRetry, handleRetryExhausted } = require("./api-retry-utils");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, 'rentpi.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const rentpiProto = grpc.loadPackageDefinition(packageDefinition).rentpi;

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

function formatDateInput(date) {
  return dateFns.format(date, "yyyy-MM-dd");
}

async function getRecommendationsLogic(date, limit) {
  if (!date || isNaN(new Date(date))) {
    throw new Error("Invalid date format");
  }

  const lim = parseInt(limit) || DEFAULT_RECOMMENDATION_LIMIT;
  if (lim <= 0 || lim > 50) {
    throw new Error("Invalid limit");
  }

  const base = new Date(date);
  const start = new Date(base);
  start.setDate(base.getDate() - 7);
  const end = new Date(base);
  end.setDate(base.getDate() + 7);

  const rentals = [];
  const fetchRange = async (fromDate, toDate) => {
    let page = 1;
    while (true) {
      const resApi = await centralApi.get(CENTRAL_API_RENTALS_URL, {
        headers: buildHeaders(),
        params: {
          from: formatDateInput(fromDate),
          to: formatDateInput(toDate),
          page,
          limit: 100
        }
      });
      const pageData = firstArrayFromPayload(resApi.data);
      rentals.push(...pageData);
      const totalPages = getTotalPagesFromPayload(resApi.data) || 1;
      if (page >= totalPages) break;
      page++;
    }
  };

  for (let i = 1; i <= 2; i++) {
    const s = new Date(start);
    const e = new Date(end);
    s.setFullYear(base.getFullYear() - i);
    e.setFullYear(base.getFullYear() - i);
    await fetchRange(s, e);
  }

  if (!rentals.length) return { date, recommendations: [] };

  const freq = {};
  for (const r of rentals) {
    const id = r.productId || r.product_id || r.product || r.item_id || r.itemId;
    if (!id) continue;
    freq[id] = (freq[id] || 0) + 1;
  }

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, lim);

  const ids = sorted.map(([id]) => id);
  if (!ids.length) return { date, recommendations: [] };

  const productRes = await centralApi.get(
    CENTRAL_API_PRODUCTS_BATCH_URL,
    {
      headers: buildHeaders(),
      params: { ids: ids.join(",") }
    }
  );

  const products = firstArrayFromPayload(productRes.data);
  const productMap = {};
  for (const p of products) productMap[p.id || p._id] = p;

  const recommendations = sorted.map(([id, score]) => ({
    productId: id,
    name: productMap[id]?.name || productMap[id]?.title || "Unknown",
    category: productMap[id]?.category || "Unknown",
    score: score,
  }));

  return { date, recommendations };
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

app.get("/analytics/recommendations", async (req, res) => {
  try {
    const { date, limit } = req.query;
    const result = await getRecommendationsLogic(date, limit);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  }
});

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

async function startServer() {
  app.listen(PORT, () => {
    console.log(`analytics-service listening on port ${PORT}`);
  });

  const grpcServer = new grpc.Server();
  grpcServer.addService(rentpiProto.Analytics.service, {
    GetRecommendations: async (call, callback) => {
      try {
        const { date, limit } = call.request;
        const result = await getRecommendationsLogic(date, limit);
        callback(null, result);
      } catch (err) {
        callback({
          code: grpc.status.INTERNAL,
          details: err.message
        });
      }
    }
  });

  const GRPC_PORT = 9003;
  grpcServer.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error("Failed to bind gRPC server", err);
      return;
    }
    console.log(`analytics-service gRPC listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start analytics-service", error);
  process.exit(1);
});
