import ConceptEditorPanel from "@/components/concepts/ConceptEditorPanel";

export const metadata = { title: "Manage List — Structura" };

export default async function ConceptEditorPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const tagName = decodeURIComponent(name);

  return (
    <main
      className="min-h-screen"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="max-w-6xl mx-auto px-6 py-12">
        <ConceptEditorPanel tagName={tagName} />
      </div>
    </main>
  );
}
