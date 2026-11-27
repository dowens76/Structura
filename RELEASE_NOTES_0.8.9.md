# Structura 0.8.9 Release Notes

*Covers changes since v0.8.8 (2026-11-22 through 2026-11-27)*

## New Features

- **Masoretic Qere in the Hebrew text** — The 1,260 Qere readings in the Westminster Leningrad Codex now appear in the OSHB text. Each Qere follows its Ketiv on the same line, smaller and muted, as `[דָּבַר :Q]`. Qere readings with no Ketiv (*Qere wela Ketiv*) attach to the word before them and are marked "+". In interlinear mode the Qere has its own column next to the Ketiv. The vowel and cantillation toggles apply to it too.

- **Qere words are full words** — Each Qere has its own lemma and parsing. Click it to open its own Word Analysis, or hover over it for its Strong's number and parsing. You can format, tag, underline, annotate and mark it separately from its Ketiv, and search hits highlight it. Paragraph, line and scene breaks, speech sections and clause-label segments are placed at the Ketiv.

- **Lemma tags include the Qere** — A lemma-based word tag now matches Ketiv and Qere separately. Tag occurrence lists and the CSV export list each Qere in brackets after its Ketiv.

- **Qere in exports** — The Qere appears on the export page and in the Reveal slide export, with its own formatting and tags.

- **Translation-only paragraphs** — In translation-only workspaces, a translation paragraph can now stand on its own without a matching source paragraph.

## Improvements

- **Presentation mode scales the clause-label editor** — In presentation mode, the clause-label editor, its range controls, the creation form and the label badges are now enlarged to match the wider label column. The communicative-function dropdown is no longer cut off by the panel edge and no longer runs off the left side of the screen.

- **USFM formatting in the Reveal export** — Translation slides now show USFM formatting instead of raw marker codes: divine names in small caps, added words in italics, the words of Jesus in red, and footnote marks removed. Words that were stuck to a marker (e.g. "theLORD") are now separated correctly, in the reading view as well as in the export.

## Bug Fixes

- **Fixed Color mode showing plain text** — Words without a manual text colour lost their part-of-speech or colour-rule colour. They show it again, and a manual text colour still takes priority.

- **Fixed lemma tag matches missing in multi-chapter passages** — In a passage view spanning several chapters (e.g. Exod 15:22 – 18:27), creating or editing a lemma tag or character only highlighted matches in the first chapter until you reloaded. Clicking one of those blank words could remove a saved reference. Matches now appear in every chapter straight away.

- **Clause relations can be deleted in translation-only mode** — Relations created in translation-only mode had no delete, edit or select control. They now do.

- **No stray RST dots in translation-only mode** — RST edit mode no longer draws a column of selector dots for the hidden source text.

---
*Generated from `git log v0.8.8..HEAD`.*
