import { appParams } from '@/lib/app-params';

const memoryStore = new Map();

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  return {
    getItem: (key) => memoryStore.get(key) ?? null,
    setItem: (key, value) => memoryStore.set(key, value),
    removeItem: (key) => memoryStore.delete(key)
  };
};

const storage = getStorage();
const APP_KEY_PREFIX = `aerovanta_${appParams.appId || 'local'}`;
const LEGACY_APP_KEY_PREFIX = `verdent_vision_${appParams.appId || 'local'}`;
const getKey = (entityName) => `${APP_KEY_PREFIX}_${entityName}`;
const getLegacyKey = (entityName) => `${LEGACY_APP_KEY_PREFIX}_${entityName}`;
const USER_KEY = `${APP_KEY_PREFIX}_current_user`;
const LEGACY_USER_KEY = `${LEGACY_APP_KEY_PREFIX}_current_user`;

const nowIso = () => new Date().toISOString();
const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const readCollection = (entityName) => {
  const key = getKey(entityName);
  const raw = storage.getItem(key) ?? storage.getItem(getLegacyKey(entityName));
  if (!raw) return [];

  if (!storage.getItem(key)) {
    storage.setItem(key, raw);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeCollection = (entityName, records) => {
  storage.setItem(getKey(entityName), JSON.stringify(records));
};

const sortRecords = (records, sort = '') => {
  if (!sort) return records;
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  return [...records].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av > bv) return isDesc ? -1 : 1;
    return isDesc ? 1 : -1;
  });
};

const applyLimit = (records, limit) => {
  if (!Number.isFinite(limit) || limit <= 0) {
    return records;
  }
  return records.slice(0, limit);
};

const matchesFilterValue = (recordValue, expectedValue) => {
  if (Array.isArray(recordValue)) {
    if (Array.isArray(expectedValue)) {
      return expectedValue.every((item) => recordValue.includes(item));
    }
    return recordValue.includes(expectedValue);
  }

  if (Array.isArray(expectedValue)) {
    return expectedValue.includes(recordValue);
  }

  return recordValue === expectedValue;
};

const getCurrentUser = () => {
  const saved = storage.getItem(USER_KEY) ?? storage.getItem(LEGACY_USER_KEY);
  if (saved) {
    if (!storage.getItem(USER_KEY)) {
      storage.setItem(USER_KEY, saved);
    }
    return JSON.parse(saved);
  }

  const fallbackUser = {
    id: 'local-user',
    full_name: 'Local Farmer',
    email: 'local@example.com',
    role: 'user',
    location: 'Demo Farm Region',
    primary_crops: ['Tomatoes', 'Corn']
  };

  storage.setItem(USER_KEY, JSON.stringify(fallbackUser));
  return fallbackUser;
};

const createEntityApi = (entityName) => ({
  async list(sort = '', limit) {
    return applyLimit(sortRecords(readCollection(entityName), sort), limit);
  },

  async filter(filters = {}, sort = '', limit) {
    const filtered = readCollection(entityName).filter((item) =>
      Object.entries(filters).every(([key, value]) => matchesFilterValue(item?.[key], value))
    );
    return applyLimit(sortRecords(filtered, sort), limit);
  },

  async create(data = {}) {
    const user = getCurrentUser();
    const timestamp = nowIso();
    const record = {
      id: createId(),
      created_date: timestamp,
      updated_date: timestamp,
      created_by: user.id,
      ...data
    };

    const current = readCollection(entityName);
    writeCollection(entityName, [record, ...current]);
    return record;
  },

  async update(id, data = {}) {
    const current = readCollection(entityName);
    let updated = null;
    const next = current.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...data, updated_date: nowIso() };
      return updated;
    });

    writeCollection(entityName, next);
    return updated;
  },

  async delete(id) {
    const current = readCollection(entityName);
    const next = current.filter((item) => item.id !== id);
    writeCollection(entityName, next);
    return { success: true, id };
  }
});

const pickEnum = (schema) => {
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  return undefined;
};

const generateFromSchema = (schema, key = '') => {
  const enumValue = pickEnum(schema);
  if (enumValue !== undefined) return enumValue;

  if (schema?.type === 'object') {
    return Object.fromEntries(
      Object.entries(schema.properties || {}).map(([prop, child]) => [prop, generateFromSchema(child, prop)])
    );
  }

  if (schema?.type === 'array') {
    return [generateFromSchema(schema.items || { type: 'string' }, key)];
  }

  if (schema?.type === 'number' || schema?.type === 'integer') {
    if (key.toLowerCase().includes('temperature')) return 72;
    if (key.toLowerCase().includes('humidity')) return 55;
    if (key.toLowerCase().includes('week')) return 1;
    return 1;
  }

  if (schema?.type === 'boolean') {
    return false;
  }

  if (key.toLowerCase().includes('date')) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${key || 'value'}_sample`;
};

const buildLlmResponse = ({ prompt = '', response_json_schema }) => {
  if (response_json_schema) {
    return generateFromSchema(response_json_schema);
  }

  const normalizedPrompt = String(prompt).toLowerCase();
  if (normalizedPrompt.includes('weather')) {
    return 'Current conditions look moderate with light winds. Recommend early-morning irrigation and pest scouting before sunset.';
  }

  return 'Here is a practical recommendation: monitor soil moisture daily, inspect leaves for pests every 2-3 days, and apply balanced nutrients based on crop stage.';
};

const entities = new Proxy(
  {},
  {
    get: (_, entityName) => createEntityApi(entityName)
  }
);

export const base44 = {
  auth: {
    async me() {
      return getCurrentUser();
    },
    async updateMe(updateData = {}) {
      const currentUser = getCurrentUser();
      const nextUser = { ...currentUser, ...updateData, updated_date: nowIso() };
      storage.setItem(USER_KEY, JSON.stringify(nextUser));
      return nextUser;
    },
    logout(redirectUrl) {
      storage.removeItem(USER_KEY);
      if (redirectUrl && typeof window !== 'undefined') {
        window.location.href = redirectUrl;
      }
    },
    redirectToLogin(redirectUrl) {
      if (typeof window !== 'undefined') {
        window.location.href = redirectUrl || '/';
      }
    }
  },

  entities,

  integrations: {
    Core: {
      async UploadFile({ file }) {
        const fileName = typeof file === 'object' && file?.name ? file.name : 'uploaded-file';
        if (typeof window !== 'undefined' && typeof file === 'object' && file) {
          return { file_url: URL.createObjectURL(file), file_name: fileName };
        }

        return { file_url: `local://uploads/${fileName}`, file_name: fileName };
      },
      async InvokeLLM(payload = {}) {
        return buildLlmResponse(payload);
      }
    }
  },

  appLogs: {
    async logUserInApp(pageName) {
      return { success: true, page: pageName, at: nowIso() };
    }
  }
};
