import Link from "next/link";
import BackupPanel from "./BackupPanel";

export const metadata = { title: "Backup & Restore — Structura" };

export default function BackupPage() {
  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="max-w-2xl mx-auto px-6 py-12">
        <header className="mb-8">
          <Link
            href="/"
            className="text-sm text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 mb-4 inline-block transition-colors"
          >
            ← Back to Structura
          </Link>
          <h1 className="text-3xl font-bold mt-2">Backup & Restore</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            Export all your annotations and translation data to a JSON file, or restore from
            a previous backup.
          </p>
        </header>

        <BackupPanel />
      </div>
    </main>
  );
}
