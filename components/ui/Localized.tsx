"use client";

import { useTranslation } from "@/lib/i18n/LocaleContext";

/** Translated string for use inside server components. */
export function T({ k, params }: { k: string; params?: Record<string, string | number> }) {
  const { t } = useTranslation();
  return <>{t(k, params)}</>;
}

/** Localized book name for use inside server components. */
export function BookName({ code, refForm = false }: { code: string; refForm?: boolean }) {
  const { bookName, refBookName } = useTranslation();
  return <>{refForm ? refBookName(code) : bookName(code)}</>;
}

/** A stored English reference label with its book names localized. */
export function LocalizedRef({ label }: { label: string }) {
  const { localizeRef } = useTranslation();
  return <>{localizeRef(label)}</>;
}
