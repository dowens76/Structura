import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/lexica-schema.ts",
  out: "./drizzle/lexica",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/lexica.db",
  },
});
