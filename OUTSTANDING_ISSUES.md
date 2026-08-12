# Outstanding Issues

Recorded 2026-08-12, during the Poetry Notation feature build and a follow-up
schema-drift cleanup session. Not urgent — the app itself runs fine — but
worth reviewing.

## 1. `npm run db:push` crashes partway through (unresolved)

**Symptom:** Running `db:push` fails with an error like:

```
SqliteError: index wt_book_idx already exists
```

The specific index named in the error is **different on every run** —
observed `wt_book_idx`, `notes_ws_key_idx`, and `rct_ws_key_idx` on three
separate attempts.

**Root cause:** Most tables in `data/user.db` were originally created by the
raw-SQL bootstrap in `lib/db/index.ts` (`migrateUserDb`, which runs on every
server start), not by `drizzle-kit` itself. That bootstrap's `CREATE TABLE`
statements are textually different from what `drizzle-kit` would generate
from `lib/db/user-schema.ts` (formatting, `DEFAULT` clause syntax, FK
constraint phrasing) even where the two are structurally equivalent.
`drizzle-kit push` compares DDL text, sees these as "different," and decides
it needs to fully rebuild dozens of tables (create a `__new_*` copy, copy
rows over, drop the old table, rename). That rebuild path has a genuine bug
in the project's current `drizzle-kit` version (`0.31.9`): it emits each
table's post-rebuild `CREATE INDEX` statements twice, and the second,
redundant statement crashes the whole push wherever it happens to land.

**What's already fixed:** One real (non-cosmetic) instance of this pattern —
`bookmarks_ws_idx` (the bootstrap's legacy name) vs. `bookmarks_workspace_idx`
(the current schema's name) coexisting as two separate indexes on the same
column — was found and fixed: the bootstrap now creates the correctly-named
index, and the stale duplicate was dropped from the live DB. That was the
original problem reported before this broader issue was discovered.

**What's still open:** The much larger DDL-text mismatch across most other
tables, and the `drizzle-kit` crash it triggers. Two ways to close this out:
- Upgrade `drizzle-kit` past `0.31.9` and see if the duplicate-`CREATE INDEX`
  bug is already fixed upstream, then re-run `db:push`.
- Or reconcile the bootstrap SQL in `lib/db/index.ts` table-by-table against
  `lib/db/user-schema.ts` so their generated DDL actually matches, removing
  the need for `drizzle-kit` to rebuild anything.

**Verified safe:** despite the crashes, `PRAGMA integrity_check` returns
`ok`, no stray `__new_*` tables were left behind, row counts on every
affected table are intact, and the app itself loads and functions normally.
The three crashed attempts did not lose or corrupt any data — this is a tool
bug, not a data-integrity problem. Recommend not repeatedly re-running
`db:push` in the meantime, since each attempt triggers large unnecessary
rebuilds via a crash-prone code path.

New tables added going forward (e.g. `poetry_notations`,
`poetry_line_bracket_exclusions`) were applied via direct `CREATE TABLE` SQL
matching the Drizzle schema exactly, bypassing `db:push`, as a workaround.

## 2. Pre-existing orphaned foreign-key rows (minor, unrelated)

`PRAGMA foreign_key_check` on `user.db` shows rows in `translation_versions`
and `translation_footnotes` whose `translation_id` points to a `translations`
row that no longer exists (presumably from a translation being deleted at
some point without cascading). This predates today's session and isn't
caused by anything above — flagging since it turned up during the integrity
audit. Likely harmless (the app's queries wouldn't surface a nonexistent
translation), but a cleanup script could remove the dangling rows if desired.

## 3. Known limitation: Similarity oval approximation

The "Similarity" Gestalt principle's yellow-oval mark
(`lib/poetry/graphemeRender.tsx`) is rendered as a rounded background tint
per word rather than a single precisely-measured ellipse spanning the whole
selected letter range. For marks confined to one word this looks correct;
for a mark spanning two adjacent words, it renders as two separate rounded
highlights instead of one continuous oval. Purely cosmetic — the underlying
data (word/grapheme range) is stored correctly either way.
