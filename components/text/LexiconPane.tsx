"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { LexiconEntry } from "@/lib/db/schema";
import { getGreekLexicon, getHebrewLexicon } from "@/components/SettingsButton";

interface LexiconPaneProps {
  wordLemma?: string | null;    // Greek: look up by lemma (SBLGNT / LXX)
  strongNumber?: string | null; // Hebrew: look up by Strong's number
  isHebrew: boolean;
  textSource?: string;          // e.g. "STEPBIBLE_LXX" — auto-selects LSJ
}

interface Suggestion {
  strongNumber: string | null;
  lemma: string | null;
  shortGloss: string | null;
}

// ── Strong's number helpers ───────────────────────────────────────────────────

const STRONG_RE = /^([HhGg])(\d+)$/;

function parseStrong(s: string): { prefix: string; n: number } | null {
  const m = s.trim().match(STRONG_RE);
  return m ? { prefix: m[1].toUpperCase(), n: parseInt(m[2], 10) } : null;
}

function entryStrongNum(entry: LexiconEntry | null | "loading"): { prefix: string; n: number } | null {
  if (!entry || entry === "loading") return null;
  return parseStrong(entry.strongNumber ?? "");
}

const HEBREW_MAX = 8674;
const GREEK_MAX  = 5624;

// ── Abbott-Smith XML → HTML converter ─────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function convertTeiNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.localName;
  const ch = () => Array.from(el.childNodes).map(convertTeiNode).join("");

  switch (tag) {
    case "entry": {
      const nAttr = el.getAttribute("n") ?? "";
      const id = escHtml(nAttr.split("|")[0]);
      return `<p class="entry" id="${id}"><bdo dir="ltr">${ch()}</bdo></p>`;
    }
    case "form":   return ch();
    case "orth":   return `<span class="orth">${ch()}</span>`;
    case "pos":    return `<span class="pos">${ch()}</span>`;
    case "gloss":  return `<span class="gloss">${ch()}</span>`;
    case "emph":   return `<em>${ch()}</em>`;
    case "lb":     return "<br/>";
    case "pb":     return "";
    case "re":     return `<div class="re">${ch()}</div>`;
    case "sense": {
      const n = el.getAttribute("n");
      return `<div class="sense">${n ? `<strong>${escHtml(n)}</strong> ` : ""}${ch()}</div>`;
    }
    case "foreign": {
      const lang =
        el.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ??
        el.getAttribute("xml:lang") ?? "";
      if (lang === "heb") return `<bdo dir="rtl"><span class="hebrew">${ch()}</span></bdo>`;
      if (lang === "arc") return `<bdo dir="rtl"><span class="aramaic">${ch()}</span></bdo>`;
      if (lang === "grc") return `<span class="greek">${ch()}</span>`;
      if (lang === "lat") return `<span class="latin">${ch()}</span>`;
      return `<span class="foreign">${ch()}</span>`;
    }
    case "hi": {
      const rend = el.getAttribute("rend") ?? "";
      if (rend === "subscript")   return `<sub>${ch()}</sub>`;
      if (rend === "superscript") return `<sup>${ch()}</sup>`;
      return ch();
    }
    case "note": {
      const type = el.getAttribute("type")     ?? "";
      const n    = el.getAttribute("n")        ?? "";
      const anch = el.getAttribute("anchored") ?? "";
      if (type === "occurrencesNT")
        return `<sup class="count"> [NT: <span>${escHtml(n)}</span>x] </sup>`;
      if (anch === "true")
        return `<sup> [<span>${escHtml(n)}. ${ch()}</span>] </sup>`;
      return `<sup> [<span>${ch()}</span>] </sup>`;
    }
    case "ref": return ch();
    default:    return ch();
  }
}

function teiXmlToHtml(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return "";
    return convertTeiNode(doc.documentElement);
  } catch {
    return "";
  }
}

// ── Scoped Abbott-Smith styles ────────────────────────────────────────────────

const ABBOTT_SMITH_CSS = `
.abbott-smith-entry p.entry { padding-left: 1.5em; position: relative; line-height: 1.5; font-family: serif; margin: 0.25em 0; }
.abbott-smith-entry sup.count { position: absolute; left: 0; text-indent: 0; color: #999; font-size: 0.7em; }
.abbott-smith-entry span.orth { font-family: "Gentium Plus", "SBL Greek", serif; font-size: 1.1em; font-weight: bold; }
.abbott-smith-entry span.greek { font-family: "Gentium Plus", "SBL Greek", serif; font-size: 1.1em; }
.abbott-smith-entry span.hebrew { font-family: "Ezra SIL", "SBL Hebrew", serif; margin: 0 0.1em; font-size: 1.3em; }
.abbott-smith-entry span.aramaic { font-family: "Ezra SIL", "SBL Hebrew", serif; margin: 0 0.1em; font-size: 1.3em; }
.abbott-smith-entry span.latin { font-style: italic; }
.abbott-smith-entry span.foreign { font-style: italic; }
.abbott-smith-entry span.pos { color: #15803d; }
.abbott-smith-entry span.gloss { font-weight: bold; font-style: italic; }
.abbott-smith-entry .sense { border-left: 1px solid #ccc; padding-left: 0.75em; margin: 0.25em 0; }
.abbott-smith-entry .sense .sense { border-left: none; padding-left: 0; display: inline; }
.abbott-smith-entry .re { margin: 0.5em 0 0.5em 1.5em; font-family: serif; }
.abbott-smith-entry .re .sense { border-left: none; padding-left: 0; margin: 0; display: inline; }
`;

let cssInjected = false;
function ensureAbbottSmithCss() {
  if (cssInjected || typeof document === "undefined") return;
  if (document.getElementById("abbott-smith-scoped-css")) { cssInjected = true; return; }
  const style = document.createElement("style");
  style.id = "abbott-smith-scoped-css";
  style.textContent = ABBOTT_SMITH_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// ── LSJ XML → HTML converter ──────────────────────────────────────────────────

const LSJ_CSS = `
.lsj-entry { font-family: serif; line-height: 1.55; font-size: 0.85rem; }
.lsj-orth { font-family: "Gentium Plus", "GFS Didot", serif; font-weight: bold; font-size: 1.05em; }
.lsj-itype { font-style: italic; color: #888; }
.lsj-pos { color: #15803d; font-style: italic; }
.lsj-sense-1 { margin: 0.5em 0 0.25em 0.75em; }
.lsj-sense-2 { margin: 0.2em 0 0.1em 1.5em; }
.lsj-sense-n { font-weight: bold; margin-right: 0.2em; }
.lsj-tr { font-style: italic; }
.lsj-greek { font-family: "Gentium Plus", "GFS Didot", serif; }
.lsj-latin { font-style: italic; }
.lsj-bibl { color: #aaa; font-size: 0.8em; }
.lsj-ref { color: #888; }
.lsj-etym { color: #777; font-style: italic; }
.dark .lsj-itype { color: #999; }
.dark .lsj-bibl { color: #555; }
.dark .lsj-ref { color: #666; }
.dark .lsj-etym { color: #666; }
/* STEPBible HTML format — Level tags rendered as indented blocks */
.lsj-entry .lsj-level-2 { display: block; margin-top: 0.4em; margin-left: 0.5em; }
.lsj-entry .lsj-level-3 { display: block; margin-top: 0.25em; margin-left: 1em; }
.lsj-entry .lsj-level-4 { display: block; margin-top: 0.15em; margin-left: 1.5em; }
/* Citation tooltips: muted colour, pointer cursor so the title hint is discoverable */
.lsj-entry span[title] { color: #888; font-size: 0.8em; cursor: help; }
.dark .lsj-entry span[title] { color: #555; }
`;

let lsjCssInjected = false;
function ensureLsjCss() {
  if (lsjCssInjected || typeof document === "undefined") return;
  if (document.getElementById("lsj-scoped-css")) { lsjCssInjected = true; return; }
  const style = document.createElement("style");
  style.id = "lsj-scoped-css";
  style.textContent = LSJ_CSS;
  document.head.appendChild(style);
  lsjCssInjected = true;
}

function convertLsjNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.localName;
  const ch = () => Array.from(el.childNodes).map(convertLsjNode).join("");

  switch (tag) {
    case "entryFree": return `<div class="lsj-entry">${ch()}</div>`;
    case "orth":   return `<span class="lsj-orth">${ch()}</span>`;
    case "itype":  return `<span class="lsj-itype"> (${ch()})</span>`;
    case "pos":    return `<span class="lsj-pos">${ch()}</span>`;
    case "sense": {
      const n     = el.getAttribute("n");
      const level = parseInt(el.getAttribute("level") ?? "1", 10);
      const cls   = level <= 1 ? "lsj-sense-1" : "lsj-sense-2";
      return `<div class="${cls}">${n ? `<span class="lsj-sense-n">${escHtml(n)}</span>` : ""}${ch()}</div>`;
    }
    case "tr":    return `<span class="lsj-tr">${ch()}</span>`;
    case "foreign": {
      const lang = el.getAttribute("lang") ?? "";
      if (lang === "greek") return `<span class="lsj-greek">${ch()}</span>`;
      if (lang === "la" || lang === "latin") return `<em class="lsj-latin">${ch()}</em>`;
      return `<em>${ch()}</em>`;
    }
    case "bibl":      return `<span class="lsj-bibl">(${ch()})</span>`;
    case "author":    return ch();
    case "title":     return `<em>${ch()}</em>`;
    case "biblScope": return ch();
    case "ref":       return `<span class="lsj-ref">${ch()}</span>`;
    case "etym":      return `<span class="lsj-etym">${ch()}</span>`;
    case "emph":      return `<em>${ch()}</em>`;
    case "hi": {
      const rend = el.getAttribute("rend") ?? "";
      if (rend === "superscript") return `<sup>${ch()}</sup>`;
      if (rend === "subscript")   return `<sub>${ch()}</sub>`;
      return ch();
    }
    case "lb": return "<br/>";
    case "cb": return "";
    case "pb": return "";
    default:   return ch();
  }
}

function lsjXmlToHtml(xml: string): string {
  if (!xml) return "";
  // STEPBible format: definition is already HTML (starts with <b> or similar tags).
  // Legacy Perseus format: definition is TEI XML (starts with <entryFree).
  if (!xml.trimStart().startsWith("<entryFree")) {
    // Convert STEPBible's custom Level tags to styled divs and strip __ indent markers.
    const html = xml
      .replace(/<Level2>([\s\S]*?)<\/Level2>/gi, '<div class="lsj-level-2">$1</div>')
      .replace(/<Level3>([\s\S]*?)<\/Level3>/gi, '<div class="lsj-level-3">$1</div>')
      .replace(/<Level4>([\s\S]*?)<\/Level4>/gi, '<div class="lsj-level-4">$1</div>')
      .replace(/__+/g, "");
    return `<div class="lsj-entry">${html}</div>`;
  }
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return "";
    return convertLsjNode(doc.documentElement);
  } catch {
    return "";
  }
}

// ── Entry display ─────────────────────────────────────────────────────────────

function EntryDisplay({
  entry,
  isHebrew,
  abbottHtml,
  lsjHtml,
}: {
  entry: LexiconEntry | null | "loading";
  isHebrew: boolean;
  abbottHtml: string;
  lsjHtml: string;
}) {
  if (entry === "loading") {
    return (
      <div className="space-y-2 animate-pulse mt-3">
        <div className="h-7 w-24 bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-4 w-40 bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-3 w-full bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-3 w-5/6 bg-stone-100 dark:bg-stone-800 rounded" />
      </div>
    );
  }

  if (!entry) {
    return (
      <p className="mt-3 text-xs text-stone-400 dark:text-stone-600 italic">No entry found.</p>
    );
  }

  const sourceName =
    entry.source === "BDB"          ? "Brown-Driver-Briggs (Unabridged)" :
    entry.source === "HebrewStrong" ? "Strong's Hebrew Dictionary (1894)" :
    entry.source === "Dodson"       ? "Dodson Greek Lexicon" :
    entry.source === "AbbottSmith"  ? "Abbott-Smith" :
    entry.source === "LSJ"          ? "Liddell-Scott-Jones (LSJ)" :
    (entry.source ?? "");

  if (entry.source === "HebrewStrong" && entry.definition) {
    return (
      <div className="mt-3">
        <div className="text-2xl leading-snug mb-1 lexicon-hebrew text-right" dir="rtl" lang="he">
          {entry.lemma}
        </div>
        {(entry.transliteration || entry.pronunciation) && (
          <div className="mb-2">
            {entry.transliteration && (
              <span className="text-sm text-stone-500 dark:text-stone-400 italic">
                {entry.transliteration}
              </span>
            )}
            {entry.pronunciation && (
              <span className="ml-1 text-xs text-stone-400 dark:text-stone-600">
                ({entry.pronunciation})
              </span>
            )}
          </div>
        )}
        {entry.shortGloss && (
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-200 mb-2">
            {entry.shortGloss}
          </p>
        )}
        <div
          className="strong-hebrew-entry"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: entry.definition }}
        />
        <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-3">{sourceName}</p>
      </div>
    );
  }

  if (entry.source === "AbbottSmith") {
    return (
      <div className="mt-3">
        <div
          className="abbott-smith-entry"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: abbottHtml || "" }}
        />
        <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-3">{sourceName}</p>
      </div>
    );
  }

  if (entry.source === "LSJ") {
    return (
      <div className="mt-3">
        {entry.transliteration && (
          <div className="text-2xl leading-snug mb-1 lexicon-greek" lang="grc">
            {entry.transliteration}
          </div>
        )}
        {entry.shortGloss && (
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-200 mb-2">
            {entry.shortGloss}
          </p>
        )}
        <div
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: lsjHtml || "" }}
        />
        <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-3">{sourceName}</p>
      </div>
    );
  }

  if (entry.source === "BDB" && entry.definition) {
    return (
      <div className="mt-3">
        <div
          className="bdb-entry"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: entry.definition }}
        />
        <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-3">{sourceName}</p>
      </div>
    );
  }

  const headwordFont = isHebrew ? "lexicon-hebrew" : "lexicon-greek";
  const headwordDir  = isHebrew ? "rtl" : "ltr";
  const headwordLang = isHebrew ? "he"  : "grc";

  return (
    <div className="mt-3">
      <div
        className={`text-2xl leading-snug mb-1 ${headwordFont} ${isHebrew ? "text-right" : ""}`}
        dir={headwordDir}
        lang={headwordLang}
      >
        {entry.lemma}
      </div>
      {(entry.transliteration || entry.pronunciation) && (
        <div className="mb-2">
          {entry.transliteration && (
            <span className="text-sm lexicon-greek text-stone-500 dark:text-stone-400" lang="grc">
              {entry.transliteration}
            </span>
          )}
          {entry.pronunciation && (
            <span className="ml-1 text-xs text-stone-400 dark:text-stone-600">
              ({entry.pronunciation})
            </span>
          )}
        </div>
      )}
      {entry.shortGloss && (
        <p className="text-sm font-semibold text-stone-800 dark:text-stone-200 mb-2">
          {entry.shortGloss}
        </p>
      )}
      {entry.definition && entry.definition !== entry.shortGloss && (
        <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed mb-2">
          {entry.definition}
        </p>
      )}
      {entry.usage && (
        <p className="text-xs italic text-stone-400 dark:text-stone-500 leading-relaxed mb-2">
          {entry.usage}
        </p>
      )}
      <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-1">{sourceName}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LexiconPane({ wordLemma, strongNumber, isHebrew, textSource }: LexiconPaneProps) {
  const isLxx = textSource === "STEPBIBLE_LXX";

  const [entry, setEntry]           = useState<LexiconEntry | null | "loading">("loading");
  const [lexiconSource, setSource]  = useState<string>(() =>
    isHebrew ? getHebrewLexicon() : isLxx ? "LSJ" : getGreekLexicon()
  );
  const [abbottHtml, setAbbottHtml] = useState("");
  const [lsjHtml,    setLsjHtml]    = useState("");

  // ── Navigation state ───────────────────────────────────────────────────────
  // overrideLookup is set when the user manually navigates; null = use props.
  const [overrideLookup, setOverrideLookup] = useState<
    { kind: "strong"; value: string } | { kind: "lemma"; value: string } | null
  >(null);

  // Text shown in the nav input; separate from committed lookup so the user
  // can edit freely before pressing Enter.
  const [inputValue, setInputValue]   = useState<string>("");
  const [editing, setEditing]         = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggIdx, setSuggIdx]         = useState(-1);

  const fetchKey    = useRef("");
  const inputRef    = useRef<HTMLInputElement>(null);
  const suggTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurPending = useRef(false);

  // ── Resolve what to fetch ──────────────────────────────────────────────────

  const resolvedStrong = overrideLookup?.kind === "strong"
    ? overrideLookup.value
    : (isHebrew ? (strongNumber ?? null) : null);

  const resolvedLemma = overrideLookup?.kind === "lemma"
    ? overrideLookup.value
    : (!isHebrew ? (wordLemma ?? null) : null);

  // When props change from the outside (user clicked a new word), reset overrides.
  useEffect(() => {
    setOverrideLookup(null);
    setSuggestions([]);
    setEditing(false);
  }, [strongNumber, wordLemma]);

  // Update input display whenever the resolved key changes (but not while editing).
  useEffect(() => {
    if (editing) return;
    if (resolvedStrong) setInputValue(resolvedStrong);
    else if (resolvedLemma) setInputValue(resolvedLemma);
  }, [resolvedStrong, resolvedLemma, editing]);

  // ── Fetch entry ────────────────────────────────────────────────────────────

  useEffect(() => {
    window.addEventListener("structura:settingsChange", onSettingsChange);
    return () => window.removeEventListener("structura:settingsChange", onSettingsChange);
    function onSettingsChange(e: Event) {
      const detail = (e as CustomEvent<Record<string, string>>).detail;
      if (isHebrew && detail.hebrewLexicon) setSource(detail.hebrewLexicon);
      // LXX always uses LSJ; only update source for SBLGNT Greek
      else if (!isHebrew && !isLxx && detail.greekLexicon) setSource(detail.greekLexicon);
    }
  }, [isHebrew, isLxx]);

  useEffect(() => {
    const lookupKey = resolvedStrong ?? resolvedLemma ?? "";
    if (!lookupKey) { setEntry(null); return; }

    const key = `${lookupKey}:${lexiconSource}`;
    if (key === fetchKey.current) return;
    fetchKey.current = key;
    setEntry("loading");
    setAbbottHtml("");

    const url = resolvedStrong
      ? `/api/lexicon?strong=${encodeURIComponent(resolvedStrong.split(/[/,\s]/)[0])}&source=${encodeURIComponent(lexiconSource)}`
      : `/api/lexicon?lemma=${encodeURIComponent(resolvedLemma!)}&source=${encodeURIComponent(lexiconSource)}`;

    fetch(url)
      .then((r) => r.json())
      .then((data: { entry: LexiconEntry | null }) => {
        if (fetchKey.current === key) setEntry(data.entry);
      })
      .catch(() => { if (fetchKey.current === key) setEntry(null); });
  }, [resolvedStrong, resolvedLemma, lexiconSource]);

  // AbbottSmith conversion
  useEffect(() => {
    if (!entry || entry === "loading" || entry.source !== "AbbottSmith" || !entry.definition) {
      setAbbottHtml(""); return;
    }
    ensureAbbottSmithCss();
    setAbbottHtml(teiXmlToHtml(entry.definition));
  }, [entry]);

  // LSJ conversion
  useEffect(() => {
    if (!entry || entry === "loading" || entry.source !== "LSJ" || !entry.definition) {
      setLsjHtml(""); return;
    }
    ensureLsjCss();
    setLsjHtml(lsjXmlToHtml(entry.definition));
  }, [entry]);

  // ── Navigation helpers ─────────────────────────────────────────────────────

  // Get current Strong's number from entry or from prop/override.
  const currentStrong = (() => {
    const esn = entryStrongNum(entry);
    if (esn) return esn;
    const s = resolvedStrong ?? (isHebrew ? strongNumber : null);
    return s ? parseStrong(s) : null;
  })();

  const maxN   = isHebrew ? HEBREW_MAX : GREEK_MAX;
  const prefix = isHebrew ? "H" : "G";

  const canPrev = currentStrong !== null && currentStrong.n > 1;
  const canNext = currentStrong !== null && currentStrong.n < maxN;

  function navigateStrong(n: number) {
    const value = `${prefix}${n}`;
    setOverrideLookup({ kind: "strong", value });
    setInputValue(value);
    setSuggestions([]);
    setEditing(false);
  }

  function commitInput(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (parseStrong(trimmed)) {
      setOverrideLookup({ kind: "strong", value: trimmed.toUpperCase() });
    } else {
      setOverrideLookup({ kind: "lemma", value: trimmed });
    }
    setSuggestions([]);
    setEditing(false);
  }

  // ── Suggestion fetching ────────────────────────────────────────────────────

  const fetchSuggestions = useCallback((q: string) => {
    if (suggTimer.current) clearTimeout(suggTimer.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggTimer.current = setTimeout(async () => {
      try {
        const lang = isHebrew ? "hebrew" : "greek";
        const url  = `/api/lexicon/search?q=${encodeURIComponent(q)}&lang=${lang}&source=${encodeURIComponent(lexiconSource)}&limit=8`;
        const res  = await fetch(url);
        const data = await res.json() as { results: Suggestion[] };
        setSuggestions(data.results ?? []);
        setSuggIdx(-1);
      } catch {
        setSuggestions([]);
      }
    }, 150);
  }, [isHebrew, lexiconSource]);

  // ── Input handlers ─────────────────────────────────────────────────────────

  function onInputFocus() {
    setEditing(true);
    setSuggestions([]);
    fetchSuggestions(inputValue);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setInputValue(v);
    setSuggIdx(-1);
    fetchSuggestions(v);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggIdx >= 0 && suggestions[suggIdx]) {
        pickSuggestion(suggestions[suggIdx]);
      } else {
        commitInput(inputValue);
      }
    } else if (e.key === "Escape") {
      // Revert to the currently displayed identifier
      const current = resolvedStrong ?? resolvedLemma ?? "";
      setInputValue(current);
      setSuggestions([]);
      setEditing(false);
      inputRef.current?.blur();
    }
  }

  function onInputBlur() {
    // Delay so that suggestion clicks register before blur dismisses the list.
    blurPending.current = true;
    setTimeout(() => {
      if (!blurPending.current) return;
      blurPending.current = false;
      setSuggestions([]);
      setEditing(false);
      // Revert input to current identifier if user didn't commit.
      const current = resolvedStrong ?? resolvedLemma ?? "";
      setInputValue(current);
    }, 150);
  }

  function pickSuggestion(s: Suggestion) {
    blurPending.current = false;
    const value = s.strongNumber ?? s.lemma ?? "";
    const kind: "strong" | "lemma" = s.strongNumber ? "strong" : "lemma";
    setOverrideLookup({ kind, value });
    setInputValue(s.strongNumber
      ? s.strongNumber
      : (s.lemma ?? ""));
    setSuggestions([]);
    setEditing(false);
    inputRef.current?.blur();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">
      {/* Navigation bar */}
      <div className="flex items-center gap-1 mb-1">
        {/* Prev */}
        <button
          onClick={() => canPrev && navigateStrong(currentStrong!.n - 1)}
          disabled={!canPrev}
          title="Previous entry"
          className="w-6 h-6 flex items-center justify-center rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-25 disabled:pointer-events-none shrink-0 text-xs"
        >
          ←
        </button>

        {/* Search input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={onInputChange}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
            onKeyDown={onInputKeyDown}
            placeholder={isHebrew ? "H1, H2…" : "lemma or G1…"}
            className={[
              "w-full text-xs px-2 py-1 rounded border bg-[var(--background)] text-[var(--foreground)]",
              "placeholder-stone-400 dark:placeholder-stone-600",
              "focus:outline-none focus:ring-1 focus:ring-amber-400",
              editing
                ? "border-amber-400"
                : "border-stone-200 dark:border-stone-700",
            ].join(" ")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />

          {/* Suggestion dropdown */}
          {editing && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-0.5 z-50 bg-[var(--background)] border border-stone-200 dark:border-stone-700 rounded shadow-lg overflow-hidden">
              {suggestions.map((s, idx) => {
                const label = isHebrew
                  ? s.strongNumber
                  : (s.lemma ?? s.strongNumber ?? "");
                const sub = s.shortGloss
                  ? s.shortGloss.slice(0, 60) + (s.shortGloss.length > 60 ? "…" : "")
                  : (isHebrew ? "" : (s.strongNumber ?? ""));
                return (
                  <button
                    key={idx}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                    className={[
                      "w-full text-left px-2 py-1.5 flex items-baseline gap-2 text-xs",
                      "hover:bg-amber-50 dark:hover:bg-amber-950/30",
                      idx === suggIdx ? "bg-amber-50 dark:bg-amber-950/30" : "",
                    ].join(" ")}
                  >
                    <span
                      className={isHebrew ? "lexicon-hebrew shrink-0" : "lexicon-greek shrink-0"}
                      dir={isHebrew ? "rtl" : "ltr"}
                      lang={isHebrew ? "he" : "grc"}
                    >
                      {isHebrew ? s.lemma : label}
                    </span>
                    {isHebrew && s.strongNumber && (
                      <span className="font-mono text-stone-400 dark:text-stone-500 shrink-0">
                        {s.strongNumber}
                      </span>
                    )}
                    {sub && (
                      <span className="text-stone-400 dark:text-stone-500 truncate min-w-0">
                        {sub}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Next */}
        <button
          onClick={() => canNext && navigateStrong(currentStrong!.n + 1)}
          disabled={!canNext}
          title="Next entry"
          className="w-6 h-6 flex items-center justify-center rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-25 disabled:pointer-events-none shrink-0 text-xs"
        >
          →
        </button>
      </div>

      {/* Entry content */}
      <EntryDisplay entry={entry} isHebrew={isHebrew} abbottHtml={abbottHtml} lsjHtml={lsjHtml} />
    </div>
  );
}
