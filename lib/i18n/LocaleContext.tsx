"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  translations,
  DEFAULT_LOCALE,
  type Locale,
} from "./translations";
import { OSIS_BOOK_NAMES, OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";

const STORAGE_KEY = "structura:locale";

type TFn = (key: string, params?: Record<string, string | number>) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
  /** Collection name — e.g. "Psalms". Use for book pickers and home grid. */
  bookName: (osisCode: string) => string;
  /** Reference form — e.g. "Psalm 23". Use wherever a chapter+verse follows. */
  refBookName: (osisCode: string) => string;
  /** Replace English book names in a stored reference label (e.g. a bookmark's
   *  "1 Peter 2:4–10 · SBLGNT") with the current locale's reference names. */
  localizeRef: (label: string) => string;
}

// English book names (collection + reference forms), longest first so
// "1 John" wins over "John" in the alternation below.
const ENGLISH_BOOK_NAME_RE = (() => {
  const names = new Set([...Object.values(OSIS_BOOK_NAMES), ...Object.values(OSIS_REF_BOOK_NAMES)]);
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|[^\\p{L}\\d])(${escaped.join("|")})(?=\\s+\\d)`, "gu");
})();
const ENGLISH_NAME_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(OSIS_BOOK_NAMES)) ENGLISH_NAME_TO_CODE[name] = code;
for (const [code, name] of Object.entries(OSIS_REF_BOOK_NAMES)) ENGLISH_NAME_TO_CODE[name] = code;

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (k) => k,
  bookName: (code) => OSIS_BOOK_NAMES[code] ?? code,
  refBookName: (code) => OSIS_REF_BOOK_NAMES[code] ?? code,
  localizeRef: (label) => label,
});

function makeTFn(locale: Locale): TFn {
  return (key, params) => {
    const parts = key.split(".");
    let val: unknown = translations[locale];
    for (const p of parts) val = (val as Record<string, unknown>)?.[p];
    let str = typeof val === "string" ? val : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && saved in translations) setLocaleState(saved);
    } catch {}
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const t = useCallback(makeTFn(locale), [locale]);

  const bookName = useCallback((osisCode: string) => {
    const key = `books.${osisCode}`;
    const translated = t(key);
    return translated !== key ? translated : (OSIS_BOOK_NAMES[osisCode] ?? osisCode);
  }, [t]);

  const refBookName = useCallback((osisCode: string) => {
    const key = `bookRefs.${osisCode}`;
    const translated = t(key);
    return translated !== key ? translated : bookName(osisCode);
  }, [t, bookName]);

  const localizeRef = useCallback((label: string) => {
    if (locale === "en") return label;
    return label.replace(ENGLISH_BOOK_NAME_RE, (_m, pre: string, name: string) =>
      pre + refBookName(ENGLISH_NAME_TO_CODE[name] ?? name));
  }, [locale, refBookName]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, bookName, refBookName, localizeRef }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LocaleContext);
}

/** Localized display name for a language stored by its English name
 *  (e.g. a translation's `language` column); unknown names pass through. */
export function languageName(t: TFn, englishName: string): string {
  const key = `languages.${englishName}`;
  const s = t(key);
  return s === key ? englishName : s;
}

/** Translate a fixed English UI string kept in a module-level table, using a
 *  translations section keyed by the English text itself. */
export function translateText(t: TFn, ns: string, english: string): string {
  const key = `${ns}.${english}`;
  const s = t(key);
  return s === key ? english : s;
}
