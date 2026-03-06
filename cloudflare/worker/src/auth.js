import { writeAuthEvent } from "./audit.js";
const textEncoder = new TextEncoder();
const MAX_PBKDF2_ITERATIONS = 100000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const safeParseJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
};

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex = "") => {
  const normalized = String(hex || "").trim();
  if (!normalized || normalized.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
};

const nowIso = () => new Date().toISOString();

const randomHex = (byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const constantTimeEqualHex = (left = "", right = "") => {
  const a = fromHex(left);
  const b = fromHex(right);
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
};

export const normalizeEmail = (email = "") => String(email || "").trim().toLowerCase();
export const isValidEmail = (email = "") => EMAIL_REGEX.test(normalizeEmail(email));

export const parseCookies = (cookieHeader = "") => {
  const cookies = {};
  String(cookieHeader || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((chunk) => {
      const index = chunk.indexOf("=");
      if (index <= 0) return;
      const key = chunk.slice(0, index).trim();
      const value = chunk.slice(index + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    });
  return cookies;
};

export const hashText = async (value = "") => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(String(value || "")));
  return toHex(digest);
};

const derivePasswordHash = async (password, saltHex, iterations) => {
  const keyMaterial = await crypto.subtle.importKey("raw", textEncoder.encode(String(password || "")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: Math.min(Number(iterations || 100000), MAX_PBKDF2_ITERATIONS),
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return toHex(bits);
};

const makePasswordRecord = async (password, iterations) => {
  const password_salt = randomHex(16);
  const password_hash = await derivePasswordHash(password, password_salt, iterations);
  return {
    password_hash,
    password_salt,
    password_iterations: Math.min(Number(iterations || 100000), MAX_PBKDF2_ITERATIONS),
  };
};

const validatePassword = (password = "", email = "", minLength = 12) => {
  const value = String(password || "");
  const emailLocal = normalizeEmail(email).split("@")[0] || "";
  if (value.length < minLength) return `Password must be at least ${minLength} characters long.`;
  if (!/[a-z]/.test(value)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(value)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include a symbol.";
  if (/\s/.test(value)) return "Password must not contain spaces.";
  if (emailLocal && value.toLowerCase().includes(emailLocal)) {
    return "Password must not contain your email name.";
  }
  return "";
};

export const sanitizeUser = (user) => {
  if (!user || typeof user !== "object") return null;
  const { password_hash, password_salt, password_iterations, ...safeUser } = user;
  return safeUser;
};

const getSessionCookieName = (env) => String(env.SESSION_COOKIE_NAME || "vv_session");
const getCsrfCookieName = (env) => String(env.CSRF_COOKIE_NAME || "vv_csrf");
export const getRequestCsrfToken = (request, env) => {
  const cookies = parseCookies(request?.headers?.get?.("cookie") || "");
  return String(cookies[getCsrfCookieName(env)] || "").trim();
};
const getPasswordIterations = (env) => {
  const requested = Number.parseInt(String(env.PASSWORD_ITERATIONS || "100000"), 10) || 100000;
  return Math.min(Math.max(requested, 10000), MAX_PBKDF2_ITERATIONS);
};
const getPasswordMinLength = (env) => Number.parseInt(String(env.PASSWORD_MIN_LENGTH || "12"), 10) || 12;
const getRememberDays = (env) => Number.parseInt(String(env.REMEMBER_SESSION_DAYS || "30"), 10) || 30;
const getSessionHours = (env) => Number.parseInt(String(env.DEFAULT_SESSION_HOURS || "8"), 10) || 8;
const getAdminEmail = (env) => normalizeEmail(env.ADMIN_EMAIL || "");

const sessionMaxAgeSeconds = (env, remember) =>
  remember ? getRememberDays(env) * 24 * 60 * 60 : getSessionHours(env) * 60 * 60;

const serializeCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
};

const getCookieSameSite = (env) => {
  const requested = String(env.SESSION_COOKIE_SAMESITE || "None").trim();
  if (/^strict$/i.test(requested)) return "Strict";
  if (/^lax$/i.test(requested)) return "Lax";
  return "None";
};

const cookieOptions = (env, maxAge) => ({
  path: "/",
  sameSite: getCookieSameSite(env),
  secure: String(env.FORCE_HTTPS || "true").toLowerCase() === "true",
  maxAge,
});

const appendAuthCookies = (headers, env, sessionToken, csrfToken, remember) => {
  const maxAge = sessionMaxAgeSeconds(env, remember);
  const options = cookieOptions(env, maxAge);
  headers.append(
    "set-cookie",
    serializeCookie(getSessionCookieName(env), sessionToken, {
      ...options,
      httpOnly: true,
    })
  );
  headers.append(
    "set-cookie",
    serializeCookie(getCsrfCookieName(env), csrfToken, {
      ...options,
      httpOnly: false,
    })
  );
};

export const appendClearAuthCookies = (headers, env) => {
  const options = {
    ...cookieOptions(env, 0),
    expires: new Date(0),
  };
  headers.append(
    "set-cookie",
    serializeCookie(getSessionCookieName(env), "", {
      ...options,
      httpOnly: true,
    })
  );
  headers.append(
    "set-cookie",
    serializeCookie(getCsrfCookieName(env), "", {
      ...options,
      httpOnly: false,
    })
  );
};

const getClientIp = (request) => {
  const forwarded = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "0.0.0.0";
  return forwarded.split(",")[0].trim().slice(0, 120);
};

const getDeviceId = async (request) => {
  const provided = String(request.headers.get("x-device-id") || "").trim();
  if (provided) return provided.slice(0, 120);
  const userAgent = String(request.headers.get("user-agent") || "");
  const ip = getClientIp(request);
  return (await hashText(`${ip}:${userAgent}`)).slice(0, 40);
};

const buildSessionRecord = async (request, env, user, remember) => {
  const token = randomHex(32);
  const csrfToken = randomHex(24);
  const tokenHash = await hashText(token);
  const csrfHash = await hashText(csrfToken);
  const created = nowIso();
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds(env, remember) * 1000).toISOString();
  const session = {
    id: crypto.randomUUID(),
    token_hash: tokenHash,
    csrf_token_hash: csrfHash,
    user_id: user.id,
    user_email: normalizeEmail(user.email || ""),
    remember: Boolean(remember),
    device_id: await getDeviceId(request),
    ip: getClientIp(request),
    created_date: created,
    last_active: created,
    expires_at: expiresAt,
    revoked_date: null,
    updated_date: created,
  };
  return {
    token,
    csrfToken,
    session,
  };
};

const writeUser = async (env, user) => {
  const record = {
    ...user,
    email: normalizeEmail(user.email || ""),
  };
  await env.DB.prepare(
    `
      INSERT OR REPLACE INTO users (
        id, email, full_name, role, provider, account_status, email_verified, avatar_url,
        password_hash, password_salt, password_iterations, created_date, updated_date, last_login_date, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
    `
  )
    .bind(
      record.id,
      record.email,
      record.full_name || "",
      record.role || "user",
      record.provider || "",
      record.account_status || "active",
      record.email_verified ? 1 : 0,
      record.avatar_url || "",
      record.password_hash || "",
      record.password_salt || "",
      record.password_iterations ?? null,
      record.created_date || "",
      record.updated_date || "",
      record.last_login_date || "",
      JSON.stringify(record)
    )
    .run();
  return record;
};

const writeSession = async (env, session) => {
  await env.DB.prepare(
    `
      INSERT INTO auth_sessions (
        id, token_hash, csrf_token_hash, user_id, user_email, remember, device_id, ip,
        created_date, last_active, expires_at, revoked_date, updated_date, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
    `
  )
    .bind(
      session.id,
      session.token_hash,
      session.csrf_token_hash,
      session.user_id,
      session.user_email,
      session.remember ? 1 : 0,
      session.device_id || "",
      session.ip || "",
      session.created_date,
      session.last_active || "",
      session.expires_at,
      session.revoked_date || "",
      session.updated_date || "",
      JSON.stringify(session)
    )
    .run();
};

const getUserByEmail = async (env, email) => {
  const row = await env.DB.prepare("SELECT payload_json FROM users WHERE email = ?1 LIMIT 1")
    .bind(normalizeEmail(email))
    .first();
  return row?.payload_json ? safeParseJson(row.payload_json, null) : null;
};

const touchSession = async (env, session) => {
  const updated = {
    ...session,
    last_active: nowIso(),
    updated_date: nowIso(),
  };
  await env.DB.prepare("UPDATE auth_sessions SET last_active = ?2, updated_date = ?3, payload_json = ?4 WHERE id = ?1")
    .bind(updated.id, updated.last_active, updated.updated_date, JSON.stringify(updated))
    .run();
  return updated;
};

const revokeSession = async (env, session) => {
  const updated = {
    ...session,
    revoked_date: nowIso(),
    updated_date: nowIso(),
  };
  await env.DB.prepare("UPDATE auth_sessions SET revoked_date = ?2, updated_date = ?3, payload_json = ?4 WHERE id = ?1")
    .bind(updated.id, updated.revoked_date, updated.updated_date, JSON.stringify(updated))
    .run();
  return updated;
};

export const getAuthContext = async (request, env, { touch = true } = {}) => {
  if (!env?.DB) return null;

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const rawToken = String(cookies[getSessionCookieName(env)] || "").trim();
  if (!rawToken) return null;

  const tokenHash = await hashText(rawToken);
  const row = await env.DB.prepare(
    `
      SELECT
        s.payload_json AS session_json,
        u.payload_json AS user_json
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1
        AND (s.revoked_date IS NULL OR s.revoked_date = '')
        AND s.expires_at > ?2
      LIMIT 1
    `
  )
    .bind(tokenHash, nowIso())
    .first();

  if (!row?.session_json || !row?.user_json) return null;

  let session = safeParseJson(row.session_json, null);
  const user = safeParseJson(row.user_json, null);
  if (!session || !user) return null;
  if (String(user.account_status || "active").trim().toLowerCase() === "suspended") return null;

  if (touch) {
    try {
      session = await touchSession(env, session);
    } catch {
      // Session touch failure should not block authenticated reads.
    }
  }

  return {
    session,
    user,
    tokenHash,
  };
};

export const requireCsrf = async (request, context) => {
  const token = String(request.headers.get("x-csrf-token") || "").trim();
  if (!token) return { ok: false, code: "csrf_required", message: "Missing CSRF token." };
  const tokenHash = await hashText(token);
  if (!constantTimeEqualHex(tokenHash, context?.session?.csrf_token_hash || "")) {
    return { ok: false, code: "csrf_invalid", message: "Invalid CSRF token." };
  }
  return { ok: true };
};

export const signInWithEmail = async (request, env, payload = {}) => {
  const email = normalizeEmail(payload.email || "");
  const password = String(payload.password || "");
  const remember = payload.remember !== false;

  if (!isValidEmail(email) || !password) {
    return { ok: false, status: 400, code: "invalid_credentials", message: "Enter a valid email and password." };
  }

  const user = await getUserByEmail(env, email);
  if (!user?.password_hash) {
    return { ok: false, status: 401, code: "invalid_credentials", message: "Invalid email or password." };
  }
  if (String(user.account_status || "").toLowerCase() === "suspended") {
    return { ok: false, status: 403, code: "account_suspended", message: "Account suspended. Contact an administrator." };
  }

  const attemptedHash = await derivePasswordHash(password, user.password_salt, user.password_iterations || getPasswordIterations(env));
  if (!constantTimeEqualHex(attemptedHash, user.password_hash || "")) {
    return { ok: false, status: 401, code: "invalid_credentials", message: "Invalid email or password." };
  }

  const updatedUser = await writeUser(env, {
    ...user,
    last_login_date: nowIso(),
    updated_date: nowIso(),
  });
  const sessionRecord = await buildSessionRecord(request, env, updatedUser, remember);
  await writeSession(env, sessionRecord.session);

  const headers = new Headers();
  appendAuthCookies(headers, env, sessionRecord.token, sessionRecord.csrfToken, remember);
  headers.set("x-csrf-token", sessionRecord.csrfToken);
  await writeAuthEvent(env, "login_email", updatedUser.email, { remember: Boolean(remember) });
  return {
    ok: true,
    status: 200,
    user: sanitizeUser(updatedUser),
    headers,
  };
};

export const registerWithEmail = async (request, env, payload = {}) => {
  const fullName = String(payload.fullName || "").trim();
  const email = normalizeEmail(payload.email || "");
  const password = String(payload.password || "");
  const confirmPassword = payload.confirmPassword;
  const remember = payload.remember !== false;

  if (!fullName || fullName.length < 2) {
    return { ok: false, status: 400, code: "invalid_full_name", message: "Full name must be at least 2 characters." };
  }
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, code: "invalid_email", message: "Enter a valid email address." };
  }
  if (!password) {
    return { ok: false, status: 400, code: "invalid_password", message: "Password is required." };
  }
  if (typeof confirmPassword === "string" && confirmPassword !== password) {
    return { ok: false, status: 400, code: "invalid_password", message: "Passwords do not match." };
  }

  const passwordPolicyError = validatePassword(password, email, getPasswordMinLength(env));
  if (passwordPolicyError) {
    return { ok: false, status: 400, code: "invalid_password", message: passwordPolicyError };
  }

  const existing = await getUserByEmail(env, email);
  if (existing?.password_hash) {
    return { ok: false, status: 409, code: "email_exists", message: "An account with this email already exists." };
  }
  if (String(existing?.account_status || "").toLowerCase() === "suspended") {
    return { ok: false, status: 403, code: "account_suspended", message: "Account suspended. Contact an administrator." };
  }

  const passwordRecord = await makePasswordRecord(password, getPasswordIterations(env));
  const createdDate = existing?.created_date || nowIso();
  const role = email === getAdminEmail(env) ? "admin" : existing?.role || "user";
  const user = await writeUser(env, {
    ...existing,
    ...payload,
    ...passwordRecord,
    id: existing?.id || crypto.randomUUID(),
    email,
    full_name: fullName,
    role,
    provider: "email",
    account_status: "active",
    email_verified: true,
    primary_crops: Array.isArray(payload.primary_crops) ? payload.primary_crops : existing?.primary_crops || [],
    created_date: createdDate,
    updated_date: nowIso(),
    last_login_date: nowIso(),
  });

  const sessionRecord = await buildSessionRecord(request, env, user, remember);
  await writeSession(env, sessionRecord.session);

  const headers = new Headers();
  appendAuthCookies(headers, env, sessionRecord.token, sessionRecord.csrfToken, remember);
  headers.set("x-csrf-token", sessionRecord.csrfToken);
  await writeAuthEvent(env, "register_email", user.email, { remember: Boolean(remember) });
  return {
    ok: true,
    status: 201,
    user: sanitizeUser(user),
    headers,
  };
};

export const logout = async (request, env) => {
  const context = await getAuthContext(request, env, { touch: false });
  const headers = new Headers();
  appendClearAuthCookies(headers, env);
  headers.set("x-csrf-token", "");

  if (!context) {
    return {
      ok: true,
      status: 200,
      data: { success: true },
      headers,
    };
  }

  const csrf = await requireCsrf(request, context);
  if (!csrf.ok) {
    return {
      ok: false,
      status: 403,
      code: csrf.code,
      message: csrf.message,
      headers,
    };
  }

  await revokeSession(env, context.session);
  await writeAuthEvent(env, "logout", context.user.email, { session_id: context.session.id });
  return {
    ok: true,
    status: 200,
    data: { success: true },
    headers,
  };
};




export const listSessions = async (env, context, requestedEmail = "") => {
  const email = normalizeEmail(requestedEmail || context?.user?.email || "");
  if (!email) {
    return { ok: false, status: 400, code: "invalid_email", message: "Email is required." };
  }
  const currentEmail = normalizeEmail(context?.user?.email || "");
  if (context?.user?.role !== "admin" && email !== currentEmail) {
    return { ok: false, status: 403, code: "forbidden", message: "Access denied." };
  }

  const result = await env.DB.prepare(
    `
      SELECT payload_json FROM auth_sessions
      WHERE user_email = ?1
        AND (revoked_date IS NULL OR revoked_date = '')
        AND expires_at > ?2
      ORDER BY COALESCE(last_active, created_date) DESC
    `
  )
    .bind(email, nowIso())
    .all();

  const rows = Array.isArray(result?.results) ? result.results : [];
  const sessions = rows
    .map((row) => safeParseJson(row?.payload_json, null))
    .filter((entry) => entry && typeof entry === "object")
    .map((session) => ({
      id: session.id,
      last_active: session.last_active || session.updated_date || session.created_date || "",
      expires_at: session.expires_at || "",
      is_current_session: String(session.id || "") === String(context?.session?.id || ""),
      is_current_device: String(session.device_id || "") === String(context?.session?.device_id || ""),
      device_info: {
        platform: session.device_id ? "Known device" : "Device",
        userAgent: session.ip ? `IP ${session.ip}` : "Unknown device",
      },
    }));

  return { ok: true, status: 200, data: sessions };
};

export const logoutOtherSessions = async (env, context, requestedEmail = "") => {
  const email = normalizeEmail(requestedEmail || context?.user?.email || "");
  if (!email) {
    return { ok: false, status: 400, code: "invalid_email", message: "Email is required." };
  }
  const currentEmail = normalizeEmail(context?.user?.email || "");
  if (context?.user?.role !== "admin" && email !== currentEmail) {
    return { ok: false, status: 403, code: "forbidden", message: "Access denied." };
  }

  const now = nowIso();
  await env.DB.prepare(
    `
      UPDATE auth_sessions
      SET revoked_date = ?1, updated_date = ?1
      WHERE user_email = ?2
        AND id != ?3
        AND (revoked_date IS NULL OR revoked_date = '')
    `
  )
        .bind(now, email, String(context?.session?.id || ""))
    .run();

  await writeAuthEvent(env, "logout_other_devices", email, { by: context.user.email });
  return { ok: true, status: 200, data: { success: true } };
};


