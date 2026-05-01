const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8004;
const RENTAL_SERVICE_URL = process.env.RENTAL_SERVICE_URL || "http://localhost:8002";
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || "http://localhost:8003";
const LLM_PROVIDER = String(process.env.LLM_PROVIDER || "").trim().toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 15000);
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 8);

const sessions = new Map();

app.use(express.json({ limit: "1mb" }));

const http = axios.create({
  timeout: HTTP_TIMEOUT_MS,
  validateStatus: () => true
});

const RENTPI_KEYWORDS = [
  "rentpi",
  "rent",
  "rental",
  "rentals",
  "product",
  "products",
  "availability",
  "available",
  "busy",
  "free",
  "booking",
  "bookings",
  "category",
  "categories",
  "recommend",
  "recommendation",
  "recommendations",
  "surge",
  "peak",
  "window",
  "seasonal",
  "discount",
  "security score",
  "securityscore",
  "tool",
  "tools",
  "equipment",
  "owner",
  "user",
  "customer",
  "feed",
  "streak"
];

const REFUSAL_REPLY =
  "I can only help with RentPi rentals, products, availability, category trends, recommendations, surge days, peak windows, and related platform questions.";

function normalizeMessage(message) {
  return String(message || "").trim();
}

function isRentPiRelated(message) {
  const normalized = message.toLowerCase();

  return RENTPI_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function formatMonth(date) {
  return date.toISOString().slice(0, 7);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && formatDateOnly(date) === value;
}

function isValidMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function extractDateOnlyValues(message) {
  return Array.from(new Set(message.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])).filter(
    isValidDateOnly
  );
}

function extractMonthValues(message) {
  return Array.from(new Set(message.match(/\b\d{4}-\d{2}\b/g) || [])).filter(isValidMonth);
}

function extractIntegerAfterLabels(message, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\s*[:=]?\\s*(\\d+)\\b`, "i");
    const match = message.match(pattern);

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function extractProductId(message) {
  const patterns = [
    /\bproduct(?:\s*id)?\s*[:#=]?\s*([A-Za-z0-9_-]+)\b/i,
    /\bitem(?:\s*id)?\s*[:#=]?\s*([A-Za-z0-9_-]+)\b/i,
    /\bavailability\s+(?:for\s+)?(?:product\s+)?([A-Za-z0-9_-]+)\b/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match && !["availability", "from", "to", "on"].includes(match[1].toLowerCase())) {
      return match[1];
    }
  }

  return null;
}

function extractUserId(message) {
  const patterns = [
    /\buser(?:\s*id)?\s*[:#=]?\s*([A-Za-z0-9_-]+)\b/i,
    /\bcustomer(?:\s*id)?\s*[:#=]?\s*([A-Za-z0-9_-]+)\b/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return null;
}

function clampLimit(value, fallback, max) {
  if (!value) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, max);
}

function inferIntents(message) {
  const normalized = message.toLowerCase();
  const intents = new Set();

  if (/\bavail|free|busy|book/.test(normalized)) {
    intents.add("availability");
  }

  if (/\brecommend|suggest|top product|seasonal/.test(normalized)) {
    intents.add("recommendations");
  }

  if (/\bsurge|next higher|higher rental/.test(normalized)) {
    intents.add("surge");
  }

  if (/\bpeak|best window|busiest window/.test(normalized)) {
    intents.add("peakWindow");
  }

  if (/\bcategory|categories|top categor/.test(normalized)) {
    intents.add("categoryStats");
  }

  if (intents.size === 0) {
    intents.add("recommendations");
    intents.add("peakWindow");
  }

  return Array.from(intents);
}

function buildToolPlan(message) {
  const dates = extractDateOnlyValues(message);
  const months = extractMonthValues(message);
  const productId = extractProductId(message);
  const userId = extractUserId(message);
  const requestedLimit = extractIntegerAfterLabels(message, ["limit", "top", "k"]);
  const limit = clampLimit(requestedLimit, 10, 50);
  const now = todayUtc();
  const defaultDate = formatDateOnly(now);
  const firstDate = dates[0] || defaultDate;
  const secondDate = dates[1] || formatDateOnly(addDays(new Date(`${firstDate}T00:00:00.000Z`), 7));
  const defaultMonth = formatMonth(now);
  const firstMonth = months[0] || defaultMonth;
  const secondMonth = months[1] || formatMonth(addMonths(new Date(`${firstMonth}-01T00:00:00.000Z`), 2));
  const intents = inferIntents(message);
  const calls = [];

  if (intents.includes("availability") && productId) {
    calls.push({
      name: "availability",
      method: "GET",
      url: `${RENTAL_SERVICE_URL}/rentals/products/${encodeURIComponent(productId)}/availability`,
      params: {
        from: firstDate,
        to: secondDate
      }
    });
  }

  if (intents.includes("recommendations")) {
    calls.push({
      name: "recommendations",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/recommendations`,
      params: {
        date: firstDate,
        limit
      }
    });
  }

  if (intents.includes("surge")) {
    calls.push({
      name: "surgeDays",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/surge-days`,
      params: {
        month: firstMonth
      }
    });
  }

  if (intents.includes("peakWindow")) {
    calls.push({
      name: "peakWindow",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/peak-window`,
      params: {
        from: firstMonth,
        to: secondMonth
      }
    });
  }

  if (intents.includes("categoryStats") && userId) {
    calls.push({
      name: "categoryStats",
      method: "GET",
      url: `${RENTAL_SERVICE_URL}/rentals/users/${encodeURIComponent(userId)}/top-categories`,
      params: {
        k: Math.min(limit, 10)
      }
    });
  }

  if (calls.length === 0) {
    calls.push({
      name: "recommendations",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/recommendations`,
      params: {
        date: firstDate,
        limit
      }
    });
  }

  return {
    productId,
    userId,
    date: firstDate,
    toDate: secondDate,
    month: firstMonth,
    toMonth: secondMonth,
    limit,
    calls
  };
}

async function executeGroundingCall(call) {
  try {
    const response = await http.request({
      method: call.method,
      url: call.url,
      params: call.params
    });

    return {
      name: call.name,
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      params: call.params,
      data: response.data
    };
  } catch (error) {
    return {
      name: call.name,
      ok: false,
      status: 0,
      params: call.params,
      error: error.message
    };
  }
}

async function collectGrounding(plan) {
  const results = await Promise.all(plan.calls.map(executeGroundingCall));

  return results.reduce((acc, result) => {
    acc[result.name] = result;
    return acc;
  }, {});
}

function getSessionHistory(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }

  return sessions.get(sessionId);
}

function appendSessionMessage(sessionId, role, content) {
  const history = getSessionHistory(sessionId);
  history.push({
    role,
    content
  });

  while (history.length > MAX_HISTORY_MESSAGES) {
    history.shift();
  }
}

function compactGroundingData(grounding) {
  return JSON.stringify(grounding, null, 2).slice(0, 12000);
}

function buildPrompt(sessionId, message, grounding) {
  const history = getSessionHistory(sessionId);

  return [
    {
      role: "system",
      content:
        "You are RentPi Assistant. Answer only RentPi rental/product analytics questions. Use only the provided grounded JSON data. If data is missing, say what is missing. Do not invent IDs, counts, dates, availability, categories, or recommendations. Keep the reply concise and helpful."
    },
    ...history,
    {
      role: "user",
      content: `User message:\n${message}\n\nGrounded RentPi API data:\n${compactGroundingData(grounding)}`
    }
  ];
}

function selectProvider() {
  if (LLM_PROVIDER === "openai" && OPENAI_API_KEY) {
    return "openai";
  }

  if (LLM_PROVIDER === "gemini" && GEMINI_API_KEY) {
    return "gemini";
  }

  if (OPENAI_API_KEY) {
    return "openai";
  }

  if (GEMINI_API_KEY) {
    return "gemini";
  }

  return "none";
}

function messagesToGeminiText(messages) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

async function callOpenAI(messages) {
  const response = await http.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      temperature: 0.1,
      messages
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  return (
    response.data?.choices?.[0]?.message?.content ||
    "I could not generate a grounded RentPi reply from the available data."
  );
}

async function callGemini(messages) {
  const response = await http.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      generationConfig: {
        temperature: 0.1
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: messagesToGeminiText(messages)
            }
          ]
        }
      ]
    },
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Gemini request failed with status ${response.status}`);
  }

  return (
    response.data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || "I could not generate a grounded RentPi reply from the available data."
  );
}

function fallbackGroundedReply(grounding) {
  const parts = [];

  if (grounding.availability?.ok) {
    const data = grounding.availability.data;
    parts.push(
      `Product ${data.productId} is ${data.available ? "available" : "not available"} from ${data.from} to ${data.to}.`
    );

    if (Array.isArray(data.busyPeriods) && data.busyPeriods.length > 0) {
      parts.push(`Busy periods: ${data.busyPeriods.map((p) => `${p.from} to ${p.to}`).join(", ")}.`);
    }
  }

  if (grounding.recommendations?.ok) {
    const recs = grounding.recommendations.data?.recommendations || [];
    parts.push(
      recs.length > 0
        ? `Recommended products: ${recs
            .slice(0, 5)
            .map((p) => `${p.name || p.productId} (${p.category || "uncategorized"}, score ${p.score})`)
            .join("; ")}.`
        : "No recommendations were found for the requested date."
    );
  }

  if (grounding.surgeDays?.ok) {
    const data = grounding.surgeDays.data?.data || [];
    const next = data.find((day) => day.nextSurgeDate);
    parts.push(
      next
        ? `For ${grounding.surgeDays.data.month}, ${next.date} has ${next.count} rentals and the next higher rental day is ${next.nextSurgeDate} in ${next.daysUntil} day(s).`
        : `No next surge day was found for ${grounding.surgeDays.data.month}.`
    );
  }

  if (grounding.peakWindow?.ok) {
    const peak = grounding.peakWindow.data?.peakWindow;

    if (peak) {
      parts.push(
        `Peak rental window: ${peak.from} to ${peak.to}, with ${peak.totalRentals} total rentals.`
      );
    }
  }

  if (grounding.categoryStats?.ok) {
    const categories = grounding.categoryStats.data?.topCategories || [];
    parts.push(
      categories.length > 0
        ? `Top categories: ${categories
            .map((category) => `${category.category} (${category.rentalCount})`)
            .join(", ")}.`
        : "No category stats were found for that user."
    );
  }

  const failures = Object.values(grounding).filter((result) => !result.ok);

  if (failures.length > 0) {
    parts.push(
      `Some RentPi data could not be loaded: ${failures
        .map((failure) => `${failure.name} status ${failure.status}`)
        .join(", ")}.`
    );
  }

  return parts.join(" ") || "I could not find enough grounded RentPi data to answer that.";
}

async function generateReply(sessionId, message, grounding) {
  const messages = buildPrompt(sessionId, message, grounding);
  const provider = selectProvider();

  try {
    if (provider === "openai") {
      return await callOpenAI(messages);
    }

    if (provider === "gemini") {
      return await callGemini(messages);
    }
  } catch (error) {
    return fallbackGroundedReply(grounding);
  }

  return fallbackGroundedReply(grounding);
}

app.post("/chat", async (req, res, next) => {
  try {
    const sessionId = String(req.body.sessionId || "").trim();
    const message = normalizeMessage(req.body.message);

    if (!sessionId || !message) {
      return res.status(400).json({
        error: "Bad Request",
        message: "sessionId and message are required"
      });
    }

    if (!isRentPiRelated(message)) {
      appendSessionMessage(sessionId, "user", message);
      appendSessionMessage(sessionId, "assistant", REFUSAL_REPLY);

      return res.json({
        sessionId,
        reply: REFUSAL_REPLY
      });
    }

    const plan = buildToolPlan(message);
    const grounding = await collectGrounding(plan);
    const reply = await generateReply(sessionId, message, grounding);

    appendSessionMessage(sessionId, "user", message);
    appendSessionMessage(sessionId, "assistant", reply);

    return res.json({
      sessionId,
      reply
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/status", (req, res) => {
  res.json({
    service: "agentic-service",
    status: "OK"
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

app.use((err, req, res, next) => {
  res.status(500).json({
    error: "Internal Server Error",
    message: "Unexpected error while processing request"
  });
});

app.listen(PORT, () => {
  console.log(`agentic-service listening on port ${PORT}`);
});
