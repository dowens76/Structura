/**
 * Build script: generate lib/data/hebrew-lemmas.json
 *
 * Downloads HebrewStrong.xml from openscriptures/HebrewLexicon and extracts
 * a compact Strong-number → Hebrew-lemma map (e.g. { "H7225": "רֵאשִׁית" }).
 *
 * Run: npm run build:hebrew-lemmas
 */

import { XMLParser } from "fast-xml-parser";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/HebrewStrong.xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Ensure these are always arrays even when only one element is present
  isArray: (name) => ["entry", "w"].includes(name),
});

async function main() {
  console.log("Fetching HebrewStrong.xml …");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
  const xml = await res.text();
  console.log(`  Downloaded ${(xml.length / 1024).toFixed(0)} KB`);

  console.log("Parsing XML …");
  const doc = parser.parse(xml) as Record<string, unknown>;
  const lexicon = doc?.lexicon as Record<string, unknown> | undefined;
  const entries: unknown[] = Array.isArray(lexicon?.entry) ? lexicon.entry : [];

  const map: Record<string, string> = {};
  let skipped = 0;

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const id = String(e["@_id"] ?? "");
    if (!id.startsWith("H")) continue;

    // Each entry has one or more <w> children.
    // Some <w> elements are cross-references (they carry a @_src attribute and
    // contain only a numeral like "1" or "7218"). Skip those and take the first
    // <w> that has actual Hebrew/Aramaic text content.
    const ws: unknown[] = Array.isArray(e.w) ? e.w : e.w ? [e.w] : [];
    let found = false;
    for (const w of ws) {
      const wEl = w as Record<string, unknown>;
      if (wEl["@_src"]) continue; // cross-reference — skip
      const text = String(wEl["#text"] ?? "").trim();
      if (text) {
        map[id] = text;
        found = true;
        break;
      }
    }
    if (!found) skipped++;
  }

  const outDir = path.join(process.cwd(), "lib", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "hebrew-lemmas.json");
  writeFileSync(outPath, JSON.stringify(map));

  console.log(
    `Written ${Object.keys(map).length} entries to ${outPath}` +
      (skipped ? ` (${skipped} entries had no Hebrew text — skipped)` : "")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
