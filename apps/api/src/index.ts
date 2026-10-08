import { createApp, prepare } from "./app.js";
import { env } from "./config/env.js";
import { setLogLevel } from "./lib/logger.js";
import { installProcessGuards } from "./middleware/common.js";
import { disconnectDatabase } from "./db/pool.js";

/**
 * Process entry point.
 *
 * The order below matters: configuration is validated on import, the database is
 * proved reachable before the listening socket opens, and shutdown handlers are
 * installed before anything can fail. A server that starts listening and only
 * then discovers its database is gone accepts traffic it cannot serve.
 */

async function main(): Promise<void> {
  setLogLevel(env.LOG_LEVEL);
  installProcessGuards();

  const app = createApp();

  await prepare();

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "server.started",
        environment: env.NODE_ENV,
        url: `http://${env.HOST}:${env.PORT}`,
        uploads: env.SERVE_UPLOADS ? "/uploads" : "disabled",
      }),
    );
  });

  // Slow or stuck clients must not hold connections open indefinitely.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;

  process.on("SIGTERM", () => closeServer(server));
  process.on("SIGINT", () => closeServer(server));
}

/** Drain in-flight requests before exiting so no response is truncated. */
function closeServer(server: import("node:http").Server): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "server.draining" }));
  server.close(async () => {
    await disconnectDatabase().catch(() => undefined);
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "server.closed" }));
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "server.startup_failed",
      err: { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
    }),
  );
  process.exit(1);
});