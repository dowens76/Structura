import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // `next build`'s static-page-generation step spawns multiple worker
  // processes, and every page transitively imports lib/db/index.ts, whose
  // module-level `getUserDb()`/`getSourceDb()` calls eagerly open
  // better-sqlite3 (native/N-API) connections in each one. On Windows +
  // Node 24 this has crashed with a Node-internal assertion
  // (`RemoveEnvironmentCleanupHook` / "Assertion failed: (env) != nullptr")
  // while a worker process tears down its native handles. Capping workers to
  // 1 removes the concurrent multi-process teardown as a variable; if the
  // crash recurs, it isn't a concurrency race and the next thing to try is
  // pinning the Windows CI job to Node 22 LTS instead of 24.
  experimental: {
    cpus: 1,
  },
  // Exclude large directories from the standalone file trace.
  // src-tauri/ (Rust build artifacts) and data/sources/ (raw USFM/XML import files)
  // are not needed at runtime and would bloat the bundled server.
  outputFileTracingExcludes: {
    "*": [
      "./src-tauri/**/*",
      "./data/sources/**/*",
    ],
  },
};

export default nextConfig;
