const normalizeEmail = (email = "") => String(email || "").trim().toLowerCase();
const nowIso = () => new Date().toISOString();

const safeParseJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
};

export const writeAuthEvent = async (env, type, email, metadata = {}) => {
  if (!env?.DB) return null;
  const record = {
    id: crypto.randomUUID(),
    type: String(type || "event").trim() || "event",
    email: normalizeEmail(email || ""),
    created_date: nowIso(),
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
  };

  await env.DB.prepare(
    `
      INSERT INTO auth_events (
        id, email, type, created_date, metadata_json, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `
  )
    .bind(
      record.id,
      record.email,
      record.type,
      record.created_date,
      JSON.stringify(record.metadata),
      JSON.stringify(record)
    )
    .run();

  return record;
};

export const listAuthEvents = async (env, limit = 100) => {
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit || 100), 10) || 100, 1), 1000);
  const result = await env.DB.prepare(
    `
      SELECT payload_json FROM auth_events
      ORDER BY created_date DESC
      LIMIT ?1
    `
  )
    .bind(safeLimit)
    .all();

  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows
    .map((row) => safeParseJson(row?.payload_json, null))
    .filter((entry) => entry && typeof entry === "object");
};
