import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/user-schema.ts",
  out: "./drizzle/user",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/user.db",
  },
});
