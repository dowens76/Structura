import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  language: text("language"),   // e.g. 'English', 'French', 'German' — null if unset
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

// Paragraph-level indentation (marks the first word of an indented paragraph)
export const lineIndents = sqliteTable(
  "line_indents",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    wordId:      text("word_id").notNull().unique(), // first word of the indented paragraph
    indentLevel: integer("indent_level").notNull(),  // 1, 2, 3 … (not stored for level 0)
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [index("li_book_ch_idx").on(t.book, t.chapter)]
);

// Section breaks — hierarchical structural markers (solid HR + optional heading).
// Level 1 = highest (book section), level 6 = lowest (minor note).
// Multiple levels may exist at the same wordId position (stacked display).
// Always implies a paragraph break: toggling a section break also adds/removes a paragraph break.
export const sceneBreaks = sqliteTable(
  "scene_breaks",
  {
    id:              integer("id").primaryKey({ autoIncrement: true }),
    wordId:          text("word_id").notNull(),           // first word of the new section
    heading:         text("heading"),                     // optional section title (null = none)
    level:           integer("level").notNull().default(1), // 1–6 (1=highest)
    verse:           integer("verse").notNull().default(0), // verse number of wordId's verse
    outOfSequence:   integer("out_of_sequence", { mode: "boolean" }).notNull().default(false),
    extendedThrough: integer("extended_through"),                 // nullable; Psalms grouping only
    textSource:      text("text_source").notNull(),
    book:            text("book").notNull(),
    chapter:         integer("chapter").notNull(),
    createdAt:       text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("sb_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    uniqueIndex("sb_word_level_idx").on(t.wordId, t.level),
  ]
);

// User-defined passage ranges (can span multiple chapters or be a sub-chapter slice)
export const passages = sqliteTable(
  "passages",
  {
    id:           integer("id").primaryKey({ autoIncrement: true }),
    book:         text("book").notNull(),
    textSource:   text("text_source").notNull(),
    label:        text("label").notNull().default(""),
    startChapter: integer("start_chapter").notNull(),
    startVerse:   integer("start_verse").notNull(),
    endChapter:   integer("end_chapter").notNull(),
    endVerse:     integer("end_verse").notNull(),
  },
  (t) => [index("passages_book_src_idx").on(t.book, t.textSource)]
);

// Clause-to-clause logical relationships (segments identified by first word ID)
export const clauseRelationships = sqliteTable(
  "clause_relationships",
  {
    id:            integer("id").primaryKey({ autoIncrement: true }),
    fromSegWordId: text("from_seg_word_id").notNull(), // first word ID of the "from" paragraph segment
    toSegWordId:   text("to_seg_word_id").notNull(),   // first word ID of the "to" paragraph segment
    relType:       text("rel_type").notNull(),          // e.g. "cause", "purpose", "contrast"
    textSource:    text("text_source").notNull(),
    book:          text("book").notNull(),
    chapter:       integer("chapter").notNull(),
    createdAt:     text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("clrel_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

// RST (Rhetorical Structure Theory) relations between paragraph segments.
// Each RST relation is a group of members sharing a groupId (UUID).
// For subordinate relations: one "nucleus" + one "satellite" member.
// For coordinate (multinuclear) relations: two or more "nucleus" members.
// sortOrder preserves document order within the group.
export const rstRelations = sqliteTable(
  "rst_relations",
  {
    id:         integer("id").primaryKey({ autoIncrement: true }),
    groupId:    text("group_id").notNull(),      // UUID — ties all members of one RST relation
    segWordId:  text("seg_word_id").notNull(),   // first word ID of this segment
    role:       text("role").notNull(),           // "nucleus" | "satellite"
    relType:    text("rel_type").notNull(),       // e.g. "cause", "coordination"
    sortOrder:  integer("sort_order").notNull().default(0),
    textSource: text("text_source").notNull(),
    book:       text("book").notNull(),
    chapter:    integer("chapter").notNull(),
    createdAt:  text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("rst_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    index("rst_group_idx").on(t.groupId),
  ]
);

// Free-form word-to-word arrows (displayed as bezier curves below the text)
export const wordArrows = sqliteTable(
  "word_arrows",
  {
    id:         integer("id").primaryKey({ autoIncrement: true }),
    fromWordId: text("from_word_id").notNull(),
    toWordId:   text("to_word_id").notNull(),
    label:      text("label"),             // optional text label on the arrow
    textSource: text("text_source").notNull(),
    book:       text("book").notNull(),
    chapter:    integer("chapter").notNull(), // chapter of fromWordId
    createdAt:  text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("wa_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

// Line annotations — structural notes attached to a range of paragraph segments.
// annotType: "plot" | "theme"
// For plot annotations, label is one of: Info, IS, Con, TA, Res, FS.
// For theme annotations, label is a user-defined letter (A, B, C …) and color is user-chosen.
// startWordId and endWordId are the FIRST WORD IDs of the start and end paragraph segments.
export const lineAnnotations = sqliteTable(
  "line_annotations",
  {
    id:             integer("id").primaryKey({ autoIncrement: true }),
    annotType:      text("annot_type").notNull(),   // "plot" | "theme" | "desc"
    label:          text("label").notNull(),         // "Info" | "IS" | … | "A" | "B" … | ""
    color:          text("color").notNull(),         // hex color (predefined for plot, user-chosen for theme/desc)
    description:    text("description"),             // optional freeform note
    outOfSequence:  integer("out_of_sequence", { mode: "boolean" }).notNull().default(false),
    startWordId:    text("start_word_id").notNull(), // first word of the start paragraph segment
    endWordId:      text("end_word_id").notNull(),   // first word of the end paragraph segment
    textSource:     text("text_source").notNull(),
    book:           text("book").notNull(),
    chapter:        integer("chapter").notNull(),
    createdAt:      text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("la_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

// Free-form notes keyed by a string ref.
// key format:  "verse:Gen.1.1"  |  "chapter:Gen.1"  |  "passage:42"
export const notes = sqliteTable(
  "notes",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    key:       text("key").notNull().unique(),   // unique composite key (see above)
    noteType:  text("note_type").notNull(),       // "verse" | "chapter" | "passage"
    content:   text("content").notNull().default("{}"), // Tiptap JSON
    book:      text("book"),                      // for verse/chapter notes
    chapter:   integer("chapter"),               // for verse/chapter notes
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("notes_book_ch_idx").on(t.book, t.chapter),
  ]
);

// Per-word bold/italic formatting
export const wordFormatting = sqliteTable(
  "word_formatting",
  {
    id:         integer("id").primaryKey({ autoIncrement: true }),
    wordId:     text("word_id").notNull().unique(), // one row per word
    isBold:     integer("is_bold",   { mode: "boolean" }).notNull().default(false),
    isItalic:   integer("is_italic", { mode: "boolean" }).notNull().default(false),
    textSource: text("text_source").notNull(),
    book:       text("book").notNull(),
    chapter:    integer("chapter").notNull(),
  },
  (t) => [index("wfmt_book_ch_idx").on(t.book, t.chapter)]
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
export type LineIndent = typeof lineIndents.$inferSelect;
export type SceneBreak = typeof sceneBreaks.$inferSelect;
export type Passage = typeof passages.$inferSelect;
export type ClauseRelationship = typeof clauseRelationships.$inferSelect;
export type RstRelation = typeof rstRelations.$inferSelect;
export type WordArrow = typeof wordArrows.$inferSelect;
export type WordFormatting = typeof wordFormatting.$inferSelect;
export type LineAnnotation = typeof lineAnnotations.$inferSelect;
export type Note = typeof notes.$inferSelect;
