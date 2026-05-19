import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

async function main() {
  const db = new Database(DB_PATH);

  const cols = db.pragma("table_info(word_tags)") as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has("corpus_grouping_id")) {
    db.exec("ALTER TABLE word_tags ADD COLUMN corpus_grouping_id INTEGER");
    console.log("✓ Added corpus_grouping_id");
  } else {
    console.log("· corpus_grouping_id already exists");
  }

  if (!colNames.has("lemmas")) {
    db.exec("ALTER TABLE word_tags ADD COLUMN lemmas TEXT");
    console.log("✓ Added lemmas");
  } else {
    console.log("· lemmas already exists");
  }

  db.close();
  console.log("Migration complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
