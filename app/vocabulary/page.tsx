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

  return <VocabularyListPanel otBooks={otBooks} ntBooks={ntBooks} lxxBooks={lxxBooks} />;
}
