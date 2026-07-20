import { integer, real, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─── Users & Workspaces ────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id:        integer("id").primaryKey({ autoIncrement: true }),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id:              integer("id").primaryKey({ autoIncrement: true }),
    userId:          integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name:            text("name").notNull(),
    translationOnly: integer("translation_only", { mode: "boolean" }).notNull().default(false),
    createdAt:       text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("workspaces_user_idx").on(t.userId)]
);

// ─── Annotation Tables (all scoped by workspaceId) ─────────────────────────

export const translations = sqliteTable(
  "translations",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    name:        text("name").notNull(),
    abbreviation: text("abbreviation").notNull(),
    language:    text("language"),
    createdAt:   integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (t) => [
    // Translations are shared across workspaces (see getTranslations in
    // lib/db/queries.ts), so the abbreviation must be globally unique, not
    // just per-workspace — otherwise two workspaces creating a translation
    // with the same abbreviation produce duplicate rows that collide when
    // the shared list is rendered together.
    uniqueIndex("trans_abbr_idx").on(t.abbreviation),
  ]
);

// bookId references books.id in source.db — FK not enforced cross-file
export const translationVerses = sqliteTable(
  "translation_verses",
  {
    id:           integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:  integer("workspace_id").notNull().default(1)
                    .references(() => workspaces.id, { onDelete: "cascade" }),
    translationId: integer("translation_id")
      .notNull()
      .references(() => translations.id, { onDelete: "cascade" }),
    osisRef:  text("osis_ref").notNull(),
    bookId:   integer("book_id").notNull(),
    chapter:  integer("chapter").notNull(),
    verse:    integer("verse").notNull(),
    text:     text("text").notNull(),
  },
  (table) => [
    index("tv_trans_book_ch_idx").on(table.translationId, table.bookId, table.chapter),
    index("tv_osis_ref_idx").on(table.osisRef),
  ]
);

export const paragraphBreaks = sqliteTable(
  "paragraph_breaks",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("pb_ws_word_idx").on(table.workspaceId, table.wordId),
    index("pb_book_ch_source_idx").on(table.book, table.chapter, table.textSource),
  ]
);

export const characters = sqliteTable(
  "characters",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    book:        text("book").notNull(),
    name:        text("name").notNull(),
    color:       text("color").notNull(),
    sortOrder:   integer("sort_order").default(0),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("char_book_idx").on(t.book)]
);

export const characterRefs = sqliteTable(
  "character_refs",
  {
    id:           integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:  integer("workspace_id").notNull().default(1)
                    .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:       text("word_id").notNull(),
    character1Id: integer("character1_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    character2Id: integer("character2_id").references(() => characters.id, { onDelete: "set null" }),
    textSource:   text("text_source").notNull(),
    book:         text("book").notNull(),
    chapter:      integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("cr_ws_word_idx").on(t.workspaceId, t.wordId),
    index("cr_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
  ]
);

export const speechSections = sqliteTable(
  "speech_sections",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    characterId: integer("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    startWordId: text("start_word_id").notNull(),
    endWordId:   text("end_word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [index("ss_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

export const wordTags = sqliteTable(
  "word_tags",
  {
    id:                integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:       integer("workspace_id").notNull().default(1)
                         .references(() => workspaces.id, { onDelete: "cascade" }),
    book:              text("book").notNull(),
    name:              text("name").notNull(),
    color:             text("color").notNull(),
    type:              text("type").notNull().default("concept"),
    sortOrder:         integer("sort_order").default(0),
    createdAt:         text("created_at").$defaultFn(() => new Date().toISOString()),
    /** FK to book_groupings.id — plain integer to avoid circular reference in Drizzle */
    corpusGroupingId:  integer("corpus_grouping_id"),
    /** JSON-encoded string[] of lemmas for "cluster" type tags */
    lemmas:            text("lemmas"),
  },
  (t) => [index("wt_book_idx").on(t.book)]
);

export const wordTagRefs = sqliteTable(
  "word_tag_refs",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    tagId:       integer("tag_id").notNull().references(() => wordTags.id, { onDelete: "cascade" }),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("wtr_ws_word_idx").on(t.workspaceId, t.wordId),
    index("wtr_tag_id_idx").on(t.tagId),
    index("wtr_book_ch_idx").on(t.book, t.chapter),
  ]
);

export const lineIndents = sqliteTable(
  "line_indents",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    indentLevel: integer("indent_level").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("li_ws_word_idx").on(t.workspaceId, t.wordId),
    index("li_book_ch_idx").on(t.book, t.chapter),
  ]
);

export const sceneBreaks = sqliteTable(
  "scene_breaks",
  {
    id:              integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:     integer("workspace_id").notNull().default(1)
                       .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:          text("word_id").notNull(),
    heading:         text("heading"),
    level:           integer("level").notNull().default(1),
    verse:           integer("verse").notNull().default(0),
    outOfSequence:   integer("out_of_sequence", { mode: "boolean" }).notNull().default(false),
    extendedThrough: integer("extended_through"),
    thematic:        integer("thematic", { mode: "boolean" }).notNull().default(false),
    thematicLetter:  text("thematic_letter"),
    transitional:    integer("transitional", { mode: "boolean" }).notNull().default(false),
    textSource:      text("text_source").notNull(),
    book:            text("book").notNull(),
    chapter:         integer("chapter").notNull(),
    createdAt:       text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("sb_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    uniqueIndex("sb_ws_word_level_idx").on(t.workspaceId, t.wordId, t.level),
  ]
);

export const passages = sqliteTable(
  "passages",
  {
    id:           integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:  integer("workspace_id").notNull().default(1)
                    .references(() => workspaces.id, { onDelete: "cascade" }),
    book:         text("book").notNull(),
    textSource:   text("text_source").notNull(),
    label:        text("label").notNull().default(""),
    startChapter: integer("start_chapter").notNull(),
    startVerse:   integer("start_verse").notNull(),
    /** Null (or same as `book`) for single-book passages; set to the
     *  continuation OSIS code for cross-book passages (e.g. "2Sam"). */
    endBook:      text("end_book"),
    endChapter:   integer("end_chapter").notNull(),
    endVerse:     integer("end_verse").notNull(),
  },
  (t) => [index("passages_book_src_idx").on(t.book, t.textSource)]
);


export const rstRelations = sqliteTable(
  "rst_relations",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    groupId:     text("group_id").notNull(),
    segWordId:   text("seg_word_id").notNull(),
    role:        text("role").notNull(),
    relType:     text("rel_type").notNull(),
    sortOrder:      integer("sort_order").notNull().default(0),
    intersectPoint: text("intersect_point").notNull().default("mid"),
    textSource:     text("text_source").notNull(),
    book:           text("book").notNull(),
    chapter:        integer("chapter").notNull(),
    createdAt:      text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("rst_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    index("rst_group_idx").on(t.groupId),
  ]
);

export const wordArrows = sqliteTable(
  "word_arrows",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    fromWordId:  text("from_word_id").notNull(),
    toWordId:    text("to_word_id").notNull(),
    label:       text("label"),
    color:       text("color"),
    midpointDx:  real("midpoint_dx"),
    midpointDy:  real("midpoint_dy"),
    midpoint2Dx: real("midpoint2_dx"),
    midpoint2Dy: real("midpoint2_dy"),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("wa_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

export const lineAnnotations = sqliteTable(
  "line_annotations",
  {
    id:            integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:   integer("workspace_id").notNull().default(1)
                     .references(() => workspaces.id, { onDelete: "cascade" }),
    annotType:     text("annot_type").notNull(),
    label:         text("label").notNull(),
    color:         text("color").notNull(),
    description:   text("description"),
    outOfSequence: integer("out_of_sequence", { mode: "boolean" }).notNull().default(false),
    transitional:  integer("transitional", { mode: "boolean" }).notNull().default(false),
    startWordId:   text("start_word_id").notNull(),
    endWordId:     text("end_word_id").notNull(),
    textSource:    text("text_source").notNull(),
    book:          text("book").notNull(),
    chapter:       integer("chapter").notNull(),
    createdAt:     text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("la_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
);

export const rstCustomTypes = sqliteTable(
  "rst_custom_types",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    key:         text("key").notNull(),
    label:       text("label").notNull(),
    abbr:        text("abbr").notNull(),
    color:       text("color").notNull(),
    category:    text("category").$type<"coordinate" | "subordinate">().notNull(),
    sortOrder:   integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("rct_ws_key_idx").on(t.workspaceId, t.key)]
);

export const notes = sqliteTable(
  "notes",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    key:         text("key").notNull(),
    noteType:    text("note_type").notNull(),
    content:     text("content").notNull().default("{}"),
    book:        text("book"),
    chapter:     integer("chapter"),
    updatedAt:   text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("notes_ws_key_idx").on(t.workspaceId, t.key),
    index("notes_book_ch_idx").on(t.book, t.chapter),
  ]
);

export const wordFormatting = sqliteTable(
  "word_formatting",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    isBold:        integer("is_bold",       { mode: "boolean" }).notNull().default(false),
    isItalic:      integer("is_italic",     { mode: "boolean" }).notNull().default(false),
    isSmallCaps:   integer("is_small_caps", { mode: "boolean" }).notNull().default(false),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("wfmt_ws_word_idx").on(t.workspaceId, t.wordId),
    index("wfmt_book_ch_idx").on(t.book, t.chapter),
  ]
);

// ─── Interlinear annotation tables ─────────────────────────────────────────

/** User-assigned grammatical constituent labels, one per word per workspace. */
export const constituentLabels = sqliteTable(
  "constituent_labels",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    label:       text("label").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("conlbl_ws_word_idx").on(t.workspaceId, t.wordId),
    index("conlbl_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
  ]
);

/** Named user-created word datasets (workspace-scoped). */
export const wordDatasets = sqliteTable(
  "word_datasets",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    name:        text("name").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("wds_ws_idx").on(t.workspaceId)]
);

/** Individual word entries within a dataset. */
export const wordDatasetEntries = sqliteTable(
  "word_dataset_entries",
  {
    id:         integer("id").primaryKey({ autoIncrement: true }),
    datasetId:  integer("dataset_id").notNull()
                  .references(() => wordDatasets.id, { onDelete: "cascade" }),
    wordId:     text("word_id").notNull(),
    value:      text("value").notNull(),
    // Shared across all member words of a manually-created grouping; null for
    // ordinary single-word entries.
    groupId:    text("group_id"),
    textSource: text("text_source").notNull(),
    book:       text("book").notNull(),
    chapter:    integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("wde_ds_word_idx").on(t.datasetId, t.wordId),
    index("wde_ds_book_ch_idx").on(t.datasetId, t.book, t.chapter, t.textSource),
    index("wde_ds_group_idx").on(t.datasetId, t.groupId),
  ]
);

/** Per-word character-level bold/italic formatting for the transliteration label.
 *  `format` stores sanitized HTML using only <b> and <i> tags. */
export const transliterationFormats = sqliteTable(
  "transliteration_formats",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    format:      text("format").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("trf_ws_word_idx").on(t.workspaceId, t.wordId),
    index("trf_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
  ]
);

// ─── Translation footnotes & version history ───────────────────────────────

/** Footnotes (\f) and cross-references (\x) extracted from USFM imports. */
export const translationFootnotes = sqliteTable(
  "translation_footnotes",
  {
    id:            integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:   integer("workspace_id").notNull().default(1)
                     .references(() => workspaces.id, { onDelete: "cascade" }),
    translationId: integer("translation_id").notNull()
                     .references(() => translations.id, { onDelete: "cascade" }),
    osisRef:       text("osis_ref").notNull(),
    type:          text("type").notNull(),         // "f" | "x"
    content:       text("content").notNull(),      // USFM body of the note
    wordIndex:     integer("word_index").notNull().default(0),
    book:          text("book").notNull(),
    chapter:       integer("chapter").notNull(),
    verse:         integer("verse").notNull(),
    createdAt:     text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("tf_trans_book_ch_idx").on(t.translationId, t.book, t.chapter),
    index("tf_osis_ref_idx").on(t.osisRef),
  ]
);

/** Per-verse text snapshots recorded before each save (fine-grained VCS). */
export const translationVersions = sqliteTable(
  "translation_versions",
  {
    id:            integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:   integer("workspace_id").notNull().default(1)
                     .references(() => workspaces.id, { onDelete: "cascade" }),
    translationId: integer("translation_id").notNull()
                     .references(() => translations.id, { onDelete: "cascade" }),
    osisRef:       text("osis_ref").notNull(),
    text:          text("text").notNull(),
    label:         text("label"),
    createdAt:     text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("tv_ver_trans_osis_idx").on(t.translationId, t.osisRef),
    index("tv_ver_ws_trans_idx").on(t.workspaceId, t.translationId),
  ]
);

// ─── Auto-backup settings (single-row, id always 1) ────────────────────────

export const paragraphHeadings = sqliteTable(
  "paragraph_headings",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    verse:       integer("verse").notNull(),
    heading:     text("heading").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("ph_ws_bkchv_idx").on(t.workspaceId, t.book, t.chapter, t.verse),
    index("ph_book_ch_idx").on(t.book, t.chapter),
  ]
);

// ─── Book Groupings (workspace-scoped) ─────────────────────────────────────

/**
 * A named set of books with an optional list of annotation features to show.
 * Stored as JSON strings so no extra join tables are needed.
 */
export const bookGroupings = sqliteTable(
  "book_groupings",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    name:        text("name").notNull(),
    /** JSON-encoded string[]: OSIS book codes, e.g. '["1Sam","2Sam"]' */
    books:       text("books").notNull().default("[]"),
    /** JSON-encoded string[]: feature keys, e.g. '["characters","wordTags"]' */
    features:    text("features").notNull().default("[]"),
    sortOrder:   integer("sort_order").notNull().default(0),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("bg_ws_idx").on(t.workspaceId)]
);

export const autoBackupSettings = sqliteTable("auto_backup_settings", {
  id:             integer("id").primaryKey(),  // always 1
  enabled:        integer("enabled", { mode: "boolean" }).notNull().default(false),
  folderPath:     text("folder_path"),         // absolute path on disk, null = not configured
  intervalType:   text("interval_type").notNull().default("daily"),
                  // 'daily' | 'weekly' | 'custom'
  intervalHours:  integer("interval_hours").notNull().default(24),
                  // used only when intervalType = 'custom'
  retentionType:  text("retention_type").notNull().default("smart"),
                  // 'keep_all' | 'keep_n' | 'smart'
  retentionCount: integer("retention_count").notNull().default(10),
                  // used only when retentionType = 'keep_n'
  lastBackupAt:   text("last_backup_at"),      // ISO 8601, null = never backed up
  lastError:      text("last_error"),          // last failure message, null = no error
  updatedAt:      text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── App Settings (global key-value, not workspace-scoped) ─────────────────
// Used for things like third-party API credentials that apply to the whole app.
// Values are stored as plain text; callers are responsible for any encoding.

export const appSettings = sqliteTable("app_settings", {
  key:   text("key").primaryKey(),
  value: text("value").notNull(),
});

// ─── Text Critical Markup ──────────────────────────────────────────────────

/** Per-word text-critical marks for comparing MT (OSHB) with LXX. */
export const textCriticalMarks = sqliteTable(
  "text_critical_marks",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    // 'lxx_unique' = green, 'mt_unique' = red, 'same_different' = yellow
    markType:    text("mark_type").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("tcm_ws_word_idx").on(t.workspaceId, t.wordId),
    index("tcm_book_ch_idx").on(t.book, t.chapter),
  ]
);

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id:           text("id").primaryKey(),           // client-generated uid
    workspaceId:  integer("workspace_id").notNull().default(1)
                    .references(() => workspaces.id, { onDelete: "cascade" }),
    label:        text("label").notNull().default(""),
    href:         text("href").notNull(),
    translations: text("translations").notNull().default("[]"), // JSON array of abbr strings
    createdAt:    integer("created_at").notNull(),   // Unix ms timestamp
  },
  (t) => [index("bookmarks_workspace_idx").on(t.workspaceId)]
);

// ─── Intertextual Links ────────────────────────────────────────────────────

/** Cross-passage intertextual connections (quotations, allusions, echoes, typology, parallels). */
export const intertextualLinks = sqliteTable(
  "intertextual_links",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),

    // Source side (earlier / cited text)
    sourceBook:        text("source_book").notNull(),
    sourceChapter:     integer("source_chapter").notNull(),
    sourceVerse:       integer("source_verse").notNull(),
    sourceEndVerse:    integer("source_end_verse"),
    sourceTextSource:  text("source_text_source").notNull(),
    sourceStartWordId: text("source_start_word_id"),
    sourceEndWordId:   text("source_end_word_id"),

    // Target side (later / citing text, or parallel)
    targetBook:        text("target_book").notNull(),
    targetChapter:     integer("target_chapter").notNull(),
    targetVerse:       integer("target_verse").notNull(),
    targetEndVerse:    integer("target_end_verse"),
    targetTextSource:  text("target_text_source").notNull(),
    targetStartWordId: text("target_start_word_id"),
    targetEndWordId:   text("target_end_word_id"),

    // Link metadata
    linkType:  text("link_type").notNull(),   // "quotation" | "allusion" | "echo" | "typology" | "parallel" | custom
    strength:  integer("strength").notNull().default(3),  // 1–5 confidence
    notes:     text("notes"),
    direction: text("direction").notNull().default("source_to_target"),  // "source_to_target" | "bidirectional"
    tags:      text("tags").notNull().default("[]"),  // JSON string[]

    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("il_workspace_idx").on(t.workspaceId),
    index("il_source_idx").on(t.sourceBook, t.sourceChapter),
    index("il_target_idx").on(t.targetBook, t.targetChapter),
  ]
);

// ─── Types ─────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Translation = typeof translations.$inferSelect;
export type TranslationVerse = typeof translationVerses.$inferSelect;
export type ParagraphBreak = typeof paragraphBreaks.$inferSelect;
export type ParagraphHeading = typeof paragraphHeadings.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type CharacterRef = typeof characterRefs.$inferSelect;
export type SpeechSection = typeof speechSections.$inferSelect;
export type WordTag = typeof wordTags.$inferSelect;
export type WordTagRef = typeof wordTagRefs.$inferSelect;
export type LineIndent = typeof lineIndents.$inferSelect;
export type SceneBreak = typeof sceneBreaks.$inferSelect;
export type Passage = typeof passages.$inferSelect;
export type RstRelation = typeof rstRelations.$inferSelect;
export type WordArrow = typeof wordArrows.$inferSelect;
export type WordFormatting = typeof wordFormatting.$inferSelect;
export type LineAnnotation = typeof lineAnnotations.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type RstCustomType = typeof rstCustomTypes.$inferSelect;
export type AutoBackupSettings = typeof autoBackupSettings.$inferSelect;
export type ConstituentLabel = typeof constituentLabels.$inferSelect;
export type WordDataset = typeof wordDatasets.$inferSelect;
export type WordDatasetEntry = typeof wordDatasetEntries.$inferSelect;
export type BookGrouping = typeof bookGroupings.$inferSelect;
export type TranslationFootnote = typeof translationFootnotes.$inferSelect;
export type TranslationVersion = typeof translationVersions.$inferSelect;
export type TextCriticalMark = typeof textCriticalMarks.$inferSelect;
export type IntertextualLink = typeof intertextualLinks.$inferSelect;
export type NewIntertextualLink = typeof intertextualLinks.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
