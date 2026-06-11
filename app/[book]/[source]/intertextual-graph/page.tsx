import { notFound } from "next/navigation";
import Link from "next/link";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getBook } from "@/lib/db/queries";
import IntertextualGraphView from "@/components/text/IntertextualGraphView";
import type { TextSource } from "@/lib/morphology/types";

interface PageProps {
  params: Promise<{ book: string; source: string }>;
  searchParams: Promise<{ chapter?: string }>;
}

export default async function IntertextualGraphPage({ params, searchParams }: PageProps) {
  const { book, source } = await params;
  const { chapter } = await searchParams;
  const osisBook = decodeURIComponent(book);
  const textSource = source as TextSource;
  const chapterNum = chapter ? parseInt(chapter) : null;

  const bookRecord = await getBook(osisBook).catch(() => null);
  if (!bookRecord) notFound();

  const workspaceId = await getActiveWorkspaceId();

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "var(--background)" }}>
      <nav
        className="shrink-0 border-b px-4 py-0 flex items-center gap-3 h-12"
        style={{ borderColor: "var(--nav-border)", backgroundColor: "var(--nav-bg)" }}
      >
        <Link
          href={`/${encodeURIComponent(osisBook)}/${textSource}${chapterNum ? `/${chapterNum}` : "/1"}`}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"
        >
          ← Back
        </Link>
        <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Intertextual Web
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={{ backgroundColor: "rgba(200,155,60,0.18)", color: "var(--accent)" }}
        >
          {textSource}
        </span>
      </nav>
      <div className="flex-1 min-h-0">
        <IntertextualGraphView
          book={osisBook}
          chapter={chapterNum}
          textSource={textSource}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}
