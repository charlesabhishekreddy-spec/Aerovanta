import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createApp } from "./src/app.js";
import { loadConfig } from "./src/config.js";

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

const loadLocalEnvFiles = () => {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, ".env.local"));
};

loadLocalEnvFiles();

const config = loadConfig();
const app = await createApp(config);

const maskKey = (value = "") => {
  const key = String(value || "").trim();
  if (!key) return "not set";
  if (config.isProduction) return "set";
  if (key.length <= 8) return "set";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
};

const startServer = async () => {
  let server;

  if (config.tls.enabled) {
    const [key, cert] = await Promise.all([readFile(config.tls.keyPath), readFile(config.tls.certPath)]);
    server = createHttpsServer({ key, cert }, app);
  } else {
    server = createHttpServer(app);
  }

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(`[api] ${config.host}:${config.port} is already in use. Stop the existing server process first.`);
      process.exit(1);
    }
    console.error("[api] server error:", error);
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const protocol = config.tls.enabled ? "https" : "http";
    const baseUrl = `${protocol}://${config.host}:${config.port}`;
    console.log(`[api] running on ${baseUrl}${config.apiPrefix}`);
    console.log(
      `[api] ai provider=${config.ai.provider} geminiModel=${config.ai.geminiModel} openAiModel=${config.ai.openAiModel}`
    );
    console.log(
      `[api] keys gemini=${maskKey(config.ai.geminiApiKey)} openai=${maskKey(config.ai.openAiApiKey)}`
    );
    if (!config.tls.enabled) {
      console.log("[api] TLS is disabled. Use HTTPS via reverse proxy for production.");
    }
  });

  const shutdown = (signal) => {
    console.log(`[api] received ${signal}, shutting down...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

startServer().catch((error) => {
  console.error("[api] fatal startup error:", error);
  process.exit(1);
});
