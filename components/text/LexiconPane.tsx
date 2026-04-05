"use client";

import { useEffect, useRef, useState } from "react";
import type { LexiconEntry } from "@/lib/db/schema";
import { getGreekLexicon, getHebrewLexicon } from "@/components/SettingsButton";

interface LexiconPaneProps {
  wordLemma?: string | null;    // Greek: look up by lemma (SBLGNT / LXX)
  strongNumber?: string | null; // Hebrew: look up by Strong's number
  isHebrew: boolean;
}

// ── Abbott-Smith XML → HTML converter ─────────────────────────────────────────
// Mirrors the output of abbott-smith.xsl so abbott-smith.css applies correctly.
// Runs client-side only (uses DOMParser).

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
// Injected once as a <style> tag so they don't pollute global body/h1/p rules.
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function LexiconPane({ wordLemma, strongNumber, isHebrew }: LexiconPaneProps) {
  const [entry, setEntry]           = useState<LexiconEntry | null | "loading">("loading");
  const [lexiconSource, setSource]  = useState<string>(() =>
    isHebrew ? getHebrewLexicon() : getGreekLexicon()
  );
  const [abbottHtml, setAbbottHtml] = useState<string>("");
  const fetchKey = useRef<string>("");

  useEffect(() => {
    function onSettingsChange(e: Event) {
      const detail = (e as CustomEvent<Record<string, string>>).detail;
      if (isHebrew && detail.hebrewLexicon) setSource(detail.hebrewLexicon);
      else if (!isHebrew && detail.greekLexicon) setSource(detail.greekLexicon);
    }
    window.addEventListener("structura:settingsChange", onSettingsChange);
    return () => window.removeEventListener("structura:settingsChange", onSettingsChange);
  }, [isHebrew]);

  useEffect(() => {
    const lookupKey = isHebrew ? (strongNumber ?? "") : (wordLemma ?? "");
    if (!lookupKey) { setEntry(null); return; }

    const key = `${lookupKey}:${lexiconSource}`;
    if (key === fetchKey.current) return;
    fetchKey.current = key;
    setEntry("loading");
    setAbbottHtml("");

    const url = isHebrew
      ? `/api/lexicon?strong=${encodeURIComponent(strongNumber!.split(/[/,\s]/)[0])}&source=${encodeURIComponent(lexiconSource)}`
      : `/api/lexicon?lemma=${encodeURIComponent(wordLemma!)}&source=${encodeURIComponent(lexiconSource)}`;

    fetch(url)
      .then((r) => r.json())
      .then((data: { entry: LexiconEntry | null }) => {
        if (fetchKey.current === key) setEntry(data.entry);
      })
      .catch(() => { if (fetchKey.current === key) setEntry(null); });
  }, [wordLemma, strongNumber, isHebrew, lexiconSource]);

  useEffect(() => {
    if (!entry || entry === "loading" || entry.source !== "AbbottSmith" || !entry.definition) {
      setAbbottHtml("");
      return;
    }
    ensureAbbottSmithCss();
    setAbbottHtml(teiXmlToHtml(entry.definition));
  }, [entry]);

  if (entry === "loading") {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800 space-y-2 animate-pulse">
        <div className="h-7 w-24 bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-4 w-40 bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-3 w-full bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-3 w-5/6 bg-stone-100 dark:bg-stone-800 rounded" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800 text-xs text-stone-400 dark:text-stone-600 italic">
        No lexicon entry found for {isHebrew ? strongNumber : wordLemma}.
      </div>
    );
  }

  const sourceName =
    entry.source === "BDB"          ? "Brown-Driver-Briggs (Unabridged)" :
    entry.source === "HebrewStrong" ? "Brown-Driver-Briggs" :
    entry.source === "Dodson"       ? "Dodson Greek Lexicon" :
    entry.source === "AbbottSmith"  ? "Abbott-Smith" :
    (entry.source ?? "");

  if (entry.source === "AbbottSmith") {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">
        <div
          className="abbott-smith-entry"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: abbottHtml || "" }}
        />
        <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-3">{sourceName}</p>
      </div>
    );
  }

  if (entry.source === "BDB" && entry.definition) {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">
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
    <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">
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
