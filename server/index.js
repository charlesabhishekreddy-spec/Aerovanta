import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createApp } from "./src/app.js";
import { loadConfig } from "./src/config.js";

const config = loadConfig();
const app = await createApp(config);

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
