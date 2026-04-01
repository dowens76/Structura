import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// ── Lookup tables (normalized string values) ──────────────────────────────────

export const textSources = sqliteTable("text_sources", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const languages = sqliteTable("languages", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const partsOfSpeech = sqliteTable("parts_of_speech", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const persons = sqliteTable("persons", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const genders = sqliteTable("genders", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const wordNumbers = sqliteTable("word_numbers", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const tenses = sqliteTable("tenses", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const voices = sqliteTable("voices", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const moods = sqliteTable("moods", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const stems = sqliteTable("stems", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const states = sqliteTable("states", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

export const verbCases = sqliteTable("verb_cases", {
  id:    integer("id").primaryKey(),
  value: text("value").notNull(),
});

// ── Core tables ───────────────────────────────────────────────────────────────

export const books = sqliteTable("books", {
  id:          integer("id").primaryKey({ autoIncrement: true }),
  osisCode:    text("osis_code").notNull().unique(),
  name:        text("name").notNull(),
  testament:   text("testament").notNull(), // 'OT' | 'NT' | 'LXX'
  language:    text("language").notNull(),  // 'hebrew' | 'greek'
  bookNumber:  integer("book_number").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  textSource:  text("text_source").notNull(), // 'OSHB' | 'SBLGNT' | 'STEPBIBLE_LXX'
});

export const words = sqliteTable(
  "words",
  {
    id:               integer("id").primaryKey({ autoIncrement: true }),
    wordId:           text("word_id").notNull().unique(),
    bookId:           integer("book_id").notNull().references(() => books.id),
    chapter:          integer("chapter").notNull(),
    verse:            integer("verse").notNull(),
    positionInVerse:  integer("position_in_verse").notNull(),

    surfaceText:  text("surface_text").notNull(),
    surfaceNorm:  text("surface_norm"),

    lemma:        text("lemma"),
    strongNumber: text("strong_number"),
    morphCode:    text("morph_code"),

    // Normalized integer columns (decoded to strings in the query layer)
    textSourceId:   integer("text_source_id").notNull(),
    languageId:     integer("language_id").notNull(),
    partOfSpeechId: integer("part_of_speech_id"),
    personId:       integer("person_id"),
    genderId:       integer("gender_id"),
    wordNumberId:   integer("word_number_id"),
    tenseId:        integer("tense_id"),
    voiceId:        integer("voice_id"),
    moodId:         integer("mood_id"),
    stemId:         integer("stem_id"),
    stateId:        integer("state_id"),
    verbCaseId:     integer("verb_case_id"),
  },
  (table) => [
    index("words_book_ch_verse_idx").on(table.bookId, table.chapter, table.verse),
    index("words_lemma_idx").on(table.lemma),
    index("words_pos_idx").on(table.partOfSpeechId),
    index("words_source_idx").on(table.textSourceId),
  ]
);

export const verses = sqliteTable("verses", {
  id:         integer("id").primaryKey({ autoIncrement: true }),
  osisRef:    text("osis_ref").notNull().unique(),
  bookId:     integer("book_id").notNull().references(() => books.id),
  chapter:    integer("chapter").notNull(),
  verse:      integer("verse").notNull(),
  textSource: text("text_source").notNull(),
});

// ── Public types ──────────────────────────────────────────────────────────────

export type Book         = typeof books.$inferSelect;
export type WordRow      = typeof words.$inferSelect; // internal: has integer ID fields
export type Verse        = typeof verses.$inferSelect;
export type NewBook      = typeof books.$inferInsert;
export type NewWord      = typeof words.$inferInsert;
export type NewVerse     = typeof verses.$inferInsert;

/**
 * Public Word type used throughout the app — string fields for all morphology
 * columns, identical to the old schema so all existing consumer code works
 * without changes. The query layer decodes integer IDs to strings using
 * lookup maps loaded from the DB at startup.
 */
export interface Word {
  id:              number;
  wordId:          string;
  bookId:          number;
  chapter:         number;
  verse:           number;
  positionInVerse: number;
  surfaceText:     string;
  surfaceNorm:     string | null;
  lemma:           string | null;
  strongNumber:    string | null;
  morphCode:       string | null;
  partOfSpeech:    string | null;
  person:          string | null;
  gender:          string | null;
  wordNumber:      string | null;
  tense:           string | null;
  voice:           string | null;
  mood:            string | null;
  stem:            string | null;
  state:           string | null;
  verbCase:        string | null;
  language:        string;
  textSource:      string;
}
