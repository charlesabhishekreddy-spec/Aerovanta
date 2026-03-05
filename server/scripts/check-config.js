import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadConfig, validateConfig } from "../src/config.js";

const parseEnvLine = (line) => {
  const text = String(line || "").trim();
  if (!text || text.startsWith("#")) return null;
  const match = text.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2] ?? "";
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key: match[1], value };
};

const loadEnvFile = (filePath) => {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] == null || process.env[parsed.key] === "") {
      process.env[parsed.key] = parsed.value;
    }
  }
};

const root = process.cwd();
loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env.production"));

const config = loadConfig();
const validation = validateConfig(config);

console.log(`[check-config] environment=${config.nodeEnv}`);
console.log(`[check-config] forceHttps=${config.forceHttps} trustProxy=${config.trustProxy}`);
console.log(`[check-config] cookieSecure=${config.cookies.secure} sameSite=${config.cookies.sameSite}`);
console.log(`[check-config] allowedOrigins=${config.allowedOrigins.join(", ") || "(none)"}`);
console.log(`[check-config] rateLimitBackend=${config.rateLimits.backend}`);

if (validation.warnings.length > 0) {
  validation.warnings.forEach((warning) => {
    console.warn(`[check-config] warning: ${warning}`);
  });
}

if (validation.errors.length > 0) {
  validation.errors.forEach((errorMessage) => {
    console.error(`[check-config] error: ${errorMessage}`);
  });
  process.exit(1);
}

console.log("[check-config] configuration passed.");
