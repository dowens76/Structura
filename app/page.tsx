import Link from "next/link";
import Image from "next/image";
import { getBooks, getBooksWithWords } from "@/lib/db/queries";
import type { Book } from "@/lib/db/schema";
import type { Testament } from "@/lib/morphology/types";
import { LXX_BOOK_DISPLAY_ORDER, OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import SettingsButton from "@/components/SettingsButton";
import ThemeToggle from "@/components/ThemeToggle";

function BookGrid({
  books,
  title,
  linkSource,
}: {
  books: Book[];
  title: string;
  linkSource?: string; // override the source used in links (e.g. "STEPBIBLE_LXX")
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
          const displayName = OSIS_BOOK_NAMES[book.osisCode] ?? book.name;
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

export default async function Home() {
  let otBooks: Book[] = [];
  let ntBooks: Book[] = [];
  let lxxBooks: Book[] = [];

  try {
    [otBooks, ntBooks, lxxBooks] = await Promise.all([
      getBooks("OT" as Testament),
      getBooks("NT" as Testament),
      // Use getBooksWithWords so canonical OT books (stored as OSHB) are included
      // when they also have STEPBIBLE_LXX content.
      getBooksWithWords("STEPBIBLE_LXX"),
    ]);
    // Sort LXX books by the LXX canonical display order
    const lxxOrder = new Map(LXX_BOOK_DISPLAY_ORDER.map((c, i) => [c, i]));
    lxxBooks.sort((a, b) => {
      const ai = lxxOrder.get(a.osisCode) ?? 999;
      const bi = lxxOrder.get(b.osisCode) ?? 999;
      return ai - bi;
    });
  } catch {
    // DB not initialized yet
  }

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
              className="w-72 sm:w-96"
            />
            <div className="flex items-center gap-1 mt-1">
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
              + Import translation
            </Link>
            <Link
              href="/backup"
              className="text-xs px-3 py-1.5 rounded border transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              Backup &amp; Restore
            </Link>
            <Link
              href="/account"
              className="text-xs px-3 py-1.5 rounded border transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
            >
              Account &amp; Workspaces
            </Link>
          </div>
        </header>

        {hasData ? (
          <>
            <BookGrid books={otBooks} title="Hebrew Old Testament (OSHB)" />
            <BookGrid books={ntBooks} title="Greek New Testament (SBLGNT + MorphGNT)" />
            <BookGrid books={lxxBooks} title="Septuagint LXX (Rahlfs-1935)" linkSource="STEPBIBLE_LXX" />
          </>
        ) : (
          <div className="text-center py-20" style={{ color: "var(--text-muted)" }}>
            <div className="text-6xl mb-4">📖</div>
            <h2 className="text-xl font-semibold mb-2">No texts loaded yet</h2>
            <p className="text-sm mb-6">Run the import scripts to load the Bible texts:</p>
            <pre className="inline-block text-left text-xs px-4 py-3 rounded-lg" style={{ backgroundColor: "var(--surface-muted)" }}>
              npm run import:oshb{"\n"}npm run import:morphgnt{"\n"}npm run import:lxx
            </pre>
          </div>
        )}

        <footer className="mt-8 pt-6 border-t text-xs space-y-1" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          <p>Hebrew text: Open Scriptures Hebrew Bible (CC BY 4.0)</p>
          <p>Greek NT: SBLGNT + MorphGNT (CC BY-SA 3.0)</p>
          <p>Septuagint: Rahlfs 1935 via LXX-Rahlfs-1935 (CC BY-NC-SA 4.0)</p>
        </footer>
      </div>
    </main>
  );
}
