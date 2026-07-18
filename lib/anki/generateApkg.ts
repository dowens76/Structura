import Database from "better-sqlite3";
import JSZip from "jszip";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";

/**
 * Hand-rolled Anki .apkg generator — no genanki-style npm package exists for
 * Node, so this builds the legacy (schema ver. 11) `collection.anki2` SQLite
 * format directly using better-sqlite3 (already a dependency) and zips it
 * with jszip (already a dependency). One note + one card per vocabulary
 * word, with the deck's original-language font (Ezra SIL for Hebrew,
 * Gentium Plus for Greek) embedded as a media file so the front of each
 * card renders correctly on any device, regardless of installed fonts.
 *
 * This schema was reconstructed from the standard Anki 2.1 format, not
 * verified against a live Anki install in this repo — if anything fails to
 * import, the SQLite structure below is the first place to check.
 */

export interface ApkgNote {
  front: string;
  back: string;
}

// Same fonts the web app embeds for these languages (see app/globals.css's
// @font-face for Ezra SIL and the @fontsource/gentium-plus import in
// app/layout.tsx) — copied into public/fonts/ as standalone files so they
// can be read here regardless of dev/packaged runtime layout, and embedded
// directly in the deck rather than relying on the recipient having them
// installed.
const FONT_CONFIG: Record<"hebrew" | "greek", { file: string; fontFamily: string }> = {
  hebrew: { file: "SILEOT.woff", fontFamily: "Ezra SIL" },
  greek:  { file: "GentiumPlus-Greek.woff", fontFamily: "Gentium Plus" },
};

// Front-of-card (lemma) size, same for every language.
const FRONT_FONT_SIZE = 32;

const FIELD_SEP = "\x1f";

function randomGuid(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Anki's note "csum" — first 8 hex digits of sha1(sort field) as an integer. */
function fieldChecksum(sortField: string): number {
  const hash = createHash("sha1").update(sortField, "utf-8").digest("hex");
  return parseInt(hash.slice(0, 8), 16);
}

const SCHEMA_SQL = `
CREATE TABLE col (
  id INTEGER PRIMARY KEY, crt INTEGER NOT NULL, mod INTEGER NOT NULL, scm INTEGER NOT NULL,
  ver INTEGER NOT NULL, dty INTEGER NOT NULL, usn INTEGER NOT NULL, ls INTEGER NOT NULL,
  conf TEXT NOT NULL, models TEXT NOT NULL, decks TEXT NOT NULL, dconf TEXT NOT NULL, tags TEXT NOT NULL
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, guid TEXT NOT NULL, mid INTEGER NOT NULL, mod INTEGER NOT NULL,
  usn INTEGER NOT NULL, tags TEXT NOT NULL, flds TEXT NOT NULL, sfld TEXT NOT NULL,
  csum INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE cards (
  id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL, ord INTEGER NOT NULL,
  mod INTEGER NOT NULL, usn INTEGER NOT NULL, type INTEGER NOT NULL, queue INTEGER NOT NULL,
  due INTEGER NOT NULL, ivl INTEGER NOT NULL, factor INTEGER NOT NULL, reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL, left INTEGER NOT NULL, odue INTEGER NOT NULL, odid INTEGER NOT NULL,
  flags INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE revlog (
  id INTEGER PRIMARY KEY, cid INTEGER NOT NULL, usn INTEGER NOT NULL, ease INTEGER NOT NULL,
  ivl INTEGER NOT NULL, lastIvl INTEGER NOT NULL, factor INTEGER NOT NULL, time INTEGER NOT NULL,
  type INTEGER NOT NULL
);
CREATE TABLE graves (usn INTEGER NOT NULL, oid INTEGER NOT NULL, type INTEGER NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);
`;

export async function generateApkg(
  notes: ApkgNote[],
  opts: { deckName: string; language: "hebrew" | "greek" },
): Promise<Buffer> {
  const sqlite = new Database(":memory:");
  sqlite.exec(SCHEMA_SQL);

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const modelId = now;
  const deckId = now + 1;

  const font = FONT_CONFIG[opts.language];
  const fontBuffer = readFileSync(path.join(process.cwd(), "public", "fonts", font.file));

  // Back-of-card lines step down from the base 20px card size in 4px
  // increments: gloss stays full-size, part of speech is one step down
  // (16px) and green, occurrence count is two steps down (12px) and gray.
  const css = `
.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }
@font-face { font-family: "${font.fontFamily}"; src: url("${font.file}") format("woff"); font-weight: normal; font-style: normal; }
.orig-lang { font-family: "${font.fontFamily}", serif; font-size: ${FRONT_FONT_SIZE}px; }
.pos-line { font-size: 16px; color: green; }
.occ-line { font-size: 12px; color: gray; }
`.trim();

  const models = {
    [modelId]: {
      id: modelId,
      name: "Structura Vocabulary",
      type: 0,
      mod: nowSec,
      usn: 0,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          // Front field content already carries class="orig-lang" (see
          // app/api/vocabulary/export/route.ts's buildAnkiNotes) so the
          // template itself doesn't need to add another wrapper.
          name: "Card 1", ord: 0,
          qfmt: "{{Front}}",
          afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
          did: null, bafmt: "", bqfmt: "",
        },
      ],
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: opts.language === "hebrew", font: font.fontFamily, size: 20 },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 },
      ],
      css,
      latexPre: "",
      latexPost: "",
      req: [[0, "any", [0]]],
      tags: [],
      vers: [],
    },
  };

  const decks = {
    "1": {
      id: 1, name: "Default", mod: nowSec, usn: 0,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
      collapsed: true, browserCollapsed: true, desc: "", dyn: 0, conf: 1, extendNew: 0, extendRev: 0,
    },
    [deckId]: {
      id: deckId, name: opts.deckName, mod: nowSec, usn: 0,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
      collapsed: true, browserCollapsed: true, desc: "", dyn: 0, conf: 1, extendNew: 0, extendRev: 0,
    },
  };

  const dconf = {
    "1": {
      id: 1, name: "Default", mod: nowSec, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
      new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
      rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
      dyn: false,
    },
  };

  const conf = {
    nextPos: 1, estTimes: true, activeDecks: [1, deckId], sortType: "noteFld",
    timeLim: 0, sortBackwards: false, addToCur: true, curDeck: deckId, newBury: true,
    newSpread: 0, dueCounts: true, curModel: String(modelId), collapseTime: 1200,
  };

  sqlite.prepare(`
    INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
    VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')
  `).run(nowSec, now, now, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf));

  const insertNote = sqlite.prepare(`
    INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
    VALUES (?, ?, ?, ?, 0, '', ?, ?, ?, 0, '')
  `);
  const insertCard = sqlite.prepare(`
    INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
    VALUES (?, ?, ?, 0, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')
  `);

  notes.forEach((note, i) => {
    const noteId = now + i;
    const cardId = now + notes.length + i;
    const flds = `${note.front}${FIELD_SEP}${note.back}`;
    insertNote.run(noteId, randomGuid(), modelId, nowSec, flds, note.front, fieldChecksum(note.front));
    insertCard.run(cardId, noteId, deckId, nowSec, i + 1);
  });

  const collectionBuffer = sqlite.serialize();
  sqlite.close();

  const zip = new JSZip();
  zip.file("collection.anki2", collectionBuffer);
  // Media files are zip entries named by number; `media` maps each number to
  // its real filename, which is what the @font-face `url(...)` above and
  // Anki's own media-restore step on import both use.
  zip.file("media", JSON.stringify({ "0": font.file }));
  zip.file("0", fontBuffer);
  return zip.generateAsync({ type: "nodebuffer" });
}
