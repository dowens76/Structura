// Synchronously gathers the live (possibly not-yet-saved) content of every
// mounted note editor. Editors save on a debounce, so reading from the API
// right after typing can miss the last edit; each mounted NoteEditor /
// ChapterSummarySection instead answers this event with its in-memory state.

export const COLLECT_NOTES_EVENT = "structura:collect-notes";

export interface CollectNotesDetail {
  /** noteKey → stored-format content string (Tiptap JSON, or meta JSON) */
  contents: Record<string, string>;
}

/** Returns live content for every mounted note editor, keyed by noteKey. */
export function collectLiveNotes(): Record<string, string> {
  const detail: CollectNotesDetail = { contents: {} };
  window.dispatchEvent(new CustomEvent<CollectNotesDetail>(COLLECT_NOTES_EVENT, { detail }));
  return detail.contents;
}

/** Subscribe a note source to collection requests. Returns an unsubscribe fn. */
export function onCollectNotes(handler: (contents: Record<string, string>) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<CollectNotesDetail>).detail.contents);
  window.addEventListener(COLLECT_NOTES_EVENT, listener);
  return () => window.removeEventListener(COLLECT_NOTES_EVENT, listener);
}
