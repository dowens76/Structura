import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  osisCode: text("osis_code").notNull().unique(),
  name: text("name").notNull(),
  testament: text("testament").notNull(), // 'OT' | 'NT' | 'LXX'
  language: text("language").notNull(),   // 'hebrew' | 'greek'
  bookNumber: integer("book_number").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  textSource: text("text_source").notNull(), // 'OSHB' | 'SBLGNT' | 'STEPBIBLE_LXX'
});

export const words = sqliteTable(
  "words",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wordId: text("word_id").notNull().unique(),
    osisRef: text("osis_ref").notNull(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id),
    chapter: integer("chapter").notNull(),
    verse: integer("verse").notNull(),
    positionInVerse: integer("position_in_verse").notNull(),

    surfaceText: text("surface_text").notNull(),
    surfaceNorm: text("surface_norm"),

    lemma: text("lemma"),
    strongNumber: text("strong_number"),
    morphCode: text("morph_code"),

    partOfSpeech: text("part_of_speech"),
    person: text("person"),
    gender: text("gender"),
    wordNumber: text("word_number"),
    tense: text("tense"),
    voice: text("voice"),
    mood: text("mood"),
    stem: text("stem"),
    state: text("state"),
    verbCase: text("verb_case"),

    language: text("language").notNull(),
    textSource: text("text_source").notNull(),
  },
  (table) => [
    index("words_osis_ref_idx").on(table.osisRef),
    index("words_book_ch_verse_idx").on(table.bookId, table.chapter, table.verse),
    index("words_lemma_idx").on(table.lemma),
    index("words_pos_idx").on(table.partOfSpeech),
    index("words_source_idx").on(table.textSource),
  ]
);

export const verses = sqliteTable("verses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  osisRef: text("osis_ref").notNull().unique(),
  bookId: integer("book_id")
    .notNull()
    .references(() => books.id),
  chapter: integer("chapter").notNull(),
  verse: integer("verse").notNull(),
  textSource: text("text_source").notNull(),
});

export const lexiconEntries = sqliteTable(
  "lexicon_entries",
  {
    id:              integer("id").primaryKey({ autoIncrement: true }),
    strongNumber:    text("strong_number").notNull().unique(),
    language:        text("language").notNull(),
    lemma:           text("lemma"),
    transliteration: text("transliteration"),
    pronunciation:   text("pronunciation"),
    shortGloss:      text("short_gloss"),
    definition:      text("definition"),
    usage:           text("usage"),
    source:          text("source"),
  },
  (t) => [index("lex_strong_idx").on(t.strongNumber)]
);

export type Book = typeof books.$inferSelect;
export type Word = typeof words.$inferSelect;
export type Verse = typeof verses.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type NewWord = typeof words.$inferInsert;
export type NewVerse = typeof verses.$inferInsert;
export type LexiconEntry = typeof lexiconEntries.$inferSelect;
