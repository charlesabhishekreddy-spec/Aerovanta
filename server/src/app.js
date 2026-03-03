import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extname } from "node:path";
import { JsonDatabase, ENTITY_NAMES } from "./database.js";
import { buildLlmResponse } from "./llm.js";
import { diagnosePlantImage } from "./diagnosis.js";
import {
  ACCOUNT_STATUS_VALUES,
  ROLE_VALUES,
  SOCIAL_PROVIDER_VALUES,
  derivePasswordHash,
  generateToken,
  getClientIp,
  getDeviceId,
  getDeviceInfo,
  hashText,
  isValidEmail,
  makeId,
  makePasswordRecord,
  maskEmail,
  normalizeCrops,
  normalizeEmail,
  nowIso,
  parseCookies,
  safeEqualHex,
  sanitizeUser,
  serializeCookie,
  sleep,
  validatePassword,
} from "./security.js";

const OWNER_SCOPED_ENTITIES = new Set([
  "PlantDiagnosis",
  "Treatment",
  "Task",
  "PestPrediction",
  "WeatherLog",
  "DiagnosisFeedback",
  "CropPlan",
  "ActivityLog",
]);

const SHARED_USER_ENTITIES = new Set(["ForumPost", "ForumComment", "OutbreakReport"]);
const ADMIN_WRITE_ENTITIES = new Set(["PlantDatabase"]);

const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".svg": "image/svg+xml",
};

const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/svg+xml": ".svg",
};

const ALLOWED_UPLOAD_MIME = new Set(Object.keys(EXTENSION_BY_MIME));

const coerceLimit = (value, fallback = 200, max = 1000) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const createHttpError = (status, message, code = "request_failed") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const parseJsonSafe = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const sortItems = (items, sortBy = "") => {
  if (!sortBy) return [...items];
  const descending = sortBy.startsWith("-");
  const field = descending ? sortBy.slice(1) : sortBy;
  return [...items].sort((left, right) => {
    const a = left?.[field];
    const b = right?.[field];
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (a === b) return 0;
    if (a > b) return descending ? -1 : 1;
    return descending ? 1 : -1;
  });
};

const matchesFilterValue = (recordValue, expectedValue) => {
  if (Array.isArray(recordValue)) {
    if (Array.isArray(expectedValue)) {
      return expectedValue.every((value) => recordValue.includes(value));
    }
    return recordValue.includes(expectedValue);
  }
  if (Array.isArray(expectedValue)) {
    return expectedValue.includes(recordValue);
  }
  return recordValue === expectedValue;
};

const applyFilters = (items, filters) => {
  if (!isObject(filters) || Object.keys(filters).length === 0) return [...items];
  return items.filter((item) =>
    Object.entries(filters).every(([key, expected]) => matchesFilterValue(item?.[key], expected))
  );
};

const applySecurityHeaders = (res, isSecureRequest) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (isSecureRequest) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};

const buildDeviceSessionRecord = (email, req, deviceId) => ({
  id: makeId(),
  user_email: normalizeEmail(email),
  device_id: deviceId,
  device_info: getDeviceInfo(req, deviceId),
  last_active: nowIso(),
});

const isOwnedByUser = (record, user) => {
  const ownerId = String(record?.created_by || "");
  const ownerEmail = normalizeEmail(record?.created_by_email || "");
  return ownerId === user.id || ownerEmail === normalizeEmail(user.email || "");
};

const getRoleForEmail = (email, adminEmail) =>
  normalizeEmail(email) === normalizeEmail(adminEmail) ? "admin" : "user";

const sanitizeForUserList = (user) => ({
  id: user.id,
  full_name: user.full_name || "User",
  email: user.email,
  role: user.role || "user",
  account_status: user.account_status || "active",
  avatar_url: user.avatar_url || "",
});

const cleanUploadFileName = (fileName = "", fileType = "") => {
  const safeBase = path
    .basename(String(fileName || "upload"))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const inputExt = extname(safeBase).toLowerCase();
  if (MIME_BY_EXTENSION[inputExt]) return safeBase;
  const fallbackExt = EXTENSION_BY_MIME[fileType] || ".bin";
  const baseWithoutExt = safeBase.replace(/\.[^.]+$/, "") || "upload";
  return `${baseWithoutExt}${fallbackExt}`;
};

const getMimeType = (filename) => MIME_BY_EXTENSION[extname(filename).toLowerCase()] || "application/octet-stream";

const readJsonBody = (req, maxBytes) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(createHttpError(413, "Request body is too large.", "payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!isObject(parsed)) {
          reject(createHttpError(400, "JSON request body must be an object.", "invalid_body"));
          return;
        }
        resolve(parsed);
      } catch {
        reject(createHttpError(400, "Invalid JSON payload.", "invalid_json"));
      }
    });

    req.on("error", () => reject(createHttpError(400, "Failed to read request body.", "read_body_failed")));
  });

export async function createApp(config) {
  const db = new JsonDatabase(config.dbFile, config.adminEmail);
  await db.init();
  await mkdir(config.uploadDir, { recursive: true });

  if (config.adminBootstrapPassword) {
    await db.transact(async (draft) => {
      const admin = draft.users.find(
        (user) => normalizeEmail(user?.email || "") === normalizeEmail(config.adminEmail)
      );
      if (!admin || admin.password_hash) return;
      const passwordRecord = await makePasswordRecord(
        config.adminBootstrapPassword,
        config.auth.passwordIterations
      );
      Object.assign(admin, passwordRecord, {
        provider: "email",
        account_status: "active",
        email_verified: true,
        updated_date: nowIso(),
      });
    });
  }

  const rateWindowStore = new Map();

  const json = (res, status, payload) => {
    const content = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(content));
    res.end(content);
  };

  const success = (res, status, data) => json(res, status, { data });

  const failure = (res, status, message, code = "request_failed", details) => {
    json(res, status, {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    });
  };

  const sessionMaxAgeSeconds = (remember) =>
    remember ? config.auth.rememberDays * 24 * 60 * 60 : config.auth.sessionHours * 60 * 60;

  const sessionDurationMs = (remember) => sessionMaxAgeSeconds(remember) * 1000;

  const setAuthCookies = (res, token, csrfToken, remember) => {
    const maxAge = sessionMaxAgeSeconds(remember);
    const baseCookie = {
      path: config.cookies.path,
      sameSite: config.cookies.sameSite,
      secure: config.cookies.secure,
      maxAge,
    };

    const sessionCookie = serializeCookie(config.cookies.sessionName, token, {
      ...baseCookie,
      httpOnly: true,
    });
    const csrfCookie = serializeCookie(config.cookies.csrfName, csrfToken, {
      ...baseCookie,
      httpOnly: false,
    });

    res.setHeader("Set-Cookie", [sessionCookie, csrfCookie]);
  };

  const clearAuthCookies = (res) => {
    const options = {
      path: config.cookies.path,
      sameSite: config.cookies.sameSite,
      secure: config.cookies.secure,
      maxAge: 0,
      expires: new Date(0),
    };
    const sessionCookie = serializeCookie(config.cookies.sessionName, "", {
      ...options,
      httpOnly: true,
    });
    const csrfCookie = serializeCookie(config.cookies.csrfName, "", {
      ...options,
      httpOnly: false,
    });
    res.setHeader("Set-Cookie", [sessionCookie, csrfCookie]);
  };

  const upsertUserByEmail = (draft, profile) => {
    const normalized = normalizeEmail(profile.email);
    const existing = draft.users.find((user) => normalizeEmail(user.email || "") === normalized);
    const role = existing?.role || getRoleForEmail(normalized, config.adminEmail);
    const accountStatus = ACCOUNT_STATUS_VALUES.has(profile?.account_status)
      ? profile.account_status
      : existing?.account_status || "active";
    const emailVerified =
      typeof profile?.email_verified === "boolean" ? profile.email_verified : existing?.email_verified ?? false;

    const user = existing
      ? {
          ...existing,
          ...profile,
          email: normalized,
          role,
          account_status: accountStatus,
          email_verified: emailVerified,
          id: existing.id,
          updated_date: nowIso(),
        }
      : {
          id: makeId(),
          created_date: nowIso(),
          email: normalized,
          role,
          account_status: accountStatus,
          email_verified: emailVerified,
          ...profile,
        };

    draft.users = [user, ...draft.users.filter((entry) => normalizeEmail(entry.email || "") !== normalized)];
    return user;
  };

  const pruneExpiredSessions = (draft) => {
    const now = Date.now();
    draft.auth_sessions = (draft.auth_sessions || []).filter((session) => {
      if (session.revoked_date) return false;
      return new Date(session.expires_at).getTime() > now;
    });
  };

  const logAuthEvent = async (type, email, metadata = {}) => {
    await db.transact((draft) => {
      draft.auth_events = draft.auth_events || [];
      draft.auth_events.unshift({
        id: makeId(),
        type,
        email: normalizeEmail(email),
        metadata,
        created_date: nowIso(),
      });
      draft.auth_events = draft.auth_events.slice(0, 5000);
    });
  };

  const touchDeviceSession = (draft, email, req, deviceId) => {
    draft.device_sessions = draft.device_sessions || [];
    const normalizedEmail = normalizeEmail(email);
    draft.device_sessions = draft.device_sessions.filter(
      (session) => !(normalizeEmail(session.user_email || "") === normalizedEmail && session.device_id === deviceId)
    );
    draft.device_sessions.unshift(buildDeviceSessionRecord(normalizedEmail, req, deviceId));
    draft.device_sessions = draft.device_sessions.slice(0, 4000);
  };

  const createAuthSession = async (user, req, remember = true) => {
    const token = generateToken(32);
    const csrfToken = generateToken(24);
    const tokenHash = hashText(token);
    const csrfHash = hashText(csrfToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionDurationMs(remember)).toISOString();
    const deviceId = getDeviceId(req);

    await db.transact((draft) => {
      pruneExpiredSessions(draft);
      draft.auth_sessions.unshift({
        id: makeId(),
        token_hash: tokenHash,
        csrf_token_hash: csrfHash,
        user_id: user.id,
        user_email: normalizeEmail(user.email),
        remember: Boolean(remember),
        device_id: deviceId,
        ip: getClientIp(req),
        created_date: now.toISOString(),
        last_active: now.toISOString(),
        expires_at: expiresAt,
      });
      draft.auth_sessions = draft.auth_sessions.slice(0, 10000);
      touchDeviceSession(draft, user.email, req, deviceId);
    });

    return { token, csrfToken, tokenHash, expiresAt };
  };

  const findThrottleRecord = (snapshot, email, deviceId, ip) =>
    (snapshot.login_throttle || []).find(
      (entry) =>
        normalizeEmail(entry.email || "") === normalizeEmail(email) &&
        entry.device_id === deviceId &&
        entry.ip === ip
    );

  const checkLoginThrottle = async (email, req) => {
    const snapshot = db.read();
    const deviceId = getDeviceId(req);
    const ip = getClientIp(req);
    const record = findThrottleRecord(snapshot, email, deviceId, ip);
    if (!record?.lock_until) return { allowed: true };

    const now = Date.now();
    const lockUntil = new Date(record.lock_until).getTime();
    if (lockUntil > now) {
      return { allowed: false, retryAfterMs: lockUntil - now };
    }

    await db.transact((draft) => {
      draft.login_throttle = (draft.login_throttle || []).map((entry) =>
        entry.id === record.id
          ? { ...entry, attempts: 0, first_attempt_at: null, lock_until: null, updated_date: nowIso() }
          : entry
      );
    });
    return { allowed: true };
  };

  const markFailedLogin = async (email, req) => {
    const deviceId = getDeviceId(req);
    const ip = getClientIp(req);
    const lockoutWindowMs = config.auth.lockoutMinutes * 60 * 1000;
    const now = Date.now();
    const normalizedEmail = normalizeEmail(email);

    await db.transact((draft) => {
      draft.login_throttle = draft.login_throttle || [];
      const existing = findThrottleRecord(draft, normalizedEmail, deviceId, ip);
      if (!existing) {
        draft.login_throttle.push({
          id: makeId(),
          email: normalizedEmail,
          device_id: deviceId,
          ip,
          attempts: 1,
          first_attempt_at: new Date(now).toISOString(),
          last_attempt_at: new Date(now).toISOString(),
          lock_until: null,
        });
        return;
      }

      const firstAttemptMs = existing.first_attempt_at ? new Date(existing.first_attempt_at).getTime() : now;
      const withinWindow = now - firstAttemptMs <= lockoutWindowMs;
      const attempts = withinWindow ? (existing.attempts || 0) + 1 : 1;
      const shouldLock = attempts >= config.auth.maxLoginAttempts;

      draft.login_throttle = draft.login_throttle.map((entry) =>
        entry.id !== existing.id
          ? entry
          : {
              ...entry,
              attempts,
              first_attempt_at: withinWindow ? entry.first_attempt_at : new Date(now).toISOString(),
              last_attempt_at: new Date(now).toISOString(),
              lock_until: shouldLock ? new Date(now + lockoutWindowMs).toISOString() : null,
              updated_date: nowIso(),
            }
      );
    });
  };

  const clearFailedLogin = async (email, req) => {
    const deviceId = getDeviceId(req);
    const ip = getClientIp(req);
    const normalizedEmail = normalizeEmail(email);
    await db.transact((draft) => {
      draft.login_throttle = (draft.login_throttle || []).filter(
        (entry) =>
          !(
            normalizeEmail(entry.email || "") === normalizedEmail &&
            entry.device_id === deviceId &&
            entry.ip === ip
          )
      );
    });
  };

  const getAuthContext = async (req, { touch = true } = {}) => {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[config.cookies.sessionName];
    if (!token) return null;

    const tokenHash = hashText(token);
    const snapshot = db.read();
    const now = Date.now();
    const session = (snapshot.auth_sessions || []).find((entry) => entry.token_hash === tokenHash);
    if (!session || session.revoked_date || new Date(session.expires_at).getTime() <= now) {
      return null;
    }

    const user = (snapshot.users || []).find((entry) => entry.id === session.user_id);
    if (!user || user.account_status === "suspended") {
      return null;
    }

    if (touch) {
      try {
        await db.transact((draft) => {
          draft.auth_sessions = (draft.auth_sessions || []).map((entry) =>
            entry.id === session.id ? { ...entry, last_active: nowIso(), updated_date: nowIso() } : entry
          );
          touchDeviceSession(draft, user.email, req, session.device_id);
        });
      } catch (touchError) {
        // Do not fail authenticated reads because of a non-critical session-touch write error.
        console.error("[auth] session touch failed:", touchError?.message || touchError);
      }
    }

    return { user, session, token, tokenHash };
  };

  const requireAuth = async (req, res, options = {}) => {
    const context = await getAuthContext(req, options);
    if (!context) {
      clearAuthCookies(res);
      failure(res, 401, "Authentication required.", "auth_required");
      return null;
    }
    return context;
  };

  const requireAdmin = async (req, res) => {
    const context = await requireAuth(req, res);
    if (!context) return null;
    if (context.user.role !== "admin") {
      failure(res, 403, "Admin access required.", "forbidden");
      return null;
    }
    return context;
  };

  const requireCsrf = (req, res, context) => {
    const token = String(req.headers["x-csrf-token"] || "").trim();
    if (!token) {
      failure(res, 403, "Missing CSRF token.", "csrf_required");
      return false;
    }
    const tokenHash = hashText(token);
    if (!safeEqualHex(tokenHash, context.session.csrf_token_hash)) {
      failure(res, 403, "Invalid CSRF token.", "csrf_invalid");
      return false;
    }
    return true;
  };

  const applyCors = (req, res) => {
    const origin = String(req.headers.origin || "");
    if (!origin) return true;

    if (!config.allowedOrigins.includes(origin)) {
      return false;
    }

    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Device-Id");
    return true;
  };

  const isSecureRequest = (req) => {
    if (req.socket?.encrypted) return true;
    return String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  };

  const takeRateLimit = (key, max, windowMs) => {
    const now = Date.now();
    const current = rateWindowStore.get(key);
    if (!current || current.resetAt <= now) {
      const resetAt = now + windowMs;
      rateWindowStore.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: Math.max(0, max - 1), resetAt, max };
    }

    if (current.count >= max) {
      return { allowed: false, remaining: 0, resetAt: current.resetAt, max };
    }

    current.count += 1;
    rateWindowStore.set(key, current);
    return { allowed: true, remaining: Math.max(0, max - current.count), resetAt: current.resetAt, max };
  };

  const applyRateLimit = (req, res, routePath) => {
    const ip = getClientIp(req);
    let bucket = config.rateLimits.general;
    let scope = "general";

    if (
      routePath.startsWith("/auth/login") ||
      routePath.startsWith("/auth/register") ||
      routePath.startsWith("/auth/social") ||
      routePath.startsWith("/auth/password-reset")
    ) {
      bucket = config.rateLimits.auth;
      scope = "auth";
    } else if (
      routePath.startsWith("/integrations/core/invoke-llm") ||
      routePath.startsWith("/ai/diagnose-plant")
    ) {
      bucket = config.rateLimits.llm;
      scope = "llm";
    }

    const result = takeRateLimit(`${scope}:${ip}`, bucket.max, bucket.windowMs);
    const resetSeconds = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
    res.setHeader("X-RateLimit-Limit", String(result.max));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSeconds));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(resetSeconds));
      failure(res, 429, "Rate limit exceeded. Please try again shortly.", "rate_limited");
      return false;
    }

    return true;
  };

  const assertEntityName = (entityName) => {
    if (entityName === "User") return;
    if (!ENTITY_NAMES.includes(entityName)) {
      throw createHttpError(404, "Entity not found.", "entity_not_found");
    }
  };

  const canCreateEntity = (entityName, user) => {
    if (entityName === "User") return false;
    if (ADMIN_WRITE_ENTITIES.has(entityName) && user.role !== "admin") return false;
    return true;
  };

  const canMutateEntityRecord = (entityName, record, user) => {
    if (user.role === "admin") return true;
    if (ADMIN_WRITE_ENTITIES.has(entityName)) return false;
    if (OWNER_SCOPED_ENTITIES.has(entityName)) return isOwnedByUser(record, user);
    if (SHARED_USER_ENTITIES.has(entityName)) return isOwnedByUser(record, user);
    return false;
  };

  const getEntityRecordsForRead = (snapshot, entityName, user) => {
    if (entityName === "User") {
      const users = (snapshot.users || []).map((entry) => sanitizeForUserList(entry));
      if (user.role === "admin") return users;
      return users.filter((entry) => entry.account_status !== "suspended");
    }

    const records = (
      Array.isArray(snapshot.entities?.[entityName]) ? snapshot.entities[entityName] : []
    ).filter((record) => record && typeof record === "object");
    if (user.role === "admin") return records;
    if (OWNER_SCOPED_ENTITIES.has(entityName)) {
      return records.filter((record) => isOwnedByUser(record, user));
    }
    return records;
  };

  const revokeSessionById = async (sessionId) => {
    if (!sessionId) return;
    await db.transact((draft) => {
      draft.auth_sessions = (draft.auth_sessions || []).map((session) =>
        session.id === sessionId && !session.revoked_date
          ? { ...session, revoked_date: nowIso(), updated_date: nowIso() }
          : session
      );
    });
  };

  const revokeUserSessions = async (userId, exceptSessionId = "") => {
    await db.transact((draft) => {
      draft.auth_sessions = (draft.auth_sessions || []).map((session) =>
        session.user_id === userId && session.id !== exceptSessionId && !session.revoked_date
          ? { ...session, revoked_date: nowIso(), updated_date: nowIso() }
          : session
      );
    });
  };

  const serveUpload = async (req, res, pathname) => {
    const context = await getAuthContext(req, { touch: false });
    if (!context) {
      clearAuthCookies(res);
      failure(res, 401, "Authentication required.", "auth_required");
      return;
    }

    const base = `${config.uploadsPublicPath.replace(/\/+$/, "")}/`;
    const filename = decodeURIComponent(pathname.slice(base.length));
    const safeName = path.basename(filename);
    if (!safeName || safeName !== filename) {
      failure(res, 404, "File not found.", "file_not_found");
      return;
    }

    const filePath = path.join(config.uploadDir, safeName);
    try {
      const content = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", getMimeType(filePath));
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(content);
    } catch {
      failure(res, 404, "File not found.", "file_not_found");
    }
  };

  return async function app(req, res) {
    const method = String(req.method || "GET").toUpperCase();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    const secure = isSecureRequest(req);
    applySecurityHeaders(res, secure);

    const corsAllowed = applyCors(req, res);
    if (!corsAllowed) {
      failure(res, 403, "Origin not allowed.", "origin_forbidden");
      return;
    }

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (config.forceHttps && !secure) {
      failure(res, 426, "HTTPS is required for this API.", "https_required");
      return;
    }

    const uploadBase = `${config.uploadsPublicPath.replace(/\/+$/, "")}/`;
    if (pathname.startsWith(uploadBase) && method === "GET") {
      await serveUpload(req, res, pathname);
      return;
    }

    const prefix = config.apiPrefix.replace(/\/+$/, "");
    if (!(pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      failure(res, 404, "Endpoint not found.", "not_found");
      return;
    }

    const routePath = pathname === prefix ? "/" : pathname.slice(prefix.length);
    if (!applyRateLimit(req, res, routePath)) return;

    try {
      if (routePath === "/health" && method === "GET") {
        success(res, 200, {
          status: "ok",
          environment: config.nodeEnv,
          timestamp: nowIso(),
        });
        return;
      }

      if (routePath === "/auth/me" && method === "GET") {
        const context = await requireAuth(req, res);
        if (!context) return;
        success(res, 200, sanitizeUser(context.user));
        return;
      }

      if (routePath === "/auth/login/email" && method === "POST") {
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const email = normalizeEmail(body.email || "");
        const password = String(body.password || "");
        const remember = body.remember !== false;

        if (!isValidEmail(email) || !password) {
          throw createHttpError(400, "Enter a valid email and password.", "invalid_credentials");
        }

        const throttle = await checkLoginThrottle(email, req);
        if (!throttle.allowed) {
          const minutes = Math.max(1, Math.ceil((throttle.retryAfterMs || 0) / 60000));
          throw createHttpError(
            429,
            `Too many failed attempts. Try again in about ${minutes} minute(s).`,
            "login_throttled"
          );
        }

        const snapshot = db.read();
        const user = (snapshot.users || []).find((entry) => normalizeEmail(entry.email || "") === email);
        if (!user?.password_hash) {
          await markFailedLogin(email, req);
          await logAuthEvent("login_failed", email, { reason: "invalid_credentials" });
          await sleep(250);
          throw createHttpError(401, "Invalid email or password.", "invalid_credentials");
        }

        if (user.account_status === "suspended") {
          throw createHttpError(403, "Account suspended. Contact an administrator.", "account_suspended");
        }

        const attemptedHash = await derivePasswordHash(
          password,
          user.password_salt,
          user.password_iterations || config.auth.passwordIterations
        );
        if (!safeEqualHex(attemptedHash, user.password_hash)) {
          await markFailedLogin(email, req);
          await logAuthEvent("login_failed", email, { reason: "invalid_credentials" });
          await sleep(250);
          throw createHttpError(401, "Invalid email or password.", "invalid_credentials");
        }

        await clearFailedLogin(email, req);
        await db.transact((draft) => {
          draft.users = (draft.users || []).map((entry) =>
            entry.id === user.id ? { ...entry, last_login_date: nowIso(), updated_date: nowIso() } : entry
          );
        });
        const freshUser = db.read().users.find((entry) => entry.id === user.id) || user;
        const session = await createAuthSession(freshUser, req, remember);
        setAuthCookies(res, session.token, session.csrfToken, remember);
        await logAuthEvent("login_success", email, { remember });
        success(res, 200, sanitizeUser(freshUser));
        return;
      }

      if (routePath === "/auth/register/email" && method === "POST") {
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const fullName = String(body.fullName || "").trim();
        const email = normalizeEmail(body.email || "");
        const password = String(body.password || "");
        const confirmPassword = body.confirmPassword;
        const remember = body.remember !== false;

        if (!fullName || fullName.length < 2) {
          throw createHttpError(400, "Full name must be at least 2 characters.", "invalid_full_name");
        }
        if (!isValidEmail(email)) {
          throw createHttpError(400, "Enter a valid email address.", "invalid_email");
        }
        if (!password) throw createHttpError(400, "Password is required.", "invalid_password");
        if (typeof confirmPassword === "string" && confirmPassword !== password) {
          throw createHttpError(400, "Passwords do not match.", "invalid_password");
        }

        const passwordPolicyError = validatePassword(password, email, config.auth.passwordMinLength);
        if (passwordPolicyError) {
          throw createHttpError(400, passwordPolicyError, "invalid_password");
        }

        const snapshot = db.read();
        const existing = (snapshot.users || []).find((entry) => normalizeEmail(entry.email || "") === email);
        if (existing?.password_hash) {
          throw createHttpError(409, "An account with this email already exists.", "email_exists");
        }
        if (existing?.account_status === "suspended") {
          throw createHttpError(403, "Account suspended. Contact an administrator.", "account_suspended");
        }

        const passwordRecord = await makePasswordRecord(password, config.auth.passwordIterations);
        const user = await db.transact((draft) =>
          upsertUserByEmail(draft, {
            ...existing,
            full_name: fullName,
            email,
            provider: "email",
            role: existing?.role || getRoleForEmail(email, config.adminEmail),
            account_status: "active",
            email_verified: true,
            farm_name: body.farm_name || existing?.farm_name || "",
            location: body.location || existing?.location || "",
            farm_size: body.farm_size || existing?.farm_size || "",
            farming_method: body.farming_method || existing?.farming_method || "conventional",
            soil_type: body.soil_type || existing?.soil_type || "",
            climate_zone: body.climate_zone || existing?.climate_zone || "",
            years_experience: Number.isFinite(Number(body.years_experience))
              ? Number(body.years_experience)
              : existing?.years_experience || 0,
            primary_crops: normalizeCrops(body.primary_crops ?? existing?.primary_crops),
            notifications_enabled: body.notifications_enabled !== false,
            ...passwordRecord,
          })
        );

        const session = await createAuthSession(user, req, remember);
        setAuthCookies(res, session.token, session.csrfToken, remember);
        await logAuthEvent("register_success", email, { role: user.role });
        success(res, 201, sanitizeUser(user));
        return;
      }

      if (routePath === "/auth/social" && method === "POST") {
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const provider = String(body.provider || "").toLowerCase();
        const profile = isObject(body.profile) ? body.profile : {};
        const remember = body.remember !== false;

        if (!SOCIAL_PROVIDER_VALUES.has(provider)) {
          throw createHttpError(400, "Unsupported social provider.", "invalid_provider");
        }
        if (!config.allowSocialProfileOnly && !body.identity_token) {
          throw createHttpError(
            400,
            "Social identity token is required in this environment.",
            "identity_token_required"
          );
        }

        const email = normalizeEmail(profile.email || "");
        if (!isValidEmail(email)) {
          throw createHttpError(400, "Social provider did not return a valid email.", "invalid_email");
        }

        const snapshot = db.read();
        const existing = (snapshot.users || []).find((entry) => normalizeEmail(entry.email || "") === email);
        if (existing?.account_status === "suspended") {
          throw createHttpError(403, "Account suspended. Contact an administrator.", "account_suspended");
        }

        const linkedProviders = Array.from(new Set([...(existing?.linked_providers || []), provider]));
        const user = await db.transact((draft) =>
          upsertUserByEmail(draft, {
            ...existing,
            full_name: String(profile.name || existing?.full_name || email.split("@")[0] || "User").trim(),
            email,
            role: existing?.role || getRoleForEmail(email, config.adminEmail),
            provider,
            linked_providers: linkedProviders,
            avatar_url: profile.picture || existing?.avatar_url || "",
            account_status: "active",
            email_verified: true,
            last_login_date: nowIso(),
          })
        );

        await clearFailedLogin(email, req);
        const session = await createAuthSession(user, req, remember);
        setAuthCookies(res, session.token, session.csrfToken, remember);
        await logAuthEvent("social_login_success", email, { provider, remember });
        success(res, 200, sanitizeUser(user));
        return;
      }

      if (routePath === "/auth/logout" && method === "POST") {
        const context = await getAuthContext(req, { touch: false });
        if (context) {
          if (!requireCsrf(req, res, context)) return;
          await revokeSessionById(context.session.id);
        }
        clearAuthCookies(res);
        success(res, 200, { success: true });
        return;
      }

      if (routePath === "/auth/me" && method === "PATCH") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const {
          email,
          fullName,
          full_name,
          primary_crops,
          ...safeUpdateData
        } = body;

        const currentEmail = normalizeEmail(context.user.email || "");
        if (email && normalizeEmail(email) !== currentEmail) {
          throw createHttpError(400, "Email updates require administrator assistance.", "email_update_denied");
        }

        const updatedUser = await db.transact((draft) =>
          upsertUserByEmail(draft, {
            ...context.user,
            ...safeUpdateData,
            email: currentEmail,
            full_name: full_name || fullName || context.user.full_name || "Farmer",
            role: context.user.role || "user",
            provider: context.user.provider || "email",
            primary_crops: Object.prototype.hasOwnProperty.call(body, "primary_crops")
              ? normalizeCrops(primary_crops)
              : context.user.primary_crops,
          })
        );

        await logAuthEvent("profile_updated", updatedUser.email);
        success(res, 200, sanitizeUser(updatedUser));
        return;
      }

      if (routePath === "/auth/change-password" && method === "POST") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");
        if (!currentPassword || !newPassword) {
          throw createHttpError(400, "Current and new passwords are required.", "invalid_password");
        }

        const snapshot = db.read();
        const user = (snapshot.users || []).find((entry) => entry.id === context.user.id);
        if (!user?.password_hash) {
          throw createHttpError(400, "Password login is not configured for this account.", "password_not_configured");
        }

        const currentHash = await derivePasswordHash(
          currentPassword,
          user.password_salt,
          user.password_iterations || config.auth.passwordIterations
        );
        if (!safeEqualHex(currentHash, user.password_hash)) {
          throw createHttpError(400, "Current password is incorrect.", "invalid_password");
        }

        const passwordError = validatePassword(newPassword, user.email, config.auth.passwordMinLength);
        if (passwordError) throw createHttpError(400, passwordError, "invalid_password");
        if (currentPassword === newPassword) {
          throw createHttpError(400, "New password must be different from the current password.", "invalid_password");
        }

        const passwordRecord = await makePasswordRecord(newPassword, config.auth.passwordIterations);
        await db.transact((draft) => {
          draft.users = (draft.users || []).map((entry) =>
            entry.id === user.id
              ? {
                  ...entry,
                  ...passwordRecord,
                  password_changed_at: nowIso(),
                  updated_date: nowIso(),
                }
              : entry
          );
          draft.auth_sessions = (draft.auth_sessions || []).map((session) =>
            session.user_id === user.id && session.id !== context.session.id && !session.revoked_date
              ? { ...session, revoked_date: nowIso(), updated_date: nowIso() }
              : session
          );
        });

        await logAuthEvent("password_changed", user.email);
        success(res, 200, { success: true });
        return;
      }

      if (routePath === "/auth/password-reset/request" && method === "POST") {
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const email = normalizeEmail(body.email || "");
        const genericMessage = "If an account exists, password reset instructions have been sent.";

        if (!isValidEmail(email)) {
          success(res, 200, { success: true, message: genericMessage });
          return;
        }

        const snapshot = db.read();
        const user = (snapshot.users || []).find((entry) => normalizeEmail(entry.email || "") === email);
        if (!user?.password_hash || user.account_status !== "active") {
          await logAuthEvent("password_reset_requested", email, { status: "ignored" });
          success(res, 200, { success: true, message: genericMessage });
          return;
        }

        const rawToken = generateToken(24);
        const tokenHash = hashText(rawToken);
        const expiresAt = new Date(Date.now() + config.auth.resetTokenMinutes * 60 * 1000).toISOString();

        await db.transact((draft) => {
          draft.password_reset_tokens = (draft.password_reset_tokens || [])
            .filter((entry) => !(entry.user_id === user.id && !entry.used_at))
            .concat({
              id: makeId(),
              user_id: user.id,
              token_hash: tokenHash,
              created_date: nowIso(),
              expires_at: expiresAt,
              used_at: null,
            });
        });

        await logAuthEvent("password_reset_requested", email, { status: "issued" });
        success(res, 200, {
          success: true,
          message: genericMessage,
          ...(config.exposeResetDebugUrl
            ? { debug_reset_url: `/reset-password?token=${encodeURIComponent(rawToken)}` }
            : {}),
        });
        return;
      }

      if (routePath === "/auth/password-reset/validate" && method === "GET") {
        const token = String(url.searchParams.get("token") || "");
        if (!token) {
          success(res, 200, { valid: false });
          return;
        }

        const tokenHash = hashText(token);
        const snapshot = db.read();
        const now = Date.now();
        const resetRecord = (snapshot.password_reset_tokens || []).find((entry) => entry.token_hash === tokenHash);
        if (!resetRecord || resetRecord.used_at || new Date(resetRecord.expires_at).getTime() <= now) {
          success(res, 200, { valid: false });
          return;
        }
        const user = (snapshot.users || []).find((entry) => entry.id === resetRecord.user_id);
        if (!user) {
          success(res, 200, { valid: false });
          return;
        }

        success(res, 200, { valid: true, email_hint: maskEmail(user.email) });
        return;
      }

      if (routePath === "/auth/password-reset/complete" && method === "POST") {
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const token = String(body.token || "");
        const newPassword = String(body.newPassword || "");
        if (!token || !newPassword) {
          throw createHttpError(400, "Reset token and new password are required.", "invalid_request");
        }

        const passwordError = validatePassword(newPassword, "", config.auth.passwordMinLength);
        if (passwordError) throw createHttpError(400, passwordError, "invalid_password");

        const tokenHash = hashText(token);
        const snapshot = db.read();
        const resetRecord = (snapshot.password_reset_tokens || []).find((entry) => entry.token_hash === tokenHash);
        if (!resetRecord || resetRecord.used_at || new Date(resetRecord.expires_at).getTime() <= Date.now()) {
          throw createHttpError(400, "Reset link is invalid or expired.", "invalid_reset_token");
        }

        const user = (snapshot.users || []).find((entry) => entry.id === resetRecord.user_id);
        if (!user || user.account_status === "suspended") {
          throw createHttpError(400, "Reset link is invalid or expired.", "invalid_reset_token");
        }

        const passwordRecord = await makePasswordRecord(newPassword, config.auth.passwordIterations);
        await db.transact((draft) => {
          draft.users = (draft.users || []).map((entry) =>
            entry.id === user.id
              ? { ...entry, ...passwordRecord, password_reset_at: nowIso(), updated_date: nowIso() }
              : entry
          );
          draft.password_reset_tokens = (draft.password_reset_tokens || []).map((entry) =>
            entry.id === resetRecord.id ? { ...entry, used_at: nowIso(), updated_date: nowIso() } : entry
          );
          draft.auth_sessions = (draft.auth_sessions || []).map((session) =>
            session.user_id === user.id && !session.revoked_date
              ? { ...session, revoked_date: nowIso(), updated_date: nowIso() }
              : session
          );
        });

        clearAuthCookies(res);
        await logAuthEvent("password_reset_completed", user.email);
        success(res, 200, { success: true });
        return;
      }

      if (routePath === "/enterprise/sessions" && method === "GET") {
        const context = await requireAuth(req, res);
        if (!context) return;

        const requestedEmail = normalizeEmail(url.searchParams.get("email") || context.user.email || "");
        const currentEmail = normalizeEmail(context.user.email || "");
        if (context.user.role !== "admin" && requestedEmail !== currentEmail) {
          throw createHttpError(403, "Access denied.", "forbidden");
        }

        const snapshot = db.read();
        const now = Date.now();
        const latestByDevice = new Map();
        (snapshot.device_sessions || [])
          .filter((entry) => normalizeEmail(entry.user_email || "") === requestedEmail)
          .forEach((session) => {
            const previous = latestByDevice.get(session.device_id);
            if (!previous || new Date(session.last_active).getTime() > new Date(previous.last_active).getTime()) {
              latestByDevice.set(session.device_id, session);
            }
          });

        const sessions = (snapshot.auth_sessions || [])
          .filter(
            (session) =>
              normalizeEmail(session.user_email || "") === requestedEmail &&
              !session.revoked_date &&
              new Date(session.expires_at).getTime() > now
          )
          .sort((a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime())
          .map((session) => ({
            id: session.id,
            user_email: session.user_email,
            device_id: session.device_id,
            device_info: latestByDevice.get(session.device_id)?.device_info || getDeviceInfo(req, session.device_id),
            last_active: session.last_active,
            created_date: session.created_date,
            expires_at: session.expires_at,
            is_current_device: session.device_id === context.session.device_id,
            is_current_session: session.id === context.session.id,
          }));

        success(res, 200, sessions);
        return;
      }

      if (routePath === "/enterprise/sessions/logout-others" && method === "POST") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const targetEmail = normalizeEmail(body.email || context.user.email || "");
        const currentEmail = normalizeEmail(context.user.email || "");
        if (context.user.role !== "admin" && targetEmail !== currentEmail) {
          throw createHttpError(403, "Access denied.", "forbidden");
        }

        await db.transact((draft) => {
          draft.auth_sessions = (draft.auth_sessions || []).map((session) => {
            if (normalizeEmail(session.user_email || "") !== targetEmail) return session;
            if (session.id === context.session.id) return session;
            return { ...session, revoked_date: nowIso(), updated_date: nowIso() };
          });
          draft.device_sessions = (draft.device_sessions || []).filter((session) => {
            if (normalizeEmail(session.user_email || "") !== targetEmail) return true;
            return session.device_id === context.session.device_id;
          });
        });

        await logAuthEvent("logout_other_devices", targetEmail);
        success(res, 200, true);
        return;
      }

      if (routePath === "/users" && method === "GET") {
        const context = await requireAdmin(req, res);
        if (!context) return;
        const limit = coerceLimit(url.searchParams.get("limit"), 200, 1000);
        const users = sortItems(db.read().users || [], "-created_date").slice(0, limit).map(sanitizeUser);
        success(res, 200, users);
        return;
      }

      if (routePath === "/users/invite" && method === "POST") {
        const context = await requireAdmin(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const email = normalizeEmail(body.email || "");
        if (!isValidEmail(email)) throw createHttpError(400, "Invalid email address.", "invalid_email");

        const snapshot = db.read();
        const existing = (snapshot.users || []).find((entry) => normalizeEmail(entry.email || "") === email);
        if (existing?.account_status === "active") {
          throw createHttpError(409, "This user already has an active account.", "user_exists");
        }

        const invited = await db.transact((draft) =>
          upsertUserByEmail(draft, {
            ...existing,
            email,
            full_name: existing?.full_name || email.split("@")[0],
            role: existing?.role || getRoleForEmail(email, config.adminEmail),
            provider: existing?.provider || "invite",
            account_status: "invited",
            email_verified: false,
          })
        );

        await logAuthEvent("user_invited", email, { by: context.user.email });
        success(res, 201, sanitizeUser(invited));
        return;
      }

      if (routePath.startsWith("/users/") && method === "PATCH") {
        const context = await requireAdmin(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const userId = decodeURIComponent(routePath.split("/")[2] || "");
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const snapshot = db.read();
        const target = (snapshot.users || []).find((entry) => entry.id === userId);
        if (!target) throw createHttpError(404, "User not found.", "user_not_found");

        const nextRole = body.role ?? target.role;
        if (!ROLE_VALUES.has(nextRole)) throw createHttpError(400, "Invalid role.", "invalid_role");
        if (normalizeEmail(target.email || "") === normalizeEmail(config.adminEmail) && nextRole !== "admin") {
          throw createHttpError(400, "Primary admin role cannot be removed.", "admin_guard");
        }

        const nextStatus = body.account_status ?? target.account_status;
        if (!ACCOUNT_STATUS_VALUES.has(nextStatus)) {
          throw createHttpError(400, "Invalid account status.", "invalid_account_status");
        }
        if (normalizeEmail(target.email || "") === normalizeEmail(config.adminEmail) && nextStatus !== "active") {
          throw createHttpError(400, "Primary admin account cannot be suspended.", "admin_guard");
        }

        const updated = await db.transact((draft) =>
          upsertUserByEmail(draft, {
            ...target,
            role: nextRole,
            account_status: nextStatus,
            full_name: body.full_name ?? target.full_name,
          })
        );

        if (nextStatus === "suspended") {
          await revokeUserSessions(target.id);
        }

        await logAuthEvent("admin_user_updated", target.email, {
          by: context.user.email,
          role: nextRole,
          status: nextStatus,
        });
        success(res, 200, sanitizeUser(updated));
        return;
      }

      if (routePath === "/security/auth-events" && method === "GET") {
        const context = await requireAdmin(req, res);
        if (!context) return;
        const limit = coerceLimit(url.searchParams.get("limit"), 100, 1000);
        success(res, 200, (db.read().auth_events || []).slice(0, limit));
        return;
      }

      if (routePath === "/ai/farm-advice" && method === "POST") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const result = await buildLlmResponse(
          { prompt: String(body.prompt || "") },
          {
            ai: config.ai,
            uploadDir: config.uploadDir,
            uploadsPublicPath: config.uploadsPublicPath,
          }
        );
        success(res, 200, { answer: typeof result === "string" ? result : JSON.stringify(result) });
        return;
      }

      if (routePath === "/ai/diagnose-plant" && method === "POST") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const fileUrl = String(body.file_url || "").trim();
        if (!fileUrl) {
          throw createHttpError(400, "file_url is required.", "invalid_file_url");
        }

        const snapshot = db.read();
        const plantDatabase = Array.isArray(snapshot?.entities?.PlantDatabase)
          ? snapshot.entities.PlantDatabase
          : [];

        const diagnosis = await diagnosePlantImage({
          fileUrl,
          plantDatabase,
          ai: config.ai,
          uploadDir: config.uploadDir,
          uploadsPublicPath: config.uploadsPublicPath,
        });

        success(res, 200, diagnosis);
        return;
      }

      if (routePath === "/integrations/core/invoke-llm" && method === "POST") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;
        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const result = await buildLlmResponse(body, {
          ai: config.ai,
          uploadDir: config.uploadDir,
          uploadsPublicPath: config.uploadsPublicPath,
        });
        success(res, 200, result);
        return;
      }

      if (routePath === "/integrations/core/upload-file" && method === "POST") {
        const context = await requireAuth(req, res);
        if (!context) return;
        if (!requireCsrf(req, res, context)) return;

        const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
        const fileName = String(body.file_name || "upload");
        const fileType = String(body.file_type || "").toLowerCase();
        const base64 = String(body.content_base64 || "")
          .replace(/^data:[^;]+;base64,/i, "")
          .replace(/\s+/g, "");

        if (!base64) throw createHttpError(400, "File payload is required.", "invalid_upload");
        if (!fileType || !ALLOWED_UPLOAD_MIME.has(fileType)) {
          throw createHttpError(415, "Unsupported file type.", "unsupported_media_type");
        }

        const buffer = Buffer.from(base64, "base64");
        if (!buffer || buffer.length === 0) throw createHttpError(400, "Invalid file payload.", "invalid_upload");
        if (buffer.length > config.requestLimits.uploadBytes) {
          throw createHttpError(413, "Uploaded file is too large.", "payload_too_large");
        }

        const safeName = cleanUploadFileName(fileName, fileType);
        const storedName = `${Date.now()}-${makeId()}-${safeName}`;
        const absolutePath = path.join(config.uploadDir, storedName);
        await writeFile(absolutePath, buffer);

        success(res, 201, {
          file_url: `${config.uploadsPublicPath.replace(/\/+$/, "")}/${storedName}`,
          file_name: safeName,
        });
        return;
      }

      if (routePath.startsWith("/entities/")) {
        const segments = routePath.split("/").filter(Boolean);
        const entityName = decodeURIComponent(segments[1] || "");
        assertEntityName(entityName);

        if (segments.length === 2 && method === "GET") {
          const context = await requireAuth(req, res);
          if (!context) return;

          const sortBy = String(url.searchParams.get("sort") || "");
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw ? coerceLimit(limitRaw, 200, 1000) : null;
          const filters = parseJsonSafe(url.searchParams.get("filters"), {});

          const snapshot = db.read();
          const records = getEntityRecordsForRead(snapshot, entityName, context.user);
          const filtered = applyFilters(records, filters);
          const sorted = sortItems(filtered, sortBy);
          success(res, 200, limit ? sorted.slice(0, limit) : sorted);
          return;
        }

        if (segments.length === 2 && method === "POST") {
          const context = await requireAuth(req, res);
          if (!context) return;
          if (!requireCsrf(req, res, context)) return;
          if (!canCreateEntity(entityName, context.user)) {
            throw createHttpError(403, "Access denied.", "forbidden");
          }

          const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
          const payload = isObject(body) ? body : {};
          const item = await db.transact((draft) => {
            if (entityName === "User") {
              throw createHttpError(403, "Use dedicated user management endpoints.", "forbidden");
            }

            const collection = draft.entities[entityName] || [];
            const createdAt = nowIso();
            const record = {
              ...payload,
              id: makeId(),
              created_date: createdAt,
              updated_date: createdAt,
              created_by: context.user.id,
              created_by_email: normalizeEmail(context.user.email || ""),
            };
            draft.entities[entityName] = [record, ...collection];
            return record;
          });

          success(res, 201, item);
          return;
        }

        if (segments.length === 3 && (method === "PATCH" || method === "DELETE")) {
          const context = await requireAuth(req, res);
          if (!context) return;
          if (!requireCsrf(req, res, context)) return;

          const id = decodeURIComponent(segments[2] || "");
          if (!id) throw createHttpError(400, "Entity id is required.", "invalid_entity_id");

          if (method === "PATCH") {
            const body = await readJsonBody(req, config.requestLimits.jsonBodyBytes);
            const updates = isObject(body) ? body : {};

            const updated = await db.transact((draft) => {
              if (entityName === "User") {
                throw createHttpError(403, "Use dedicated user management endpoints.", "forbidden");
              }

              const collection = draft.entities[entityName] || [];
              const existing = collection.find((record) => record.id === id);
              if (!existing) throw createHttpError(404, "Record not found.", "record_not_found");
              if (!canMutateEntityRecord(entityName, existing, context.user)) {
                throw createHttpError(403, "Access denied.", "forbidden");
              }

              const next = {
                ...existing,
                ...updates,
                id: existing.id,
                created_by: existing.created_by,
                created_by_email: existing.created_by_email,
                created_date: existing.created_date,
                updated_date: nowIso(),
                updated_by: context.user.id,
              };

              draft.entities[entityName] = collection.map((record) => (record.id === id ? next : record));
              return next;
            });

            success(res, 200, updated);
            return;
          }

          const deleted = await db.transact((draft) => {
            if (entityName === "User") {
              throw createHttpError(403, "Use dedicated user management endpoints.", "forbidden");
            }

            const collection = draft.entities[entityName] || [];
            const existing = collection.find((record) => record.id === id);
            if (!existing) throw createHttpError(404, "Record not found.", "record_not_found");
            if (!canMutateEntityRecord(entityName, existing, context.user)) {
              throw createHttpError(403, "Access denied.", "forbidden");
            }
            draft.entities[entityName] = collection.filter((record) => record.id !== id);
            return true;
          });

          success(res, 200, { success: Boolean(deleted), id });
          return;
        }
      }

      throw createHttpError(404, "Endpoint not found.", "not_found");
    } catch (error) {
      const status = Number(error?.status) || 500;
      const message =
        status >= 500 && config.isProduction ? "Internal server error." : error.message || "Request failed.";
      const code = error?.code || (status >= 500 ? "internal_error" : "request_failed");
      if (status >= 500) {
        console.error("[api] request failed", {
          method,
          routePath,
          status,
          code,
          message: error?.message || "",
        });
      }
      failure(res, status, message, code);
    }
  };
}
