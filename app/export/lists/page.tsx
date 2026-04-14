import ExportListsPanel from "./ExportListsPanel";

export const metadata = { title: "Export Reference Lists — Structura" };

export default function ExportListsPage() {
  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="max-w-3xl mx-auto px-6 py-12">
        <ExportListsPanel />
      </div>
    </main>
  );
}
