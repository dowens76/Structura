/**
 * OSIS reference utilities.
 * Standard format: Book.Chapter.Verse (e.g., "Gen.1.1")
 * Sort key format: "001.001.001" (zero-padded for lexicographic ordering)
 */

export interface OsisRef {
  book: string;
  chapter: number;
  verse: number;
}

export function parseOsisRef(ref: string): OsisRef {
  const parts = ref.split(".");
  if (parts.length < 3) throw new Error(`Invalid OSIS ref: ${ref}`);
  return {
    book: parts[0],
    chapter: parseInt(parts[1], 10),
    verse: parseInt(parts[2], 10),
  };
}

export function formatOsisRef(book: string, chapter: number, verse: number): string {
  return `${book}.${chapter}.${verse}`;
}

export function osisRefToSortKey(ref: string): string {
  const { book, chapter, verse } = parseOsisRef(ref);
  const bookNum = OSIS_BOOK_ORDER[book] ?? 0;
  return `${String(bookNum).padStart(3, "0")}.${String(chapter).padStart(3, "0")}.${String(verse).padStart(3, "0")}`;
}

export function formatVerseLabel(book: string, chapter: number, verse: number): string {
  const name = OSIS_BOOK_NAMES[book] ?? book;
  return `${name} ${chapter}:${verse}`;
}

/** Canonical OSIS book codes in canonical order */
export const OSIS_BOOKS_OT = [
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth",
  "1Sam", "2Sam", "1Kgs", "2Kgs", "1Chr", "2Chr", "Ezra", "Neh",
  "Esth", "Job", "Ps", "Prov", "Eccl", "Song", "Isa", "Jer",
  "Lam", "Ezek", "Dan", "Hos", "Joel", "Amos", "Obad", "Jonah",
  "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
];

export const OSIS_BOOKS_NT = [
  "Matt", "Mark", "Luke", "John", "Acts", "Rom", "1Cor", "2Cor",
  "Gal", "Eph", "Phil", "Col", "1Thess", "2Thess", "1Tim", "2Tim",
  "Titus", "Phlm", "Heb", "Jas", "1Pet", "2Pet", "1John", "2John",
  "3John", "Jude", "Rev",
];

export const OSIS_BOOKS_LXX = [
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth",
  "1Sam", "2Sam", "1Kgs", "2Kgs", "1Chr", "2Chr", "Ezra", "Neh",
  "Esth", "1Macc", "2Macc", "3Macc", "4Macc", "PsSol",
  "Job", "Ps", "Prov", "Eccl", "Song", "Wis", "Sir",
  "Isa", "Jer", "Lam", "EpJer", "Bar", "Ezek", "Dan",
  "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah",
  "Hab", "Zeph", "Hag", "Zech", "Mal",
];

export const OSIS_BOOK_ORDER: Record<string, number> = {};
[...OSIS_BOOKS_OT, ...OSIS_BOOKS_NT].forEach((b, i) => {
  OSIS_BOOK_ORDER[b] = i + 1;
});

export const OSIS_BOOK_NAMES: Record<string, string> = {
  // Old Testament (canonical)
  Gen: "Genesis", Exod: "Exodus", Lev: "Leviticus", Num: "Numbers",
  Deut: "Deuteronomy", Josh: "Joshua", Judg: "Judges", Ruth: "Ruth",
  "1Sam": "1 Samuel", "2Sam": "2 Samuel", "1Kgs": "1 Kings", "2Kgs": "2 Kings",
  "1Chr": "1 Chronicles", "2Chr": "2 Chronicles", Ezra: "Ezra", Neh: "Nehemiah",
  Esth: "Esther", Job: "Job", Ps: "Psalms", Prov: "Proverbs",
  Eccl: "Ecclesiastes", Song: "Song of Songs", Isa: "Isaiah", Jer: "Jeremiah",
  Lam: "Lamentations", Ezek: "Ezekiel", Dan: "Daniel", Hos: "Hosea",
  Joel: "Joel", Amos: "Amos", Obad: "Obadiah", Jonah: "Jonah",
  Mic: "Micah", Nah: "Nahum", Hab: "Habakkuk", Zeph: "Zephaniah",
  Hag: "Haggai", Zech: "Zechariah", Mal: "Malachi",
  // New Testament
  Matt: "Matthew", Mark: "Mark", Luke: "Luke", John: "John",
  Acts: "Acts", Rom: "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians",
  Gal: "Galatians", Eph: "Ephesians", Phil: "Philippians", Col: "Colossians",
  "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians",
  "1Tim": "1 Timothy", "2Tim": "2 Timothy",
  Titus: "Titus", Phlm: "Philemon", Heb: "Hebrews", Jas: "James",
  "1Pet": "1 Peter", "2Pet": "2 Peter",
  "1John": "1 John", "2John": "2 John", "3John": "3 John",
  Jude: "Jude", Rev: "Revelation",
  // LXX / Deuterocanonical books
  Jdt: "Judith", Tob: "Tobit", TobBA: "Tobit (BA)", TobS: "Tobit (S)",
  "1Macc": "1 Maccabees", "2Macc": "2 Maccabees",
  "3Macc": "3 Maccabees", "4Macc": "4 Maccabees",
  Wis: "Wisdom of Solomon", Sir: "Sirach",
  Bar: "Baruch", EpJer: "Epistle of Jeremiah",
  "1Esdr": "1 Esdras", "2Esdr": "2 Esdras",
  JoshA: "Joshua (LXX A)", JoshB: "Joshua (LXX B)",
  JudgA: "Judges (LXX A)", JudgB: "Judges (LXX B)",
  DanOG: "Daniel (OG)", DanTh: "Daniel (Th)",
  BelOG: "Bel and the Dragon (OG)", BelTh: "Bel and the Dragon (Th)",
  SusOG: "Susanna (OG)", SusTh: "Susanna (Th)",
  Odes: "Odes", PsSol: "Psalms of Solomon",
};

/** Canonical OT books that also exist in the LXX (STEPBIBLE_LXX source).
 *  Used to show the "Parallel LXX" toggle when viewing OSHB. */
export const OSHB_LXX_PARALLEL_BOOKS = new Set([
  "Gen", "Exod", "Lev", "Num", "Deut",
  "Josh", "Judg", "Ruth",
  "1Sam", "2Sam", "1Kgs", "2Kgs",
  "1Chr", "2Chr", "Ezra", "Neh", "Esth",
  "Job", "Ps", "Prov", "Eccl", "Song",
  "Isa", "Jer", "Lam", "Ezek", "Dan",
  "Hos", "Joel", "Amos", "Obad", "Jonah",
  "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
]);

/** Preferred display order for LXX books in the navigation dropdown.
 *  Canonical books first (using OSHB/Protestant order), then deuterocanonicals. */
export const LXX_BOOK_DISPLAY_ORDER: string[] = [
  // Pentateuch
  "Gen", "Exod", "Lev", "Num", "Deut",
  // Historical
  "Josh", "JoshA", "JoshB", "Judg", "JudgA", "JudgB", "Ruth",
  "1Sam", "2Sam", "1Kgs", "2Kgs", "1Chr", "2Chr",
  "1Esdr", "2Esdr", "Ezra", "Neh", "Esth", "Jdt", "TobBA", "TobS",
  "1Macc", "2Macc", "3Macc", "4Macc",
  // Wisdom/Poetry
  "Job", "Ps", "Prov", "Eccl", "Song", "Wis", "Sir", "Odes", "PsSol",
  // Prophets
  "Isa", "Jer", "Lam", "EpJer", "Bar", "Ezek",
  "DanOG", "DanTh", "SusOG", "SusTh", "BelOG", "BelTh",
  "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic",
  "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
];

/** MorphGNT 2-char book codes → OSIS codes */
export const MORPHGNT_BOOK_MAP: Record<string, string> = {
  "01": "Matt", "02": "Mark", "03": "Luke", "04": "John", "05": "Acts",
  "06": "Rom", "07": "1Cor", "08": "2Cor", "09": "Gal", "10": "Eph",
  "11": "Phil", "12": "Col", "13": "1Thess", "14": "2Thess",
  "15": "1Tim", "16": "2Tim", "17": "Titus", "18": "Phlm",
  "19": "Heb", "20": "Jas", "21": "1Pet", "22": "2Pet",
  "23": "1John", "24": "2John", "25": "3John", "26": "Jude", "27": "Rev",
};

/** OSHB book names → OSIS codes */
export const OSHB_BOOK_MAP: Record<string, string> = {
  Genesis: "Gen", Exodus: "Exod", Leviticus: "Lev", Numbers: "Num",
  Deuteronomy: "Deut", Joshua: "Josh", Judges: "Judg", Ruth: "Ruth",
  "1 Samuel": "1Sam", "2 Samuel": "2Sam", "1 Kings": "1Kgs", "2 Kings": "2Kgs",
  "1 Chronicles": "1Chr", "2 Chronicles": "2Chr", Ezra: "Ezra", Nehemiah: "Neh",
  Esther: "Esth", Job: "Job", Psalms: "Ps", Proverbs: "Prov",
  Ecclesiastes: "Eccl", "Song of Solomon": "Song", Isaiah: "Isa", Jeremiah: "Jer",
  Lamentations: "Lam", Ezekiel: "Ezek", Daniel: "Dan", Hosea: "Hos",
  Joel: "Joel", Amos: "Amos", Obadiah: "Obad", Jonah: "Jonah",
  Micah: "Mic", Nahum: "Nah", Habakkuk: "Hab", Zephaniah: "Zeph",
  Haggai: "Hag", Zechariah: "Zech", Malachi: "Mal",
};
