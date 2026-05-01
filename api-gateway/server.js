const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8000;

const downstreamServices = {
  "user-service": process.env.USER_SERVICE_URL || "http://localhost:8001",
  "rental-service": process.env.RENTAL_SERVICE_URL || "http://localhost:8002",
  "analytics-service": process.env.ANALYTICS_SERVICE_URL || "http://localhost:8003",
  "agentic-service": process.env.AGENTIC_SERVICE_URL || "http://localhost:8004"
};

app.use(express.json());

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
