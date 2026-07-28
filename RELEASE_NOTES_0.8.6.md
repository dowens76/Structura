# Structura 0.8.6 Release Notes

*Covers changes since v0.8.5 (2026-07-17 through 2026-07-25)*

## New Features

- **UBS Dictionaries** — Added the UBS Hebrew and Greek dictionaries, fetched and imported at build time.
- **Vocabulary List Tool** — New tool for building vocabulary lists, with matching improvements to Anki deck export layout.
- **Word Grouping for Interlinear Datasets** — New mechanism for grouping words together in interlinear/constituent datasets, including user-selectable group colors, and extended to the Constituent dataset.
- **Word/Concept Editor** — New editor for creating and managing words/concepts, with a follow-up pass to make it more readable and usable, plus corpus and lemma selection support.
- **Corpus & Lemma Tagging for Characters** — Characters can now be associated with a corpus (book/chapter/passage scope) and a set of lemmas.
- **App Update Check** — The app now checks for newer available versions.
- **LXX Translation Tooltips** — Added tooltip/panel info for the LXX in the translation column.
- **Home Button & Menu Revisions** — Reorganized menus and added a Home button for easier navigation.
- **Native Help > Open Log Folder** — Added a native menu item that opens the app's log directory directly via the OS file explorer, so logs are reachable even if the app's UI fails to render.

## Improvements

- Rewrote several components for visual and behavioral consistency across views.
- Reworked "Speech Acts" clause/paragraph annotation into a more general "communicative function" category, now also available in the Theme tab, with follow-up tweaks.
- Moved content licenses to their own dedicated page.
- Removed the marketing website; Privacy Policy is now packaged as a page within the app.
- Removed unused Strong's Hebrew data and an unused directory to slim the build.

## Bug Fixes

- Fixed a bug where a space was incorrectly added after the maqqef character in OSHB Hebrew text.
- Fixed user-defined datasets not saving properly.
- Fixed corpus selection for words/concepts.
- Fixed visibility of passage-related word tags.
- Fixed several issues in the word list manager.
- Fixed external links not opening in the Tauri desktop app.
- Fixed missing UBS dictionaries in the Tauri app build/packaging.
- **Fixed Windows "Internal Server Error" on startup** — root-caused to a database migration bug: an unguarded `CREATE INDEX` on `word_dataset_entries.group_id` ran before the column existed on older `user.db` files, throwing `no such column: group_id` and crashing the Next.js server on every request. Also added retry-with-backoff around database opens to harden against transient Windows file-locking (antivirus/indexer) errors, and added a global error page that surfaces the real error message and digest instead of a bare "Internal Server Error".

## Under the Hood

- CI build workflow updated to build and cache the new UBS dictionary databases.

---
*Generated from `git log v0.8.5..HEAD`.*
