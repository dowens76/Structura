import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface FetchBibleTranslation {
  id: string;      // e.g. "eng_bsb"
  name: string;    // e.g. "Berean Standard Bible"
  abbrev: string;  // e.g. "BSB"
  lang: string;    // ISO 639-3, e.g. "eng"
}

/**
 * GET /api/fetchbible
 * Returns the list of translations available from fetch.bible (v1.fetch.bible).
 * Response is cached server-side for 24 hours.
 */
export async function GET() {
  try {
    const res = await fetch("https://v1.fetch.bible/bibles/manifest.json", {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json([], { status: 502 });

    const manifest = await res.json() as {
      translations: Record<string, {
        name: { local: string; local_abbrev: string; english?: string; english_abbrev?: string };
        books_ot: boolean | string[];
        books_nt: boolean | string[];
      }>;
    };

    const out: FetchBibleTranslation[] = Object.entries(manifest.translations)
      .map(([id, t]) => ({
        id,
        name:   t.name.english   || t.name.local,
        abbrev: t.name.english_abbrev || t.name.local_abbrev || id,
        lang:   id.split("_")[0],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(out);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
