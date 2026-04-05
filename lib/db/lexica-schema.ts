import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const lexiconEntries = sqliteTable(
  "lexicon_entries",
  {
    id:              integer("id").primaryKey({ autoIncrement: true }),
    strongNumber:    text("strong_number").notNull(),
    language:        text("language").notNull(),
    lemma:           text("lemma"),
    transliteration: text("transliteration"),
    pronunciation:   text("pronunciation"),
    shortGloss:      text("short_gloss"),
    definition:      text("definition"),
    usage:           text("usage"),
    source:          text("source"),
  },
  (t) => [
    index("lex_strong_idx").on(t.strongNumber),
    uniqueIndex("lex_strong_source_idx").on(t.strongNumber, t.source),
    index("lex_lemma_src_idx").on(t.lemma, t.source),
  ]
);

export type LexiconEntry = typeof lexiconEntries.$inferSelect;
