const express = require("express");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { withRetry, handleRetryExhausted } = require("./api-retry-utils");

const app = express();
const PORT = process.env.PORT || 8001;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://hackspark:hackspark_password@localhost:5432/hackspark";
const JWT_SECRET = process.env.JWT_SECRET || "development_jwt_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN || "";
const CENTRAL_API_USERS_URL =
  process.env.CENTRAL_API_USERS_URL || "https://technocracy.brittoo.xyz/api/data/users";
const CENTRAL_API_TIMEOUT_MS = Number(process.env.CENTRAL_API_TIMEOUT_MS || 10000);

const pool = new Pool({
  connectionString: DATABASE_URL
});

app.use(express.json());

const centralApi = withRetry(
  axios.create({
    timeout: CENTRAL_API_TIMEOUT_MS,
    validateStatus: () => true
  }),
  "user-service"
);

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error", err);
});

async function createUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(320) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
  `);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toPublicUser(user) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    createdAt: user.created_at
  };
}

function createToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN
    }
  );
}

function buildCentralApiHeaders() {
  const headers = {
    Accept: "application/json"
  };

  if (CENTRAL_API_TOKEN) {
    headers.Authorization = `Bearer ${CENTRAL_API_TOKEN}`;
  }

  return headers;
}

function extractUserFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.securityScore !== undefined || payload.security_score !== undefined) {
    return payload;
  }

  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return extractUserFromPayload(payload.data);
  }

  if (payload.user && typeof payload.user === "object") {
    return extractUserFromPayload(payload.user);
  }

  if (Array.isArray(payload.data) && payload.data.length > 0) {
    return extractUserFromPayload(payload.data[0]);
  }

  if (Array.isArray(payload.users) && payload.users.length > 0) {
    return extractUserFromPayload(payload.users[0]);
  }

  return null;
}

function extractSecurityScore(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  const value =
    user.securityScore ??
    user.security_score ??
    user.security?.score ??
    user.profile?.securityScore ??
    user.profile?.security_score;
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return null;
  }

  return Math.max(0, Math.min(100, score));
}

function discountPercentForSecurityScore(securityScore) {
  if (securityScore >= 80) {
    return 20;
  }

  if (securityScore >= 60) {
    return 15;
  }

  if (securityScore >= 40) {
    return 10;
  }

  if (securityScore >= 20) {
    return 5;
  }

  return 0;
}

async function authenticateJwt(req, res, next) {
  try {
    const authorizationHeader = req.headers.authorization;

    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Missing bearer token"
      });
    }

    const token = authorizationHeader.slice("Bearer ".length).trim();

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Missing bearer token"
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded || !decoded.sub) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid token"
      });
    }

    const result = await pool.query(
      `
        SELECT id, name, email, created_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [decoded.sub]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User no longer exists"
      });
    }

    req.user = result.rows[0];
    req.token = decoded;
    return next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid token"
      });
    }

    return next(error);
  }
}

app.get("/status", (req, res) => {
  res.json({
    service: "user-service",
    status: "OK"
  });
});

app.post("/users/register", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Bad Request",
        message: "name, email, and password are required"
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "email must be valid"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Bad Request",
        message: "password must be at least 8 characters"
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const result = await pool.query(
      `
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, created_at
      `,
      [name, email, passwordHash]
    );

    const user = result.rows[0];
    const token = createToken(user);

    return res.status(201).json({
      token,
      user: toPublicUser(user)
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Conflict",
        message: "Email already registered"
      });
    }

    return next(error);
  }
});

app.post("/users/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        error: "Bad Request",
        message: "email and password are required"
      });
    }

    const result = await pool.query(
      `
        SELECT id, name, email, password_hash, created_at
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid email or password"
      });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid email or password"
      });
    }

    const token = createToken(user);

    return res.json({
      token,
      user: toPublicUser(user)
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/users/me", authenticateJwt, (req, res) => {
  res.json({
    user: toPublicUser(req.user)
  });
});

app.get("/users/:id/discount", async (req, res, next) => {
  try {
    const userId = String(req.params.id || "").trim();

    if (!userId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "User id is required"
      });
    }

    const response = await centralApi.get(
      `${CENTRAL_API_USERS_URL}/${encodeURIComponent(userId)}`,
      {
        headers: buildCentralApiHeaders()
      }
    );

    if (response.status === 404) {
      return res.status(404).json({
        error: "Not Found",
        message: "User not found"
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

    const user = extractUserFromPayload(response.data);
    const securityScore = extractSecurityScore(user);

    if (!user) {
      return res.status(404).json({
        error: "Not Found",
        message: "User not found"
      });
    }

    if (securityScore === null) {
      return res.status(502).json({
        error: "Bad Gateway",
        message: "Central API user response is missing securityScore"
      });
    }

    return res.json({
      userId,
      securityScore,
      discountPercent: discountPercentForSecurityScore(securityScore)
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
  console.error(err);

  res.status(500).json({
    error: "Internal Server Error",
    message: "Unexpected error while processing request"
  });
});

async function startServer() {
  await createUsersTable();

  app.listen(PORT, () => {
    console.log(`user-service listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start user-service", error);
  process.exit(1);
});
