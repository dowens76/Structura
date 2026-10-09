import ConceptEditorPanel from "@/components/concepts/ConceptEditorPanel";

export const metadata = { title: "Manage List — Structura" };

export default async function ConceptEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { name } = await params;
  const { from } = await searchParams;
  // Only accept same-origin app paths ("/Gen/OSHB/1"), never "//host" or URLs.
  const returnTo = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : null;
  const tagName = decodeURIComponent(name);

  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="max-w-6xl mx-auto px-6 py-12">
        <ConceptEditorPanel tagName={tagName} returnTo={returnTo} />
      </div>
    </main>
  );
}
