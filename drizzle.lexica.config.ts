import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/lexica-schema.ts",
  out: "./drizzle/lexica",
  dialect: "sqlite",
  // Any per-lexicon DB shares the same schema; bdb.db is used as the reference.
  dbCredentials: {
    url: "./data/bdb.db",
  },
});
