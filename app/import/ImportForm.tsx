"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { importTranslationAction, checkExistingVersesAction } from "./actions";
import type { Book, Translation } from "@/lib/db/schema";
import { OSIS_BOOKS_OT, OSIS_BOOKS_NT } from "@/lib/utils/osis";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface ImportFormProps {
  books: Book[];
  existingTranslations: Translation[];
}

const INITIAL_STATE = {
  success: false,
  error: null as string | null,
  count: 0,
  redirectTo: null as string | null,
};

const inputClass =
  "w-full px-3 py-2 rounded-lg border text-sm bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function ImportForm({ books, existingTranslations }: ImportFormProps) {
  const { t, bookName } = useTranslation();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(importTranslationAction, INITIAL_STATE);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [checking, setChecking] = useState(false);

  const [confirmData, setConfirmData] = useState<{
    formData: FormData;
    existingCount: number;
    abbr: string;
    bookName: string;
    chapter: number;
  } | null>(null);

  useEffect(() => {
    if (state.redirectTo) {
      router.push(state.redirectTo);
    }
  }, [state.redirectTo, router]);

  const otCodes = OSIS_BOOKS_OT.filter((c) => books.some((b) => b.osisCode === c));
  const ntCodes = OSIS_BOOKS_NT.filter((c) => books.some((b) => b.osisCode === c));

  function selectTranslation(tr: Translation) {
    if (selectedId === tr.id) {
      setSelectedId(null);
      setName("");
      setAbbreviation("");
    } else {
      setSelectedId(tr.id);
      setName(tr.name);
      setAbbreviation(tr.abbreviation);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const abbr = ((formData.get("abbreviation") as string) ?? "").trim().toUpperCase();
    const osisBook = ((formData.get("osisBook") as string) ?? "").trim();
    const chapter = parseInt((formData.get("chapter") as string) ?? "", 10);

    setChecking(true);
    try {
      const { count } = await checkExistingVersesAction(abbr, osisBook, chapter);
      if (count > 0) {
        setConfirmData({
          formData,
          existingCount: count,
          abbr,
          bookName: bookName(osisBook),
          chapter,
        });
      } else {
        startTransition(() => formAction(formData));
      }
    } catch {
      startTransition(() => formAction(formData));
    } finally {
      setChecking(false);
    }
  }

  function handleConfirmReplace() {
    if (!confirmData) return;
    const fd = confirmData.formData;
    setConfirmData(null);
    startTransition(() => formAction(fd));
  }

  function handleCancelReplace() {
    setConfirmData(null);
  }

  return (
    <>
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 mb-4 inline-block transition-colors"
        >
          {t("importPage.backLink")}
        </Link>
        <h1 className="text-3xl font-bold mt-2">{t("importPage.title")}</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {t("importPage.description")}
        </p>
      </header>
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Translation identity */}
      <div>
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">
          {t("importPage.translationHeading")}
        </h2>
        {existingTranslations.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
              {t("importPage.existingHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {existingTranslations.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => selectTranslation(tr)}
                  title={tr.name}
                  className={[
                    "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors border",
                    selectedId === tr.id
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-[var(--surface)] text-stone-600 dark:text-stone-300 border-[var(--border)] hover:border-blue-400",
                  ].join(" ")}
                >
                  {tr.abbreviation}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="name">
              {t("importPage.fullName")}
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder={t("importPage.fullNamePlaceholder")}
              value={name}
              onChange={(e) => { setName(e.target.value); setSelectedId(null); }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="abbreviation">
              {t("importPage.abbreviation")}
            </label>
            <input
              id="abbreviation"
              name="abbreviation"
              type="text"
              required
              placeholder={t("importPage.abbreviationPlaceholder")}
              maxLength={12}
              value={abbreviation}
              onChange={(e) => { setAbbreviation(e.target.value); setSelectedId(null); }}
              className={inputClass + " font-mono uppercase"}
            />
          </div>
        </div>
      </div>

      {/* Location */}
      <div>
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">
          {t("importPage.locationHeading")}
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="osisBook">
              {t("importPage.book")}
            </label>
            <select id="osisBook" name="osisBook" required className={inputClass}>
              <option value="">{t("importPage.selectBook")}</option>
              {otCodes.length > 0 && (
                <optgroup label={t("importPage.oldTestament")}>
                  {otCodes.map((c) => (
                    <option key={c} value={c}>
                      {bookName(c)}
                    </option>
                  ))}
                </optgroup>
              )}
              {ntCodes.length > 0 && (
                <optgroup label={t("importPage.newTestament")}>
                  {ntCodes.map((c) => (
                    <option key={c} value={c}>
                      {bookName(c)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="chapter">
              {t("importPage.chapter")}
            </label>
            <input
              id="chapter"
              name="chapter"
              type="number"
              min="1"
              required
              placeholder="1"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Paste area */}
      <div>
        <label className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300" htmlFor="pastedText">
          {t("importPage.pasteLabel")}
        </label>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
          {t("importPage.pasteHint")}
        </p>
        <textarea
          id="pastedText"
          name="pastedText"
          required
          rows={10}
          placeholder={"Genesis 1:1-31 (NIV)\n1 In the beginning God created the heavens and the earth. 2 Now the earth was formless and empty…"}
          className={inputClass + " font-mono resize-y"}
        />
      </div>

      {/* Overwrite confirmation */}
      {confirmData && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">
            {t("importPage.replaceTitle")}
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
            {t("importPage.replaceDesc", {
              abbr: confirmData.abbr,
              count: confirmData.existingCount,
              plural: confirmData.existingCount !== 1 ? "s" : "",
              book: confirmData.bookName,
              chapter: confirmData.chapter,
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancelReplace}
              className="px-4 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--surface)] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
            >
              {t("importPage.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirmReplace}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              {t("importPage.yesReplace")}
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {state.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {state.error}
        </div>
      )}
      {state.success && !state.redirectTo && (
        <div className="px-4 py-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm">
          {t("importPage.importedVerses", { count: state.count, plural: state.count !== 1 ? "s" : "" })}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || checking || !!confirmData}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
      >
        {pending ? t("importPage.importing") : checking ? t("importPage.checking") : t("importPage.importChapter")}
      </button>
    </form>
    </>
  );
}
