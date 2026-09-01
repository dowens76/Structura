export const dynamic = "force-dynamic";

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

  return <UsfmExportForm books={allBooks} translations={allTranslations} />;
}
