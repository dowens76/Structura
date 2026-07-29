"use client";

export default function ColumnHeading({
  label,
  refText,
  active,
}: {
  label: string;
  refText: string;
  active: boolean;
}) {
  return (
    <div
      className="shrink-0 px-4 py-2 border-b flex items-center gap-2"
      style={{
        borderColor: "var(--border)",
        backgroundColor: active ? "var(--surface)" : "transparent",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: active ? "var(--accent)" : "var(--border)" }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
          {label}
        </div>
        <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
          {refText}
        </div>
      </div>
    </div>
  );
}
