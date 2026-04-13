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
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

const STORAGE_KEY = "structura:locale";

type TFn = (key: string, params?: Record<string, string | number>) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
  bookName: (osisCode: string) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (k) => k,
  bookName: (code) => OSIS_BOOK_NAMES[code] ?? code,
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

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, bookName }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LocaleContext);
}
