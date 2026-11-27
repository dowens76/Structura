# Structura 0.8.9 Release Notes

*Covers changes since v0.8.8 (2026-11-22 through 2026-11-27)*

## Highlights

- **The Masoretic Qere is now part of the Hebrew text.** All 1,260 Qere readings from the Westminster Leningrad Codex appear next to their Ketiv. Each Qere is a full word you can click, tag, format and export.
- **Translation-only workspaces are more independent.** Paragraphs, clause relations and RST markup now work from the translation itself, with no hidden structure in the source text needed.
- **Presentation mode and the Reveal export are more polished.**

---

## New Features

### Masoretic Qere readings (OSHB)

Where the Masoretes indicate that a word should be read differently from how it is written, Structura now shows both forms. The written form is the **Ketiv**; the reading is the **Qere**.

**How it looks**

- In the running text, each Qere follows its Ketiv on the same line, in brackets with a "Q" label, smaller and muted:

  > כתוב `[קְרִי :Q]`

  The Qere always stays on the same line as its Ketiv.
- **Qere wela Ketiv** ("read but not written"): a word that is read aloud but has no written form is attached to the word before it and marked with **"+"**.
- **Interlinear mode:** the Qere has its own column next to the Ketiv, lined up under the Ketiv's label. The words in that verse line up at the top so the Ketiv stays level with its neighbours.
- The **vowel** and **cantillation** toggles apply to the Qere as well as to the main text.
- Hover over the bracket to see whether it is a *Qere (read)* or a *Qere wela Ketiv (read, not written)*. Labels are available in English and Vietnamese.

**Working with Qere words**

Each Qere has its own lemma, Strong's number and morphology, so it works like any other word:

- **Click** a Qere to open its own **Word Analysis** panel. **Hover** over it for a tooltip with its Strong's number and parsing.
- **Word markup:** text formatting, characters, word tags, TC and compare marks, poetry marks, arrows, dataset and constituent labels, and search highlighting all apply to the Qere **separately from its Ketiv**. For example, you can tag the Qere with one character and the Ketiv with another.
- **Structural markup** applies at the Ketiv's position, since the Qere has no position of its own in the text. This covers paragraph, line and scene breaks, speech sections and clause-label segments. A range can still start or end on a Qere.
- **Lemma tags:** a word tag or character defined by lemma now matches Qere readings too, separately from the Ketiv. A lemma tag might match the Ketiv of one verse and only the Qere of another.
- **Tag occurrences and CSV export** list each Qere in brackets right after its Ketiv, and place it in the correct verse.

**In exports**

- The **export page** shows Qere readings with all their markup, and poetry-mark ranges work the same as in the reading view.
- The **Reveal slide export** shows each Qere under its Ketiv, with the Qere's own formatting, character underline and tag outline. Qere wela Ketiv readings are marked "+".

> **For developers:** the Qere readings live in a new `qere_readings` table in `oshb.db`, keyed to the Ketiv word. Build it with `npm run import:oshb-qere` (run after `db:split-source`). It does not touch the shared `words` table, and if the table is missing the app shows no Qere and nothing else changes. Release builds now generate the table automatically.

### Paragraphs in translation-only workspaces

In a workspace that hides the source text, **the paragraph breaks in your first active translation now set the paragraphs**. Before, paragraphs followed breaks in the hidden Hebrew or Greek text, so you had to add breaks you couldn't see in order to split a translation paragraph.

Indentation, RST relations, line groups, annotations and horizontal lines now follow the translation's own paragraphs. Markup you added at verse level still lines up as before.

---

## Improvements

### Presentation mode: clause-label editor scales up

Presentation mode already widened the clause-label column, and now everything inside it scales to match. The clause-label editor, its range controls, the end-segment hint, the new-label form and the label badges are all **1.5× larger**, so they're readable on a projector.

The **communicative-function picker** has also been reworked:
- Its dropdown and category manager now float above the page, so they are no longer cut off by the panel they open from.
- The dropdown is placed correctly at the larger size and no longer runs off the left edge of the screen.

### Reveal export: USFM formatting

Translation slides in the Reveal export used to show raw USFM marker codes (e.g. `the\nd Lord\nd*`). They now use the same formatting as the reading view:

| Marker | Shown as |
|---|---|
| `\nd` (divine name) | SMALL CAPS — e.g. LORD |
| `\add` (added words) | *italics* |
| `\wj` (words of Jesus) | red text |
| footnote markers | removed |

Translation words on slides now link to their word tags and characters just as they do in the app, so tag outlines and character underlines carry over.

### Text stuck to USFM markers

Some imported translations have text with no space before a marker, so "the" and "LORD" ran together. Structura now separates them in the **reading view**, the **concept editor** and the **Reveal export**. Existing tags and references are unaffected.

---

## Bug Fixes

- **Color mode showed plain text.** Words without a manual text colour lost their part-of-speech or colour-rule colour in Color mode. Colours are back, and a manual text colour still takes priority. A word's underline is also no longer cleared by formatting that doesn't set one.

- **Lemma tag matches missing in multi-chapter passages.** In a passage view spanning several chapters (e.g. Exod 15:22 – 18:27), creating or editing a lemma tag or character only highlighted matches in the first chapter until you reloaded. Clicking one of the unhighlighted words could **remove a saved reference without warning**. Matches now appear in every chapter of the passage straight away.
  *If you used lemma tags in a multi-chapter passage on 0.8.8 or earlier,* check the tag's occurrence list for references that may have been removed this way.

- **Translation word positions in multi-chapter passages.** Paragraph breaks and other markup placed on translation words are now saved under the correct chapter when the passage spans more than one.

- **Clause relations couldn't be deleted in translation-only mode.** Relations created while the source text was hidden had no delete, edit or select control. Those controls now appear whenever the source copy of the relation isn't shown, whether you're in translation-only mode or the relation exists only on the translation side.

- **Stray RST dots in translation-only mode.** RST edit mode drew a column of selector dots on the far right for the hidden source text. It now shows only the translation's dots.

- **Qere missing from the packaged app.** The Qere data wasn't included in release builds, so the downloaded app showed no Qere even though the development version did. Release builds now include it.

---

## Upgrading

No action is needed. Your workspaces, annotations and tags carry over unchanged, and the Qere readings are included in the app download.

---
*Generated from `git log v0.8.8..v0.8.9`.*
