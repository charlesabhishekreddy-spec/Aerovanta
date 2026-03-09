const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const resolveApiBase = () => {
  const configured = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  if (configured) return configured;
  if (typeof window === "undefined") return "/api/v1";

  const hostname = String(window.location.hostname || "").toLowerCase();
  if (hostname === "aerovanta-web.pages.dev" || hostname.endsWith(".aerovanta-web.pages.dev")) {
    return "https://aerovanta-api.aerovata-charles.workers.dev/api/v1";
  }
  if (hostname === "aerovanta.com" || hostname === "www.aerovanta.com" || hostname.endsWith(".aerovanta.com")) {
    return "https://api.aerovanta.com/api/v1";
  }
  return "/api/v1";
};

const API_BASE = resolveApiBase();
const CSRF_COOKIE_NAME = String(import.meta.env.VITE_CSRF_COOKIE_NAME || "vv_csrf");
const CSRF_TOKEN_KEY = "aerovanta_csrf_token";
const LEGACY_CSRF_TOKEN_KEY = "verdent_csrf_token";
const DEVICE_KEY = "aerovanta_device_id";
const LEGACY_DEVICE_KEY = "verdent_device_id";
const REQUEST_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(String(import.meta.env.VITE_API_TIMEOUT_MS || ""), 10);
  if (!Number.isFinite(parsed)) return 20_000;
  return Math.min(Math.max(parsed, 3_000), 120_000);
})();

const memoryStore = new Map();
const getStorage = () => {
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return {
    getItem: (key) => memoryStore.get(key) ?? null,
    setItem: (key, value) => memoryStore.set(key, value),
    removeItem: (key) => memoryStore.delete(key),
  };
};

const storage = getStorage();

const getDeviceId = () => {
  let id = storage.getItem(DEVICE_KEY) || storage.getItem(LEGACY_DEVICE_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  storage.setItem(DEVICE_KEY, id);
  return id;
};

const getCookieValue = (name) => {
  if (typeof document === "undefined") return "";
  const key = `${name}=`;
  const part = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(key));
  if (!part) return "";
  return decodeURIComponent(part.slice(key.length));
};

const readJsonSafe = async (response) => {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const getStoredCsrfToken = () => {
  const token = storage.getItem(CSRF_TOKEN_KEY) || storage.getItem(LEGACY_CSRF_TOKEN_KEY) || "";
  if (token && !storage.getItem(CSRF_TOKEN_KEY)) {
    storage.setItem(CSRF_TOKEN_KEY, token);
  }
  return token;
};

const setStoredCsrfToken = (token) => {
  const normalized = String(token || "").trim();
  if (!normalized) {
    storage.removeItem(CSRF_TOKEN_KEY);
    storage.removeItem(LEGACY_CSRF_TOKEN_KEY);
    return;
  }
  storage.setItem(CSRF_TOKEN_KEY, normalized);
};

const syncCsrfTokenFromResponse = (response) => {
  const responseToken = response?.headers?.get?.("x-csrf-token");
  if (responseToken == null) return;
  setStoredCsrfToken(responseToken);
};

const isMutatingMethod = (method) => !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });

const request = async (path, { method = "GET", body, useCsrf = true, signal } = {}) => {
  const headers = {
    Accept: "application/json",
    "X-Device-Id": getDeviceId(),
  };

  const upperMethod = String(method || "GET").toUpperCase();
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (useCsrf && isMutatingMethod(upperMethod)) {
    const csrfToken = getCookieValue(CSRF_COOKIE_NAME) || getStoredCsrfToken();
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  let response;
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  if (signal?.aborted) {
    clearTimeout(timeoutHandle);
    throw new Error("Request was cancelled.");
  }
  const abortFromExternalSignal = () => timeoutController.abort();
  signal?.addEventListener?.("abort", abortFromExternalSignal, { once: true });
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: upperMethod,
      credentials: "include",
      headers,
      signal: timeoutController.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`);
    }
    throw new Error("Unable to connect to API server.");
  } finally {
    clearTimeout(timeoutHandle);
    signal?.removeEventListener?.("abort", abortFromExternalSignal);
  }

  syncCsrfTokenFromResponse(response);
  const payload = await readJsonSafe(response);
  if (!response.ok) {
    const apiMessage = payload?.error?.message || payload?.message || `Request failed with status ${response.status}.`;
    const apiCode = payload?.error?.code;
    throw new Error(apiCode ? `${apiMessage} (${apiCode})` : apiMessage);
  }

  if (!payload) return null;
  return Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
};

const entityApi = (entityName) => ({
  async list(sort = "", limit) {
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/entities/${encodeURIComponent(entityName)}${suffix}`);
  },

  async filter(filters = {}, sort = "", limit) {
    const params = new URLSearchParams();
    params.set("filters", JSON.stringify(filters || {}));
    if (sort) params.set("sort", sort);
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    return request(`/entities/${encodeURIComponent(entityName)}?${params.toString()}`);
  },

  async create(data = {}) {
    return request(`/entities/${encodeURIComponent(entityName)}`, {
      method: "POST",
      body: data,
    });
  },

  async update(id, data = {}) {
    return request(`/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: data,
    });
  },

  async delete(id) {
    return request(`/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
});

const entities = new Proxy(
  {},
  {
    get: (_target, entityName) => entityApi(String(entityName)),
  }
);

export const appClient = {
  entities,

  integrations: {
    Core: {
      async InvokeLLM(payload = {}) {
        return request("/integrations/core/invoke-llm", {
          method: "POST",
          body: payload,
        });
      },

      async UploadFile({ file } = {}) {
        if (!file) throw new Error("No file provided.");
        const contentBase64 = await toBase64(file);
        return request("/integrations/core/upload-file", {
          method: "POST",
          body: {
            file_name: file.name || "upload",
            file_type: file.type || "application/octet-stream",
            content_base64: contentBase64,
          },
        });
      },
    },
  },

  enterprise: {
    async listSessions(email) {
      const params = new URLSearchParams();
      if (email) params.set("email", email);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return request(`/enterprise/sessions${suffix}`);
    },

    async logoutOtherDevices(email) {
      return request("/enterprise/sessions/logout-others", {
        method: "POST",
        body: { email },
      });
    },
  },

  auth: {
    async me() {
      return request("/auth/me");
    },

    async signInWithSocial(payload = {}) {
      return request("/auth/social", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async signInWithEmail(payload = {}) {
      return request("/auth/login/email", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async registerWithEmail(payload = {}) {
      return request("/auth/register/email", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async requestPasswordReset(payload = {}) {
      return request("/auth/password-reset/request", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async validateResetToken(token) {
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return request(`/auth/password-reset/validate${suffix}`, {
        useCsrf: false,
      });
    },

    async resetPassword(payload = {}) {
      return request("/auth/password-reset/complete", {
        method: "POST",
        body: payload,
        useCsrf: false,
      });
    },

    async updateMe(updateData = {}) {
      return request("/auth/me", {
        method: "PATCH",
        body: updateData,
      });
    },

    async changePassword(payload = {}) {
      return request("/auth/change-password", {
        method: "POST",
        body: payload,
      });
    },

    async logout(redirectTo) {
      await request("/auth/logout", {
        method: "POST",
      });
      setStoredCsrfToken("");
      if (redirectTo) window.location.href = redirectTo;
    },

    redirectToLogin(redirectTo) {
      const next = encodeURIComponent(redirectTo || window.location.href);
      window.location.href = `/login?next=${next}`;
    },
  },

  users: {
    async listUsers(limit = 200) {
      return request(`/users?limit=${encodeURIComponent(String(limit))}`);
    },

    async updateUser(userId, updates = {}) {
      return request(`/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: updates,
      });
    },

    async inviteUser(email) {
      return request("/users/invite", {
        method: "POST",
        body: { email },
      });
    },
  },

  security: {
    async listAuthEvents(limit = 100) {
      return request(`/security/auth-events?limit=${encodeURIComponent(String(limit))}`);
    },
  },

  ai: {
    async getFarmAdvice(payload = {}) {
      const body =
        typeof payload === "string"
          ? { prompt: payload }
          : payload && typeof payload === "object"
            ? payload
            : { prompt: "" };
      return request("/ai/farm-advice", {
        method: "POST",
        body,
      });
    },

    async diagnosePlant(fileUrl) {
      return request("/ai/diagnose-plant", {
        method: "POST",
        body: { file_url: fileUrl },
      });
    },
  },
};


