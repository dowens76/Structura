import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
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
