import path from "node:path";
import process from "node:process";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const DEFAULT_ADMIN_EMAIL = "charlesabhishekreddy@gmail.com";
const PLACEHOLDER_SECRETS = new Set(["", "your_real_key", "changeme", "replace_me"]);

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
};

const toList = (value, fallback = []) => {
  if (!value) return fallback;
  const items = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
};

const toText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeOrigin = (value) => String(value || "").trim().replace(/\/+$/, "");

const toSameSite = (value, fallback = "Lax") => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "none") return "None";
  if (normalized === "lax") return "Lax";
  return fallback;
};

const resolveFromRoot = (value) => {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
};

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const trustProxy = toBool(env.TRUST_PROXY, isProduction);

  const dataDir = resolveFromRoot(env.API_DATA_DIR || "server/data");
  const uploadDir = resolveFromRoot(env.API_UPLOAD_DIR || "server/uploads");
  const dbFile = resolveFromRoot(env.API_DB_FILE || path.join(dataDir, "db.json"));

  const tlsKeyPath = env.TLS_KEY_PATH ? resolveFromRoot(env.TLS_KEY_PATH) : "";
  const tlsCertPath = env.TLS_CERT_PATH ? resolveFromRoot(env.TLS_CERT_PATH) : "";

  const sessionCookieName = env.SESSION_COOKIE_NAME || "vv_session";
  const csrfCookieName = env.CSRF_COOKIE_NAME || "vv_csrf";
  const allowedOrigins = Array.from(
    new Set(
      toList(env.CORS_ORIGINS, DEFAULT_ALLOWED_ORIGINS)
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean)
    )
  );
  const rateLimiterBackend = toText(env.RATE_LIMIT_BACKEND, "memory").toLowerCase();

  return {
    nodeEnv,
    isProduction,
    trustProxy,
    host: env.API_HOST || "127.0.0.1",
    port: toInt(env.API_PORT, 5000),
    apiPrefix: env.API_PREFIX || "/api/v1",
    forceHttps: toBool(env.FORCE_HTTPS, isProduction),
    allowSocialProfileOnly: toBool(env.ALLOW_SOCIAL_PROFILE_ONLY, !isProduction),
    exposeResetDebugUrl: toBool(env.EXPOSE_RESET_DEBUG_URL, !isProduction),
    allowedOrigins,
    adminEmail: String(env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase(),
    adminBootstrapPassword: String(env.ADMIN_BOOTSTRAP_PASSWORD || ""),
    dataDir,
    uploadDir,
    dbFile,
    uploadsPublicPath: env.UPLOADS_PUBLIC_PATH || "/uploads",
    requestLimits: {
      jsonBodyBytes: toInt(env.MAX_JSON_BODY_BYTES, 1024 * 1024),
      uploadBytes: toInt(env.MAX_UPLOAD_BYTES, 8 * 1024 * 1024),
    },
    auth: {
      passwordIterations: toInt(env.PASSWORD_ITERATIONS, 210_000),
      passwordMinLength: toInt(env.PASSWORD_MIN_LENGTH, 12),
      maxLoginAttempts: toInt(env.MAX_LOGIN_ATTEMPTS, 5),
      lockoutMinutes: toInt(env.LOCKOUT_MINUTES, 15),
      resetTokenMinutes: toInt(env.RESET_TOKEN_MINUTES, 15),
      sessionHours: toInt(env.DEFAULT_SESSION_HOURS, 8),
      rememberDays: toInt(env.REMEMBER_SESSION_DAYS, 30),
    },
    cookies: {
      sessionName: sessionCookieName,
      csrfName: csrfCookieName,
      secure: isProduction ? true : toBool(env.SESSION_COOKIE_SECURE, false),
      sameSite: toSameSite(env.SESSION_COOKIE_SAMESITE, "Lax"),
      path: "/",
    },
    rateLimits: {
      backend: rateLimiterBackend,
      allowInMemoryInProduction: toBool(env.ALLOW_IN_MEMORY_RATE_LIMITER, false),
      general: {
        windowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
        max: toInt(env.RATE_LIMIT_MAX, 240),
      },
      auth: {
        windowMs: toInt(env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
        max: toInt(env.AUTH_RATE_LIMIT_MAX, 25),
      },
      llm: {
        windowMs: toInt(env.LLM_RATE_LIMIT_WINDOW_MS, 60_000),
        max: toInt(env.LLM_RATE_LIMIT_MAX, 30),
      },
    },
    ai: {
      provider: toText(env.AI_PROVIDER, "auto").toLowerCase(),
      allowProviderFallback: toBool(env.AI_PROVIDER_FALLBACK, true),
      geminiApiKey: String(env.GEMINI_API_KEY || ""),
      geminiModel: toText(env.GEMINI_MODEL, "gemini-2.5-flash"),
      geminiTimeoutMs: toInt(env.GEMINI_TIMEOUT_MS, 25_000),
      geminiBaseUrl: toText(env.GEMINI_BASE_URL, "https://generativelanguage.googleapis.com"),
      openAiApiKey: String(env.OPENAI_API_KEY || ""),
      openAiModel: String(env.OPENAI_MODEL || "gpt-4o-mini"),
      openAiTimeoutMs: toInt(env.OPENAI_TIMEOUT_MS, 18_000),
      maxOutputTokens: toInt(env.OPENAI_MAX_OUTPUT_TOKENS, 1400),
    },
    tls: {
      enabled: Boolean(tlsKeyPath && tlsCertPath),
      keyPath: tlsKeyPath,
      certPath: tlsCertPath,
    },
  };
}

const hasSecret = (value) => !PLACEHOLDER_SECRETS.has(String(value || "").trim().toLowerCase());

export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const allowedOrigins = Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [];

  if (config.cookies.sameSite === "None" && !config.cookies.secure) {
    errors.push("SESSION_COOKIE_SAMESITE=None requires SESSION_COOKIE_SECURE=true.");
  }

  if (config.isProduction) {
    if (!config.forceHttps) {
      errors.push("FORCE_HTTPS must be true in production.");
    }
    if (!config.cookies.secure) {
      errors.push("SESSION_COOKIE_SECURE must be true in production.");
    }
    if (config.exposeResetDebugUrl) {
      errors.push("EXPOSE_RESET_DEBUG_URL must be false in production.");
    }
    if (config.allowSocialProfileOnly) {
      errors.push("ALLOW_SOCIAL_PROFILE_ONLY must be false in production.");
    }
    if (allowedOrigins.length === 0) {
      errors.push("CORS_ORIGINS must include at least one trusted frontend origin in production.");
    }
    if (allowedOrigins.some((origin) => /^http:\/\//i.test(origin))) {
      errors.push("CORS_ORIGINS must use HTTPS origins in production.");
    }
    if (allowedOrigins.some((origin) => /(localhost|127\.0\.0\.1)/i.test(origin))) {
      errors.push("CORS_ORIGINS contains localhost/127.0.0.1, which is not valid for production.");
    }
    if (!config.tls.enabled && !config.trustProxy) {
      errors.push("Enable TLS directly or set TRUST_PROXY=true behind a secure reverse proxy.");
    }
    if (config.rateLimits.backend === "memory" && !config.rateLimits.allowInMemoryInProduction) {
      errors.push(
        "In production, memory rate limiting is insufficient for multi-instance deployment. Use a shared rate-limiter or set ALLOW_IN_MEMORY_RATE_LIMITER=true only for single-instance deployment."
      );
    }
    if (config.adminBootstrapPassword) {
      warnings.push("ADMIN_BOOTSTRAP_PASSWORD is set. Remove it after initial bootstrap.");
    }
    if (!hasSecret(config.ai.geminiApiKey) && !hasSecret(config.ai.openAiApiKey)) {
      warnings.push("No AI provider API key is configured. AI features will degrade or fail.");
    }
    if (/server[\\/]+data[\\/]+db\.json$/i.test(String(config.dbFile || ""))) {
      warnings.push("API_DB_FILE points to local filesystem JSON storage. Use managed database storage for production resilience.");
    }
    if (/server[\\/]+uploads[\\/]*$/i.test(String(config.uploadDir || ""))) {
      warnings.push("API_UPLOAD_DIR points to local filesystem uploads. Use cloud object storage for production durability.");
    }
  }

  if (config.rateLimits.backend !== "memory") {
    warnings.push(`RATE_LIMIT_BACKEND=${config.rateLimits.backend} is declared, but only memory backend is currently implemented.`);
  }

  return { errors, warnings };
}
