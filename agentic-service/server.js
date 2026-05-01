const express = require("express");
const { withRetry, handleRetryExhausted } = require("./api-retry-utils");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// Load gRPC proto
const PROTO_PATH = path.join(__dirname, 'rentpi.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const rentpiProto = grpc.loadPackageDefinition(packageDefinition).rentpi;

const analyticsClient = new rentpiProto.Analytics(
  'analytics-service:9003',
  grpc.credentials.createInsecure()
);
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8004;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/hackspark";
const RENTAL_SERVICE_URL = process.env.RENTAL_SERVICE_URL || "http://localhost:8002";
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || "http://localhost:8003";
const LLM_PROVIDER = String(process.env.LLM_PROVIDER || "").trim().toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 15000);
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 20);

// ─── MongoDB Models ───────────────────────────────────────────────────────────

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: "New Chat" },
  createdAt: { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Session = mongoose.model("Session", sessionSchema);
const Message = mongoose.model("Message", messageSchema);

// ─── MongoDB connection ───────────────────────────────────────────────────────

let mongoConnected = false;

mongoose.connect(MONGO_URI).then(() => {
  mongoConnected = true;
  console.log("agentic-service connected to MongoDB");
}).catch((err) => {
  console.error("MongoDB connection error:", err.message);
});

// ─── HTTP client ──────────────────────────────────────────────────────────────

const http = axios.create({
  timeout: HTTP_TIMEOUT_MS,
  validateStatus: () => true
});

// ─── RentPi topic guard ───────────────────────────────────────────────────────

const RENTPI_KEYWORDS = [
  "rentpi", "rent", "rental", "rentals", "product", "products",
  "availability", "available", "busy", "free", "booking", "bookings",
  "category", "categories", "recommend", "recommendation", "recommendations",
  "surge", "peak", "window", "seasonal", "discount", "security score",
  "securityscore", "tool", "tools", "equipment", "owner", "user",
  "customer", "feed", "streak", "trending", "price", "lease"
];

const REFUSAL_REPLY =
  "I can only help with RentPi rentals, products, availability, category trends, recommendations, surge days, peak windows, and related platform questions.";

function isRentPiRelated(message) {
  const normalized = message.toLowerCase();
  return RENTPI_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

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

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && formatDateOnly(date) === value;
}

function isValidMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const [y, m] = value.split("-").map(Number);
  return Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12;
}

function extractDateOnlyValues(message) {
  return Array.from(new Set(message.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])).filter(isValidDateOnly);
}

function extractMonthValues(message) {
  return Array.from(new Set(message.match(/\b\d{4}-\d{2}\b/g) || [])).filter(isValidMonth);
}

function extractIntegerAfterLabels(message, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\s*[:=]?\\s*(\\d+)\\b`, "i");
    const match = message.match(pattern);
    if (match) return Number(match[1]);
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
    if (match) return match[1];
  }
  return null;
}

function clampLimit(value, fallback, max) {
  if (!value || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function inferIntents(message) {
  const normalized = message.toLowerCase();
  const intents = new Set();

  if (/\bavail|free|busy|book/.test(normalized)) intents.add("availability");
  if (/\brecommend|suggest|top product|seasonal|trending/.test(normalized)) intents.add("recommendations");
  if (/\bsurge|next higher|higher rental/.test(normalized)) intents.add("surge");
  if (/\bpeak|best window|busiest window/.test(normalized)) intents.add("peakWindow");
  if (/\bcategory|categories|top categor/.test(normalized)) intents.add("categoryStats");

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
      params: { from: firstDate, to: secondDate }
    });
  }

  if (intents.includes("recommendations")) {
    calls.push({
      name: "recommendations",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/recommendations`,
      params: { date: firstDate, limit }
    });
  }

  if (intents.includes("surge")) {
    calls.push({
      name: "surgeDays",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/surge-days`,
      params: { month: firstMonth }
    });
  }

  if (intents.includes("peakWindow")) {
    calls.push({
      name: "peakWindow",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/peak-window`,
      params: { from: firstMonth, to: secondMonth }
    });
  }

  if (intents.includes("categoryStats") && userId) {
    calls.push({
      name: "categoryStats",
      method: "GET",
      url: `${RENTAL_SERVICE_URL}/rentals/users/${encodeURIComponent(userId)}/top-categories`,
      params: { k: Math.min(limit, 10) }
    });
  }

  if (calls.length === 0) {
    calls.push({
      name: "recommendations",
      method: "GET",
      url: `${ANALYTICS_SERVICE_URL}/analytics/recommendations`,
      params: { date: firstDate, limit }
    });
  }

  return { productId, userId, date: firstDate, toDate: secondDate, month: firstMonth, toMonth: secondMonth, limit, calls };
}

async function executeGroundingCall(call) {
  try {
    // Intercept recommendations call to use gRPC (Bonus B1)
    if (call.name === "recommendations") {
      return new Promise((resolve) => {
        analyticsClient.GetRecommendations({ date: call.params.date, limit: call.params.limit }, (err, response) => {
          if (err) {
            resolve({ name: call.name, ok: false, status: 500, params: call.params, error: err.message });
          } else {
            resolve({
              name: call.name,
              ok: true,
              status: 200,
              params: call.params,
              data: response
            });
          }
        });
      });
    }

    const response = await http.request({ method: call.method, url: call.url, params: call.params });
    return {
      name: call.name,
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      params: call.params,
      data: response.data
    };
  } catch (error) {
    return { name: call.name, ok: false, status: 0, params: call.params, error: error.message };
  }
}

async function collectGrounding(plan) {
  const results = await Promise.all(plan.calls.map(executeGroundingCall));
  return results.reduce((acc, result) => { acc[result.name] = result; return acc; }, {});
}

// ─── LLM providers ───────────────────────────────────────────────────────────

function selectProvider() {
  if (LLM_PROVIDER === "openai" && OPENAI_API_KEY) return "openai";
  if (LLM_PROVIDER === "gemini" && GEMINI_API_KEY) return "gemini";
  if (OPENAI_API_KEY) return "openai";
  if (GEMINI_API_KEY) return "gemini";
  return "none";
}

function messagesToGeminiText(messages) {
  return messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
}

async function callOpenAI(messages) {
  const response = await http.post(
    "https://api.openai.com/v1/chat/completions",
    { model: OPENAI_MODEL, temperature: 0.1, messages },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }
  return response.data?.choices?.[0]?.message?.content || "No reply generated.";
}

async function callGemini(messages) {
  const response = await http.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      generationConfig: { temperature: 0.1 },
      contents: [{ role: "user", parts: [{ text: messagesToGeminiText(messages) }] }]
    },
    { headers: { "Content-Type": "application/json" } }
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Gemini request failed with status ${response.status}`);
  }
  return (
    response.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() ||
    "No reply generated."
  );
}

async function callLlm(messages) {
  const provider = selectProvider();
  if (provider === "openai") return callOpenAI(messages);
  if (provider === "gemini") return callGemini(messages);
  return null;
}

async function generateSessionName(firstMessage) {
  const messages = [
    {
      role: "system",
      content: "You generate ultra-short chat session titles. Reply ONLY with a 3-5 word title. No punctuation, no quotes."
    },
    { role: "user", content: `First user message: "${firstMessage}"` }
  ];
  try {
    const name = await callLlm(messages);
    return (name || "").trim().slice(0, 60) || "New Chat";
  } catch {
    return firstMessage.trim().slice(0, 40) || "New Chat";
  }
}

function fallbackGroundedReply(grounding) {
  const parts = [];

  if (grounding.availability?.ok) {
    const d = grounding.availability.data;
    parts.push(`Product ${d.productId} is ${d.available ? "available" : "not available"} from ${d.from} to ${d.to}.`);
    if (Array.isArray(d.busyPeriods) && d.busyPeriods.length > 0) {
      parts.push(`Busy periods: ${d.busyPeriods.map((p) => `${p.from} to ${p.to}`).join(", ")}.`);
    }
  }

  if (grounding.recommendations?.ok) {
    const recs = grounding.recommendations.data?.recommendations || [];
    parts.push(
      recs.length > 0
        ? `Recommended products: ${recs.slice(0, 5).map((p) => `${p.name || p.productId} (${p.category || "?"}, score ${p.score})`).join("; ")}.`
        : "No recommendations found for the requested date."
    );
  }

  if (grounding.surgeDays?.ok) {
    const data = grounding.surgeDays.data?.data || [];
    const next = data.find((day) => day.nextSurgeDate);
    parts.push(
      next
        ? `For ${grounding.surgeDays.data.month}: ${next.date} has ${next.count} rentals; next surge is ${next.nextSurgeDate} in ${next.daysUntil} day(s).`
        : `No upcoming surge days found for ${grounding.surgeDays.data?.month}.`
    );
  }

  if (grounding.peakWindow?.ok) {
    const peak = grounding.peakWindow.data?.peakWindow;
    if (peak) parts.push(`Peak rental window: ${peak.from} to ${peak.to}, with ${peak.totalRentals} total rentals.`);
  }

  if (grounding.categoryStats?.ok) {
    const categories = grounding.categoryStats.data?.topCategories || [];
    parts.push(
      categories.length > 0
        ? `Top categories: ${categories.map((c) => `${c.category} (${c.rentalCount})`).join(", ")}.`
        : "No category stats found for that user."
    );
  }

  const failures = Object.values(grounding).filter((r) => !r.ok);
  if (failures.length > 0) {
    parts.push(`Some data could not be loaded: ${failures.map((f) => `${f.name} (status ${f.status})`).join(", ")}.`);
  }

  return parts.join(" ") || "I could not find enough RentPi data to answer that.";
}

async function generateReply(historyMessages, currentMessage, grounding) {
  const systemPrompt = {
    role: "system",
    content:
      "You are RentPi Assistant. Answer only RentPi rental/product analytics questions. Use only the provided grounded JSON data. If data is missing, say what is missing. Do not invent numbers, IDs, dates, or product names. Keep replies concise and helpful."
  };

  const groundingContext = JSON.stringify(grounding, null, 2).slice(0, 12000);
  const userContent = `User message:\n${currentMessage}\n\nGrounded RentPi API data:\n${groundingContext}`;

  // Build history (last N messages for context)
  const contextHistory = historyMessages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content
  }));

  const messages = [systemPrompt, ...contextHistory, { role: "user", content: userContent }];

  try {
    const reply = await callLlm(messages);
    if (reply) return reply;
  } catch (err) {
    console.error("LLM call failed:", err.message);
  }

  return fallbackGroundedReply(grounding);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/status", (req, res) => {
  res.json({ service: "agentic-service", status: "OK" });
});

// POST /chat  – main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const sessionId = String(req.body.sessionId || "").trim();
    const message = String(req.body.message || "").trim();

    if (!sessionId || !message) {
      return res.status(400).json({ error: "Bad Request", message: "sessionId and message are required" });
    }

    // Topic guard – no LLM call for off-topic messages
    if (!isRentPiRelated(message)) {
      const refusal = REFUSAL_REPLY;

      if (mongoConnected) {
        await Message.create([
          { sessionId, role: "user", content: message },
          { sessionId, role: "assistant", content: refusal }
        ]);
        await Session.findOneAndUpdate(
          { sessionId },
          { $set: { lastMessageAt: new Date() } },
          { upsert: true, new: true }
        );
      }

      return res.json({ sessionId, reply: refusal });
    }

    // Load history from MongoDB (or empty array if not connected)
    let historyMessages = [];
    let isNewSession = false;

    if (mongoConnected) {
      historyMessages = await Message.find({ sessionId }).sort({ timestamp: 1 }).lean();
      isNewSession = historyMessages.length === 0;
    }

    // Collect grounding data
    const plan = buildToolPlan(message);
    const grounding = await collectGrounding(plan);

    // Generate reply
    const reply = await generateReply(historyMessages, message, grounding);

    // Persist to MongoDB
    if (mongoConnected) {
      await Message.create([
        { sessionId, role: "user", content: message },
        { sessionId, role: "assistant", content: reply }
      ]);

      if (isNewSession) {
        // Generate a session name from the first message (lightweight LLM call)
        const name = await generateSessionName(message);
        await Session.create({ sessionId, name, lastMessageAt: new Date() });
      } else {
        await Session.findOneAndUpdate({ sessionId }, { $set: { lastMessageAt: new Date() } });
      }
    }

    return res.json({ sessionId, reply });
  } catch (err) {
    console.error("POST /chat error:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

// GET /chat/sessions – list all sessions sorted by most recent
app.get("/chat/sessions", async (req, res) => {
  try {
    if (!mongoConnected) {
      return res.json({ sessions: [] });
    }

    const sessions = await Session.find({})
      .sort({ lastMessageAt: -1 })
      .lean();

    return res.json({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        name: s.name,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt
      }))
    });
  } catch (err) {
    console.error("GET /chat/sessions error:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

// GET /chat/:sessionId/history – messages for a session
app.get("/chat/:sessionId/history", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!mongoConnected) {
      return res.json({ sessionId, name: "Chat", messages: [] });
    }

    const session = await Session.findOne({ sessionId }).lean();
    const messages = await Message.find({ sessionId }).sort({ timestamp: 1 }).lean();

    return res.json({
      sessionId,
      name: session?.name || "Chat",
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }))
    });
  } catch (err) {
    console.error("GET /chat/:sessionId/history error:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

// DELETE /chat/:sessionId
app.delete("/chat/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (mongoConnected) {
      await Promise.all([
        Session.deleteOne({ sessionId }),
        Message.deleteMany({ sessionId })
      ]);
    }

    return res.json({ success: true, sessionId });
  } catch (err) {
    console.error("DELETE /chat/:sessionId error:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

// ─── 404 & error handlers ─────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: "Not Found", message: `Route ${req.method} ${req.originalUrl} not found` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error", message: "Unexpected error while processing request" });
});

app.listen(PORT, () => {
  console.log(`agentic-service listening on port ${PORT}`);
});
