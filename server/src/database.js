import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeEmail, nowIso } from "./security.js";

export const ENTITY_NAMES = [
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

const clone = (value) => {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const createSeedState = (adminEmail) => {
  const now = nowIso();
  const entities = Object.fromEntries(ENTITY_NAMES.map((name) => [name, []]));
  entities.PlantDatabase = [
    {
      id: "p1",
      common_name: "Tomato",
      scientific_name: "Solanum lycopersicum",
      common_diseases: ["Early Blight", "Late Blight"],
      common_pests: ["Aphids"],
      created_date: now,
    },
    {
      id: "p2",
      common_name: "Potato",
      scientific_name: "Solanum tuberosum",
      common_diseases: ["Scab"],
      common_pests: ["Colorado Beetle"],
      created_date: now,
    },
  ];

  return {
    meta: {
      version: 1,
      created_date: now,
      updated_date: now,
    },
    users: [
      {
        id: "u-admin",
        full_name: "Platform Admin",
        email: adminEmail,
        role: "admin",
        provider: "system",
        account_status: "active",
        email_verified: true,
        created_date: now,
      },
    ],
    auth_events: [],
    auth_sessions: [],
    password_reset_tokens: [],
    login_throttle: [],
    device_sessions: [],
    entities,
  };
};

const migrateLegacyRootEntities = (state, next) => {
  ENTITY_NAMES.forEach((entityName) => {
    if (Array.isArray(state?.[entityName]) && next.entities[entityName].length === 0) {
      next.entities[entityName] = state[entityName];
    }
  });
};

const ensureStateShape = (rawState, adminEmail) => {
  const seed = createSeedState(adminEmail);
  const state = rawState && typeof rawState === "object" ? rawState : {};

  const next = {
    meta: {
      ...seed.meta,
      ...(state.meta || {}),
    },
    users: Array.isArray(state.users) ? state.users : Array.isArray(state.User) ? state.User : seed.users,
    auth_events: Array.isArray(state.auth_events)
      ? state.auth_events
      : Array.isArray(state.AuthEvent)
        ? state.AuthEvent
        : [],
    auth_sessions: Array.isArray(state.auth_sessions)
      ? state.auth_sessions
      : Array.isArray(state.AuthSession)
        ? state.AuthSession
        : [],
    password_reset_tokens: Array.isArray(state.password_reset_tokens)
      ? state.password_reset_tokens
      : Array.isArray(state.PasswordResetToken)
        ? state.PasswordResetToken
        : [],
    login_throttle: Array.isArray(state.login_throttle)
      ? state.login_throttle
      : Array.isArray(state.LoginThrottle)
        ? state.LoginThrottle
        : [],
    device_sessions: Array.isArray(state.device_sessions)
      ? state.device_sessions
      : Array.isArray(state.DeviceSessions)
        ? state.DeviceSessions
        : [],
    entities: state.entities && typeof state.entities === "object" ? state.entities : {},
  };

  ENTITY_NAMES.forEach((entityName) => {
    if (!Array.isArray(next.entities[entityName])) {
      next.entities[entityName] = [];
    }
  });

  migrateLegacyRootEntities(state, next);

  const normalizedAdmin = normalizeEmail(adminEmail);
  const hasAdmin = next.users.some((user) => normalizeEmail(user?.email || "") === normalizedAdmin);
  if (!hasAdmin) {
    next.users.unshift(seed.users[0]);
  }

  next.users = next.users.map((user) => {
    const normalizedEmail = normalizeEmail(user?.email || "");
    const role = normalizedEmail === normalizedAdmin ? "admin" : user?.role || "user";
    return {
      account_status: "active",
      email_verified: true,
      ...user,
      email: normalizedEmail,
      role,
    };
  });

  return next;
};

async function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}

export class JsonDatabase {
  constructor(filePath, adminEmail) {
    this.filePath = filePath;
    this.adminEmail = adminEmail;
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = ensureStateShape(parsed, this.adminEmail);
    } catch {
      this.state = createSeedState(this.adminEmail);
      await writeAtomic(this.filePath, JSON.stringify(this.state, null, 2));
      return;
    }

    await writeAtomic(this.filePath, JSON.stringify(this.state, null, 2));
  }

  read() {
    return clone(this.state);
  }

  async transact(mutator) {
    // Recover from prior queue failures so one rejected transaction does not
    // permanently break all future writes/auth flows.
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const draft = clone(this.state);
        const result = await mutator(draft);
        draft.meta = {
          ...(draft.meta || {}),
          updated_date: nowIso(),
        };
        this.state = draft;
        await writeAtomic(this.filePath, JSON.stringify(draft, null, 2));
        return result;
      });
    return this.writeQueue;
  }
}
