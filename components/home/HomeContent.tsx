"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Book } from "@/lib/db/schema";
import SettingsButton from "@/components/SettingsButton";
import ThemeToggle from "@/components/ThemeToggle";
import LanguagePicker from "@/components/ui/LanguagePicker";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import BookGroupingsDialog from "@/components/home/BookGroupingsDialog";
import ManageTranslationsDialog from "@/components/home/ManageTranslationsDialog";
import BookmarkButton from "@/components/navigation/BookmarkButton";
import HomePassagesButton from "@/components/home/HomePassagesButton";
import UpdateBanner from "@/components/home/UpdateBanner";
import { MORPHGNT_BOOK_MAP, OSIS_BOOK_ORDER } from "@/lib/utils/osis";
import AddressBar from "@/components/ui/AddressBar";

// NT OSIS codes — used to pick the correct word-DB source for chapter links
const NT_OSIS_CODES = new Set(Object.values(MORPHGNT_BOOK_MAP));

function bookAbbr(osisCode: string): string {
  return osisCode.replace(/^(\d+)([A-Za-z])/, "$1 $2");
}

// Grid for ULT/VCB — books are OSIS code strings, not Book objects.
// Links always use the underlying word-DB source (SBLGNT for NT, OSHB for OT)
// so the chapter page can load properly; ChapterDisplay handles hiding the
// source text and auto-activating the translation when translationOnly is set.
function TranslationBookGrid({
  books,
  title,
  bookName,
}: {
  books: string[];
  title: string;
  bookName: (osisCode: string) => string;
}) {
  if (books.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-stone-700 dark:text-stone-300 mb-3 border-b border-stone-200 dark:border-stone-700 pb-2">
        {title}
      </h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2">
        {books.map((osisCode) => {
          const src = NT_OSIS_CODES.has(osisCode) ? "SBLGNT" : "OSHB";
          const displayName = bookName(osisCode);
          return (
            <Link
              key={osisCode}
              href={`/${encodeURIComponent(osisCode)}/${src}/1`}
              className="block px-3 py-2 rounded-lg border text-sm transition-colors text-center hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--foreground)" }}
              title={displayName}
            >
              <div className="font-medium truncate text-xs">{displayName}</div>
              <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{bookAbbr(osisCode)}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function BookGrid({
  books,
  title,
  linkSource,
  bookName,
}: {
  books: Book[];
  title: string;
  linkSource?: string;
  bookName: (osisCode: string) => string;
}) {
  if (books.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-stone-700 dark:text-stone-300 mb-3 border-b border-stone-200 dark:border-stone-700 pb-2">
        {title}
      </h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2">
        {books.map((book) => {
          const src = linkSource ?? book.textSource;
          const displayName = bookName(book.osisCode);
          return (
            <Link
              key={`${book.osisCode}-${src}`}
              href={`/${encodeURIComponent(book.osisCode)}/${src}/1`}
              className="block px-3 py-2 rounded-lg border text-sm transition-colors text-center hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--foreground)" }}
              title={displayName}
            >
              <div className="font-medium truncate text-xs">{displayName}</div>
              <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{bookAbbr(book.osisCode)}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

interface HomeContentProps {
  otBooks: Book[];
  ntBooks: Book[];
  lxxBooks: Book[];
  translationOnly?: boolean;
  ultBooks?: string[];
  vcbBooks?: string[];
}

export default function HomeContent({ otBooks, ntBooks, lxxBooks, translationOnly = false, ultBooks = [], vcbBooks = [] }: HomeContentProps) {
  const { t, bookName, locale } = useTranslation();
  const hasData = otBooks.length + ntBooks.length + lxxBooks.length > 0;
  const [groupingsOpen, setGroupingsOpen] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [hiddenSources, setHiddenSources] = useState<string[]>([]);
  const [addressBarOpen, setAddressBarOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "l" && !e.shiftKey) {
        const inInput = document.activeElement instanceof HTMLInputElement
          || document.activeElement instanceof HTMLTextAreaElement;
        if (inInput) return;
        e.preventDefault();
        setAddressBarOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // In translation-only mode, pick ULT (English) or VCB (Vietnamese) based on locale,
  // then sort into canonical Bible order
  const translationBooks = translationOnly
    ? [...(locale === "vi" ? vcbBooks : ultBooks)].sort(
        (a, b) => (OSIS_BOOK_ORDER[a] ?? 999) - (OSIS_BOOK_ORDER[b] ?? 999)
      )
    : [];
  const translationLabel = locale === "vi"
    ? "Vietnamese Contemporary Bible (VCB)"
    : "UnfoldingWord Literal Text (ULT)";

  useEffect(() => {
    // Load initial hidden sources from sessionStorage (populated by SettingsButton on mount)
    // Fall back to fetching from API if not yet cached
    const cached = sessionStorage.getItem("structura:hiddenSources");
    if (cached) {
      try { setHiddenSources(JSON.parse(cached)); } catch { /* ignore */ }
    } else {
      fetch("/api/settings/hidden-sources")
        .then((r) => r.json())
        .then((d: { hidden?: string[] }) => setHiddenSources(d.hidden ?? []))
        .catch(() => {});
    }

    function onHiddenChange(e: Event) {
      const detail = (e as CustomEvent<{ hidden: string[] }>).detail;
      setHiddenSources(detail.hidden);
    }
    window.addEventListener("structura:hiddenSourcesChange", onHiddenChange);
    return () => window.removeEventListener("structura:hiddenSourcesChange", onHiddenChange);
  }, []);

  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <AddressBar open={addressBarOpen} onClose={() => setAddressBarOpen(false)} textSource="OSHB" />
      <div className="max-w-[1800px] mx-auto px-6 lg:px-10 py-12">
        <header className="mb-12">
          <div className="flex items-start justify-between gap-4 mb-6">
            <Image
              src="/structura-full-logo.svg"
              alt="Structura — A Workbench for Study of Scripture"
              width={540}
              height={252}
              priority
              className="w-72 sm:w-96 dark:hidden"
            />
            <Image
              src="/structura-full-logo-dark.svg"
              alt="Structura — A Workbench for Study of Scripture"
              width={540}
              height={252}
              priority
              className="w-72 sm:w-96 hidden dark:block"
            />
            <div className="flex items-center gap-1 mt-1">
              <LanguagePicker />
              <SettingsButton />
              <ThemeToggle />
            </div>
          </div>
          <UpdateBanner />
          <h2 className="text-xl font-semibold text-stone-700 dark:text-stone-300 mb-3 border-b border-stone-200 dark:border-stone-700 pb-2">
            Manage
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGroupingsOpen(true)}
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.bookGroupings")}
            </button>
            <button
              type="button"
              onClick={() => setTranslationsOpen(true)}
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              Manage Translations
            </button>
            <Link
              href="/import"
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.importTranslation")}
            </Link>
            <Link
              href="/usfm-export"
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              Export USFM
            </Link>
            <Link
              href="/export/lists"
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              Export Lists
            </Link>
            <Link
              href="/backup"
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.backup")}
            </Link>
            <Link
              href="/account"
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.account")}
            </Link>
            <Link
              href="/shortcuts"
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              ⌨ Shortcuts
            </Link>
          </div>
          <h2 className="text-xl font-semibold text-stone-700 dark:text-stone-300 mb-3 mt-6 border-b border-stone-200 dark:border-stone-700 pb-2">
            Navigate
          </h2>
          <div className="flex flex-wrap gap-2 mt-2">
            <BookmarkButton variant="bordered" />
            <HomePassagesButton />
          </div>
        </header>

        {translationOnly && translationBooks.length > 0 ? (
          <TranslationBookGrid books={translationBooks} title={translationLabel} bookName={bookName} />
        ) : hasData ? (
          <>
            {!hiddenSources.includes("OSHB") && <BookGrid books={otBooks} title={t("home.hebrewOt")} bookName={bookName} />}
            {!hiddenSources.includes("SBLGNT") && <BookGrid books={ntBooks} title={t("home.greekNt")} bookName={bookName} />}
            {!hiddenSources.includes("LXX") && <BookGrid books={lxxBooks} title={t("home.lxx")} linkSource="STEPBIBLE_LXX" bookName={bookName} />}
          </>
        ) : (
          <div className="text-center py-20" style={{ color: "var(--text-muted)" }}>
            <div className="text-6xl mb-4">📖</div>
            <h2 className="text-xl font-semibold mb-2">{t("home.noTexts")}</h2>
            <p className="text-sm mb-6">{t("home.runImport")}</p>
            <pre className="inline-block text-left text-xs px-4 py-3 rounded-lg" style={{ backgroundColor: "var(--surface-muted)" }}>
              npm run import:oshb{"\n"}npm run import:morphgnt{"\n"}npm run import:lxx
            </pre>
          </div>
        )}

        <div className="mt-8 pt-6 border-t flex gap-4 text-xs" style={{ borderColor: "var(--border)" }}>
          <a
            href="https://dowens76.github.io/Structura"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
            className="hover:underline"
          >
            {t("home.website")}
          </a>
          <a
            href="https://dowens76.github.io/Structura/privacy-policy.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
            className="hover:underline"
          >
            {t("home.privacyPolicy")}
          </a>
          <Link
            href="/licenses"
            style={{ color: "var(--accent)" }}
            className="hover:underline"
          >
            {t("home.contentLicenses")}
          </Link>
        </div>
      </div>

      {translationsOpen && (
        <ManageTranslationsDialog onClose={() => setTranslationsOpen(false)} />
      )}
      {groupingsOpen && (
        <BookGroupingsDialog
          otBooks={otBooks}
          ntBooks={ntBooks}
          lxxBooks={lxxBooks}
          onClose={() => setGroupingsOpen(false)}
        />
      )}
    </main>
  );
}
