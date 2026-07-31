import type { DisplayMode, InterlinearSubMode } from "@/lib/morphology/types";
import {
  getChapterConstituentLabels,
  getChapterTransliterationFormats,
  getWordDataset,
  getDatasetEntries,
  getDatasetLabelColors,
} from "@/lib/db/queries";

export interface InterlinearExportData {
  constituentLabelMap: Map<string, string>;
  constituentGroupMap: Map<string, string>;
  transliterationFormatMap: Map<string, string>;
  datasetEntryMap: Map<string, string>;
  datasetGroupMap: Map<string, string>;
  datasetLabelColors: Map<string, string>;
  datasetDirection: "ltr" | "rtl";
}

const EMPTY: InterlinearExportData = {
  constituentLabelMap: new Map(),
  constituentGroupMap: new Map(),
  transliterationFormatMap: new Map(),
  datasetEntryMap: new Map(),
  datasetGroupMap: new Map(),
  datasetLabelColors: new Map(),
  datasetDirection: "ltr",
};

/**
 * Parses the `mode`/`sub` export query params (written by NavLinks /
 * PassageExportLink from the same localStorage keys ChapterDisplay persists
 * the live view's displayMode/interlinearSubMode under) back into typed
 * values. Falls back to Clean/Lemma for anything missing or malformed.
 */
export function parseExportViewParams(sp: {
  mode?: string | string[];
  sub?: string | string[];
}): { displayMode: DisplayMode; interlinearSubMode: InterlinearSubMode } {
  // Only "interlinear" is reproduced in export — "color" mode's POS color
  // rules are a separate, unrelated settings concern (not requested here),
  // so a "color" live view still exports as plain Clean text.
  const modeRaw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const displayMode: DisplayMode = modeRaw === "interlinear" ? "interlinear" : "clean";

  let interlinearSubMode: InterlinearSubMode = "lemma";
  const subRaw = Array.isArray(sp.sub) ? sp.sub[0] : sp.sub;
  if (subRaw) {
    try {
      const parsed = JSON.parse(subRaw);
      if (
        parsed === "lemma" || parsed === "strongs" || parsed === "morph" ||
        parsed === "transliteration" || parsed === "constituent" ||
        (parsed && typeof parsed === "object" && parsed.type === "dataset" && typeof parsed.id === "number")
      ) {
        interlinearSubMode = parsed;
      }
    } catch { /* malformed param — fall back to lemma */ }
  }
  return { displayMode, interlinearSubMode };
}

/**
 * Fetches whatever interlinear-mode data (constituent labels, transliteration
 * formats, or a specific dataset's entries/groups/colors/direction) is needed
 * to reproduce the currently-displayed interlinear sub-mode in the read-only
 * export view — mirrors the live fetches in ChapterDisplay.tsx, just run
 * server-side across every chapter covered by the export instead of via
 * client-side useEffects scoped to one chapter at a time.
 */
export async function getInterlinearExportData(opts: {
  osisBook: string;
  chapters: number[];
  textSource: string;
  /** Abbreviations of every translation visible in this export — dataset
   *  entries can also be attached under translation words (`tv:ABBR:...`
   *  ids), scoped per-translation via textSource = the abbreviation. */
  translationAbbrs: string[];
  workspaceId: number;
  displayMode: DisplayMode;
  interlinearSubMode: InterlinearSubMode;
}): Promise<InterlinearExportData> {
  const { osisBook, chapters, textSource, translationAbbrs, workspaceId, displayMode, interlinearSubMode } = opts;
  if (displayMode !== "interlinear") return EMPTY;

  if (interlinearSubMode === "constituent") {
    const rows = (await Promise.all(
      chapters.map((ch) => getChapterConstituentLabels(osisBook, ch, textSource, workspaceId))
    )).flat();
    return {
      ...EMPTY,
      constituentLabelMap: new Map(rows.map((r) => [r.wordId, r.label])),
      constituentGroupMap: new Map(rows.filter((r) => r.groupId).map((r) => [r.wordId, r.groupId as string])),
    };
  }

  if (interlinearSubMode === "transliteration") {
    const rows = (await Promise.all(
      chapters.map((ch) => getChapterTransliterationFormats(osisBook, ch, textSource, workspaceId))
    )).flat();
    return { ...EMPTY, transliterationFormatMap: new Map(rows.map((r) => [r.wordId, r.format])) };
  }

  if (typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset") {
    const dsId = interlinearSubMode.id;
    const [dataset, labelColorRows] = await Promise.all([
      getWordDataset(dsId),
      getDatasetLabelColors(dsId),
    ]);
    if (!dataset) return EMPTY;
    const textSources = [textSource, ...translationAbbrs];
    const entryRows = (await Promise.all(
      chapters.flatMap((ch) => textSources.map((ts) => getDatasetEntries(dsId, osisBook, ch, ts)))
    )).flat();
    return {
      ...EMPTY,
      datasetEntryMap: new Map(entryRows.map((r) => [r.wordId, r.value])),
      datasetGroupMap: new Map(entryRows.filter((r) => r.groupId).map((r) => [r.wordId, r.groupId as string])),
      datasetLabelColors: new Map(labelColorRows.map((r) => [r.value, r.color])),
      datasetDirection: dataset.direction === "rtl" ? "rtl" : "ltr",
    };
  }

  // lemma / strongs / morph need no extra data — derived from Word fields already fetched.
  return EMPTY;
}
