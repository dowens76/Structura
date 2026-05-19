import { getBooks, getTranslations } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import UsfmExportForm from "./UsfmExportForm";

export const metadata = { title: "Export USFM — Structura" };

export default async function UsfmExportPage() {
  const workspaceId = await getActiveWorkspaceId();
  const [otBooks, ntBooks, allTranslations] = await Promise.all([
    getBooks("OT"),
    getBooks("NT"),
    getTranslations(workspaceId),
  ]);
  const allBooks = [...otBooks, ...ntBooks];

  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="max-w-2xl mx-auto px-6 py-12">
        <UsfmExportForm books={allBooks} translations={allTranslations} />
      </div>
    </main>
  );
}
