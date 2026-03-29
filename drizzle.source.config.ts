import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/source-schema.ts",
  out: "./drizzle/source",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/source.db",
  },
});
