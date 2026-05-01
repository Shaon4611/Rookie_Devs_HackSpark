const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8000;

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:8001";
const RENTAL_SERVICE_URL = process.env.RENTAL_SERVICE_URL || "http://localhost:8002";
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || "http://localhost:8003";
const AGENTIC_SERVICE_URL = process.env.AGENTIC_SERVICE_URL || "http://localhost:8004";

const downstreamServices = {
  "user-service": USER_SERVICE_URL,
  "rental-service": RENTAL_SERVICE_URL,
  "analytics-service": ANALYTICS_SERVICE_URL,
  "agentic-service": AGENTIC_SERVICE_URL
};

app.use(express.json({ limit: "2mb" }));

// ─── Health aggregator ────────────────────────────────────────────────────────

async function checkService(serviceName, serviceUrl) {
  try {
    const response = await axios.get(`${serviceUrl}/status`, {
      timeout: 3000,
      validateStatus: () => true
    });

    if (
      response.status >= 200 &&
      response.status < 300 &&
      response.data &&
      response.data.status === "OK"
    ) {
      return [serviceName, "OK"];
    }

    return [serviceName, "UNREACHABLE"];
  } catch (error) {
    return [serviceName, "UNREACHABLE"];
  }
}

app.get("/status", async (req, res, next) => {
  try {
    const checks = await Promise.all(
      Object.entries(downstreamServices).map(([serviceName, serviceUrl]) =>
        checkService(serviceName, serviceUrl)
      )
    );

    res.json({
      service: "api-gateway",
      status: "OK",
      downstream: Object.fromEntries(checks)
    });
  } catch (error) {
    next(error);
  }
});

// ─── Generic proxy helper ─────────────────────────────────────────────────────

async function proxyRequest(req, res, targetBaseUrl) {
  try {
    const url = `${targetBaseUrl}${req.originalUrl}`;
    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: {
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        "Content-Type": req.headers["content-type"] || "application/json",
        Accept: "application/json"
      },
      timeout: 30000,
      validateStatus: () => true
    });

    // Forward status + body
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return res.status(503).json({ error: "Service Unavailable", message: "Downstream service is not reachable" });
    }

    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Gateway Timeout", message: "Downstream service timed out" });
    }

    res.status(502).json({ error: "Bad Gateway", message: error.message || "Downstream error" });
  }
}

// ─── User Service Routes (/users/*) ──────────────────────────────────────────

app.use("/users", (req, res) => proxyRequest(req, res, USER_SERVICE_URL));

// ─── Rental Service Routes (/rentals/*) ──────────────────────────────────────

app.use("/rentals", (req, res) => proxyRequest(req, res, RENTAL_SERVICE_URL));

// ─── Analytics Service Routes (/analytics/*) ─────────────────────────────────

app.use("/analytics", (req, res) => proxyRequest(req, res, ANALYTICS_SERVICE_URL));

// ─── Agentic Service Routes (/chat/*) ────────────────────────────────────────

app.use("/chat", (req, res) => proxyRequest(req, res, AGENTIC_SERVICE_URL));

// ─── 404 & Error handlers ─────────────────────────────────────────────────────

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
  console.log(`api-gateway listening on port ${PORT}`);
});
