# Structura

A biblical text analysis workbench for studying the Hebrew Old Testament, Septuagint, and Greek New Testament. Structura loads the original-language texts with full morphological data and provides a layered annotation system for linguistic, narrative, and discourse analysis.

---

## Text Sources

| Source | Language | Words |
|--------|----------|-------|
| OSHB (Open Scriptures Hebrew Bible) | Biblical Hebrew | 305,507 |
| LXX Rahlfs 1935 | Koine Greek (OT) | 623,199 |
| SBLGNT / MorphGNT | Koine Greek (NT) | 137,554 |

---

## Features

### Reading & Display

- **Three display modes**
  - *Clean* — Plain source text
  - *Color* — Morphology-based highlighting; configure rules by part of speech and fine-grained morphological conditions (stem, tense, voice, mood, person, gender, number, case, state, prefix)
  - *Interlinear* — Source text with a sub-line showing lemma, Strong's number, morphological parsing code, grammatical constituent label, or a user dataset value
- **Morphology panel** — Click any word to see its full grammatical parsing, lemma, Strong's number, and Scripture reference
- **Adjustable font sizes** — Independent size controls for Hebrew, Greek, and translation text
- **Linguistic terminology toggle** — Switch between traditional labels (perfect/imperfect) and Hebrew-specific labels (Qatal/Yiqtol/Wayyiqtol/Weqatal)
- **Tooltips** — Hover over any word for parsing information
- **Dark mode** — Full light/dark theme support
- **Parallel view** — Side-by-side OSHB Hebrew and LXX Septuagint for books shared between the two

### Translation

- **Built-in ULT** — The UnfoldingWord Literal Text (31,102 verses, all 66 books) is bundled as a built-in translation and available in the translation picker immediately after running `npm run import:ult`
- **Import translations** — Paste any translation (KJV, NASB, ESV, etc.) from Bible.com, or import via USFM
- **Parallel display** — One or more translations shown alongside the source text in both chapter and passage views
- **In-place editing** — Edit translation text directly in the view; edits are saved and override the built-in base text
- **Translation-specific formatting** — Independent paragraph breaks, indentation, and bold/italic per translation
- **Workspace-independent** — Imported translations are shared across all workspaces; importing once makes a translation available everywhere

### Interlinear Sub-modes

When display mode is set to Interlinear, a toolbar picker selects what appears beneath each source word:

- **Lemma** — Lexical/dictionary form
- **Strong's** — Strong's reference number
- **Morph** — Full morphological parsing code
- **Constituent** — User-assigned grammatical constituent label (Subject, Predicate, Object, Indirect Object, Verb Complement, Adjunct, Vocative, Appositive, Noun Phrase, Verb Phrase, Prepositional Phrase, Clause, Relative Clause)
- **Datasets** — User-created datasets assigning a custom text value to individual words; datasets can be entered word-by-word or uploaded as a tab-separated file (`wordId TAB value`, one entry per line)

### Passage Management

- **Define passages** — Create named passages with a start and end verse (spanning chapters if needed)
- **Passage view** — A dedicated view for a defined passage with all annotation tools available
- **Navigate passages** — Switch between passages from the nav bar dropdown

### Character & Speech Annotation

- **Characters** — Create a cast of characters with names and colors for a book
- **Character references** — Tag words with the character(s) they refer to; supports dual-character tagging with a striped underline
- **Speech sections** — Mark contiguous ranges of text as direct speech by a character, with 21 speech-act classifications (Command, Question, Promise, etc.)

### Word & Concept Tagging

- **Word tags** — Instantly create a tag named after a word's lexical form by clicking it
- **Concept tags** — Create custom named tags for themes, motifs, or any category
- **Highlight** — Click a tag in the panel to highlight all instances across the text; contiguous tagged words show as a continuous highlight

### Structural Annotation

- **Paragraph breaks** — Mark paragraph divisions within and across verses
- **Line indentation** — Indent paragraph segments up to five levels; source and translation indentation can be linked or controlled independently
- **Bold / italic** — Apply bold or italic formatting to individual words
- **Scene / episode breaks** — A six-level hierarchical break system with headings, out-of-sequence flags, and cross-chapter range tracking
- **Outline export** — Generate a classical hierarchical outline (I. A. 1. a. …) from scene breaks and download as a text file

### Discourse & Rhetorical Analysis

- **RST relations** — Draw Rhetorical Structure Theory relationships between paragraph segments using 14 relation types across coordinate and subordinate categories (Cause/Reason, Purpose, Concession, Condition, Temporal, etc.)
- **Free-form arrows** — Draw directional arrows between any two words across verse boundaries
- **Line annotations** — Annotate paragraph segments with Plot elements (Inciting Situation, Conflict, Turning Action, Resolution, etc.), Theme labels, or free-form Descriptions

### Export & Backup

- **HTML export** — Export a passage or chapter to a self-contained HTML file preserving all visual annotations
- **Manual backup** — Download a complete snapshot of `user.db` (all workspaces, annotations, translations, and settings) as a `.db` file
- **Manual restore** — Upload a previously downloaded `.db` backup to replace the current database
- **Automatic backups** — Schedule periodic backups to a local folder; configurable interval (daily / weekly / custom hours), retention policy (keep all / keep N / smart tiered), and a native OS folder picker; runs while the app is open

### Undo

- **50-step undo** — Cmd/Ctrl+Z undoes any annotation operation across all editing modes

### Workspaces

- **Multiple workspaces** — Annotations and settings are scoped to a workspace; switch workspaces from the nav bar
- **Shared translations** — Imported translation text is available across all workspaces; only annotations (character refs, word tags, paragraph breaks, etc.) are workspace-specific

## Desktop App

Structura ships as a Linux, Mac, and Windows app via Tauri v2. The bundled app includes the Next.js server, Node.js runtime, and all source databases — no external dependencies required at runtime.

Note for Mac users: The MacOS will complain that the app is damaged. To get around this security feature, open the terminal and run: 

``xattr -cr /Applications/Structura.app`` 

---

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS v4** (CSS-based config)
- **Drizzle ORM** + **better-sqlite3** — SQLite databases at `./data/`
- **Tauri v2** — macOS desktop packaging (Node.js sidecar + WebView)
- Morphological data: `morphhb` (OSHB), MorphGNT/SBLGNT, LXX Rahlfs 1935
- Built-in translation: UnfoldingWord Literal Text (CC BY-SA 4.0)

---

## Getting Started

### Development server

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Import text data

```bash
npm run import:oshb      # Hebrew OT (requires morphhb package)
npm run import:morphgnt  # Greek NT (downloads from GitHub)
npm run import:lxx       # Septuagint (downloads from GitHub)
npm run import:ult       # UnfoldingWord Literal Text (downloads from git.door43.org)
```

### Import lexicons

```bash
npm run import:lexicon   # Hebrew + Greek lexicons
```

### Database

```bash
npm run db:push          # apply schema migrations to user.db
npm run db:push:source   # apply schema migrations to source.db
```

---

### Build

```bash
npm run tauri:build      # builds Structura.app
npm run tauri:dmg        # wraps it in a distributable DMG
```

Output locations:
- `src-tauri/target/release/bundle/macos/Structura.app`
- `src-tauri/target/release/bundle/dmg/Structura_0.1.0_aarch64.dmg`

### User data

On first launch the app creates `~/Library/Application Support/com.structura.app/user.db`. Source databases (OSHB, LXX, SBLGNT, ULT) are bundled read-only inside the app.

### Architecture

The Rust shell finds a free port, spawns a bundled Node.js 24 binary running the Next.js standalone server, waits for the "Ready" signal, then navigates the WebView to the local server URL. In development (`npm run tauri:dev`) the WebView points directly to `http://localhost:3000`.
