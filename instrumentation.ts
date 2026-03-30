/**
 * instrumentation.ts — Next.js server startup hook.
 *
 * Next.js calls register() once per server process, before any routes are
 * served. We use it to start the auto-backup scheduler so it runs for the
 * lifetime of the process without needing an HTTP request to kick it off.
 *
 * The Node.js runtime guard ensures this does not run in Edge environments.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import keeps the scheduler (and better-sqlite3) out of the
    // Edge runtime bundle entirely.
    await import("@/lib/backup/scheduler");
  }
}
