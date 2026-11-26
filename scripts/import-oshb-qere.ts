/**
 * import-oshb-qere.ts
 *
 * Fills the `qere_readings` table in data/oshb.db from the OSHB WLC XML.
 * Additive and idempotent: it (re)creates only that table and never touches
 * `words`, so transliterations and other post-import data survive.
 *
 * In the XML a Qere follows its Ketiv word as
 *   <w id="02QZQ">ו/ילינו</w><note type="variant"><catchWord>ו/ילינו</catchWord>
 *     <rdg type="x-qere"><w id="02iJj" lemma="c/3885 b" morph="HC/VNw3mp">וַ/יִּלּ֜וֹנוּ</w></rdg></note>
 * A note without <catchWord> is a Qere wela Ketiv (read, but not written);
 * it is attached to the preceding word and flagged "qere-only".
 *
 * Run after `npm run db:split-source` (which rebuilds oshb.db):
 *   npm run import:oshb-qere
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseOshbLemma } from "../lib/morphology/oshb-parser";

const WLC_PATH = path.join(process.cwd(), "node_modules", "morphhb", "wlc");
const DB_PATH  = path.join(process.cwd(), "data", "oshb.db");

interface Row {
  ketivWordId: string; seq: number; wordId: string; surfaceText: string;
  lemma: string | null; strongNumber: string | null; morphCode: string | null;
  kind: "qere" | "qere-only";
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

function parseBook(xml: string): Row[] {
  const rows: Row[] = [];
  const verseRe = /<verse\b[^>]*>([\s\S]*?)<\/verse>/g;
  const noteRe  = /<note\b([^>]*)>([\s\S]*?)<\/note>/g;
  const wRe     = /<w\b([^>]*)>([\s\S]*?)<\/w>/g;
  let vm: RegExpExecArray | null;
  while ((vm = verseRe.exec(xml)) !== null) {
    const body = vm[1];
    let lastKetivId: string | null = null;
    let cursor = 0;
    let nm: RegExpExecArray | null;
    noteRe.lastIndex = 0;
    while ((nm = noteRe.exec(body)) !== null) {
      // Top-level words between the previous note and this one; the last of
      // them is the word this note annotates.
      const between = body.slice(cursor, nm.index);
      let wm: RegExpExecArray | null;
      wRe.lastIndex = 0;
      while ((wm = wRe.exec(between)) !== null) lastKetivId = attr(wm[1], "id") ?? lastKetivId;
      cursor = nm.index + nm[0].length;

      const inner = nm[2];
      const rdg = inner.match(/<rdg type="x-qere">([\s\S]*?)<\/rdg>/);
      if (!rdg) continue;
      if (!lastKetivId) {
        console.warn(`  Qere with no preceding word, skipped: ${vm[0].slice(0, 60)}`);
        continue;
      }
      const kind = /<catchWord>/.test(inner) ? "qere" : "qere-only";
      let seq = 0;
      let qm: RegExpExecArray | null;
      const qRe = /<w\b([^>]*)>([\s\S]*?)<\/w>/g;
      while ((qm = qRe.exec(rdg[1])) !== null) {
        const { strongNumber, lemmaText } = parseOshbLemma(attr(qm[1], "lemma") ?? "");
        rows.push({
          ketivWordId: lastKetivId,
          seq: seq++,
          wordId: attr(qm[1], "id") ?? `${lastKetivId}.q${seq}`,
          surfaceText: qm[2].replace(/<[^>]+>/g, "").trim(),
          lemma: lemmaText,
          strongNumber,
          morphCode: attr(qm[1], "morph"),
          kind,
        });
      }
    }
  }
  return rows;
}

function main() {
  const sqlite = new Database(DB_PATH);
  sqlite.exec(`
    DROP TABLE IF EXISTS qere_readings;
    CREATE TABLE qere_readings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ketiv_word_id TEXT    NOT NULL,
      seq           INTEGER NOT NULL,
      word_id       TEXT    NOT NULL,
      surface_text  TEXT    NOT NULL,
      lemma         TEXT,
      strong_number TEXT,
      morph_code    TEXT,
      kind          TEXT    NOT NULL
    );
    CREATE INDEX qere_ketiv_idx ON qere_readings(ketiv_word_id);
  `);
  const insert = sqlite.prepare(`INSERT INTO qere_readings
    (ketiv_word_id, seq, word_id, surface_text, lemma, strong_number, morph_code, kind)
    VALUES (@ketivWordId, @seq, @wordId, @surfaceText, @lemma, @strongNumber, @morphCode, @kind)`);
  const hasWord = sqlite.prepare("SELECT 1 FROM words WHERE word_id = ?");

  let total = 0, missing = 0;
  const files = readdirSync(WLC_PATH).filter((f) => f.endsWith(".xml")).sort();
  sqlite.transaction(() => {
    for (const f of files) {
      const rows = parseBook(readFileSync(path.join(WLC_PATH, f), "utf-8"));
      for (const r of rows) {
        if (!hasWord.get(r.ketivWordId)) missing++;
        insert.run(r);
      }
      if (rows.length) console.log(`  ${f.replace(".xml", "").padEnd(6)} ${rows.length}`);
      total += rows.length;
    }
  })();
  console.log(`\n${total} Qere words imported${missing ? ` (${missing} attached to word ids not in words)` : ""}.`);
  sqlite.close();
}

main();
