/*
 * cPanel / Passenger entry point.
 *
 * cPanel's Node selectors run the app through Phusion Passenger, which loads a
 * startup file from the application root and defaults to `app.js`. The real
 * server is the compiled API, which is an ES module, so load it dynamically from
 * this CommonJS file (dynamic import is available to CommonJS).
 *
 * Passenger hooks the first http server `listen()` and moves it onto its own
 * socket, so the API's PORT/HOST values are ignored and need not be set here.
 *
 * The app must already be built (`npm run build`) so that
 * `apps/api/dist/index.js` exists. See AGENTS.md -> "Production hosting".
 */
import("./apps/api/dist/index.js").catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "startup_failed",
      error: String((error && error.stack) || error),
    }),
  );
  process.exit(1);
});
