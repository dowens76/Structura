# Structura 0.8.7 Release Notes

*Covers changes since v0.8.6 (2026-07-28 through 2026-11-11)*

## New Features

- **Synoptic View** — New view for comparing parallel passages side by side (e.g. the Synoptic Gospels, Kings/Chronicles, parallel Psalms), with seeded passage sets included by default and a dedicated PDF export.
- **Alternative Versions of a Chapter** — A workspace can now hold multiple versions of its markup for the same chapter, so you can try out competing analyses without losing the original. Versions can be created (with All/None buttons for choosing what to carry over), renamed, and switched between.
- **Copy Markup from Another Workspace** — Pull annotations from another workspace directly from the chapter or passage view.
- **Poetry Notation Tools (E. Grosser's method)** — New notation tools for Hebrew poetry, including closure lines, requiredness (with arrows showing what is required, correct in right-to-left text), symmetry markers, and similarity links between related words or letters.
- **Stress & Syllable Counts** — Show stress and syllable counts for Hebrew poetry, and adjust the counts by hand where needed.
- **Line Grouping Mode** — Group poetic lines together, including connecting explicitly to a group's anchor point.
- **Interlinear Data Under Translations** — Custom interlinear datasets can now appear beneath translation text, including in PDF export.
- **SBL Transliteration** — SBL transliteration schemes are available as languages, and transliteration datasets have a direction toggle.
- **Text Formatting** — Added text color (down to individual letters), underline, and shift-click to apply bold, italic and underline across a range.
- **Horizontal Lines at Verse Breaks** — Horizontal divider lines can now be placed at verse breaks.
- **Reorder Translations** — Translations can be put in any order; translations labeled as Transliteration are handled distinctly.
- **Versification Schemes** — Each translation can be set to MT, KJV, LXX or Vietnamese versification in Manage Translations, so verse alignment works for more translations.
- **Outline Pane** — Change outline levels directly in the Outline side panel; the pane now auto-scrolls to follow your position.
- **Intertextual Web** — A web icon appears below verse numbers that have an intertextual connection. The intertextual panel now matches the other side panels, links to the referenced texts and shows tooltips for references.
- **RST Relationships in Translation** — Rhetorical structure (RST) relationships are now included in the translation view and export.

## Improvements

- **Reopens in your last workspace** — Structura now remembers the last workspace you used and opens it at startup, instead of always opening the default workspace.
- Your active-translations selection is now saved in the database, so it is no longer lost when the desktop app starts on a different port.
- Imported section headings (`\s`) are now attached to their translation rather than being saved as scene breaks.
- Notes: the toolbar now stays visible while scrolling, and every notes field has a copy button.
- Word/Concept tags: clearer distinction between editing a list and opening it.
- Expanded the set of plot labels for clause labels.
- Better vertical spacing when multiple translations are shown.
- The remaining hard-coded interface text is now localized (English/Vietnamese).
- The home page links to the website again.

## Bug Fixes

- **Fixed texts failing to open after upgrading (Windows)** — Databases created before the alternative-versions feature were never upgraded, so opening any text failed with a generic Server Components error. The app now brings older databases up to date automatically at startup, keeping all existing annotations.
- **Fixed backup restore losing annotations** — Restore skipped the versions tables (and about 16 others), leaving restored annotations orphaned. Restore now copies every table in the backup.
- Fixed speech boxes disappearing in multi-chapter passage views, and undo writing speech sections to the wrong chapter.
- Fixed a race that could create duplicate "Version 1" entries for a chapter.
- Fixed translation text sometimes not showing, including a case where imported translations were hidden after a database rebuild.
- Fixed Psalm superscriptions (titles) on import and in the display.
- Fixed errors saving clause/paragraph labels and word arrows on Surface/Windows devices caused by database write locks. Pane resizing and arrow reshaping now work with touch.
- Fixed the Windows desktop app sometimes being unable to reach its own local server (proxy/SmartScreen settings in WebView2).
- Fixed a crash in the packaged app caused by a native database-module mismatch with the bundled Node.js (upgraded better-sqlite3).
- Fixed managing translations, and versification not applying to other translations.
- Fixed Greek search by lemma.
- Fixed a scripture tooltip lookup bug.
- Fixed manual Word/Concept tags being deleted when a lemma was added.
- Fixed passage verse ranges: a single-verse passage no longer shows as a range, and a passage can no longer be defined with verses that don't exist.
- Fixed bracket spacing and custom-interlinear vertical spacing when several translations are visible.
- Fixed changes to clause/paragraph labels not saving correctly.
- Fixed several shift-click and "Add word" issues in the poetry notation tools.
- Fixed the version number and the Open Log Folder menu item in the desktop app, and opening the update link in an external browser.
- Fixed synoptic passages missing from the desktop app.

## Under the Hood

- Upgraded better-sqlite3 to v13 (N-API), removing the need to match a specific Node.js ABI.
- Database writes now retry automatically on transient Windows file locks for every write, not just selected ones.
- Build script and CI workflow updates for packaging and bundled data.

---
*Generated from `git log v0.8.6..HEAD`.*
