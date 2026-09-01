export const dynamic = "force-dynamic";

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

  return <ImportForm books={allBooks} existingTranslations={existingTranslations} />;
}
