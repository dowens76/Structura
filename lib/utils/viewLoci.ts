/**
 * The (book, chapter) loci a reading view is currently showing. A single
 * chapter page has one; a passage view (e.g. Exod 15:22 – 18:27) has one per
 * chapter it spans, possibly across two books.
 *
 * Lemma-driven tag/character creation and edits link words corpus-wide on the
 * server, then hand back just the refs the open view needs so it can show
 * them without a reload. Filtering by the page's single `chapter` prop hid
 * every match outside a passage's first chapter until the page was reloaded.
 */
export interface ViewLocus {
  book: string;
  chapter: number;
}

/** Keep only refs that fall inside the view. `viewLoci` wins when given;
 *  otherwise falls back to the legacy single `book`/`currentChapter` pair. */
export function filterRefsToView<T extends { book: string; chapter: number }>(
  refs: T[],
  viewLoci: ViewLocus[] | undefined,
  book: string | undefined,
  currentChapter: number | undefined,
): T[] {
  if (viewLoci?.length) {
    const keys = new Set(viewLoci.map((l) => `${l.book}:${l.chapter}`));
    return refs.filter((r) => keys.has(`${r.book}:${r.chapter}`));
  }
  if (currentChapter != null && book) {
    return refs.filter((r) => r.book === book && r.chapter === currentChapter);
  }
  return [];
}
