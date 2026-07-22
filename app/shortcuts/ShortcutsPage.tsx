"use client";

import PageShell from "@/components/ui/PageShell";

// Detect Mac at runtime for display only — SSR-safe (defaults to showing both)
function useIsMac() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
}

function Key({ k }: { k: string }) {
  return (
    <kbd
      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-mono border min-w-[1.5rem]"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: "var(--border)",
        color: "var(--foreground)",
        boxShadow: "0 1px 0 var(--border)",
      }}
    >
      {k}
    </kbd>
  );
}

function Chord({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <Key k={k} />
          {i < keys.length - 1 && (
            <span className="text-[10px] mx-0.5" style={{ color: "var(--text-muted)" }}>+</span>
          )}
        </span>
      ))}
    </span>
  );
}

interface ShortcutRow {
  description: string;
  mac: string[][];   // list of key chords for Mac
  win: string[][];   // list of key chords for Win/Linux
  context?: string;
}

interface Section {
  title: string;
  shortcuts: ShortcutRow[];
}

const SECTIONS: Section[] = [
  {
    title: "Navigation",
    shortcuts: [
      {
        description: "Open address bar (go to any book & chapter)",
        mac: [["⌘", "L"]],
        win: [["Ctrl", "L"]],
        context: "Available everywhere",
      },
      {
        description: "Next chapter",
        mac: [["F8"]],
        win: [["F8"]],
      },
      {
        description: "Previous chapter",
        mac: [["⌘", "F8"]],
        win: [["Ctrl", "F8"]],
      },
      {
        description: "Next book",
        mac: [["F9"]],
        win: [["F9"]],
      },
      {
        description: "Previous book",
        mac: [["⌘", "F9"]],
        win: [["Ctrl", "F9"]],
      },
      {
        description: "Scroll to next verse",
        mac: [["⌘", "↓"]],
        win: [["Ctrl", "↓"]],
      },
      {
        description: "Scroll to previous verse",
        mac: [["⌘", "↑"]],
        win: [["Ctrl", "↑"]],
      },
    ],
  },
  {
    title: "Address Bar",
    shortcuts: [
      {
        description: "Navigate to selected result",
        mac: [["↵ Enter"]],
        win: [["↵ Enter"]],
      },
      {
        description: "Move down through results",
        mac: [["↓"]],
        win: [["↓"]],
      },
      {
        description: "Move up through results",
        mac: [["↑"]],
        win: [["↑"]],
      },
      {
        description: "Close address bar",
        mac: [["Esc"]],
        win: [["Esc"]],
      },
    ],
  },
  {
    title: "Find in Page",
    shortcuts: [
      {
        description: "Open find bar",
        mac: [["⌘", "F"]],
        win: [["Ctrl", "F"]],
      },
      {
        description: "Next match",
        mac: [["⌘", "G"], ["↵ Enter"]],
        win: [["Ctrl", "G"], ["↵ Enter"]],
        context: "When find bar is open",
      },
      {
        description: "Previous match",
        mac: [["⌘", "⇧", "G"], ["⇧", "↵"]],
        win: [["Ctrl", "⇧", "G"], ["⇧", "↵"]],
        context: "When find bar is open",
      },
      {
        description: "Tag focused word with active annotation",
        mac: [["⌘", "E"]],
        win: [["Ctrl", "E"]],
        context: "When find bar is open and a word is focused",
      },
      {
        description: "Close find bar",
        mac: [["Esc"]],
        win: [["Esc"]],
      },
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      {
        description: "Undo last change",
        mac: [["⌘", "Z"]],
        win: [["Ctrl", "Z"]],
      },
    ],
  },
];

function ShortcutTable({ section }: { section: Section }) {
  const isMac = useIsMac();
  return (
    <section className="mb-10">
      <h2
        className="text-base font-semibold mb-3 pb-2 border-b"
        style={{ color: "var(--foreground)", borderColor: "var(--border)" }}
      >
        {section.title}
      </h2>
      <div className="flex flex-col gap-1">
        {section.shortcuts.map((s, i) => {
          const chords = isMac ? s.mac : s.win;
          return (
            <div
              key={i}
              className="flex items-start justify-between gap-6 px-3 py-2 rounded-lg"
              style={{ backgroundColor: i % 2 === 0 ? "var(--surface)" : "transparent" }}
            >
              <div className="min-w-0">
                <span className="text-sm" style={{ color: "var(--foreground)" }}>
                  {s.description}
                </span>
                {s.context && (
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    — {s.context}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {chords.map((chord, ci) => (
                  <span key={ci} className="flex items-center gap-1">
                    {ci > 0 && (
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>or</span>
                    )}
                    <Chord keys={chord} />
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ShortcutsPage() {
  return (
    <PageShell
      title="Keyboard Shortcuts"
      subtitle={
        <>
          Shortcuts use <kbd className="text-xs px-1 py-0.5 rounded border" style={{ borderColor: "var(--border)" }}>⌘</kbd> on Mac
          and <kbd className="text-xs px-1 py-0.5 rounded border" style={{ borderColor: "var(--border)" }}>Ctrl</kbd> on Windows / Linux.
        </>
      }
    >
      {SECTIONS.map((s) => (
        <ShortcutTable key={s.title} section={s} />
      ))}
    </PageShell>
  );
}
