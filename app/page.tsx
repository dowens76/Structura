import { getBooks, getBooksWithWords } from "@/lib/db/queries";
import type { Book } from "@/lib/db/schema";
import type { Testament } from "@/lib/morphology/types";
import { LXX_BOOK_DISPLAY_ORDER } from "@/lib/utils/osis";
import HomeContent from "@/components/home/HomeContent";

export default async function Home() {
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
    lxxBooks.sort((a, b) => {
      const ai = lxxOrder.get(a.osisCode) ?? 999;
      const bi = lxxOrder.get(b.osisCode) ?? 999;
      return ai - bi;
    });
  } catch {
    // DB not initialized yet
  }

  return <HomeContent otBooks={otBooks} ntBooks={ntBooks} lxxBooks={lxxBooks} />;
}
