const OAUTH_TIMEOUT_MS = 60_000;
const MICROSOFT_OAUTH_TIMEOUT_MS = 180_000;

const SOCIAL_LOGIN_ENABLED = String(
  import.meta.env.VITE_ENABLE_SOCIAL_LOGIN || (import.meta.env.DEV ? "true" : "false")
).trim().toLowerCase() === "true";

const PROVIDERS = {
  google: {
    key: "google",
    label: "Continue with Google",
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  },
  microsoft: {
    key: "microsoft",
    label: "Continue with Microsoft",
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
  },
  facebook: {
    key: "facebook",
    label: "Continue with Facebook",
    clientId: import.meta.env.VITE_FACEBOOK_APP_ID,
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeoutMs = OAUTH_TIMEOUT_MS, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function withTimeout(promise, timeoutMs = OAUTH_TIMEOUT_MS, message = "Authentication timed out.") {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function ensureProviderConfigured(provider) {
  const config = PROVIDERS[provider];
  if (!config?.clientId) throw new Error(`${config?.label || provider} is not configured.`);
}

function extractEmailFromClaims(claims = {}) {
  return (
    claims.email ||
    claims.preferred_username ||
    (Array.isArray(claims.emails) ? claims.emails[0] : "") ||
    ""
  );
}

let msalInstance = null;
let msalInitPromise = null;
let msalHandleRedirectPromise = null;
let microsoftLoginPromise = null;
let msalPublicClientApplication = null;

function getMicrosoftRedirectUri() {
  return import.meta.env.VITE_OAUTH_REDIRECT || window.location.origin;
}

function getMsalCacheLocation() {
  const requested = String(import.meta.env.VITE_MSAL_CACHE_LOCATION || "memoryStorage").trim().toLowerCase();
  if (requested === "localstorage") return "localStorage";
  if (requested === "sessionstorage") return "sessionStorage";
  return "memoryStorage";
}

async function getMsalPublicClientApplicationClass() {
  if (msalPublicClientApplication) return msalPublicClientApplication;
  const mod = await import("@azure/msal-browser");
  msalPublicClientApplication = mod?.PublicClientApplication;
  if (!msalPublicClientApplication) {
    throw new Error("Microsoft sign-in library failed to load.");
  }
  return msalPublicClientApplication;
}

async function getMsalInstance() {
  if (!msalInstance) {
    const PublicClientApplication = await getMsalPublicClientApplicationClass();
    msalInstance = new PublicClientApplication({
      auth: {
        clientId: import.meta.env.VITE_ENTRA_CLIENT_ID || "MISSING",
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID || "common"}`,
        redirectUri: getMicrosoftRedirectUri(),
        navigateToLoginRequestUrl: false,
      },
      cache: {
        cacheLocation: getMsalCacheLocation(),
        storeAuthStateInCookie: true,
      },
    });
  }
  return msalInstance;
}

async function ensureGoogleSdkLoaded() {
  const existing = await waitFor(() => Boolean(window.google?.accounts?.oauth2), { timeoutMs: 4_000 });
  if (existing) return;

  const hasScript = Array.from(document.querySelectorAll("script")).some((script) =>
    String(script.src || "").includes("accounts.google.com/gsi/client")
  );
  if (!hasScript) {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  const ready = await waitFor(() => Boolean(window.google?.accounts?.oauth2), { timeoutMs: 12_000 });
  if (!ready) {
    throw new Error("Google SDK could not be loaded.");
  }
}

async function ensureFacebookSdkLoaded() {
  const existing = await waitFor(() => Boolean(window.FB), { timeoutMs: 4_000 });
  if (existing) return;

  const hasScript = Array.from(document.querySelectorAll("script")).some((script) =>
    String(script.src || "").includes("connect.facebook.net/en_US/sdk.js")
  );
  if (!hasScript) {
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  }

  const ready = await waitFor(() => Boolean(window.FB), { timeoutMs: 12_000 });
  if (!ready) throw new Error("Facebook SDK could not be loaded.");
}

let fbInitialized = false;
async function ensureFacebookInitialized() {
  ensureProviderConfigured("facebook");
  await ensureFacebookSdkLoaded();
  if (fbInitialized) return;

  window.FB.init({
    appId: import.meta.env.VITE_FACEBOOK_APP_ID,
    cookie: true,
    xfbml: false,
    version: "v21.0",
  });
  fbInitialized = true;
}

async function ensureMsalInitialized() {
  ensureProviderConfigured("microsoft");
  if (!msalInitPromise) {
    msalInitPromise = (async () => {
      const instance = await getMsalInstance();
      await instance.initialize();
    })();
  }
  await msalInitPromise;
  if (!msalHandleRedirectPromise) {
    msalHandleRedirectPromise = (async () => {
      const instance = await getMsalInstance();
      return instance.handleRedirectPromise();
    })().catch(() => null);
  }
  await msalHandleRedirectPromise;
}

function clearStaleMsalInteractionState() {
  if (typeof window === "undefined") return;
  const clientId = String(import.meta.env.VITE_ENTRA_CLIENT_ID || "").toLowerCase();
  const directKeys = ["msal.interaction.status"];
  if (clientId) {
    directKeys.push(`msal.${clientId}.interaction.status`);
    directKeys.push(`msal.${clientId}.interaction_status`);
  }

  const stores = [window.localStorage, window.sessionStorage];
  for (const store of stores) {
    for (const key of directKeys) {
      try {
        store.removeItem(key);
      } catch {
        // Ignore storage access errors for hardened browser modes.
      }
    }

    try {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (!key) continue;
        const normalized = key.toLowerCase();
        const matchesClient = !clientId || normalized.includes(clientId);
        const isInteractionKey =
          normalized.includes("interaction.status") || normalized.includes("interaction_in_progress");
        if (matchesClient && isInteractionKey) {
          store.removeItem(key);
        }
      }
    } catch {
      // Ignore storage access errors for hardened browser modes.
    }
  }
}

function mapMicrosoftAuthError(error) {
  const code = String(error?.errorCode || error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("storage is not defined")) {
    return new Error("Browser storage is blocked for Microsoft sign-in in this context. Try another browser window.");
  }
  if (code.includes("user_cancelled")) return new Error("Microsoft sign-in was canceled.");
  if (code.includes("interaction_in_progress")) {
    return new Error("Microsoft sign-in is already in progress. Close extra sign-in windows and try again.");
  }
  if (code.includes("monitor_popup_timeout")) {
    return new Error("Microsoft sign-in timed out. Please complete sign-in in the Microsoft popup.");
  }
  return error;
}

async function runMicrosoftPopup({ allowRecovery = true } = {}) {
  try {
    const instance = await getMsalInstance();
    const result = await instance.loginPopup({
      scopes: ["openid", "profile", "email", "User.Read"],
      prompt: "select_account",
      redirectUri: getMicrosoftRedirectUri(),
    });

    const claims = result.idTokenClaims || {};
    const email = result.account?.username || extractEmailFromClaims(claims);
    if (!email) throw new Error("Microsoft did not return an email address.");

    return {
      provider: "microsoft",
      profile: {
        name: result.account?.name || claims.name || email,
        email,
        picture: "",
      },
    };
  } catch (error) {
    const code = String(error?.errorCode || error?.code || "").toLowerCase();
    if (allowRecovery && code.includes("interaction_in_progress")) {
      clearStaleMsalInteractionState();
      await sleep(200);
      return runMicrosoftPopup({ allowRecovery: false });
    }
    throw mapMicrosoftAuthError(error);
  }
}

export function getSocialProviderConfigs() {
  return Object.values(PROVIDERS).map((provider) => ({
    key: provider.key,
    label: provider.label,
    enabled: SOCIAL_LOGIN_ENABLED && Boolean(provider.clientId),
  }));
}

export async function loginWithGoogle() {
  ensureProviderConfigured("google");
  await ensureGoogleSdkLoaded();

  return withTimeout(
    new Promise((resolve, reject) => {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          scope: "openid email profile",
          callback: async (tokenResponse) => {
            try {
              if (tokenResponse?.error) {
                if (tokenResponse.error === "popup_closed_by_user") {
                  throw new Error("Google sign-in was canceled.");
                }
                throw new Error(`Google sign-in failed: ${tokenResponse.error}`);
              }

              const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
              });
              if (!response.ok) throw new Error("Unable to retrieve Google profile.");

              const profile = await response.json();
              if (!profile?.email) throw new Error("Google did not return an email address.");

              resolve({
                provider: "google",
                profile: {
                  name: profile.name || profile.email,
                  email: profile.email,
                  picture: profile.picture || "",
                },
              });
            } catch (error) {
              reject(error);
            }
          },
        });

        tokenClient.requestAccessToken({ prompt: "select_account" });
      } catch (error) {
        reject(error);
      }
    }),
    OAUTH_TIMEOUT_MS,
    "Google sign-in timed out."
  );
}

export async function loginWithMicrosoft() {
  if (microsoftLoginPromise) return microsoftLoginPromise;

  microsoftLoginPromise = withTimeout(
    (async () => {
      await ensureMsalInitialized();
      return runMicrosoftPopup();
    })(),
    MICROSOFT_OAUTH_TIMEOUT_MS,
    "Microsoft sign-in timed out."
  ).finally(() => {
    microsoftLoginPromise = null;
  });

  return microsoftLoginPromise;
}

export async function loginWithFacebook() {
  await ensureFacebookInitialized();

  return withTimeout(
    new Promise((resolve, reject) => {
      window.FB.login(
        (response) => {
          if (!response?.authResponse) {
            reject(new Error("Facebook sign-in was canceled."));
            return;
          }

          window.FB.api("/me", { fields: "name,email,picture" }, (userInfo) => {
            if (!userInfo || userInfo.error) {
              reject(new Error("Failed to retrieve Facebook profile."));
              return;
            }
            if (!userInfo.email) {
              reject(new Error("Facebook did not return an email address."));
              return;
            }

            resolve({
              provider: "facebook",
              profile: {
                name: userInfo.name || userInfo.email,
                email: userInfo.email,
                picture: userInfo.picture?.data?.url || "",
              },
            });
          });
        },
        { scope: "public_profile,email", auth_type: "rerequest" }
      );
    }),
    OAUTH_TIMEOUT_MS,
    "Facebook sign-in timed out."
  );
}

export async function loginWithSocial(provider) {
  const normalizedProvider = String(provider || "").toLowerCase();
  if (normalizedProvider === "google") return loginWithGoogle();
  if (normalizedProvider === "microsoft") return loginWithMicrosoft();
  if (normalizedProvider === "facebook") return loginWithFacebook();
  throw new Error("Unsupported social provider.");
}
