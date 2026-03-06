import { isValidEmail, normalizeEmail, sanitizeUser } from "./auth.js";
import { writeAuthEvent, listAuthEvents as readAuthEvents } from "./audit.js";

const ROLE_VALUES = new Set(["admin", "user"]);
const ACCOUNT_STATUS_VALUES = new Set(["active", "invited", "suspended"]);

const nowIso = () => new Date().toISOString();

const safeParseJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
};

const requireAdmin = (context) => {
  if (context?.user?.role !== "admin") {
    const error = new Error("Admin access required.");
    error.status = 403;
    error.code = "forbidden";
    throw error;
  }
};

const readUserRows = async (env, limit = 200) => {
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit || 200), 10) || 200, 1), 1000);
  const result = await env.DB.prepare(
    `
      SELECT payload_json FROM users
      ORDER BY created_date DESC
      LIMIT ?1
    `
  )
    .bind(safeLimit)
    .all();
  return Array.isArray(result?.results) ? result.results : [];
};

const parseUserRow = (row) => safeParseJson(row?.payload_json, null);

const getUserById = async (env, userId) => {
  const row = await env.DB.prepare("SELECT payload_json FROM users WHERE id = ?1 LIMIT 1")
    .bind(String(userId || ""))
    .first();
  return parseUserRow(row);
};

const getUserByEmail = async (env, email) => {
  const row = await env.DB.prepare("SELECT payload_json FROM users WHERE email = ?1 LIMIT 1")
    .bind(normalizeEmail(email || ""))
    .first();
  return parseUserRow(row);
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

const revokeUserSessions = async (env, userId) => {
  const now = nowIso();
  await env.DB.prepare(
    `
      UPDATE auth_sessions
      SET revoked_date = ?2, updated_date = ?2
      WHERE user_id = ?1
        AND (revoked_date IS NULL OR revoked_date = '')
    `
  )
    .bind(String(userId || ""), now)
    .run();
};

export const listUsers = async (env, context, limit = 200) => {
  requireAdmin(context);
  const rows = await readUserRows(env, limit);
  return rows
    .map(parseUserRow)
    .filter((entry) => entry && typeof entry === "object")
    .map((user) => sanitizeUser(user));
};

export const inviteUser = async (env, context, email) => {
  requireAdmin(context);
  const normalizedEmail = normalizeEmail(email || "");
  if (!isValidEmail(normalizedEmail)) {
    const error = new Error("Invalid email address.");
    error.status = 400;
    error.code = "invalid_email";
    throw error;
  }

  const existing = await getUserByEmail(env, normalizedEmail);
  if (String(existing?.account_status || "").toLowerCase() === "active") {
    const error = new Error("This user already has an active account.");
    error.status = 409;
    error.code = "user_exists";
    throw error;
  }

  const invited = await writeUser(env, {
    ...existing,
    id: existing?.id || crypto.randomUUID(),
    email: normalizedEmail,
    full_name: existing?.full_name || normalizedEmail.split("@")[0],
    role: existing?.role || (normalizedEmail === normalizeEmail(env.ADMIN_EMAIL || "") ? "admin" : "user"),
    provider: existing?.provider || "invite",
    account_status: "invited",
    email_verified: false,
    created_date: existing?.created_date || nowIso(),
    updated_date: nowIso(),
    last_login_date: existing?.last_login_date || "",
  });

  await writeAuthEvent(env, "user_invited", normalizedEmail, { by: context.user.email });
  return sanitizeUser(invited);
};

export const updateUser = async (env, context, userId, updates = {}) => {
  requireAdmin(context);
  const target = await getUserById(env, userId);
  if (!target) {
    const error = new Error("User not found.");
    error.status = 404;
    error.code = "user_not_found";
    throw error;
  }

  const nextRole = updates.role ?? target.role;
  if (!ROLE_VALUES.has(nextRole)) {
    const error = new Error("Invalid role.");
    error.status = 400;
    error.code = "invalid_role";
    throw error;
  }
  const primaryAdminEmail = normalizeEmail(env.ADMIN_EMAIL || "");
  if (normalizeEmail(target.email || "") === primaryAdminEmail && nextRole !== "admin") {
    const error = new Error("Primary admin role cannot be removed.");
    error.status = 400;
    error.code = "admin_guard";
    throw error;
  }

  const nextStatus = updates.account_status ?? target.account_status;
  if (!ACCOUNT_STATUS_VALUES.has(nextStatus)) {
    const error = new Error("Invalid account status.");
    error.status = 400;
    error.code = "invalid_account_status";
    throw error;
  }
  if (normalizeEmail(target.email || "") === primaryAdminEmail && nextStatus !== "active") {
    const error = new Error("Primary admin account cannot be suspended.");
    error.status = 400;
    error.code = "admin_guard";
    throw error;
  }

  const updated = await writeUser(env, {
    ...target,
    role: nextRole,
    account_status: nextStatus,
    full_name: updates.full_name ?? target.full_name,
    updated_date: nowIso(),
  });

  if (nextStatus === "suspended") {
    await revokeUserSessions(env, target.id);
  }

  await writeAuthEvent(env, "admin_user_updated", target.email, {
    by: context.user.email,
    role: nextRole,
    status: nextStatus,
  });

  return sanitizeUser(updated);
};

export const listSecurityAuthEvents = async (env, context, limit = 100) => {
  requireAdmin(context);
  return readAuthEvents(env, limit);
};
