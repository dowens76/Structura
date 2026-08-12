import { POETRY_COLORS } from "@/lib/poetry/constants";

/** Splits a word/token's core text into clickable grapheme spans for the
 *  "Similarity" poetry-notation tool — first click sets a pending start
 *  letter, shift-click on a later letter (in the same line) commits the
 *  range. Shared between WordToken.tsx (source words) and VerseDisplay.tsx's
 *  translation-token renderer, since both need identical grapheme-splitting
 *  and click behavior. */
export function renderClickableGraphemes(
  text: string,
  wordId: string,
  language: string,
  pendingIdx: number | null,
  onClick: (wordId: string, graphemeIndex: number, shiftHeld: boolean) => void
): React.ReactNode {
  const segmenter = new Intl.Segmenter(language === "hebrew" ? "he" : "en", { granularity: "grapheme" });
  const clusters = [...segmenter.segment(text)].map((s) => s.segment);
  return clusters.map((cluster, i) => (
    <span
      key={i}
      data-grapheme-idx={i}
      className={[
        "cursor-pointer rounded-sm",
        pendingIdx === i
          ? "outline outline-2"
          : "hover:bg-yellow-200/60 dark:hover:bg-yellow-800/40",
      ].join(" ")}
      style={pendingIdx === i ? { outlineColor: POETRY_COLORS.similarity, backgroundColor: `${POETRY_COLORS.similarity}55` } : undefined}
      onClick={(e) => { e.stopPropagation(); onClick(wordId, i, e.shiftKey); }}
    >
      {cluster}
    </span>
  ));
}

/** Read-mode rendering of a saved "Similarity" mark — wraps the covered
 *  grapheme range in a yellow oval-ish highlight (approximates the spec's
 *  "yellow oval under selected letters" with a rounded background rather
 *  than a precise cross-word measured ellipse, so multi-word spans still
 *  render correctly without any DOM-measurement overlay). Shared between
 *  WordToken.tsx and VerseDisplay.tsx's translation-token renderer. */
export function renderGraphemesWithSimilarityHighlight(
  text: string,
  language: string,
  startIdx: number,
  endIdx: number,
  onClick: () => void
): React.ReactNode {
  const segmenter = new Intl.Segmenter(language === "hebrew" ? "he" : "en", { granularity: "grapheme" });
  const clusters = [...segmenter.segment(text)].map((s) => s.segment);
  const covered = clusters.slice(startIdx, endIdx + 1).join("");
  const before = clusters.slice(0, startIdx).join("");
  const after = clusters.slice(endIdx + 1).join("");
  return (
    <>
      {before}
      <span
        className="cursor-pointer rounded-full px-0.5"
        style={{ backgroundColor: `${POETRY_COLORS.similarity}70` }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {covered}
      </span>
      {after}
    </>
  );
}
