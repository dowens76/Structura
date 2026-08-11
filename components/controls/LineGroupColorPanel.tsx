"use client";

interface Props {
  /** Number of rows to show — the deepest nesting level currently in use,
   *  floored at 3 so the user can pre-configure colors before nesting that
   *  deep, and capped by the caller at MAX_CONFIGURABLE_LEVELS. */
  levelCount: number;
  getColor: (level: number) => string;
  onChange: (level: number, color: string) => void;
  onClose: () => void;
}

export default function LineGroupColorPanel({ levelCount, getColor, onChange, onClose }: Props) {
  const levels = Array.from({ length: levelCount }, (_, i) => i + 1);

  return (
    <div
      className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-3 flex-wrap shrink-0"
      style={{ backgroundColor: "var(--nav-bg)" }}
    >
      <span className="text-xs text-stone-500 dark:text-stone-400">
        Bracket color by nesting level (1 = innermost):
      </span>
      {levels.map((level) => (
        <label
          key={level}
          className="flex items-center gap-1 text-xs text-stone-600 dark:text-stone-300"
        >
          {level}
          <input
            type="color"
            value={getColor(level)}
            onChange={(e) => onChange(level, e.target.value)}
            className="w-6 h-6 rounded cursor-pointer border border-[var(--border)] bg-transparent p-0.5"
          />
        </label>
      ))}
      <button
        onClick={onClose}
        className="ml-auto text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
        type="button"
      >
        Done
      </button>
    </div>
  );
}
