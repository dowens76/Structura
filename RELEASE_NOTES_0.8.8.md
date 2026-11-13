# Structura 0.8.8 Release Notes

*Covers changes since v0.8.7 (2026-11-11 through 2026-11-13)*

## Bug Fixes

- **Fixed translation text disappearing after editing** — When you typed into a verse of your own translation that had no text yet, the text was saved but disappeared from view once you closed editing. Reopening the editor then showed an empty box, and closing it again (or typing something new) overwrote the saved text. New verses now stay visible and are never overwritten this way.

  *If you lost a verse to this bug in 0.8.7:* your earlier text is still in that verse's version history. Open the history for the verse and restore the most recent full version.

---
*Generated from `git log v0.8.7..HEAD`.*
