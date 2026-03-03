import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Callback);

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ROLE_VALUES = new Set(["admin", "user"]);
export const ACCOUNT_STATUS_VALUES = new Set(["active", "invited", "suspended"]);
export const SOCIAL_PROVIDER_VALUES = new Set(["google", "microsoft", "facebook"]);

export const nowIso = () => new Date().toISOString();
export const makeId = () => randomUUID();

export const normalizeEmail = (email = "") => String(email || "").trim().toLowerCase();
export const isValidEmail = (email = "") => EMAIL_REGEX.test(normalizeEmail(email));

export const normalizeCrops = (value) => {
  if (Array.isArray(value)) {
    return value.map((crop) => String(crop || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((crop) => crop.trim())
      .filter(Boolean);
  }
  return [];
};

export const hashText = (text = "") => createHash("sha256").update(String(text || ""), "utf8").digest("hex");
export const generateToken = (byteLength = 32) => randomBytes(byteLength).toString("hex");

export const safeEqualHex = (left = "", right = "") => {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

export async function derivePasswordHash(password, saltHex, iterations) {
  const salt = Buffer.from(String(saltHex || ""), "hex");
  const hash = await pbkdf2(String(password || ""), salt, iterations, 32, "sha256");
  return hash.toString("hex");
}

export async function makePasswordRecord(password, iterations) {
  const salt = generateToken(16);
  const hash = await derivePasswordHash(password, salt, iterations);
  return {
    password_hash: hash,
    password_salt: salt,
    password_iterations: iterations,
  };
}

export function validatePassword(password = "", email = "", minLength = 12) {
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
}

export function maskEmail(email = "") {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "your email";
  const maskedLocal = `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local.slice(-1)}`;
  return `${maskedLocal}@${domain}`;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const {
    password_hash,
    password_salt,
    password_iterations,
    ...safeUser
  } = user;
  return safeUser;
}

export function parseCookies(cookieHeader = "") {
  const cookies = {};
  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  String(cookieHeader || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((chunk) => {
      const index = chunk.indexOf("=");
      if (index <= 0) return;
      const key = chunk.slice(0, index).trim();
      const value = chunk.slice(index + 1).trim();
      cookies[key] = safeDecode(value);
    });
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

export function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "0.0.0.0";
}

export function getDeviceId(req) {
  const raw = String(req.headers["x-device-id"] || "").trim();
  if (raw) return raw.slice(0, 120);
  const ip = getClientIp(req);
  const userAgent = String(req.headers["user-agent"] || "");
  return hashText(`${ip}:${userAgent}`).slice(0, 40);
}

export function getDeviceInfo(req, deviceId) {
  return {
    id: deviceId,
    userAgent: String(req.headers["user-agent"] || ""),
    platform: String(req.headers["sec-ch-ua-platform"] || ""),
    created_at: nowIso(),
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
