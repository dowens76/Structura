import { getBooks, getBooksWithWords } from "@/lib/db/queries";
import type { Book } from "@/lib/db/schema";
import type { Testament } from "@/lib/morphology/types";
import { LXX_BOOK_DISPLAY_ORDER } from "@/lib/utils/osis";
import BookGroupingsPanel from "./BookGroupingsPanel";

export const metadata = { title: "Book Groupings — Structura" };

export default async function BookGroupingsPage() {
  let otBooks: Book[] = [];
  let ntBooks: Book[] = [];
  let lxxBooks: Book[] = [];

  try {
    [otBooks, ntBooks, lxxBooks] = await Promise.all([
      getBooks("OT" as Testament),
      getBooks("NT" as Testament),
      getBooksWithWords("STEPBIBLE_LXX"),
    ]);
    const lxxOrder = new Map(LXX_BOOK_DISPLAY_ORDER.map((c, i) => [c, i]));
    lxxBooks.sort((a, b) => (lxxOrder.get(a.osisCode) ?? 999) - (lxxOrder.get(b.osisCode) ?? 999));
  } catch {
    // DB not initialized yet
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <BookGroupingsPanel otBooks={otBooks} ntBooks={ntBooks} lxxBooks={lxxBooks} />
    </div>
  );
}
