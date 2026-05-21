# Structura

A biblical text analysis workbench for studying the Hebrew Old Testament, Septuagint, and Greek New Testament. Structura loads the original-language texts with full morphological data and provides a layered annotation system for linguistic, narrative, and discourse analysis.

---

## How to Obtain the Desktop App

Structura ships as a Linux, Mac, and Windows app. As of version 0.6.0, Chromebook users with Linux enabled may use the ARM64 deb file. The app has not yet been tested on a Chromebook, so if you use it, share your experiences through the feedback system explained in the next section.

Download the latest release at https://github.com/dowens76/structura/releases/latest.

### How to Give Feedback

If you want to give feedback about the app, share ideas for new features, or connect about visually analysing Bible passages, click on the Discussions tab above and start or respond to a discussion. You will need a free Github account.

---

## Text Sources

| Source | Language |
|--------|----------|
| OSHB (Open Scriptures Hebrew Bible) | Biblical Hebrew |
| LXX Rahlfs 1935 | Koine Greek (OT) |
| SBLGNT / MorphGNT | Koine Greek (NT) |
| ULT (The UnfoldingWord Literal Text) | English |
| VCB (Biblica® Open Vietnamese Contemporary Bible 2015) | Vietnamese |

---

## Features

### Reading & Display

- **Three display modes**
  - *Clean* — Plain source text
  - *Color* — Morphology-based highlighting; configure rules by part of speech and fine-grained morphological conditions (stem, tense, voice, mood, person, gender, number, case, state, prefix)
  - *Interlinear* — Source text with a sub-line showing lemma, Strong's number, morphological parsing code, grammatical constituent label, or a user dataset value
- **Morphology panel** — Click any word to see its full grammatical parsing, lemma, Strong's number, and Scripture reference
- **Adjustable font sizes** — Independent size controls for Hebrew, Greek, and translation text
- **Hebrew verb terminology toggle** — Switch between traditional labels (perfect/imperfect) and Hebrew-specific labels (Qatal/Yiqtol/Wayyiqtol/Weqatal)
- **Tooltips** — Hover over any word for parsing information (when enabled)
- **Dark mode** — Full light/dark theme support
- **Parallel view** — Side-by-side OSHB Hebrew and LXX Septuagint for books shared between the two
- **Find in text** — Press Ctrl/Cmd+F to open a search bar that highlights all matches in the current chapter or passage; navigate matches with Ctrl/Cmd+G (forward) and Ctrl/Cmd+Shift+G (back); works across source and translation text with diacritic-insensitive matching
- **Keyboard navigation** — F8 / Ctrl+F8 moves to the next / previous chapter; F9 / Ctrl+F9 moves to the next / previous book
- **Toolbar customizer** — Click the ⚙ gear button to show or hide individual toolbar buttons; a Reset button and Hide all / Show all shortcuts are included; settings persist per session

### Presentation Mode

Press the ⊞ button in the toolbar to enter Presentation Mode, which enlarges the text for screen sharing or display:

- Source text (Hebrew / Greek) is scaled to **2×** the configured font size
- Translation text is scaled to **3×** the configured font size
- Section headings are enlarged proportionally
- All editing tools are still accessible from the toolbar

**Browser and Reveal.js access**

The Structura app serves its interface over HTTP on port **3737** (falling back to a random free port if 3737 is taken). This means any browser on the same machine can open `http://localhost:3737` while the app is running — no separate server needed.

Two URL parameters control the initial state:

| Parameter | Effect |
|-----------|--------|
| `?present` | Opens the page already in Presentation Mode |
| `?present&toolbar=0` | Presentation Mode with the toolbar and nav bar hidden — designed for clean iframe embedding |

The **🔗 Copy Link** button in the toolbar copies the current page URL with `?present` appended to the clipboard. Paste it directly into a Reveal.js `<iframe src="...">` slide:

```html
<section>
  <iframe
    src="http://localhost:3737/Gen/OSHB/1?present&toolbar=0"
    width="100%" height="600" frameborder="0">
  </iframe>
</section>
```

### Translation

- **Built-in ULT** — The UnfoldingWord Literal Text (English, 31,102 verses, all 66 books) is bundled and available immediately in the translation picker
- **Built-in VCB** — The Biblica® Open Vietnamese Contemporary Bible 2015 (Vietnamese, 31,096 verses, all 66 books) is bundled alongside the ULT
- **Import translations** — Paste any translation with verse numbers and text (one chapter at a time), or import USFM-formatted translation text
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
- **Highlight** — Click a tag in the panel to highlight all instances across the text

### Structural Annotation

- **Paragraph breaks** — Mark paragraph divisions within and across verses
- **Line indentation** — Indent paragraph segments up to five levels; source and translation indentation can be linked or controlled independently
- **Bold / italic** — Apply bold or italic formatting to individual words
- **Scene / episode breaks** — A six-level hierarchical break system with headings, out-of-sequence flags, and cross-chapter range tracking; each break can optionally be marked as a **thematic heading** with a chosen letter (A–Z), which replaces the standard outline prefix and indents the entry by letter depth in the outline
- **Outline sidebar** — View all section breaks for a book in a collapsible pane; thematic headings display with their letter and letter-depth indentation instead of the classical I./A./1. numbering
- **Outline export** — Copy or download the outline as plain text; thematic headings are rendered with letter prefixes and matching indentation to match the sidebar display

### Discourse & Rhetorical Analysis

- **Clause relations** — Draw arrows to show relationships between paragraph segments (according to Rhetorical Structure Theory) using 15 relation types across coordinate and subordinate categories (Cause/Reason, Purpose, Concession, Condition, Inference, Temporal, etc.)
- **Free-form arrows** — Draw directional arrows between any two words across verse boundaries
- **Line annotations** — Annotate lines or segments of text in one of three ways, identifying plot elements (Background information, Initial Situation, Conflict, Transforming Action, Resolution, etc.), theme labels (A, B, C, etc.), or free-form descriptions

### Bible Lookup

- **Quick Lookup pane** — Open from the toolbar (📖) to look up any passage by reference (e.g. "John 3:16", "Gen 1:1–3"); displays the verse text with a copy button
- **Scripture tooltips** — Hover over any scripture reference in the notes panel to see a floating tooltip with the verse text
- **Translation sources** — Three tiers of translation data are available for lookup and tooltips:
  - *Built-in* — ULT (English) and VCB (Vietnamese) are bundled and work with no configuration
  - *Imported* — Any translation imported through the Translations panel is available in the picker
  - *fetch.bible* — Hundreds of free translations in dozens of languages, served from the [fetch.bible](https://fetch.bible) CDN with no API key required; browse and filter by language in the lookup pane
  - *api.bible* — An optional API key unlocks NASB 2020, NLT, NIV (2011), KJV, and a Vietnamese traditional Bible (Bản Truyền Thống); see setup instructions below
- **Language filter** — The lookup pane's translation dropdown can be filtered by language

#### Setting up an api.bible key

1. Go to [scripture.api.bible](https://scripture.api.bible) and click **Get Started Free**.
2. Sign in or create a free account, then create a new app in your dashboard. You can name it anything (e.g. "Structura").
3. Copy the **API Key** shown for your app.
4. In Structura, open **Settings** (⚙ in the toolbar) and scroll to the **Bible Lookup** section.
5. Paste the key into the **api.bible API key** field and click **Save**.
6. The NASB 2020, NLT, NIV (2011), KJV, and Bản Truyền Thống options will appear in the translation dropdown immediately.

The key is stored locally in the app's database and is never sent anywhere except directly to api.bible when fetching a passage.

### Export & Backup

- **PDF and PNG export** — Export a passage or chapter to a PDF file or PNG image, preserving all visual annotations
- **Manual backup** — Download a complete snapshot of all workspaces, annotations, translations, and settings as a `.db` file
- **Manual restore** — Upload a previously downloaded `.db` backup to replace the current database
- **Automatic backups** — Schedule periodic backups to a local folder; configurable interval (daily / weekly / custom hours), retention policy (keep all / keep N / smart tiered), and a native OS folder picker; runs while the app is open

### Undo

- **50-step undo** — Cmd/Ctrl+Z undoes any annotation operation across all editing modes

### Workspaces

- **Multiple workspaces** — Annotations and settings are scoped to a workspace; switch workspaces from the nav bar
- **Shared translations** — Imported translation text is available across all workspaces; only annotations (character refs, word tags, paragraph breaks, etc.) are workspace-specific

---

# For Developers

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
npm run import:vcb       # Vietnamese Contemporary Bible 2015 (downloads from open.bible; CC BY-SA)
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

On first launch the app creates `~/Library/Application Support/com.structura.app/user.db`. Source databases (OSHB, LXX, SBLGNT, ULT, VCB) are bundled read-only inside the app.

### Architecture

The Rust shell binds to port **3737** (falling back to a random free port if 3737 is already in use), spawns a bundled Node.js 24 binary running the Next.js standalone server, waits for the "Ready" signal, then navigates the WebView to `http://localhost:3737`. Because the server is reachable from any browser on the same machine, the app can also be used without Tauri by simply opening that URL in Chrome or Firefox — useful for Reveal.js iframe embedding and other web-based workflows.

In development (`npm run tauri:dev`) the WebView points directly to `http://localhost:3000`.
