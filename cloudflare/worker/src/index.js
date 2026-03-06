import { getDatabaseHealth } from "./db.js";
import {
  getAuthContext,
  logout,
  registerWithEmail,
  requireCsrf,
  sanitizeUser,
  signInWithEmail,
} from "./auth.js";
import { handleEntityRequest } from "./entities.js";
import { invokeLlm, uploadTransientFile } from "./llm.js";

const mergeHeaders = (headers = {}) => {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json; charset=utf-8");
  merged.set("cache-control", "no-store");
  return merged;
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: mergeHeaders(headers),
  });

const errorJson = (code, message, status = 400, headers = {}) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: mergeHeaders(headers),
  });

const normalizeOrigin = (value = "") => String(value || "").trim().replace(/\/+$/, "");

const parseAllowedOrigins = (value = "") =>
  String(value || "")
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

const originMatchesPattern = (origin, pattern) => {
  if (!origin || !pattern) return false;
  if (origin === pattern) return true;

  const wildcardMatch = String(pattern).match(/^(https?):\/\/\*\.(.+)$/i);
  if (!wildcardMatch) return false;

  try {
    const originUrl = new URL(origin);
    const expectedProtocol = `${wildcardMatch[1].toLowerCase()}:`;
    const expectedHostSuffix = wildcardMatch[2].toLowerCase();
    const originHost = String(originUrl.hostname || "").toLowerCase();
    return originUrl.protocol === expectedProtocol && originHost.endsWith(`.${expectedHostSuffix}`);
  } catch {
    return false;
  }
};

const withSecurityHeaders = (headers, isSecureRequest) => {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-dns-prefetch-control", "off");
  headers.set("x-permitted-cross-domain-policies", "none");
  headers.set("origin-agent-cluster", "?1");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(self)");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; connect-src 'self'; img-src 'self' data:;"
  );
  if (isSecureRequest) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return headers;
};

const applyCors = (request, env, headers) => {
  const origin = normalizeOrigin(request.headers.get("origin") || "");
  if (!origin) return { allowed: true, headers };

  const allowedOrigins = parseAllowedOrigins(env.CORS_ORIGINS || "");
  if (!allowedOrigins.some((pattern) => originMatchesPattern(origin, pattern))) {
    return { allowed: false, headers };
  }

  headers.set("vary", "Origin");
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, X-CSRF-Token, X-Device-Id, X-Request-Id");
  return { allowed: true, headers };
};

const readJsonBody = async (request) => {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { ok: false, code: "unsupported_media_type", message: "Content-Type must be application/json.", status: 415 };
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, code: "invalid_body", message: "JSON request body must be an object.", status: 400 };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, code: "invalid_json", message: "Invalid JSON payload.", status: 400 };
  }
};

const requireAuth = async (request, env, headers) => {
  const context = await getAuthContext(request, env);
  if (!context) {
    return { ok: false, response: errorJson("auth_required", "Authentication required.", 401, headers) };
  }
  return { ok: true, context };
};

const requireMutationAuth = async (request, env, headers) => {
  const auth = await requireAuth(request, env, headers);
  if (!auth.ok) return auth;
  const csrf = await requireCsrf(request, auth.context);
  if (!csrf.ok) {
    return { ok: false, response: errorJson(csrf.code, csrf.message, 403, headers) };
  }
  return auth;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const prefix = String(env.API_PREFIX || "/api/v1").replace(/\/+$/, "");
    const requestId = crypto.randomUUID();
    const isSecureRequest = url.protocol === "https:";

    const headers = withSecurityHeaders(new Headers(), isSecureRequest);
    headers.set("x-request-id", requestId);

    const cors = applyCors(request, env, headers);
    if (!cors.allowed) {
      return errorJson("origin_forbidden", "Origin not allowed.", 403, cors.headers);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors.headers });
    }

    if (String(env.FORCE_HTTPS || "true").toLowerCase() === "true" && !isSecureRequest) {
      return errorJson("https_required", "HTTPS is required.", 426, cors.headers);
    }

    try {
      if (url.pathname === "/healthz" || url.pathname === `${prefix}/healthz`) {
        return json(
          {
            status: "ok",
            environment: "production",
            timestamp: new Date().toISOString(),
          },
          200,
          cors.headers
        );
      }

      if (url.pathname === "/readyz" || url.pathname === `${prefix}/readyz`) {
        const databaseHealth = await getDatabaseHealth(env);
        const checks = {
          d1: !databaseHealth.configured ? "missing" : databaseHealth.schemaReady ? "ready" : "schema_missing",
          uploads: "transient_not_persisted",
        };
        const ready = checks.d1 === "ready";
        return json(
          {
            status: ready ? "ready" : "degraded",
            checks,
            details: {
              d1: databaseHealth,
            },
            timestamp: new Date().toISOString(),
          },
          ready ? 200 : 503,
          cors.headers
        );
      }

      if (url.pathname === "/" || url.pathname === prefix) {
        return json(
          {
            service: "aerovanta-api-edge",
            status: "ok",
            timestamp: new Date().toISOString(),
          },
          200,
          cors.headers
        );
      }

      if (url.pathname === `${prefix}/auth/me` && request.method === "GET") {
        const auth = await requireAuth(request, env, cors.headers);
        if (!auth.ok) return auth.response;
        return json(sanitizeUser(auth.context.user), 200, cors.headers);
      }

      if (url.pathname === `${prefix}/auth/login/email` && request.method === "POST") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) return errorJson(parsed.code, parsed.message, parsed.status, cors.headers);
        const result = await signInWithEmail(request, env, parsed.body);
        if (!result.ok) return errorJson(result.code, result.message, result.status, cors.headers);
        const responseHeaders = new Headers(cors.headers);
        result.headers?.forEach((value, key) => responseHeaders.append(key, value));
        return json(result.user, result.status, responseHeaders);
      }

      if (url.pathname === `${prefix}/auth/register/email` && request.method === "POST") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) return errorJson(parsed.code, parsed.message, parsed.status, cors.headers);
        const result = await registerWithEmail(request, env, parsed.body);
        if (!result.ok) return errorJson(result.code, result.message, result.status, cors.headers);
        const responseHeaders = new Headers(cors.headers);
        result.headers?.forEach((value, key) => responseHeaders.append(key, value));
        return json(result.user, result.status, responseHeaders);
      }

      if (url.pathname === `${prefix}/auth/logout` && request.method === "POST") {
        const result = await logout(request, env);
        const responseHeaders = new Headers(cors.headers);
        result.headers?.forEach((value, key) => responseHeaders.append(key, value));
        if (!result.ok) {
          return errorJson(result.code, result.message, result.status, responseHeaders);
        }
        return json(result.data, result.status, responseHeaders);
      }

      if (url.pathname === `${prefix}/auth/social` && request.method === "POST") {
        return errorJson(
          "not_implemented",
          "Social login is not migrated to the Cloudflare worker yet. Use email login/register first.",
          501,
          cors.headers
        );
      }

      if (url.pathname === `${prefix}/integrations/core/invoke-llm` && request.method === "POST") {
        const auth = await requireMutationAuth(request, env, cors.headers);
        if (!auth.ok) return auth.response;
        const parsed = await readJsonBody(request);
        if (!parsed.ok) return errorJson(parsed.code, parsed.message, parsed.status, cors.headers);
        const result = await invokeLlm(parsed.body, env);
        return json(result, 200, cors.headers);
      }

      if (url.pathname === `${prefix}/integrations/core/upload-file` && request.method === "POST") {
        const auth = await requireMutationAuth(request, env, cors.headers);
        if (!auth.ok) return auth.response;
        const parsed = await readJsonBody(request);
        if (!parsed.ok) return errorJson(parsed.code, parsed.message, parsed.status, cors.headers);
        const result = uploadTransientFile(parsed.body);
        return json(result, 201, cors.headers);
      }

      if (url.pathname.startsWith(`${prefix}/entities/`)) {
        const auth = request.method === "GET"
          ? await requireAuth(request, env, cors.headers)
          : await requireMutationAuth(request, env, cors.headers);
        if (!auth.ok) return auth.response;

        const suffix = url.pathname.slice(`${prefix}/entities/`.length);
        const segments = suffix.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
        const entityName = segments[0] || "";
        const recordId = segments[1] || "";
        const parsed = request.method === "POST" || request.method === "PATCH" ? await readJsonBody(request) : null;
        if (parsed && !parsed.ok) return errorJson(parsed.code, parsed.message, parsed.status, cors.headers);
        const result = await handleEntityRequest({
          env,
          url,
          method: request.method,
          entityName,
          recordId,
          user: auth.context.user,
          body: parsed?.body || null,
        });
        return json(result.data, result.status, cors.headers);
      }

      if (url.pathname === `${prefix}/ai/diagnose-plant` && request.method === "POST") {
        return errorJson(
          "not_implemented",
          "AI plant diagnosis is not migrated to the Cloudflare worker yet.",
          501,
          cors.headers
        );
      }

      return errorJson(
        "not_implemented",
        "Edge worker scaffold is ready. Migrate remaining Node API routes to Worker handlers next.",
        501,
        cors.headers
      );
    } catch (error) {
      console.error("[worker] request failed", {
        method: request.method,
        path: url.pathname,
        code: String(error?.code || "internal_error"),
        status: Number.isFinite(error?.status) ? error.status : 500,
        message: String(error?.message || error || "Unknown error"),
        stack: String(error?.stack || ""),
      });
      const status = Number.isFinite(error?.status) ? error.status : 500;
      const code = String(error?.code || (status >= 500 ? "internal_error" : "request_failed"));
      return errorJson(code, String(error?.message || "Internal server error."), status, cors.headers);
    }
  },
};
