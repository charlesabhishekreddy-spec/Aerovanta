import { normalizeEmail } from "./auth.js";

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
const FORUM_CATEGORY_VALUES = new Set([
  "pest_control",
  "disease_management",
  "organic_farming",
  "irrigation",
  "soil_health",
  "crop_rotation",
  "fertilizers",
  "seeds",
  "equipment",
  "general",
]);

const nowIso = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();
const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const createHttpError = (status, message, code = "request_failed") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const safeParseJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
};

const sanitizeTextValue = (value, maxLength = 3000) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, Math.max(0, maxLength));

const parseNonNegativeInt = (value, fallback = 0, max = 1_000_000) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
};

const normalizeForumCategory = (value) => {
  const normalized = sanitizeTextValue(value, 40).toLowerCase().replace(/[^a-z0-9_]/g, "");
  return FORUM_CATEGORY_VALUES.has(normalized) ? normalized : "general";
};

const normalizeForumTags = (value) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  const tags = [];
  value.forEach((entry) => {
    const tag = sanitizeTextValue(entry, 24).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!tag || unique.has(tag)) return;
    unique.add(tag);
    tags.push(tag);
  });
  return tags.slice(0, 8);
};

const normalizeForumImages = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeTextValue(entry, 2_000))
    .filter((url) => /^(data:image\/|https?:\/\/|\/uploads\/)/i.test(url))
    .slice(0, 4);
};

const sanitizeEntityPayload = (entityName, payload, { isUpdate = false } = {}) => {
  const raw = isObject(payload) ? payload : {};
  if (entityName !== "ForumPost" && entityName !== "ForumComment") return raw;

  const next = {};

  if (entityName === "ForumPost") {
    if (!isUpdate || hasOwn(raw, "title")) {
      const title = sanitizeTextValue(raw.title, 180);
      if (!title) throw createHttpError(400, "Post title is required.", "invalid_post_title");
      next.title = title;
    }
    if (!isUpdate || hasOwn(raw, "content")) {
      const content = sanitizeTextValue(raw.content, 8_000);
      if (!content) throw createHttpError(400, "Post content is required.", "invalid_post_content");
      next.content = content;
    }
    if (!isUpdate || hasOwn(raw, "category")) next.category = normalizeForumCategory(raw.category);
    if (!isUpdate || hasOwn(raw, "author_name")) {
      next.author_name = sanitizeTextValue(raw.author_name, 80) || "Anonymous Farmer";
    }
    if (!isUpdate || hasOwn(raw, "tags")) next.tags = normalizeForumTags(raw.tags);
    if (!isUpdate || hasOwn(raw, "images")) next.images = normalizeForumImages(raw.images);
    if (!isUpdate || hasOwn(raw, "likes_count")) next.likes_count = parseNonNegativeInt(raw.likes_count, 0);
    if (!isUpdate || hasOwn(raw, "comments_count")) next.comments_count = parseNonNegativeInt(raw.comments_count, 0);
    if (!isUpdate || hasOwn(raw, "is_solved")) next.is_solved = Boolean(raw.is_solved);
    if (!isUpdate || hasOwn(raw, "solved_date")) {
      next.solved_date = raw.solved_date ? sanitizeTextValue(raw.solved_date, 40) : null;
    }
    return next;
  }

  if (!isUpdate || hasOwn(raw, "post_id")) {
    const postId = sanitizeTextValue(raw.post_id, 120);
    if (!postId) throw createHttpError(400, "post_id is required.", "invalid_post_id");
    next.post_id = postId;
  }
  if (!isUpdate || hasOwn(raw, "content")) {
    const content = sanitizeTextValue(raw.content, 2_000);
    if (!content) throw createHttpError(400, "Comment content is required.", "invalid_comment_content");
    next.content = content;
  }
  if (!isUpdate || hasOwn(raw, "author_name")) {
    next.author_name = sanitizeTextValue(raw.author_name, 80) || "Community Member";
  }
  return next;
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
    if (Array.isArray(expectedValue)) return expectedValue.every((value) => recordValue.includes(value));
    return recordValue.includes(expectedValue);
  }
  if (Array.isArray(expectedValue)) return expectedValue.includes(recordValue);
  return recordValue === expectedValue;
};

const applyFilters = (items, filters) => {
  if (!isObject(filters) || Object.keys(filters).length === 0) return [...items];
  return items.filter((item) =>
    Object.entries(filters).every(([key, expected]) => matchesFilterValue(item?.[key], expected))
  );
};

const sanitizeForUserList = (user) => ({
  id: user.id,
  full_name: user.full_name || "User",
  email: user.email,
  role: user.role || "user",
  account_status: user.account_status || "active",
  avatar_url: user.avatar_url || "",
});

const isOwnedByUser = (record, user) => {
  const ownerId = String(record?.created_by || "");
  const ownerEmail = normalizeEmail(record?.created_by_email || "");
  return ownerId === user.id || ownerEmail === normalizeEmail(user.email || "");
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

const assertEntityName = (entityName) => {
  if (entityName === "User") return;
  if (!ENTITY_NAMES.includes(entityName)) {
    throw createHttpError(404, "Entity not found.", "entity_not_found");
  }
};

const listEntityRows = async (env, entityName) => {
  const result = await env.DB.prepare(
    "SELECT record_id, payload_json FROM entity_records WHERE entity_name = ?1"
  )
    .bind(entityName)
    .all();
  return Array.isArray(result?.results) ? result.results : [];
};

const parseEntityRow = (row) => {
  const payload = safeParseJson(row?.payload_json, null);
  if (!payload || typeof payload !== "object") return null;
  if (!payload.id && row?.record_id) payload.id = row.record_id;
  return payload;
};

const listEntityRecords = async (env, entityName) => {
  const rows = await listEntityRows(env, entityName);
  return rows.map(parseEntityRow).filter(Boolean);
};

const getEntityRecord = async (env, entityName, id) => {
  const row = await env.DB.prepare(
    "SELECT record_id, payload_json FROM entity_records WHERE entity_name = ?1 AND record_id = ?2 LIMIT 1"
  )
    .bind(entityName, id)
    .first();
  return parseEntityRow(row);
};

const upsertEntityRecord = async (env, entityName, record) => {
  const payload = { ...record, id: record.id };
  await env.DB.prepare(
    `
      INSERT OR REPLACE INTO entity_records (
        entity_name, record_id, created_by, created_by_email, created_date, updated_date, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `
  )
    .bind(
      entityName,
      payload.id,
      payload.created_by || "",
      normalizeEmail(payload.created_by_email || ""),
      payload.created_date || "",
      payload.updated_date || "",
      JSON.stringify(payload)
    )
    .run();
  return payload;
};

const removeEntityRecord = async (env, entityName, id) => {
  await env.DB.prepare("DELETE FROM entity_records WHERE entity_name = ?1 AND record_id = ?2")
    .bind(entityName, id)
    .run();
};

const listUsers = async (env) => {
  const result = await env.DB.prepare("SELECT payload_json FROM users").all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows
    .map((row) => safeParseJson(row?.payload_json, null))
    .filter((entry) => entry && typeof entry === "object")
    .map(sanitizeForUserList);
};

const getEntityRecordsForRead = async (env, entityName, user) => {
  if (entityName === "User") {
    const users = sortItems(await listUsers(env), "-created_date");
    if (user.role === "admin") return users;
    return users.filter((entry) => entry.account_status !== "suspended");
  }

  const records = await listEntityRecords(env, entityName);
  if (user.role === "admin") return records;
  if (OWNER_SCOPED_ENTITIES.has(entityName)) {
    return records.filter((record) => isOwnedByUser(record, user));
  }
  return records;
};

const recountForumComments = async (env, postId) => {
  const comments = await listEntityRecords(env, "ForumComment");
  const totalComments = comments.filter((entry) => String(entry?.post_id || "") === String(postId || "")).length;
  const post = await getEntityRecord(env, "ForumPost", postId);
  if (!post) return;
  await upsertEntityRecord(env, "ForumPost", {
    ...post,
    comments_count: totalComments,
    updated_date: nowIso(),
  });
};

export const handleEntityRequest = async ({ env, url, method, entityName, recordId = "", user, body = null }) => {
  assertEntityName(entityName);

  if (method === "GET" && !recordId) {
    const sortBy = String(url.searchParams.get("sort") || "");
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(Number.parseInt(limitRaw, 10) || 200, 1), 1000) : null;
    const filters = safeParseJson(url.searchParams.get("filters"), {});
    const records = await getEntityRecordsForRead(env, entityName, user);
    const filtered = applyFilters(records, filters);
    const sorted = sortItems(filtered, sortBy);
    return {
      status: 200,
      data: limit ? sorted.slice(0, limit) : sorted,
    };
  }

  if (method === "POST" && !recordId) {
    if (!canCreateEntity(entityName, user)) {
      throw createHttpError(403, "Access denied.", "forbidden");
    }
    if (entityName === "User") {
      throw createHttpError(403, "Use dedicated user management endpoints.", "forbidden");
    }

    const payload = sanitizeEntityPayload(entityName, body, { isUpdate: false });
    if (entityName === "ForumComment") {
      const parentPost = await getEntityRecord(env, "ForumPost", String(payload.post_id || ""));
      if (!parentPost) throw createHttpError(400, "Referenced post does not exist.", "invalid_post_id");
    }

    const createdAt = nowIso();
    const record = {
      ...payload,
      id: makeId(),
      created_date: createdAt,
      updated_date: createdAt,
      created_by: user.id,
      created_by_email: normalizeEmail(user.email || ""),
    };
    await upsertEntityRecord(env, entityName, record);

    if (entityName === "ForumComment") {
      await recountForumComments(env, record.post_id);
    }

    return { status: 201, data: record };
  }

  if (!recordId) {
    throw createHttpError(405, "Method not allowed.", "method_not_allowed");
  }

  if (entityName === "User") {
    throw createHttpError(403, "Use dedicated user management endpoints.", "forbidden");
  }

  const existing = await getEntityRecord(env, entityName, recordId);
  if (!existing) throw createHttpError(404, "Record not found.", "record_not_found");
  if (!canMutateEntityRecord(entityName, existing, user)) {
    throw createHttpError(403, "Access denied.", "forbidden");
  }

  if (method === "PATCH") {
    const updates = sanitizeEntityPayload(entityName, body, { isUpdate: true });
    if (entityName === "ForumComment" && hasOwn(updates, "post_id")) {
      if (String(existing.post_id || "") !== String(updates.post_id || "")) {
        throw createHttpError(400, "Comment post_id cannot be changed.", "invalid_update");
      }
    }

    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      created_by: existing.created_by,
      created_by_email: existing.created_by_email,
      created_date: existing.created_date,
      updated_date: nowIso(),
      updated_by: user.id,
    };
    await upsertEntityRecord(env, entityName, updated);
    return { status: 200, data: updated };
  }

  if (method === "DELETE") {
    await removeEntityRecord(env, entityName, recordId);
    if (entityName === "ForumPost") {
      const comments = await listEntityRecords(env, "ForumComment");
      await Promise.all(
        comments
          .filter((comment) => String(comment?.post_id || "") === String(recordId))
          .map((comment) => removeEntityRecord(env, "ForumComment", String(comment.id || "")))
      );
    }
    if (entityName === "ForumComment") {
      await recountForumComments(env, existing.post_id);
    }
    return { status: 200, data: true };
  }

  throw createHttpError(405, "Method not allowed.", "method_not_allowed");
};
