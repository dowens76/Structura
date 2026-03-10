import Link from "next/link";
import Image from "next/image";
import { getBooks } from "@/lib/db/queries";
import type { Book } from "@/lib/db/schema";
import type { Testament } from "@/lib/morphology/types";

function BookGrid({ books, title }: { books: Book[]; title: string }) {
  if (books.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-stone-700 dark:text-stone-300 mb-3 border-b border-stone-200 dark:border-stone-700 pb-2">
        {title}
      </h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
        {books.map((book) => (
          <Link
            key={`${book.osisCode}-${book.textSource}`}
            href={`/${encodeURIComponent(book.osisCode)}/${book.textSource}/1`}
            className="block px-3 py-2 rounded-lg border text-sm transition-colors text-center hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--foreground)" }}
            title={book.name}
          >
            <div className="font-medium truncate">{book.osisCode}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{book.name}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function Home() {
  let otBooks: Book[] = [];
  let ntBooks: Book[] = [];
  let lxxBooks: Book[] = [];

  try {
    otBooks = await getBooks("OT" as Testament);
    ntBooks = await getBooks("NT" as Testament);
    lxxBooks = await getBooks("LXX" as Testament);
  } catch {
    // DB not initialized yet
  }

  const hasData = otBooks.length + ntBooks.length + lxxBooks.length > 0;

  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <header className="mb-12">
          <Image
            src="/structura-full-logo.svg"
            alt="Structura — Visual Bible Analysis"
            width={540}
            height={252}
            priority
            className="w-72 sm:w-96"
          />
        </header>

        {hasData ? (
          <>
            <BookGrid books={otBooks} title="Hebrew Old Testament (OSHB)" />
            <BookGrid books={ntBooks} title="Greek New Testament (SBLGNT + MorphGNT)" />
            <BookGrid books={lxxBooks} title="Septuagint LXX (Rahlfs)" />
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

        <div className="mt-10 flex flex-col gap-2">
          <Link
            href="/import"
            className="text-sm hover:underline"
            style={{ color: "var(--accent)" }}
          >
            + Import translation →
          </Link>
          <Link
            href="/backup"
            className="text-sm hover:underline"
            style={{ color: "var(--accent)" }}
          >
            Backup & Restore →
          </Link>
        </div>

        <footer className="mt-8 pt-6 border-t text-xs space-y-1" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          <p>Hebrew text: Open Scriptures Hebrew Bible (CC BY 4.0)</p>
          <p>Greek NT: SBLGNT + MorphGNT (CC BY-SA 3.0)</p>
          <p>Septuagint: Rahlfs 1935 via LXX-Rahlfs-1935 (CC BY-NC-SA 4.0)</p>
        </footer>
      </div>
    </main>
  );
}
