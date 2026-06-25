/** Shared helpers for Bible Lookup language filtering. */

export const BIBLE_LOOKUP_LANG_KEY = "structura:bibleLookup:langs";

// Common ISO 639-3 → display name mapping (falls back to the code itself)
export const LANG_NAMES: Record<string, string> = {
  afr:"Afrikaans", aln:"Albanian (Gheg)", arb:"Arabic", arz:"Arabic (Egyptian)",
  azt:"Aztec (Orizaba)", bul:"Bulgarian", ceb:"Cebuano", ces:"Czech",
  cmn:"Chinese (Mandarin)", dan:"Danish", deu:"German", ell:"Greek (Modern)",
  eng:"English", fin:"Finnish", fra:"French", guj:"Gujarati", hat:"Haitian Creole",
  hau:"Hausa", hbo:"Hebrew (Ancient)", hin:"Hindi", hrv:"Croatian", hun:"Hungarian",
  ibo:"Igbo", ind:"Indonesian", ita:"Italian", jpn:"Japanese", kan:"Kannada",
  kor:"Korean", lat:"Latin", lit:"Lithuanian", lug:"Ganda", mal:"Malayalam",
  mar:"Marathi", mya:"Burmese", nld:"Dutch", nor:"Norwegian", orm:"Oromo",
  pan:"Punjabi", pol:"Polish", por:"Portuguese", ron:"Romanian", rus:"Russian",
  sin:"Sinhala", slk:"Slovak", som:"Somali", spa:"Spanish", swa:"Swahili",
  swe:"Swedish", tam:"Tamil", tel:"Telugu", tha:"Thai", tir:"Tigrinya",
  tpi:"Tok Pisin", tur:"Turkish", ukr:"Ukrainian", urd:"Urdu", uzb:"Uzbek",
  vie:"Vietnamese", yor:"Yoruba", zul:"Zulu",
};

export function langLabel(code: string): string {
  return LANG_NAMES[code] ? `${LANG_NAMES[code]} (${code})` : code;
}

/** Read the stored language filter from localStorage.
 *  Returns null for "all languages", or a Set of selected ISO 639-3 codes. */
export function readBibleLookupLangs(): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BIBLE_LOOKUP_LANG_KEY);
    if (!raw) return new Set(["eng"]);
    const parsed = JSON.parse(raw);
    return parsed === null ? null : new Set(parsed as string[]);
  } catch {
    return new Set(["eng"]);
  }
}

/** Persist the language filter to localStorage. */
export function writeBibleLookupLangs(langs: Set<string> | null): void {
  try {
    localStorage.setItem(
      BIBLE_LOOKUP_LANG_KEY,
      JSON.stringify(langs === null ? null : [...langs])
    );
  } catch { /* quota exceeded */ }
}
