import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const inputPath = path.resolve(root, process.env.CF_D1_SEED_INPUT || "server/data/db.json");
const outputPath = path.resolve(root, process.env.CF_D1_SEED_OUTPUT || "cloudflare/d1/seed.generated.sql");

const ENTITY_NAMES = [
  "PlantDatabase",
  "PlantDiagnosis",
  "Treatment",
  "Task",
  "PestPrediction",
  "WeatherLog",
  "OutbreakReport",
  "DiagnosisFeedback",
  "ForumPost",
  "ForumComment",
  "CropPlan",
  "ActivityLog",
];

const sqlString = (value) => {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const jsonString = (value) => sqlString(JSON.stringify(value ?? null));

const boolInt = (value) => (value ? "1" : "0");

const pushDeleteStatements = (lines) => {
  lines.push("DELETE FROM app_meta;");
  lines.push("DELETE FROM users;");
  lines.push("DELETE FROM auth_events;");
  lines.push("DELETE FROM auth_sessions;");
  lines.push("DELETE FROM password_reset_tokens;");
  lines.push("DELETE FROM login_throttle;");
  lines.push("DELETE FROM device_sessions;");
  lines.push("DELETE FROM entity_records;");
};

const emitMeta = (lines, state) => {
  const meta = state?.meta || {};
  lines.push(
    `INSERT INTO app_meta (key, value_json, updated_date) VALUES (${sqlString("state_meta")}, ${jsonString(meta)}, ${sqlString(
      meta.updated_date || new Date().toISOString()
    )});`
  );
};

const emitUsers = (lines, users) => {
  for (const user of Array.isArray(users) ? users : []) {
    lines.push(
      [
        "INSERT INTO users (",
        "id, email, full_name, role, provider, account_status, email_verified, avatar_url,",
        "password_hash, password_salt, password_iterations, created_date, updated_date, last_login_date, payload_json",
        ") VALUES (",
        [
          sqlString(user.id),
          sqlString(user.email),
          sqlString(user.full_name || ""),
          sqlString(user.role || "user"),
          sqlString(user.provider || ""),
          sqlString(user.account_status || "active"),
          boolInt(Boolean(user.email_verified)),
          sqlString(user.avatar_url || ""),
          sqlString(user.password_hash || ""),
          sqlString(user.password_salt || ""),
          user.password_iterations == null ? "NULL" : Number(user.password_iterations),
          sqlString(user.created_date || ""),
          sqlString(user.updated_date || ""),
          sqlString(user.last_login_date || ""),
          jsonString(user),
        ].join(", "),
        ");",
      ].join("")
    );
  }
};

const emitAuthEvents = (lines, events) => {
  for (const entry of Array.isArray(events) ? events : []) {
    lines.push(
      `INSERT INTO auth_events (id, email, type, created_date, metadata_json, payload_json) VALUES (${sqlString(
        entry.id
      )}, ${sqlString(entry.email || "")}, ${sqlString(entry.type || "")}, ${sqlString(entry.created_date || "")}, ${jsonString(
        entry.metadata || {}
      )}, ${jsonString(entry)});`
    );
  }
};

const emitAuthSessions = (lines, sessions) => {
  for (const entry of Array.isArray(sessions) ? sessions : []) {
    lines.push(
      `INSERT INTO auth_sessions (id, token_hash, csrf_token_hash, user_id, user_email, remember, device_id, ip, created_date, last_active, expires_at, revoked_date, updated_date, payload_json) VALUES (${sqlString(
        entry.id
      )}, ${sqlString(entry.token_hash || "")}, ${sqlString(entry.csrf_token_hash || "")}, ${sqlString(
        entry.user_id || ""
      )}, ${sqlString(entry.user_email || "")}, ${boolInt(Boolean(entry.remember))}, ${sqlString(
        entry.device_id || ""
      )}, ${sqlString(entry.ip || "")}, ${sqlString(entry.created_date || "")}, ${sqlString(
        entry.last_active || ""
      )}, ${sqlString(entry.expires_at || "")}, ${sqlString(entry.revoked_date || "")}, ${sqlString(
        entry.updated_date || ""
      )}, ${jsonString(entry)});`
    );
  }
};

const emitPasswordResetTokens = (lines, entries) => {
  for (const entry of Array.isArray(entries) ? entries : []) {
    lines.push(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, created_date, expires_at, used_at, updated_date, payload_json) VALUES (${sqlString(
        entry.id
      )}, ${sqlString(entry.user_id || "")}, ${sqlString(entry.token_hash || "")}, ${sqlString(
        entry.created_date || ""
      )}, ${sqlString(entry.expires_at || "")}, ${sqlString(entry.used_at || "")}, ${sqlString(
        entry.updated_date || ""
      )}, ${jsonString(entry)});`
    );
  }
};

const emitLoginThrottle = (lines, entries) => {
  for (const entry of Array.isArray(entries) ? entries : []) {
    lines.push(
      `INSERT INTO login_throttle (id, email, device_id, ip, attempts, first_attempt_at, last_attempt_at, lock_until, updated_date, payload_json) VALUES (${sqlString(
        entry.id
      )}, ${sqlString(entry.email || "")}, ${sqlString(entry.device_id || "")}, ${sqlString(
        entry.ip || ""
      )}, ${Number(entry.attempts || 0)}, ${sqlString(entry.first_attempt_at || "")}, ${sqlString(
        entry.last_attempt_at || ""
      )}, ${sqlString(entry.lock_until || "")}, ${sqlString(entry.updated_date || "")}, ${jsonString(entry)});`
    );
  }
};

const emitDeviceSessions = (lines, entries) => {
  for (const entry of Array.isArray(entries) ? entries : []) {
    lines.push(
      `INSERT INTO device_sessions (id, user_email, device_id, last_active, device_info_json, payload_json) VALUES (${sqlString(
        entry.id
      )}, ${sqlString(entry.user_email || "")}, ${sqlString(entry.device_id || "")}, ${sqlString(
        entry.last_active || ""
      )}, ${jsonString(entry.device_info || {})}, ${jsonString(entry)});`
    );
  }
};

const emitEntities = (lines, entities) => {
  const entityMap = entities && typeof entities === "object" ? entities : {};
  for (const entityName of ENTITY_NAMES) {
    const records = Array.isArray(entityMap[entityName]) ? entityMap[entityName] : [];
    for (const record of records) {
      lines.push(
        `INSERT INTO entity_records (entity_name, record_id, created_by, created_by_email, created_date, updated_date, payload_json) VALUES (${sqlString(
          entityName
        )}, ${sqlString(record.id || "")}, ${sqlString(record.created_by || "")}, ${sqlString(
          record.created_by_email || ""
        )}, ${sqlString(record.created_date || "")}, ${sqlString(record.updated_date || "")}, ${jsonString(record)});`
      );
    }
  }
};

const main = async () => {
  const raw = await readFile(inputPath, "utf8");
  const state = JSON.parse(raw);
  const lines = [];

  lines.push("PRAGMA foreign_keys = OFF;");
  pushDeleteStatements(lines);
  emitMeta(lines, state);
  emitUsers(lines, state.users);
  emitAuthEvents(lines, state.auth_events);
  emitAuthSessions(lines, state.auth_sessions);
  emitPasswordResetTokens(lines, state.password_reset_tokens);
  emitLoginThrottle(lines, state.login_throttle);
  emitDeviceSessions(lines, state.device_sessions);
  emitEntities(lines, state.entities);
  lines.push("PRAGMA foreign_keys = ON;");
  lines.push("");

  await writeFile(outputPath, lines.join("\n"), "utf8");
  console.log(`[export-d1-seed] wrote ${outputPath}`);
};

main().catch((error) => {
  console.error("[export-d1-seed] failed:", error?.message || error);
  process.exit(1);
});



