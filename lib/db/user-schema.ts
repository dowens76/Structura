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

// ─── Versions (per workspace + book + chapter markup layers) ──────────────

export const versions = sqliteTable(
  "versions",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull()
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    name:        text("name").notNull(),
    sortOrder:   integer("sort_order").notNull().default(0),
    /** Set when this version was created from the Passage view and fanned
     *  out across multiple chapters with the same name — lets rename/delete
     *  apply to the whole group instead of matching by name text. Null for
     *  versions created from a single-chapter view. */
    groupKey:    text("group_key"),
    /** Bumped by copyVersionAnnotations whenever this version's markup is
     *  overwritten by a copy. The chapter/passage pages fold this into
     *  ChapterDisplay's remount key so a copy targeting the version the user
     *  is currently viewing forces a fresh render — otherwise the key
     *  (workspaceId + versionId) is unchanged and React reuses the existing
     *  instance, whose per-feature state was only ever initialized once from
     *  the old initial* props and never re-syncs on its own. */
    contentRevision: integer("content_revision").notNull().default(0),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("ver_ws_book_ch_idx").on(t.workspaceId, t.book, t.chapter),
    index("ver_group_idx").on(t.groupKey),
  ]
);

/** Which version is currently active for a given (workspace, book, chapter)
 *  locus — the version equivalent of the structura_active_workspace cookie,
 *  but DB-backed since a per-locus cookie map would grow unboundedly. */
export const activeVersionSelections = sqliteTable(
  "active_version_selections",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull()
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("avs_ws_book_ch_idx").on(t.workspaceId, t.book, t.chapter)]
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
    sortOrder:   integer("sort_order").notNull().default(0),
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
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("pb_ws_word_idx").on(table.workspaceId, table.versionId, table.wordId),
    index("pb_book_ch_source_idx").on(table.book, table.chapter, table.textSource),
  ]
);

export const horizontalLines = sqliteTable(
  "horizontal_lines",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("hl_ws_word_idx").on(table.workspaceId, table.versionId, table.wordId),
    index("hl_book_ch_source_idx").on(table.book, table.chapter, table.textSource),
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
    /** FK to book_groupings.id — plain integer, same reasoning as wordTags.corpusGroupingId. */
    corpusGroupingId: integer("corpus_grouping_id"),
    /** Which kind of scope this character is limited to — see wordTags.corpusType
     *  and resolveVisibleWordTags() for the equivalent on tags; characters use
     *  the same "book" | "chapter" | "passage" | "grouping" scheme. */
    corpusType:       text("corpus_type").notNull().default("book"),
    /** Chapter number, only meaningful when corpusType = "chapter". */
    corpusChapter:    integer("corpus_chapter"),
    /** FK to passages.id — plain integer. Only meaningful when corpusType = "passage". */
    corpusPassageId:  integer("corpus_passage_id"),
    /** JSON-encoded string[] of lemmas whose occurrences are auto-linked to
     *  this character via character_refs (see getWordRefsByLemmas). */
    lemmas:           text("lemmas"),
  },
  (t) => [index("char_book_idx").on(t.book)]
);

export const characterRefs = sqliteTable(
  "character_refs",
  {
    id:           integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:  integer("workspace_id").notNull().default(1)
                    .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:    integer("version_id").notNull()
                    .references(() => versions.id, { onDelete: "cascade" }),
    wordId:       text("word_id").notNull(),
    character1Id: integer("character1_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    character2Id: integer("character2_id").references(() => characters.id, { onDelete: "set null" }),
    textSource:   text("text_source").notNull(),
    book:         text("book").notNull(),
    chapter:      integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("cr_ws_word_idx").on(t.workspaceId, t.versionId, t.wordId),
    index("cr_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
  ]
);

export const speechSections = sqliteTable(
  "speech_sections",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
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
    /** Which kind of scope this tag is limited to: "book" (the `book` column,
     *  plus its contiguous pair sibling e.g. 1Sam/2Sam), "chapter"
     *  (book + corpusChapter), "passage" (corpusPassageId), or "grouping"
     *  (corpusGroupingId). Determines which chapter/passage views the tag
     *  shows up in — see resolveWordTagVisibility(). */
    corpusType:        text("corpus_type").notNull().default("book"),
    /** Chapter number, only meaningful when corpusType = "chapter". */
    corpusChapter:     integer("corpus_chapter"),
    /** FK to passages.id — plain integer, same reasoning as corpusGroupingId.
     *  Only meaningful when corpusType = "passage". */
    corpusPassageId:   integer("corpus_passage_id"),
    /** JSON-encoded string[] of lemmas for "cluster" type tags */
    lemmas:            text("lemmas"),
    /** Whether this tag's occurrences should be pre-highlighted when opening
     *  a chapter in the reading view. */
    highlighted:       integer("highlighted", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("wt_book_idx").on(t.book)]
);

export const wordTagRefs = sqliteTable(
  "word_tag_refs",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    tagId:       integer("tag_id").notNull().references(() => wordTags.id, { onDelete: "cascade" }),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("wtr_ws_word_idx").on(t.workspaceId, t.versionId, t.wordId),
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
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    indentLevel: integer("indent_level").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("li_ws_word_idx").on(t.workspaceId, t.versionId, t.wordId),
    index("li_book_ch_idx").on(t.book, t.chapter),
  ]
);

export const syllableStressOverrides = sqliteTable(
  "syllable_stress_overrides",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    stresses:    integer("stresses").notNull(),
    syllables:   integer("syllables").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("sso_ws_word_idx").on(t.workspaceId, t.versionId, t.wordId),
    index("sso_book_ch_idx").on(t.book, t.chapter),
  ]
);

export const sceneBreaks = sqliteTable(
  "scene_breaks",
  {
    id:              integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:     integer("workspace_id").notNull().default(1)
                       .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:       integer("version_id").notNull()
                       .references(() => versions.id, { onDelete: "cascade" }),
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
    uniqueIndex("sb_ws_word_level_idx").on(t.workspaceId, t.versionId, t.wordId, t.level),
  ]
);

export const synopticSets = sqliteTable(
  "synoptic_sets",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    title:       text("title").notNull(),
    /** "gospels" | "historical" | "psalms" | "custom" — grouping tag for the /synoptic index. */
    corpus:      text("corpus").notNull().default("custom"),
    /** "seed" | "custom" — seed rows are never overwritten by re-running the importer. */
    source:      text("source").notNull().default("custom"),
    /** Stable key used by scripts/import-synoptic-sets.ts for idempotent upsert. Null for custom sets. */
    slug:        text("slug"),
    sortOrder:   integer("sort_order").notNull().default(0),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("ss_ws_idx").on(t.workspaceId),
    uniqueIndex("ss_ws_slug_idx").on(t.workspaceId, t.slug),
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
    /** Set when this passage row is one column of a synoptic set rather than
     *  a standalone user passage — see synopticSets and getSynopticSet(). */
    synopticSetId: integer("synoptic_set_id").references(() => synopticSets.id, { onDelete: "cascade" }),
    /** 0-based position of this column within its synoptic set. */
    columnIndex:   integer("column_index"),
    /** Display label for this column (e.g. "Matthew", "Chronicles"). */
    columnLabel:   text("column_label"),
  },
  (t) => [
    index("passages_book_src_idx").on(t.book, t.textSource),
    index("passages_synoptic_set_idx").on(t.synopticSetId),
  ]
);


export const rstRelations = sqliteTable(
  "rst_relations",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
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

/**
 * Poetry line-grouping brackets — groups 2+ consecutive paragraph "lines"
 * (or nested sub-groupings) to render as a vertical bracket in the margin,
 * with tighter vertical spacing between more closely-grouped lines. See
 * lib/lineGroups/buildLineGroupTree.ts for the nesting convention.
 *
 * Structurally a trimmed rstRelations: same flat-rows-form-a-group shape,
 * but no role (nucleus/satellite) or relType — grouping here is symmetric
 * and untyped, so members are ordered purely by sortOrder.
 */
export const lineGroups = sqliteTable(
  "line_groups",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    groupId:     text("group_id").notNull(),
    /** A paragraph's first wordId, OR another group's groupId (nesting). */
    memberId:    text("member_id").notNull(),
    sortOrder:   integer("sort_order").notNull().default(0),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("lg_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    index("lg_group_idx").on(t.groupId),
  ]
);

export const wordArrows = sqliteTable(
  "word_arrows",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    fromWordId:  text("from_word_id").notNull(),
    toWordId:    text("to_word_id").notNull(),
    label:       text("label"),
    color:       text("color"),
    midpointDx:  real("midpoint_dx"),
    midpointDy:  real("midpoint_dy"),
    midpoint2Dx: real("midpoint2_dx"),
    midpoint2Dy: real("midpoint2_dy"),
    /** Set only on arrows auto-drawn by Similarity's "Add word" chaining
     *  (see poetryNotations.similarityGroupId) — null for manually-drawn
     *  arrows. Lets a per-word delete in that flow find and remove just the
     *  arrow(s) touching the deleted word within that group. */
    similarityGroupId: integer("similarity_group_id"),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("wa_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    index("wa_similarity_group_idx").on(t.similarityGroupId),
  ]
);

export const lineAnnotations = sqliteTable(
  "line_annotations",
  {
    id:            integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:   integer("workspace_id").notNull().default(1)
                     .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:     integer("version_id").notNull()
                     .references(() => versions.id, { onDelete: "cascade" }),
    annotType:     text("annot_type").notNull(),
    label:         text("label").notNull(),
    commFunction:  text("comm_function"),
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

/**
 * Poetry notation marks — Emmylou Grosser's Gestalt-based Biblical Hebrew
 * poetry notation: continuation, balance/imbalance, requiredness, symmetry,
 * similarity, closure. One unified table (rather than one per principle)
 * since every row shares the same versioning/CRUD shape; unused geometry
 * columns stay null for a given row:
 *   continuation                : startWordId only (word-anchored)
 *   requiredness                : subtype null|"arrow" (startWordId = the "requires" word; optionally resolvedStartWordId/resolvedEndWordId = the word/phrase that resolves it, arbitrary range not segment-snapped) | "underline" (startWordId/endWordId = arbitrary word range, not segment-snapped, same as closure "weak")
 *   balance                     : startWordId/endWordId = two paragraphFirstWordIds entries (bracket spans from the top of the earlier line to the bottom of the later one, "=" centered between); subtype "balance"|"imbalance"; direction "left"|"right" (imbalance only)
 *   symmetry                    : startWordId/endWordId = two paragraphFirstWordIds entries, in click order (upper/lower triangle)
 *   similarity                  : startWordId/startGraphemeIndex .. endWordId/endGraphemeIndex (letter range, may span adjacent words in one line); similarityGroupId optionally chains this mark to others anywhere in the chapter (see below)
 *   closure                     : subtype "weak" (startWordId/endWordId = arbitrary word range, not segment-snapped) | "complete" (startWordId = a line's segFirstWordId, endWordId null)
 */
export const poetryNotations = sqliteTable(
  "poetry_notations",
  {
    id:                 integer("id").primaryKey({ autoIncrement: true }),
    workspaceId:        integer("workspace_id").notNull().default(1)
                          .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:          integer("version_id").notNull()
                          .references(() => versions.id, { onDelete: "cascade" }),
    principle:          text("principle").notNull(), // "continuation"|"balance"|"requiredness"|"symmetry"|"similarity"|"closure"
    subtype:            text("subtype"),              // balance: "balance"|"imbalance"; closure: "weak"|"complete"; requiredness: "arrow"|"underline"
    direction:          text("direction"),             // imbalance triangle: "left"|"right"
    startWordId:        text("start_word_id").notNull(),
    endWordId:          text("end_word_id"),
    startGraphemeIndex: integer("start_grapheme_index"), // similarity only
    endGraphemeIndex:   integer("end_grapheme_index"),   // similarity only
    /** Requiredness ("arrow" subtype) only — the word/phrase that resolves
     *  what startWordId requires. An arbitrary word range (not segment-
     *  snapped), same shape as endWordId's range use elsewhere; kept as its
     *  own pair of columns rather than reusing endWordId so the "requires"
     *  word (startWordId) and the "resolves" range stay unambiguous. */
    resolvedStartWordId: text("resolved_start_word_id"),
    resolvedEndWordId:   text("resolved_end_word_id"),
    /** Similarity only — chains this mark to others into one "Add word"
     *  group, anywhere in the chapter. A stable tag, not a live FK: set to
     *  the group's first member's own id when the group is created, and
     *  stays that value even if that specific row is later deleted (the
     *  other members just keep carrying the same tag). Every member's
     *  `note` is kept in sync so deleting any one member never loses it. */
    similarityGroupId:  integer("similarity_group_id"),
    note:               text("note"),
    textSource:         text("text_source").notNull(),
    book:               text("book").notNull(),
    chapter:            integer("chapter").notNull(),
    createdAt:          text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("pn_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    index("pn_similarity_group_idx").on(t.similarityGroupId),
  ]
);
export type PoetryNotation = typeof poetryNotations.$inferSelect;

/**
 * Lines excluded from the Poetry Notation tool's "bracket every poetic line"
 * auto-bracket toggle (LineGroupOverlay's showAutoLineBrackets) — e.g. a
 * superscription like Psalm 29:1a ("A Psalm of David"), which isn't really
 * part of the poem's line structure and shouldn't get a level-1 bracket.
 * Presence of a row = excluded; there's nothing else to store, so this is a
 * plain marker table (toggled by insert/delete, not updated).
 */
export const poetryLineBracketExclusions = sqliteTable(
  "poetry_line_bracket_exclusions",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    /** A line's segFirstWordId (a paragraphFirstWordIds entry). */
    wordId:      text("word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("plbe_ws_ver_word_idx").on(t.workspaceId, t.versionId, t.wordId),
    index("plbe_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
  ]
);
export type PoetryLineBracketExclusion = typeof poetryLineBracketExclusions.$inferSelect;

/**
 * Word-level "Synoptic comparison" marks — unlike lineAnnotations (which snap
 * to whole paragraph segments and render as a margin badge), these are an
 * arbitrary contiguous word range (start/end can fall mid-sentence) rendered
 * as an inline background tint directly on the words themselves. See the
 * "Compare" toolbar toggle in ChapterDisplay.tsx and useSynopticCategories.
 */
export const synopticWordMarks = sqliteTable(
  "synoptic_word_marks",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    /** References synopticCategoryTypes.key (loosely — not a DB-enforced FK,
     *  same pattern as lineAnnotations storing a category/label key). */
    categoryKey: text("category_key").notNull(),
    /** Copied from the category at creation time so the mark still renders
     *  its color even if the category is later deleted (same pattern as
     *  "theme" line annotations copying a palette color). */
    color:       text("color").notNull(),
    startWordId: text("start_word_id").notNull(),
    endWordId:   text("end_word_id").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("swm_book_ch_src_idx").on(t.book, t.chapter, t.textSource)]
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

export const commFunctionCustomTypes = sqliteTable(
  "comm_function_custom_types",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    key:         text("key").notNull(),
    category:    text("category").notNull(),
    label:       text("label").notNull(),
    sortOrder:   integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("cfct_ws_key_idx").on(t.workspaceId, t.key)]
);

export const synopticCategoryTypes = sqliteTable(
  "synoptic_category_types",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    key:         text("key").notNull(),
    label:       text("label").notNull(),
    color:       text("color").notNull(),
    sortOrder:   integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("sct_ws_key_idx").on(t.workspaceId, t.key)]
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
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    isBold:        integer("is_bold",       { mode: "boolean" }).notNull().default(false),
    isItalic:      integer("is_italic",     { mode: "boolean" }).notNull().default(false),
    isUnderline:   integer("is_underline",  { mode: "boolean" }).notNull().default(false),
    isSmallCaps:   integer("is_small_caps", { mode: "boolean" }).notNull().default(false),
    /** Hex color (e.g. "#DC2626") applied to the word's text, or null for the default color. */
    textColor:     text("text_color"),
    /** JSON-encoded map of grapheme index → hex color for per-letter color overrides
     *  within the word (translation text only), or null when no letters are individually colored. */
    letterColors:  text("letter_colors"),
    /** JSON-encoded array of grapheme indices individually bolded/italicized/underlined
     *  within the word (translation text only, mirrors letterColors), or null for none. */
    letterBold:      text("letter_bold"),
    letterItalic:    text("letter_italic"),
    letterUnderline: text("letter_underline"),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("wfmt_ws_word_idx").on(t.workspaceId, t.versionId, t.wordId),
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
    // Shared across all member words of a manually-created grouping; null for
    // ordinary single-word labels.
    groupId:     text("group_id"),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
  },
  (t) => [
    uniqueIndex("conlbl_ws_word_idx").on(t.workspaceId, t.wordId),
    index("conlbl_book_ch_src_idx").on(t.book, t.chapter, t.textSource),
    index("conlbl_ws_group_idx").on(t.workspaceId, t.groupId),
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
    // Text direction for this dataset's values — "ltr" (default) or "rtl".
    // Interlinear labels/entry inputs inherit the source word's RTL Hebrew
    // context unless this is set explicitly, so datasets of e.g. English
    // glosses need to opt out of that inherited direction.
    direction:   text("direction").notNull().default("ltr"),
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

/** User-chosen highlight color override for a dataset's label value (e.g.
 *  always render "A" in red instead of its auto-assigned hash color). One
 *  row per (dataset, value); absence means the value keeps its auto color. */
export const wordDatasetLabelColors = sqliteTable(
  "word_dataset_label_colors",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    datasetId: integer("dataset_id").notNull()
                 .references(() => wordDatasets.id, { onDelete: "cascade" }),
    value:     text("value").notNull(),
    color:     text("color").notNull(),
  },
  (t) => [uniqueIndex("wdlc_ds_value_idx").on(t.datasetId, t.value)]
);

/** A custom classification column on a word/concept tag's occurrence table
 *  (Word/Concept Editor). Keyed by tag NAME rather than a single wordTags.id,
 *  since the same concept name can span multiple wordTags rows (one per book). */
export const wordTagColumns = sqliteTable(
  "word_tag_columns",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspace_id").notNull().default(1)
                   .references(() => workspaces.id, { onDelete: "cascade" }),
    tagName:     text("tag_name").notNull(),
    name:        text("name").notNull(),
    type:        text("type").notNull(), // "text" | "list"
    sortOrder:   integer("sort_order").notNull().default(0),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("wtc_ws_tagname_name_idx").on(t.workspaceId, t.tagName, t.name),
    index("wtc_ws_tagname_idx").on(t.workspaceId, t.tagName),
  ]
);

/** Reusable entries for a "list"-type wordTagColumns column (e.g. "lion",
 *  "camel" for an "Animals" concept's category column). Created on demand
 *  when the user types a new value; reusable across occurrences afterward. */
export const wordTagColumnOptions = sqliteTable(
  "word_tag_column_options",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    columnId:  integer("column_id").notNull()
                 .references(() => wordTagColumns.id, { onDelete: "cascade" }),
    value:     text("value").notNull(),
    color:     text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("wtco_col_value_idx").on(t.columnId, t.value)]
);

/** Per-occurrence cell value for a wordTagColumns column. List-type columns
 *  may have multiple rows per (columnId, wordId) — one per selected option —
 *  to support multiple tags/values on the same occurrence. Text-type columns
 *  use textValue with optionId null, and are kept to a single row per cell
 *  at the API layer (delete-then-insert), not via a DB constraint. */
export const wordTagColumnValues = sqliteTable(
  "word_tag_column_values",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    columnId:  integer("column_id").notNull()
                 .references(() => wordTagColumns.id, { onDelete: "cascade" }),
    wordId:    text("word_id").notNull(),
    optionId:  integer("option_id")
                 .references(() => wordTagColumnOptions.id, { onDelete: "cascade" }),
    textValue: text("text_value"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("wtcv_col_word_idx").on(t.columnId, t.wordId),
    uniqueIndex("wtcv_col_word_option_idx").on(t.columnId, t.wordId, t.optionId),
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
    versionId:   integer("version_id").notNull()
                   .references(() => versions.id, { onDelete: "cascade" }),
    wordId:      text("word_id").notNull(),
    // 'lxx_unique' = green, 'mt_unique' = red, 'same_different' = yellow
    markType:    text("mark_type").notNull(),
    textSource:  text("text_source").notNull(),
    book:        text("book").notNull(),
    chapter:     integer("chapter").notNull(),
    createdAt:   text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    uniqueIndex("tcm_ws_word_idx").on(t.workspaceId, t.versionId, t.wordId),
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
export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;
export type ActiveVersionSelection = typeof activeVersionSelections.$inferSelect;
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
export type SyllableStressOverride = typeof syllableStressOverrides.$inferSelect;
export type SceneBreak = typeof sceneBreaks.$inferSelect;
export type Passage = typeof passages.$inferSelect;
export type RstRelation = typeof rstRelations.$inferSelect;
export type LineGroup = typeof lineGroups.$inferSelect;
export type WordArrow = typeof wordArrows.$inferSelect;
export type WordFormatting = typeof wordFormatting.$inferSelect;
export type LineAnnotation = typeof lineAnnotations.$inferSelect;
export type SynopticWordMark = typeof synopticWordMarks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type RstCustomType = typeof rstCustomTypes.$inferSelect;
export type AutoBackupSettings = typeof autoBackupSettings.$inferSelect;
export type ConstituentLabel = typeof constituentLabels.$inferSelect;
export type WordDataset = typeof wordDatasets.$inferSelect;
export type WordDatasetEntry = typeof wordDatasetEntries.$inferSelect;
export type WordDatasetLabelColor = typeof wordDatasetLabelColors.$inferSelect;
export type WordTagColumn = typeof wordTagColumns.$inferSelect;
export type WordTagColumnOption = typeof wordTagColumnOptions.$inferSelect;
export type WordTagColumnValue = typeof wordTagColumnValues.$inferSelect;
export type BookGrouping = typeof bookGroupings.$inferSelect;
export type TranslationFootnote = typeof translationFootnotes.$inferSelect;
export type TranslationVersion = typeof translationVersions.$inferSelect;
export type TextCriticalMark = typeof textCriticalMarks.$inferSelect;
export type IntertextualLink = typeof intertextualLinks.$inferSelect;
export type NewIntertextualLink = typeof intertextualLinks.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type SynopticSet = typeof synopticSets.$inferSelect;
export type SynopticCategoryType = typeof synopticCategoryTypes.$inferSelect;
