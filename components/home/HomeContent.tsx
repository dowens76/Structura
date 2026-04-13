"use client";

import Link from "next/link";
import Image from "next/image";
import type { Book } from "@/lib/db/schema";
import SettingsButton from "@/components/SettingsButton";
import ThemeToggle from "@/components/ThemeToggle";
import LanguagePicker from "@/components/ui/LanguagePicker";
import { useTranslation } from "@/lib/i18n/LocaleContext";

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
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
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
              <div className="font-medium truncate text-xs">{book.osisCode}</div>
              <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{displayName}</div>
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
}

export default function HomeContent({ otBooks, ntBooks, lxxBooks }: HomeContentProps) {
  const { t, bookName } = useTranslation();
  const hasData = otBooks.length + ntBooks.length + lxxBooks.length > 0;

  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <header className="mb-12">
          <div className="flex items-start justify-between gap-4 mb-6">
            <Image
              src="/structura-full-logo.svg"
              alt="Structura — Visual Bible Analysis"
              width={540}
              height={252}
              priority
              className="w-72 sm:w-96 dark:hidden"
            />
            <Image
              src="/structura-full-logo-dark.svg"
              alt="Structura — Visual Bible Analysis"
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
          <div className="flex flex-wrap gap-2">
            <Link
              href="/import"
              className="text-xs px-3 py-1.5 rounded border transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.importTranslation")}
            </Link>
            <Link
              href="/backup"
              className="text-xs px-3 py-1.5 rounded border transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.backup")}
            </Link>
            <Link
              href="/account"
              className="text-xs px-3 py-1.5 rounded border transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              {t("home.account")}
            </Link>
          </div>
        </header>

        {hasData ? (
          <>
            <BookGrid books={otBooks} title={t("home.hebrewOt")} bookName={bookName} />
            <BookGrid books={ntBooks} title={t("home.greekNt")} bookName={bookName} />
            <BookGrid books={lxxBooks} title={t("home.lxx")} linkSource="STEPBIBLE_LXX" bookName={bookName} />
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

        <footer className="mt-8 pt-6 border-t text-xs space-y-1" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          <p>{t("home.footerHebrew")}</p>
          <p>{t("home.footerGreek")}</p>
          <p>{t("home.footerLxx")}</p>
        </footer>
      </div>
    </main>
  );
}
