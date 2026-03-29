// Default drizzle config points at user.db (the schema that evolves during development).
// Source text schema is managed separately via drizzle.source.config.ts.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/user-schema.ts",
  out: "./drizzle/user",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/user.db",
  },
});
