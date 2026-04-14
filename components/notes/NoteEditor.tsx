"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import ZoteroCitePicker from "./ZoteroCitePicker";

// ─── Search-highlight ProseMirror extension ───────────────────────────────────

const SearchHighlightKey = new PluginKey<{ decorations: DecorationSet; query: string }>(
  "searchHighlight"
);

function buildDecorations(doc: ProseMirrorNode, query: string): DecorationSet {
  if (!query) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  const q = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(q);
    while (idx !== -1) {
      decorations.push(
        Decoration.inline(pos + idx, pos + idx + query.length, {
          class: "search-highlight-match",
        })
      );
      idx = text.indexOf(q, idx + 1);
    }
  });
  return DecorationSet.create(doc, decorations);
}

// Augment TipTap command types
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearchQuery: (query: string) => ReturnType;
    };
  }
}

const SearchHighlightExtension = Extension.create({
  name: "searchHighlight",

  addCommands() {
    return {
      setSearchQuery:
        (query: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SearchHighlightKey, query);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SearchHighlightKey,
        state: {
          init(_, { doc }) {
            return { decorations: DecorationSet.empty, query: "" };
          },
          apply(tr, old) {
            const newQuery = tr.getMeta(SearchHighlightKey) as string | undefined;
            const query = newQuery !== undefined ? newQuery : old.query;
            const decorations =
              newQuery !== undefined || tr.docChanged
                ? buildDecorations(tr.doc, query)
                : old.decorations.map(tr.mapping, tr.doc);
            return { decorations, query };
          },
        },
        props: {
          decorations(state) {
            return SearchHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

interface NoteEditorProps {
  /** Unique DB key for this note (e.g. "verse:Gen.1.1") */
  noteKey: string;
  noteType: "verse" | "chapter" | "passage";
  /** Initial Tiptap JSON string from DB (may be "{}" for empty) */
  initialContent: string;
  book?: string;
  chapter?: number;
  /** Current search query — highlights all occurrences inline */
  searchQuery?: string;
}

/** Debounce helper */
function useDebouncedSave(fn: (content: string) => void, delay = 800) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (content: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(content), delay);
    },
    [fn, delay]
  );
}

// Toolbar button
function ToolBtn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // prevent editor losing focus
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={[
        "w-6 h-6 flex items-center justify-center rounded text-xs transition-colors select-none",
        active
          ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
          : "text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
        disabled ? "opacity-30 pointer-events-none" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// Divider
function Sep() {
  return <span className="w-px self-stretch bg-stone-200 dark:bg-stone-700 mx-0.5" />;
}

export default function NoteEditor({
  noteKey,
  noteType,
  initialContent,
  book,
  chapter,
  searchQuery,
}: NoteEditorProps) {
  // Parse stored JSON; fall back to empty doc
  let parsedContent: object | undefined;
  try {
    const parsed = JSON.parse(initialContent);
    // Only use if it's a valid Tiptap doc
    if (parsed && typeof parsed === "object" && parsed.type === "doc") {
      parsedContent = parsed;
    }
  } catch {
    /* ignore */
  }

  const save = useCallback(
    async (jsonString: string) => {
      try {
        await fetch("/api/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: noteKey, noteType, content: jsonString, book, chapter }),
        });
      } catch {
        /* silent */
      }
    },
    [noteKey, noteType, book, chapter]
  );

  const debouncedSave = useDebouncedSave(save, 600);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Highlight.configure({ multicolor: false }),
      Superscript,
      Subscript,
      Placeholder.configure({ placeholder: "Add notes…" }),
      SearchHighlightExtension,
    ],
    content: parsedContent ?? { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: ({ editor }) => {
      debouncedSave(JSON.stringify(editor.getJSON()));
    },
    editorProps: {
      attributes: {
        class: "note-editor-content outline-none",
      },
    },
  });

  // Sync if noteKey changes (e.g. pane reused for different note)
  useEffect(() => {
    if (!editor) return;
    let content: object = { type: "doc", content: [{ type: "paragraph" }] };
    try {
      const parsed = JSON.parse(initialContent);
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
        content = parsed;
      }
    } catch {
      /* ignore */
    }
    const current = JSON.stringify(editor.getJSON());
    if (current !== JSON.stringify(content)) {
      editor.commands.setContent(content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  // Update search highlights whenever query changes
  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchQuery(searchQuery ?? "");
  }, [editor, searchQuery]);

  const [showCitePicker, setShowCitePicker] = useState(false);

  const handleCiteClose = useCallback(() => setShowCitePicker(false), []);
  const handleCiteInsert = useCallback(
    (html: string) => {
      editor.chain().focus().insertContent(html).run();
      setShowCitePicker(false);
    },
    [editor],
  );

  if (!editor) return null;

  return (
    <div className="note-editor">
      {/* ── Toolbar wrapper — position: relative so picker floats below ── */}
      <div style={{ position: "relative" }}>
      <div className="note-toolbar flex items-center gap-0.5 flex-wrap px-2 py-1 border-b border-stone-100 dark:border-stone-800">
        {/* Paragraph styles */}
        <ToolBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          H1
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          H2
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          H3
        </ToolBtn>

        <Sep />

        {/* Bold / Italic */}
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive("highlight")}
          title="Highlight"
        >
          <span style={{ background: "rgba(250,204,21,0.6)", padding: "0 2px", borderRadius: 2 }}>H</span>
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          active={editor.isActive("superscript")}
          title="Superscript"
        >
          x<sup style={{ fontSize: "0.65em" }}>2</sup>
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          active={editor.isActive("subscript")}
          title="Subscript"
        >
          x<sub style={{ fontSize: "0.65em" }}>2</sub>
        </ToolBtn>

        <Sep />

        {/* Lists */}
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="1.5" cy="2.5" r="1"/>
            <rect x="3.5" y="2" width="8" height="1" rx="0.5"/>
            <circle cx="1.5" cy="6" r="1"/>
            <rect x="3.5" y="5.5" width="8" height="1" rx="0.5"/>
            <circle cx="1.5" cy="9.5" r="1"/>
            <rect x="3.5" y="9" width="8" height="1" rx="0.5"/>
          </svg>
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <text x="0" y="4" fontSize="4" fontFamily="monospace">1.</text>
            <rect x="4" y="2.5" width="7" height="1" rx="0.5"/>
            <text x="0" y="7.5" fontSize="4" fontFamily="monospace">2.</text>
            <rect x="4" y="6" width="7" height="1" rx="0.5"/>
            <text x="0" y="11" fontSize="4" fontFamily="monospace">3.</text>
            <rect x="4" y="9.5" width="7" height="1" rx="0.5"/>
          </svg>
        </ToolBtn>
        {/* Indent / dedent for lists */}
        <ToolBtn
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
          disabled={!editor.can().sinkListItem("listItem")}
          title="Increase list indent (Tab)"
        >
          ⇥
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
          disabled={!editor.can().liftListItem("listItem")}
          title="Decrease list indent (Shift+Tab)"
        >
          ⇤
        </ToolBtn>

        <Sep />

        {/* Block quote */}
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Block quote"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" opacity="0.9">
            <path d="M0 3h4l-2 3h2v3H0V6l2-3zm6 0h4l-2 3h2v3H6V6l2-3z"/>
          </svg>
        </ToolBtn>

        <Sep />

        {/* Zotero citation */}
        <ToolBtn
          onClick={() => setShowCitePicker((v) => !v)}
          active={showCitePicker}
          title="Insert Zotero citation"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" opacity="0.9">
            <rect x="1" y="1" width="7" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="3" y1="4" x2="6" y2="4" stroke="currentColor" strokeWidth="1"/>
            <line x1="3" y1="6" x2="6" y2="6" stroke="currentColor" strokeWidth="1"/>
            <line x1="3" y1="8" x2="5" y2="8" stroke="currentColor" strokeWidth="1"/>
            <circle cx="9.5" cy="9.5" r="2" fill="currentColor" opacity="0.7"/>
            <text x="9.5" y="11.2" textAnchor="middle" fontSize="3" fill="white" fontWeight="bold">Z</text>
          </svg>
        </ToolBtn>
      </div>

      {/* Floating citation picker */}
      {showCitePicker && (
        <ZoteroCitePicker
          onInsert={handleCiteInsert}
          onClose={handleCiteClose}
        />
      )}
      </div>{/* end relative wrapper */}

      {/* ── Editor content area ─────────────────────────────────────── */}
      <EditorContent editor={editor} />
    </div>
  );
}
