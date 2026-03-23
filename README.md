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
	— Clean (plain text): This is the basic mode.
	- Color (morphology-based highlighting): Automatically identify words that fit certain grammatical criteria, such as part of speech or a more fine-grained set of criteria based on morphological conditions (stem, tense, voice, mood, person, gender, number, case, state, prefix).
	- Interlinear (lemma/lexical form beneath each word in the source-language font)
- **Morphology panel** — Click any word to see its full grammatical parsing, lemma, Strong's number, and Scripture reference.
- **Adjustable font sizes** — Independent size controls for Hebrew, Greek, and translation text.
- **Linguistic terminology toggle** — Switch between traditional labels (perfect/imperfect) and Hebrew-specific labels (Qatal/Yiqtol/Wayyiqtol/Weqatal).
- **Tooltips** — When enabled, hover over any word for parsing information
- **Dark mode** — Full light/dark theme support

### Translation

- **Import translations** — Paste any translation (KJV, NASB, ESV, etc.) from Bible.com
- **Parallel display** — One or more translations shown alongside the source text
- **In-place editing** — Edit translation text directly in the view
- **Translation-specific formatting** — Independent paragraph breaks, indentation, and bold/italic per translation

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

- **HTML export** — Export a passage or chapter to a self-contained HTML file (Reveal.js-compatible) preserving all visual annotations
- **Database backup** — Export the entire annotation database to JSON and selectively restore individual annotation categories

### Undo

- **50-step undo** — Cmd/Ctrl+Z undoes any annotation operation across all editing modes

---

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS v4** (CSS-based config)
- **Drizzle ORM** + **better-sqlite3** — SQLite database at `./data/structura.db`
- Morphological data: `morphhb` (OSHB), MorphGNT/SBLGNT, LXX Rahlfs 1935

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Import text data

```bash
npm run import:oshb      # Hebrew OT
npm run import:morphgnt  # Greek NT
npm run import:lxx       # Septuagint
```

### Database

```bash
npm run db:push   # apply schema migrations
```
