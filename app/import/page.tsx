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
        <ImportForm books={allBooks} existingTranslations={existingTranslations} />
      </div>
    </main>
  );
}
