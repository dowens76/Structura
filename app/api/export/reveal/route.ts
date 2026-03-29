import { NextRequest, NextResponse } from "next/server";
import {
  getChapterWords,
  getPassage,
  getPassageWords,
  getBook,
  getCharacters,
  getChapterCharacterRefs,
  getChapterSpeechSections,
  getChapterWordFormatting,
  getChapterParagraphBreaks,
  getWordTags,
  getChapterWordTagRefs,
  getChapterLineIndents,
  getChapterWordArrows,
  getAvailableTranslationsForChapter,
  getTranslationVerses,
  getChapterSceneBreaks,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import type {
  Word, Character, CharacterRef, SpeechSection,
  WordTag, WordTagRef, WordArrow, Translation,
} from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";

// ── HTML escaping ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Translation token → inline span ──────────────────────────────────────────
// Like wordToSpan but for translation tokens (tv:abbr:book.ch.v.wi IDs).
// Applies character-ref underline, word-tag outline, and data-word-id.

function tvTokenToSpan(
  tokenText:       string,
  wordId:          string,
  characterRefMap: Map<string, CharacterRef>,
  characterMap:    Map<number, Character>,
  wordTagRefMap:   Map<string, WordTagRef>,
  wordTagMap:      Map<number, WordTag>,
): string {
  if (!tokenText) return "";
  const styles: string[] = [];

  const ref = characterRefMap.get(wordId);
  if (ref) {
    const char1 = characterMap.get(ref.character1Id);
    const char2 = ref.character2Id != null ? characterMap.get(ref.character2Id) : undefined;
    if (char1 && char2) {
      styles.push(
        `background-image:repeating-linear-gradient(to right,${esc(char1.color)} 0px,${esc(char1.color)} 4px,${esc(char2.color)} 4px,${esc(char2.color)} 8px)`,
        "background-size:100% 2px",
        "background-position:center bottom",
        "background-repeat:no-repeat",
        "padding-bottom:2px",
      );
    } else if (char1) {
      styles.push(
        `text-decoration:underline`,
        `text-decoration-color:${esc(char1.color)}`,
        `text-decoration-thickness:2px`,
        `text-underline-offset:2px`,
      );
    }
  }

  const tagRef = wordTagRefMap.get(wordId);
  const tag    = tagRef ? wordTagMap.get(tagRef.tagId) : undefined;
  if (tag) styles.push(`outline:1.5px solid ${esc(tag.color)}`, "border-radius:2px");

  const styleAttr = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
  return `<span data-word-id="${esc(wordId)}"${styleAttr}>${esc(tokenText)}</span>`;
}

// ── Word → inline span ────────────────────────────────────────────────────────
// Applies bold/italic, character-ref underline (with dual-colour gradient),
// speech-section underline (fallback when no char-ref), and word-tag outline.
// Each span carries a data-word-id attribute for client-side arrow drawing.

function wordToSpan(
  word: Word,
  formatting:   { isBold: boolean; isItalic: boolean } | undefined,
  speechChar:   Character | undefined,
  ref:          CharacterRef | undefined,
  characterMap: Map<number, Character>,
  tag:          WordTag | undefined,
): string {
  const text = (word.surfaceText ?? "").replace(/\//g, "");
  if (!text) return "";

  const styles: string[] = [];

  if (formatting?.isBold)   styles.push("font-weight:bold");
  if (formatting?.isItalic) styles.push("font-style:italic");

  // Character ref underline (overrides speech section when present)
  if (ref) {
    const char1 = characterMap.get(ref.character1Id);
    const char2 = ref.character2Id != null ? characterMap.get(ref.character2Id) : undefined;
    if (char1 && char2) {
      // Dual-character: alternating-colour dashed gradient underline
      styles.push(
        `background-image:repeating-linear-gradient(to right,${esc(char1.color)} 0px,${esc(char1.color)} 4px,${esc(char2.color)} 4px,${esc(char2.color)} 8px)`,
        "background-size:100% 2px",
        "background-position:center bottom",
        "background-repeat:no-repeat",
        "padding-bottom:2px",
      );
    } else if (char1) {
      styles.push(
        `text-decoration:underline`,
        `text-decoration-color:${esc(char1.color)}`,
        `text-decoration-thickness:2px`,
        `text-underline-offset:2px`,
      );
    }
  } else if (speechChar) {
    // Speech-section underline (only shown when word has no direct char-ref)
    styles.push(
      `text-decoration:underline`,
      `text-decoration-color:${esc(speechChar.color)}`,
      `text-decoration-thickness:2px`,
      `text-underline-offset:2px`,
    );
  }

  // Word / concept tag: coloured outline box
  if (tag) {
    styles.push(`outline:1.5px solid ${esc(tag.color)}`, "border-radius:2px");
  }

  const styleAttr = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
  return `<span data-word-id="${esc(word.wordId)}"${styleAttr}>${esc(text)}</span>`;
}

// ── Paragraph-segment structure ───────────────────────────────────────────────
// A "segment" is a run of consecutive words that share the same paragraph.
// Verse boundaries implicitly reset the paragraph; explicit paragraph-break
// word IDs also start a new segment.

interface Segment {
  verse:          number;
  chapter:        number;
  isFirstInVerse: boolean;
  isParaBreak:    boolean;   // explicit paragraph break (not just a new verse)
  indentLevel:    number;
  speechChar:     Character | null;
  words:          Word[];
}

function buildWordToParaStart(
  words: Word[],
  paragraphBreakIds: Set<string>,
): Map<string, string> {
  const map = new Map<string, string>();
  let cur = words[0]?.wordId ?? "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0 && words[i - 1].verse !== w.verse) cur = w.wordId;
    if (paragraphBreakIds.has(w.wordId))          cur = w.wordId;
    map.set(w.wordId, cur);
  }
  return map;
}

function buildSegments(
  words:            Word[],
  paragraphBreakIds: Set<string>,
  wordSpeechMap:    Map<string, SpeechSection>,
  characterMap:     Map<number, Character>,
  lineIndentMap:    Map<string, number>,
  wordToParaStart:  Map<string, string>,
): Segment[] {
  const segments: Segment[] = [];
  let cur: Segment | null = null;

  for (let i = 0; i < words.length; i++) {
    const w          = words[i];
    const isNewVerse = i === 0 || words[i - 1].verse !== w.verse || words[i - 1].chapter !== w.chapter;
    const isParaBrk  = i > 0 && !isNewVerse && paragraphBreakIds.has(w.wordId);
    const paraStart  = wordToParaStart.get(w.wordId) ?? w.wordId;
    const indent     = lineIndentMap.get(paraStart) ?? 0;

    if (!cur || isNewVerse || isParaBrk) {
      const sec       = wordSpeechMap.get(w.wordId);
      const sChr      = sec ? (characterMap.get(sec.characterId) ?? null) : null;
      cur = {
        verse:          w.verse,
        chapter:        w.chapter,
        isFirstInVerse: isNewVerse || i === 0,
        isParaBreak:    isParaBrk,
        indentLevel:    indent,
        speechChar:     sChr,
        words:          [],
      };
      segments.push(cur);
    }
    cur.words.push(w);
  }
  return segments;
}

// ── Render all words to HTML ──────────────────────────────────────────────────

// translationMap key: "${chapter}.${verse}" → array of { abbr, text } entries
function renderWords(
  words:            Word[],
  formattingMap:    Map<string, { isBold: boolean; isItalic: boolean }>,
  wordSpeechMap:    Map<string, SpeechSection>,
  characterMap:     Map<number, Character>,
  characterRefMap:  Map<string, CharacterRef>,
  wordTagRefMap:    Map<string, WordTagRef>,
  wordTagMap:       Map<number, WordTag>,
  paragraphBreakIds: Set<string>,
  lineIndentMap:    Map<string, number>,
  wordToParaStart:  Map<string, string>,
  translationMap:   Map<string, { abbr: string; text: string }[]>,
  osisBook:         string,
  isHebrew:         boolean,
  sceneBreakMap:    Map<string, string | null>,
): string {
  if (words.length === 0) return "";

  const segments = buildSegments(
    words, paragraphBreakIds, wordSpeechMap, characterMap, lineIndentMap, wordToParaStart
  );

  const hasTranslation = translationMap.size > 0;

  // ── Helper: render word spans for a segment ──────────────────────────────
  const renderSpans = (seg: Segment) =>
    seg.words
      .map((w) => {
        const sec       = wordSpeechMap.get(w.wordId);
        const speechChr = sec ? characterMap.get(sec.characterId) : undefined;
        const ref       = characterRefMap.get(w.wordId);
        const tagRef    = wordTagRefMap.get(w.wordId);
        const tag       = tagRef ? wordTagMap.get(tagRef.tagId) : undefined;
        return wordToSpan(w, formattingMap.get(w.wordId), speechChr, ref, characterMap, tag);
      })
      .filter(Boolean)
      .join(" ");

  // ── Helper: render scene-break separator HTML ─────────────────────────────
  // Returns a scene-break div (solid rule + optional heading) for a wordId.
  const renderSceneBreakDiv = (wordId: string): string => {
    const heading = sceneBreakMap.get(wordId) ?? null;
    const headingHtml = heading
      ? `<span class="scene-heading">${esc(heading)}</span>`
      : "";
    return `<div class="scene-break">${headingHtml}</div>`;
  };

  // ── Helper: render a single source paragraph segment div ─────────────────
  // In side-by-side mode, the speech-box BACKGROUND goes on .verse-row (full
  // width), so we omit it here and only keep the source-side border+padding.
  const renderSegDiv = (seg: Segment, verseLabel = "", sourceSideOnly = false) => {
    const divStyles: string[] = [];
    if (seg.indentLevel > 0) {
      divStyles.push(`padding-${isHebrew ? "right" : "left"}:${seg.indentLevel * 2}rem`);
    }
    if (seg.speechChar) {
      const col = esc(seg.speechChar.color);
      if (sourceSideOnly) {
        // Side-by-side: row carries background; source column carries border only
        divStyles.push(
          `border-${isHebrew ? "right" : "left"}:3px solid ${col}`,
          `padding-${isHebrew ? "right" : "left"}:0.75rem`,
          `margin-${isHebrew ? "right" : "left"}:-0.75rem`,
        );
      } else {
        divStyles.push(
          `background-color:${col}18`,
          `border-${isHebrew ? "right" : "left"}:3px solid ${col}`,
          `padding-${isHebrew ? "right" : "left"}:0.75rem`,
          `margin-${isHebrew ? "right" : "left"}:-0.75rem`,
          "border-radius:3px",
        );
      }
    }
    // Scene break segments use scene-break class; regular para breaks use para-break
    const firstWordId = seg.words[0]?.wordId ?? "";
    const isScene     = seg.isParaBreak && sceneBreakMap.has(firstWordId);
    const cls         = ["text-seg", isScene ? "scene-seg" : (seg.isParaBreak ? "para-break" : "")].filter(Boolean).join(" ");
    const styleAttr   = divStyles.length > 0 ? ` style="${divStyles.join(";")}"` : "";
    // Prepend scene-break separator div when this segment starts a scene
    const sceneHtml   = isScene ? renderSceneBreakDiv(firstWordId) : "";
    return `${sceneHtml}<div class="${esc(cls)}"${styleAttr}>${verseLabel}${renderSpans(seg)}</div>`;
  };

  const dir  = isHebrew ? "rtl" : "ltr";
  const lang = isHebrew ? "he" : "grc";

  // ── Source-only: flat paragraph segments with embedded verse labels ───────
  if (!hasTranslation) {
    const seenVerses = new Set<string>();
    const segDivs = segments.map((seg) => {
      const verseKey = `${seg.chapter}.${seg.verse}`;
      const show = !seenVerses.has(verseKey);
      if (show) seenVerses.add(verseKey);
      const label = show ? `<sup class="verse-num">${seg.verse}</sup>` : "";
      return renderSegDiv(seg, label);
    });
    return `<div dir="${dir}" lang="${lang}">\n${segDivs.join("\n")}\n</div>`;
  }

  // ── Side-by-side: group segments by verse, render as HTML tables ────────
  // One <table> per verse; one <tr> per source paragraph segment.
  // The verse-number <td> uses rowspan so it spans all rows for that verse.
  // Translation segments are distributed row-by-row to align with source
  // paragraphs — each row shows one translation paragraph, and the last
  // row collects any remaining translation paragraphs.

  const verseKeys: string[] = [];
  const segsByVerse = new Map<string, Segment[]>();
  for (const seg of segments) {
    const key = `${seg.chapter}.${seg.verse}`;
    if (!segsByVerse.has(key)) { verseKeys.push(key); segsByVerse.set(key, []); }
    segsByVerse.get(key)!.push(seg);
  }

  const tables = verseKeys.map((verseKey) => {
    const vSegs     = segsByVerse.get(verseKey)!;
    const verseNum  = vSegs[0].verse;
    const [chStr, vStr] = verseKey.split(".");
    const chNum     = parseInt(chStr, 10);
    const vNum      = parseInt(vStr,  10);
    const tvEntries = translationMap.get(verseKey) ?? [];
    const showAbbr  = tvEntries.length > 1;

    // Pre-compute translation paragraph segments per translation entry
    type TvSeg = { tokens: string[]; startWi: number };
    const tvSegsPerEntry = tvEntries.map((tv) => {
      const tokens = tv.text.split(/\s+/).filter(Boolean);
      const tvSegs: TvSeg[] = [];
      let curTokens: string[] = [];
      let curStart  = 0;
      tokens.forEach((tok, wi) => {
        const pbId = `tv:${tv.abbr}:${osisBook}.${chNum}.${vNum}.${wi}`;
        if (wi > 0 && paragraphBreakIds.has(pbId)) {
          tvSegs.push({ tokens: curTokens, startWi: curStart });
          curTokens = [];
          curStart  = wi;
        }
        curTokens.push(tok);
      });
      if (curTokens.length > 0) tvSegs.push({ tokens: curTokens, startWi: curStart });
      return { abbr: tv.abbr, tvSegs };
    });

    // Render translation cell HTML for source-paragraph row at rowIdx.
    // Non-last rows show one translation paragraph segment; the last row
    // collects all remaining segments so nothing is lost.
    const renderTransCell = (rowIdx: number, isLastRow: boolean): string =>
      tvSegsPerEntry.map(({ abbr: tvAbbr, tvSegs }) => {
        const segsToShow = isLastRow
          ? tvSegs.slice(rowIdx)
          : (rowIdx < tvSegs.length ? [tvSegs[rowIdx]] : []);
        if (segsToShow.length === 0) return "";
        // Abbreviation label only on first row and when multiple translations
        const abbrHtml = (showAbbr && rowIdx === 0)
          ? `<span class="trans-abbr">${esc(tvAbbr)}</span>` : "";
        const segSpans = segsToShow
          .map((tvSeg, si) => {
            const spans = tvSeg.tokens
              .map((tok, localWi) => {
                const wi     = tvSeg.startWi + localWi;
                const wordId = `tv:${tvAbbr}:${osisBook}.${chNum}.${vNum}.${wi}`;
                return tvTokenToSpan(tok, wordId, characterRefMap, characterMap, wordTagRefMap, wordTagMap);
              })
              .join(" ");
            const cls = si > 0 ? "trans-text trans-para-break" : "trans-text";
            return `<span class="${cls}">${spans}</span>`;
          })
          .join("\n");
        return abbrHtml + segSpans;
      }).join("\n");

    // One <tr> per source paragraph segment (plus an optional scene-break row before it)
    const rows: string[] = [];
    vSegs.forEach((seg, rowIdx) => {
      const isLastRow    = rowIdx === vSegs.length - 1;
      const rowSpeechChr = seg.speechChar;
      const rowStyle     = rowSpeechChr
        ? ` style="background-color:${esc(rowSpeechChr.color)}18"`
        : "";

      // Scene break: emit a full-width separator row spanning all 3 columns
      const firstWordId = seg.words[0]?.wordId ?? "";
      const isScene     = seg.isParaBreak && sceneBreakMap.has(firstWordId);
      if (isScene) {
        const heading    = sceneBreakMap.get(firstWordId) ?? null;
        const headingHtml = heading ? `<span class="scene-heading">${esc(heading)}</span>` : "";
        rows.push(
          `<tr><td colspan="3" class="scene-break-row"><div class="scene-break">${headingHtml}</div></td></tr>`
        );
      }

      // Verse-number cell only in the first content row, spanning all content rows
      // (We count content rows = vSegs.length, excluding the scene-break separator rows above)
      const vnCell = rowIdx === 0
        ? `<td class="verse-num-col" rowspan="${vSegs.length}"><span class="verse-num">${verseNum}</span></td>`
        : "";

      // For source cell, use renderSegDiv but suppress the prepended scene div
      // (we already emitted the scene-break as a full-width row above)
      const srcDiv = (() => {
        const divStyles: string[] = [];
        if (seg.indentLevel > 0) {
          divStyles.push(`padding-${isHebrew ? "right" : "left"}:${seg.indentLevel * 2}rem`);
        }
        if (seg.speechChar) {
          const col = esc(seg.speechChar.color);
          divStyles.push(
            `border-${isHebrew ? "right" : "left"}:3px solid ${col}`,
            `padding-${isHebrew ? "right" : "left"}:0.75rem`,
            `margin-${isHebrew ? "right" : "left"}:-0.75rem`,
          );
        }
        // In side-by-side: scene segments use scene-seg class; para breaks use para-break;
        // but since we already rendered the separator row, don't add extra top border here
        const cls       = ["text-seg"].filter(Boolean).join(" ");
        const styleAttr = divStyles.length > 0 ? ` style="${divStyles.join(";")}"` : "";
        const label     = "";
        return `<div class="${esc(cls)}"${styleAttr}>${label}${renderSpans(seg)}</div>`;
      })();

      rows.push(
        `<tr${rowStyle}>\n` +
        `<td class="verse-source-td" dir="${dir}" lang="${lang}">${srcDiv}</td>\n` +
        vnCell +
        `<td class="verse-trans" dir="ltr">${renderTransCell(rowIdx, isLastRow)}</td>\n` +
        `</tr>`
      );
    });

    return `<table class="verse-table">\n${rows.join("\n")}\n</table>`;
  });

  // Outer wrapper is direction-neutral — tables always flow left→right
  return `<div>\n${tables.join("\n")}\n</div>`;
}

// ── Build wordSpeechMap from word list + speech sections ──────────────────────

function buildWordSpeechMap(
  words: Word[],
  sections: SpeechSection[],
): Map<string, SpeechSection> {
  const posMap = new Map(words.map((w, i) => [w.wordId, i]));
  const result = new Map<string, SpeechSection>();
  for (const section of sections) {
    const si = posMap.get(section.startWordId) ?? -1;
    const ei = posMap.get(section.endWordId)   ?? -1;
    if (si < 0 || ei < 0) continue;
    for (let i = si; i <= ei; i++) result.set(words[i].wordId, section);
  }
  return result;
}

// ── Self-contained Reveal.js HTML ─────────────────────────────────────────────

function buildRevealHtml(
  title:       string,
  slideContent: string,
  isHebrew:    boolean,
  wordArrows:  { fromWordId: string; toWordId: string; label: string | null }[],
): string {
  const sourceFontSize = isHebrew ? "1.4rem" : "1.25rem";
  const lineHeight     = isHebrew ? "2.4"    : "2.0";

  // Client-side arrow-drawing script (only emitted when there are arrows)
  const arrowScript = wordArrows.length === 0 ? "" : (() => {
    // Safe JSON: prevent premature </script> closing
    const arrowsJson = JSON.stringify(
      wordArrows.map((a) => ({ f: a.fromWordId, t: a.toWordId, l: a.label ?? null }))
    ).replace(/<\/script>/gi, "<\\/script>");

    return `
  <script>
    (function () {
      var A = ${arrowsJson};
      var C = '#64748B';

      function draw() {
        // SVG is position:fixed on <body> — covers the full viewport.
        // Coordinates are raw viewport coords from getBoundingClientRect(),
        // so Reveal.js scale/transform has no effect on arrow placement.
        var svg = document.getElementById('wao');
        if (!svg) {
          svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.id = 'wao';
          svg.setAttribute('style',
            'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
            'pointer-events:none;overflow:visible;z-index:9999;');
          svg.innerHTML =
            '<defs><marker id="wah" markerWidth="7" markerHeight="7" ' +
            'refX="3.5" refY="3.5" orient="auto">' +
            '<path d="M0,1 L7,3.5 L0,6 Z" fill="' + C + '" opacity="0.7"/>' +
            '</marker></defs>';
          document.body.appendChild(svg);
        }

        // Remove old arrow groups
        var old = svg.querySelectorAll('.wag');
        for (var i = 0; i < old.length; i++) old[i].remove();

        for (var ai = 0; ai < A.length; ai++) {
          var a   = A[ai];
          var fEl = document.querySelector('[data-word-id="' + a.f + '"]');
          var tEl = document.querySelector('[data-word-id="' + a.t + '"]');
          if (!fEl || !tEl) continue;

          var fr = fEl.getBoundingClientRect();
          var tr = tEl.getBoundingClientRect();

          // Raw viewport coordinates — no section offset adjustment needed
          var fx = fr.left + fr.width  / 2;
          var fy = fr.top  + fr.height + 3;
          var tx = tr.left + tr.width  / 2;
          var ty = tr.top  + tr.height + 3;

          var horiz = Math.abs(tx - fx);
          var depth = Math.max(horiz * 0.35 + 20, 24);
          var cx0 = fx, cy0 = fy + depth;
          var cx1 = tx, cy1 = ty + depth;

          var d = 'M '+fx+' '+fy+' C '+cx0+' '+cy0+','+cx1+' '+cy1+','+tx+' '+ty;

          // Cubic bezier midpoint (t = 0.5)
          var mx = 0.125*fx + 0.375*cx0 + 0.375*cx1 + 0.125*tx;
          var my = 0.125*fy + 0.375*cy0 + 0.375*cy1 + 0.125*ty;

          var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', 'wag');

          var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('d', d);
          p.setAttribute('stroke', C);
          p.setAttribute('stroke-width', '1.2');
          p.setAttribute('stroke-opacity', '0.6');
          p.setAttribute('fill', 'none');
          p.setAttribute('marker-end', 'url(#wah)');
          g.appendChild(p);

          if (a.l) {
            var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', mx);
            txt.setAttribute('y', my + depth / 2 + 12);
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('font-size', '9');
            txt.setAttribute('fill', C);
            txt.setAttribute('opacity', '0.8');
            txt.style.userSelect = 'none';
            txt.textContent = a.l;
            g.appendChild(txt);
          }

          svg.appendChild(g);
        }
      }

      Reveal.on('ready', function () {
        // Wait for web fonts so getBoundingClientRect() reflects final layout
        (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
          requestAnimationFrame(draw);
          // Redraw on scroll (section content scrolls, changing viewport positions)
          var sec = document.querySelector('.reveal .slides section');
          if (sec) sec.addEventListener('scroll', draw, { passive: true });
          // Redraw on window resize (Reveal.js rescales the presentation)
          window.addEventListener('resize', draw, { passive: true });
        });
      });
    }());
  </script>`;
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css" />
  <link href="https://fonts.googleapis.com/css2?family=Gentium+Plus:ital@0;1&display=swap" rel="stylesheet" />
  <style>
    :root { --r-main-font-size: 1rem; }

    .reveal .slides section {
      text-align: ${isHebrew ? "right" : "left"};
      padding: 1.5rem 2rem;
      max-height: 90vh;
      overflow-y: auto;
      box-sizing: border-box;
    }

    .slide-ref {
      display: block;
      font-size: 0.65em;
      opacity: 0.45;
      margin-bottom: 0.75em;
      font-family: Georgia, 'Times New Roman', serif;
    }

    [lang="he"] {
      font-family: "Ezra SIL", "SBL Hebrew", "Frank Ruehl CLM", serif;
      font-size: ${sourceFontSize};
      line-height: ${lineHeight};
      direction: rtl;
    }

    [lang="grc"] {
      font-family: "Gentium Plus", "Gentium", serif;
      font-size: ${sourceFontSize};
      line-height: ${lineHeight};
    }

    .verse-num {
      font-size: 0.55em;
      opacity: 0.4;
      vertical-align: super;
      margin-${isHebrew ? "left" : "right"}: 0.25em;
      font-family: Georgia, 'Times New Roman', serif;
    }

    /* Paragraph segment block */
    .text-seg {
      display: block;
      margin-bottom: 0.1em;
    }

    /* Explicit paragraph break — extra spacing above (no border) */
    .para-break {
      margin-top: 0.65em;
    }

    /* Side-by-side verse table: [source ~47%] [verse# ~6%] [translation ~47%] */
    .verse-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 0.35em;
      table-layout: fixed;
    }
    .verse-table td {
      vertical-align: top;
      padding: 0;
    }
    .verse-source-td { width: 47%; }

    /* Verse number in the centre column */
    .verse-num-col {
      width: 6%;
      padding-top: 0.3em;
      text-align: center;
      font-size: 0.55em;
      opacity: 0.4;
      font-family: Georgia, 'Times New Roman', serif;
      white-space: nowrap;
    }

    /* Translation column — always LTR English regardless of source direction */
    .verse-trans {
      width: 47%;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 0.875em;
      line-height: 1.625;
      color: rgba(0,0,0,0.72);
      padding-top: 0.25em;
      text-align: left;
      direction: ltr;
    }

    /* Abbreviation label (only shown when multiple translations are present) */
    .trans-abbr {
      display: block;
      font-size: 0.75em;
      font-weight: 600;
      opacity: 0.5;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 0.1em;
    }

    /* Each translation paragraph segment */
    .trans-text {
      display: block;
      margin-bottom: 0.2em;
    }

    /* Translation paragraph break — extra spacing above (no border) */
    .trans-para-break {
      margin-top: 0.65em;
    }

    /* Scene break — solid rule + optional heading */
    .scene-break {
      border-top: 2px solid rgba(0,0,0,0.35);
      margin-top: 1.2em;
      margin-bottom: 0.3em;
      padding-top: 0.35em;
    }
    .scene-heading {
      display: block;
      font-size: 0.6em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.5;
      font-family: Georgia, serif;
      margin-bottom: 0.4em;
    }

    /* Scene break full-width row in side-by-side tables */
    .scene-break-row {
      padding: 0;
    }
    .scene-break-row .scene-break {
      margin-top: 0.8em;
    }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section data-overflow="scroll">
        <span class="slide-ref">${esc(title)}</span>
        ${slideContent}
      </section>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      controls: true,
      progress: true,
      slideNumber: false,
      transition: "none",
    });
  </script>${arrowScript}
</body>
</html>`;
}

// ── Build translation map from available translations + verse data ─────────────
// Key: "${chapter}.${verse}" → array of { abbr, text } entries (one per translation)

async function buildTranslationMap(
  translations: Translation[],
  osisBook:     string,
  chapters:     number[],
  workspaceId:  number,
): Promise<Map<string, { abbr: string; text: string }[]>> {
  const map = new Map<string, { abbr: string; text: string }[]>();
  await Promise.all(
    translations.map(async (t) => {
      const versesPerChapter = await Promise.all(
        chapters.map((ch) => getTranslationVerses(t.id, osisBook, ch, workspaceId))
      );
      for (const v of versesPerChapter.flat()) {
        const key     = `${v.chapter}.${v.verse}`;
        const entries = map.get(key) ?? [];
        entries.push({ abbr: t.abbreviation, text: v.text });
        map.set(key, entries);
      }
    })
  );
  return map;
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const passageIdStr = searchParams.get("passageId");

  const workspaceId = await getActiveWorkspaceId();

  let words:                Word[];
  let characters:           Character[];
  let characterRefs:        CharacterRef[];
  let speechSections:       SpeechSection[];
  let formattingRows:       { wordId: string; isBold: boolean; isItalic: boolean }[];
  let paragraphBreakIds:    string[];
  let sceneBreakRows:       { wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean }[];
  let wordTags:             WordTag[];
  let wordTagRefs:          WordTagRef[];
  let lineIndentRows:       { wordId: string; indentLevel: number }[];
  let wordArrows:           WordArrow[];
  let translationMap:       Map<string, { abbr: string; text: string }[]>;
  let osisBook:             string;
  let title:                string;
  let filename:             string;
  let isHebrew:             boolean;

  if (passageIdStr) {
    // ── Passage mode ──────────────────────────────────────────────────────
    const passageId = parseInt(passageIdStr, 10);
    if (isNaN(passageId)) {
      return NextResponse.json({ error: "Invalid passageId" }, { status: 400 });
    }

    const passage = await getPassage(passageId);
    if (!passage) return NextResponse.json({ error: "Passage not found" }, { status: 404 });

    osisBook         = passage.book;
    const textSource = passage.textSource as TextSource;
    const bookRecord = await getBook(osisBook);
    const bookName   = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
    isHebrew         = bookRecord?.language === "hebrew";

    const chapterRange: number[] = [];
    for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) chapterRange.push(ch);

    const [passageWords, chars, tags, perChapter, arrowsByChapter, availableTranslations] =
      await Promise.all([
        getPassageWords(
          osisBook, textSource,
          passage.startChapter, passage.startVerse,
          passage.endChapter,   passage.endVerse,
        ),
        getCharacters(osisBook, workspaceId),
        getWordTags(osisBook, workspaceId),
        Promise.all(
          chapterRange.map((ch) =>
            Promise.all([
              getChapterCharacterRefs(osisBook, ch, workspaceId),
              getChapterSpeechSections(osisBook, ch, textSource, workspaceId),
              getChapterWordFormatting(osisBook, ch, workspaceId),
              getChapterParagraphBreaks(osisBook, ch, workspaceId),
              getChapterWordTagRefs(osisBook, ch, workspaceId),
              getChapterLineIndents(osisBook, ch, workspaceId),
              getChapterSceneBreaks(osisBook, ch, workspaceId),
            ])
          )
        ),
        Promise.all(
          chapterRange.map((ch) => getChapterWordArrows(osisBook, ch, textSource, workspaceId))
        ),
        getAvailableTranslationsForChapter(osisBook, passage.startChapter, workspaceId),
      ]);

    words             = passageWords;
    characters        = chars;
    wordTags          = tags;
    characterRefs     = perChapter.flatMap(([r]) => r);
    speechSections    = perChapter.flatMap(([, s]) => s);
    formattingRows    = perChapter.flatMap(([,, f]) => f);
    paragraphBreakIds = perChapter.flatMap(([,,, p]) => p);
    wordTagRefs       = perChapter.flatMap(([,,,, t]) => t);
    lineIndentRows    = perChapter.flatMap(([,,,,, l]) => l);
    sceneBreakRows    = perChapter.flatMap(([,,,,,, sb]) => sb);
    wordArrows        = arrowsByChapter.flat();
    translationMap    = await buildTranslationMap(availableTranslations, osisBook, chapterRange, workspaceId);

    title    = passage.label
      || `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse}`;
    filename = `structura-passage-${passageId}`;

  } else {
    // ── Chapter mode ──────────────────────────────────────────────────────
    const bookParam   = searchParams.get("book");
    const sourceParam = searchParams.get("source");
    const chapterStr  = searchParams.get("chapter");

    if (!bookParam || !sourceParam || !chapterStr) {
      return NextResponse.json(
        { error: "Provide either passageId or book + source + chapter" },
        { status: 400 }
      );
    }

    const chapter    = parseInt(chapterStr, 10);
    osisBook         = bookParam;
    const textSource = sourceParam as TextSource;

    if (isNaN(chapter) || chapter < 1) {
      return NextResponse.json({ error: "Invalid chapter" }, { status: 400 });
    }

    const bookRecord = await getBook(osisBook);
    const bookName   = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
    isHebrew         = bookRecord?.language === "hebrew";

    const [chapterWords, chars, refs, sections, fmt, paraBreaks, sceneBreaks, tags, tagRefs, indents, arrows, availableTranslations] =
      await Promise.all([
        getChapterWords(osisBook, chapter, textSource),
        getCharacters(osisBook, workspaceId),
        getChapterCharacterRefs(osisBook, chapter, workspaceId),
        getChapterSpeechSections(osisBook, chapter, textSource, workspaceId),
        getChapterWordFormatting(osisBook, chapter, workspaceId),
        getChapterParagraphBreaks(osisBook, chapter, workspaceId),
        getChapterSceneBreaks(osisBook, chapter, workspaceId),
        getWordTags(osisBook, workspaceId),
        getChapterWordTagRefs(osisBook, chapter, workspaceId),
        getChapterLineIndents(osisBook, chapter, workspaceId),
        getChapterWordArrows(osisBook, chapter, textSource, workspaceId),
        getAvailableTranslationsForChapter(osisBook, chapter, workspaceId),
      ]);

    words             = chapterWords;
    characters        = chars;
    characterRefs     = refs;
    speechSections    = sections;
    formattingRows    = fmt;
    paragraphBreakIds = paraBreaks;
    sceneBreakRows    = sceneBreaks;
    wordTags          = tags;
    wordTagRefs       = tagRefs;
    lineIndentRows    = indents;
    wordArrows        = arrows;
    translationMap    = await buildTranslationMap(availableTranslations, osisBook, [chapter], workspaceId);

    title    = `${bookName} ${chapter}`;
    filename = `structura-${osisBook}-${chapter}`;
  }

  if (!words || words.length === 0) {
    return NextResponse.json({ error: "No words found" }, { status: 404 });
  }

  // ── Build lookup maps ────────────────────────────────────────────────────────

  const characterMap     = new Map(characters.map((c) => [c.id, c]));
  const formattingMap    = new Map(formattingRows.map((f) => [f.wordId, { isBold: f.isBold, isItalic: f.isItalic }]));
  const wordSpeechMap    = buildWordSpeechMap(words, speechSections);
  const characterRefMap  = new Map(characterRefs.map((r) => [r.wordId, r]));
  const wordTagMap       = new Map(wordTags.map((t) => [t.id, t]));
  const wordTagRefMap    = new Map(wordTagRefs.map((r) => [r.wordId, r]));
  const lineIndentMap    = new Map(lineIndentRows.map((l) => [l.wordId, l.indentLevel]));
  const breakIdSet       = new Set(paragraphBreakIds);
  const wordToParaStart  = buildWordToParaStart(words, breakIdSet);
  // Build sceneBreakMap: wordId → heading of the highest-priority (lowest level number) break
  const sceneBreakMap = new Map<string, string | null>();
  for (const sb of sceneBreakRows) {
    const existing = sceneBreakMap.get(sb.wordId);
    if (existing === undefined) {
      sceneBreakMap.set(sb.wordId, sb.heading);
    }
    // Keep the first encountered (getChapterSceneBreaks returns sorted by verse/level asc)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const slideContent = renderWords(
    words,
    formattingMap,
    wordSpeechMap,
    characterMap,
    characterRefMap,
    wordTagRefMap,
    wordTagMap,
    breakIdSet,
    lineIndentMap,
    wordToParaStart,
    translationMap,
    osisBook,
    isHebrew,
    sceneBreakMap,
  );

  const html = buildRevealHtml(title, slideContent, isHebrew, wordArrows);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.html"`,
    },
  });
}
