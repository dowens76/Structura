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

    // Parsed morphology fields
    partOfSpeech: text("part_of_speech"),
    person: text("person"),
    gender: text("gender"),
    wordNumber: text("word_number"),
    tense: text("tense"),
    voice: text("voice"),
    mood: text("mood"),
    stem: text("stem"),         // Hebrew verb stems (qal, niphal, etc.)
    state: text("state"),       // Hebrew nominal state (absolute, construct)
    verbCase: text("verb_case"), // Greek case (nominative, genitive, etc.)

    language: text("language").notNull(),     // 'hebrew' | 'greek'
    textSource: text("text_source").notNull(), // 'OSHB' | 'SBLGNT' | 'STEPBIBLE_LXX'
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

export const translations = sqliteTable("translations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const translationVerses = sqliteTable(
  "translation_verses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    translationId: integer("translation_id")
      .notNull()
      .references(() => translations.id, { onDelete: "cascade" }),
    osisRef: text("osis_ref").notNull(),
    bookId: integer("book_id").notNull().references(() => books.id),
    chapter: integer("chapter").notNull(),
    verse: integer("verse").notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    index("tv_trans_book_ch_idx").on(table.translationId, table.bookId, table.chapter),
    index("tv_osis_ref_idx").on(table.osisRef),
  ]
);

export const paragraphBreaks = sqliteTable(
  "paragraph_breaks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wordId: text("word_id").notNull().unique(),
    textSource: text("text_source").notNull(),
    book: text("book").notNull(),
    chapter: integer("chapter").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("pb_book_ch_source_idx").on(table.book, table.chapter, table.textSource),
  ]
);

// Book-scoped character definitions
export const characters = sqliteTable(
  "characters",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    book:      text("book").notNull(),
    name:      text("name").notNull(),
    color:     text("color").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("char_book_idx").on(t.book)]
);

// Word-level character references (up to two characters per word)
export const characterRefs = sqliteTable(
  "character_refs",
  {
    id:           integer("id").primaryKey({ autoIncrement: true }),
    wordId:       text("word_id").notNull().unique(),
    character1Id: integer("character1_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    character2Id: integer("character2_id").references(() => characters.id, { onDelete: "set null" }),
    textSource:   text("text_source").notNull(),
    book:         text("book").notNull(),
    chapter:      integer("chapter").notNull(),
  },
  (t) => [index("cr_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

// Word-range speech sections
export const speechSections = sqliteTable(
  "speech_sections",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    characterId: integer("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    startWordId: text("start_word_id").notNull(),
    endWordId:   text("end_word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [index("ss_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

// Book-scoped word/concept tags
export const wordTags = sqliteTable(
  "word_tags",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    book:      text("book").notNull(),
    name:      text("name").notNull(),
    color:     text("color").notNull(),
    type:      text("type").notNull().default("concept"), // "word" | "concept"
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("wt_book_idx").on(t.book)]
);

// Word-level tag references (one tag per word position)
export const wordTagRefs = sqliteTable(
  "word_tag_refs",
  {
    id:         integer("id").primaryKey({ autoIncrement: true }),
    wordId:     text("word_id").notNull().unique(),
    tagId:      integer("tag_id").notNull().references(() => wordTags.id, { onDelete: "cascade" }),
    textSource: text("text_source").notNull(),
    book:       text("book").notNull(),
    chapter:    integer("chapter").notNull(),
  },
  (t) => [
    index("wtr_tag_id_idx").on(t.tagId),
    index("wtr_book_ch_idx").on(t.book, t.chapter),
  ]
);

export type Book = typeof books.$inferSelect;
export type Word = typeof words.$inferSelect;
export type Verse = typeof verses.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type NewWord = typeof words.$inferInsert;
export type NewVerse = typeof verses.$inferInsert;
export type Translation = typeof translations.$inferSelect;
export type TranslationVerse = typeof translationVerses.$inferSelect;
export type ParagraphBreak = typeof paragraphBreaks.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type CharacterRef = typeof characterRefs.$inferSelect;
export type SpeechSection = typeof speechSections.$inferSelect;
export type WordTag = typeof wordTags.$inferSelect;
export type WordTagRef = typeof wordTagRefs.$inferSelect;
