import Link from "next/link";
import { getBooks, getTranslations } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import ImportForm from "./ImportForm";

export const metadata = { title: "Import Translation — Structura" };

export default async function ImportPage() {
  const workspaceId = await getActiveWorkspaceId();
  const [allBooks, existingTranslations] = await Promise.all([
    getBooks(),
    getTranslations(workspaceId),
  ]);

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
          <h1 className="text-3xl font-bold mt-2">Import Translation</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            Paste text copied from Bible.com to add an English translation for parallel display alongside the source text.
          </p>
        </header>

        <ImportForm books={allBooks} existingTranslations={existingTranslations} />
      </div>
    </main>
  );
}
