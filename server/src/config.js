import path from "node:path";
import process from "node:process";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const DEFAULT_ADMIN_EMAIL = "charlesabhishekreddy@gmail.com";

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

const resolveFromRoot = (value) => {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
};

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  const dataDir = resolveFromRoot(env.API_DATA_DIR || "server/data");
  const uploadDir = resolveFromRoot(env.API_UPLOAD_DIR || "server/uploads");
  const dbFile = resolveFromRoot(env.API_DB_FILE || path.join(dataDir, "db.json"));

  const tlsKeyPath = env.TLS_KEY_PATH ? resolveFromRoot(env.TLS_KEY_PATH) : "";
  const tlsCertPath = env.TLS_CERT_PATH ? resolveFromRoot(env.TLS_CERT_PATH) : "";

  const sessionCookieName = env.SESSION_COOKIE_NAME || "vv_session";
  const csrfCookieName = env.CSRF_COOKIE_NAME || "vv_csrf";

  return {
    nodeEnv,
    isProduction,
    host: env.API_HOST || "127.0.0.1",
    port: toInt(env.API_PORT, 5000),
    apiPrefix: env.API_PREFIX || "/api/v1",
    forceHttps: toBool(env.FORCE_HTTPS, false),
    allowSocialProfileOnly: toBool(env.ALLOW_SOCIAL_PROFILE_ONLY, !isProduction),
    exposeResetDebugUrl: toBool(env.EXPOSE_RESET_DEBUG_URL, !isProduction),
    allowedOrigins: toList(env.CORS_ORIGINS, DEFAULT_ALLOWED_ORIGINS),
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
      secure: toBool(env.SESSION_COOKIE_SECURE, isProduction),
      sameSite: env.SESSION_COOKIE_SAMESITE || "Lax",
      path: "/",
    },
    rateLimits: {
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
