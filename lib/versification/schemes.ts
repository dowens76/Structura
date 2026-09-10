/**
 * Named Psalm-superscription versification schemes for translations.
 *
 * This is deliberately narrower than "full versification system": it only
 * answers one question — does this translation count a Psalm's descriptive
 * title (superscription) as verse 1, or leave it unnumbered before verse 1?
 *
 * - Leningrad/MT and LXX both count the title as verse 1 (verified directly
 *   against source.db/OSHB and lxx.db: e.g. LXX Ps 29:1 — MT Ps 30 shifted by
 *   the MT↔LXX chapter offset, see lib/versification/index.ts — is the same
 *   "εἰς τὸ τέλος ... τῷ Δαυιδ" title, with content starting at LXX 29:2, the
 *   same title-then-content split as MT itself). No offset needed.
 * - KJV and Vietnamese (based on VCB, the only Vietnamese translation
 *   checked so far) leave the title unnumbered, so MT verse N = this
 *   translation's own verse (N − offset). See lib/versification/mt-kjv-mapping.ts
 *   for the actual per-Psalm offsets and getTranslationVerses for how a
 *   translation's stored "verse 0" (the captured title) gets shifted to the
 *   right MT verse.
 *
 * This does NOT address MT↔LXX *chapter*-level differences (Ps 9/10 merging
 * into one LXX chapter, etc.) — that's a separate, larger concern already
 * handled for the app's own built-in LXX text by lib/versification/index.ts.
 * Selecting "LXX" here only fixes Psalm-title verse numbering for a
 * user-imported LXX-based translation; importing it under the correct MT
 * chapter number is still up to the user.
 */

export const VERSIFICATION_SCHEMES = ["kjv", "mt", "lxx", "vietnamese"] as const;

export type VersificationScheme = (typeof VERSIFICATION_SCHEMES)[number];

export const VERSIFICATION_SCHEME_LABELS: Record<VersificationScheme, string> = {
  kjv: "KJV",
  mt: "Leningrad/MT",
  lxx: "LXX",
  vietnamese: "Vietnamese",
};

export const DEFAULT_VERSIFICATION_SCHEME: VersificationScheme = "mt";

export function isVersificationScheme(value: string): value is VersificationScheme {
  return (VERSIFICATION_SCHEMES as readonly string[]).includes(value);
}

/**
 * True when this scheme leaves the Psalm superscription unnumbered, so a
 * translation using it needs its title captured as verse 0 at import time
 * and shifted to the MT superscription verse at read time (see
 * getTranslationVerses in lib/db/queries.ts).
 */
export function schemeUsesKjvPsalmOffset(scheme: string | null | undefined): boolean {
  return scheme === "kjv" || scheme === "vietnamese";
}
