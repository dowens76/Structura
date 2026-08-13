// Shared with VerseDisplay's own translation-text rendering — the tokenizer
// here MUST stay identical there, since a translation word's tag/character/
// formatting ref id (`tv:ABBR:BOOK.CH.V.POS`) embeds this exact tokenization's
// word position. Diverging would silently misalign every existing ref.

/** Punctuation excluded from per-letter text-color selection (translation
 *  text) — parentheses, brackets, commas, semicolons, colons, and periods.
 *  Shared between VerseDisplay's letter-click rendering and ChapterDisplay's
 *  range-commit filtering so a selected range never colors these marks. */
export const TEXT_COLOR_EXCLUDED_PUNCTUATION = /[()[\].,;:]/;

/** Encode USFM inline markers as per-token prefixes so word-level annotations
 *  work. e.g. "\\nd the LORD\\nd*" → "ND:the ND:LORD" */
export function encodeUsfmTokens(raw: string): string {
  let s = raw;
  // \bd and \it must be encoded BEFORE block markers (\nd, \add, \wj) so their
  // spaces are consumed first; otherwise \nd splits content on the space inside \bd.
  // Close tags first so \\bd\s* won't partially match \\bd*.
  s = s.replace(/\\bd\*/g,  "").replace(/\\bd\s*/g,  "");
  s = s.replace(/\\it\*/g,  "").replace(/\\it\s*/g,  "");
  s = s.replace(/\\nd\s+([\s\S]*?)\\nd\*/g, (_: string, content: string) =>
    content.split(/\s+/).filter(Boolean).map((w: string) => `ND:${w}`).join(" ")
  );
  s = s.replace(/\\add\s+([\s\S]*?)\\add\*/g, (_: string, content: string) =>
    content.split(/\s+/).filter(Boolean).map((w: string) => `ADD:${w}`).join(" ")
  );
  s = s.replace(/\\wj\s+([\s\S]*?)\\wj\*/g, (_: string, content: string) =>
    content.split(/\s+/).filter(Boolean).map((w: string) => `WJ:${w}`).join(" ")
  );
  // Attach \fn \fn* to the preceding word so the superscript survives tokenisation.
  // "know \fn \fn* wisdom" → "know«fn» wisdom"
  // Trailing space is always appended so the next word stays a separate token
  // even when the original had no space after \fn* (e.g. DCO-BT imports).
  s = s.replace(/(\S+)\s+\\fn\s+\\fn\*/g, "$1«fn» ");
  s = s.replace(/\\fn\s+\\fn\*/g, "«fn» "); // fallback: fn at start with no preceding word
  s = s.replace(/\\[a-z]+\d*\*?\s*/g, "");
  return s;
}

export function decodeUsfmToken(token: string): { display: string; marker: "nd" | "add" | "wj" | "fn" | null } {
  if (token.startsWith("ND:"))  return { display: token.slice(3),  marker: "nd"  };
  if (token.startsWith("ADD:")) return { display: token.slice(4), marker: "add" };
  if (token.startsWith("WJ:"))  return { display: token.slice(3),  marker: "wj"  };
  if (token.endsWith("«fn»"))   return { display: token.slice(0, -4), marker: "fn" };
  return { display: token, marker: null };
}

/** Splits a translation verse's raw text into the same flat, globally-indexed
 *  word array VerseDisplay uses to build `tv:` ids — split on whitespace, then
 *  split each token after any mid-word em-dash so "bread—purifying" becomes
 *  two tokens rather than one joined token. */
export function tokenizeTranslationText(rawText: string): string[] {
  const encoded = encodeUsfmTokens(rawText);
  return encoded.split(/\s+/).filter(Boolean).flatMap((t) => t.split(/(?<=—)(?=.)/));
}
