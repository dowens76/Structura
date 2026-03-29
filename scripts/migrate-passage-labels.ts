/**
 * One-time migration: copies existing passage labels → level-2 section breaks.
 *
 * Run with: npx tsx scripts/migrate-passage-labels.ts
 *
 * This is idempotent — uses ON CONFLICT DO NOTHING so re-running is safe.
 */

import { migratePassageLabelsToSectionBreaks } from "../lib/db/queries";

async function main() {
  console.log("Migrating passage labels to section breaks (level 2)…");
  await migratePassageLabelsToSectionBreaks(1); // default workspaceId
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
