/**
 * Client-safe labels for the 12 versionable markup types — shared by
 * lib/versions/registry.ts (server, pairs each key with its Drizzle table)
 * and the version dialogs (client, render checkboxes from this list alone).
 * Keep in sync with VERSIONABLE_FEATURES in registry.ts — same keys, same order.
 */
export interface VersionableFeatureLabel {
  key: string;
  label: string;
}

export const VERSIONABLE_FEATURE_LABELS: VersionableFeatureLabel[] = [
  { key: "paragraphBreaks", label: "Paragraph breaks" },
  { key: "characterRefs", label: "Character assignments" },
  { key: "speechSections", label: "Speech sections" },
  { key: "wordTagRefs", label: "Word/concept tags" },
  { key: "lineIndents", label: "Line indents" },
  { key: "sceneBreaks", label: "Scene breaks / headings" },
  { key: "rstRelations", label: "Clause relationships" },
  { key: "lineGroups", label: "Line groups (poetry)" },
  { key: "wordArrows", label: "Word arrows" },
  { key: "lineAnnotations", label: "Clause labels (plot/theme/desc)" },
  { key: "wordFormatting", label: "Word formatting (bold/italic)" },
  { key: "textCriticalMarks", label: "Text-critical marks" },
];

/**
 * Feature keys whose content is anchored to paragraph-break segment
 * boundaries and silently fails to render without them. ChapterDisplay's
 * `paragraphFirstWordIds` (the list of word IDs a segment can start at)
 * includes every verse's first word for free, but NOT a mid-verse paragraph
 * break unless that break is itself present — so a clause label or
 * scene-break heading anchored mid-verse (the common case for real
 * structural annotation) becomes invisible if "Paragraph breaks" isn't
 * copied alongside it, even though the row itself copied correctly. The
 * version dialogs use this to force "Paragraph breaks" on whenever one of
 * these is selected.
 */
export const FEATURES_REQUIRING_PARAGRAPH_BREAKS = ["lineAnnotations", "sceneBreaks"];
