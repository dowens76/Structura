import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { lexiconEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/lexicon?strong=H7225  or  ?strong=G2316
export async function GET(request: NextRequest) {
  const strong = new URL(request.url).searchParams.get("strong")?.trim();
  if (!strong) {
    return NextResponse.json({ entry: null });
  }

  const results = await db
    .select()
    .from(lexiconEntries)
    .where(eq(lexiconEntries.strongNumber, strong))
    .limit(1);

  return NextResponse.json({ entry: results[0] ?? null });
}
