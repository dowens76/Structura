import BackupPanel from "./BackupPanel";

export const metadata = { title: "Backup & Restore — Structura" };

export default function BackupPage() {
  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="max-w-2xl mx-auto px-6 py-12">
        <BackupPanel />
      </div>
    </main>
  );
}
