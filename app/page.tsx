import { getBooks, getBooksWithWords, getWorkspaceById, getUltBooks, getVcbBooks } from "@/lib/db/queries";
import type { Book } from "@/lib/db/schema";
import type { Testament } from "@/lib/morphology/types";
import { LXX_BOOK_DISPLAY_ORDER } from "@/lib/utils/osis";
import { getActiveWorkspaceId } from "@/lib/workspace";
import HomeContent from "@/components/home/HomeContent";

export default async function Home() {
  let otBooks: Book[] = [];
  let ntBooks: Book[] = [];
  let lxxBooks: Book[] = [];
  let ultBooks: string[] = [];
  let vcbBooks: string[] = [];
  let translationOnly = false;

  try {
    const workspaceId = await getActiveWorkspaceId();
    const workspace = await getWorkspaceById(workspaceId);
    translationOnly = workspace?.translationOnly ?? false;

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

    if (translationOnly) {
      ultBooks = getUltBooks();
      vcbBooks = getVcbBooks();
    }
  } catch {
    // DB not initialized yet
  }

  return (
    <HomeContent
      otBooks={otBooks}
      ntBooks={ntBooks}
      lxxBooks={lxxBooks}
      translationOnly={translationOnly}
      ultBooks={ultBooks}
      vcbBooks={vcbBooks}
    />
  );
}
