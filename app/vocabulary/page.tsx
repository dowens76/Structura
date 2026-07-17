import { getBooks, getBooksWithWords } from "@/lib/db/queries";
import type { Book } from "@/lib/db/schema";
import VocabularyListPanel from "./VocabularyListPanel";

export const metadata = { title: "Vocabulary List Creator — Structura" };

export default async function VocabularyPage() {
  let otBooks: Book[] = [];
  let ntBooks: Book[] = [];
  let lxxBooks: Book[] = [];

  try {
    [otBooks, ntBooks, lxxBooks] = await Promise.all([
      getBooks("OT"),
      getBooks("NT"),
      getBooksWithWords("STEPBIBLE_LXX"),
    ]);
  } catch {
    // DB not initialized yet
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <div className="max-w-4xl mx-auto px-6 py-12">
        <VocabularyListPanel otBooks={otBooks} ntBooks={ntBooks} lxxBooks={lxxBooks} />
      </div>
    </main>
  );
}
