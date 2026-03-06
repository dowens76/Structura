import { NextRequest, NextResponse } from "next/server";
import { getWordTags, createWordTag } from "@/lib/db/queries";

// GET /api/word-tags?book=Gen
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  if (!book) return NextResponse.json({ error: "Missing book param" }, { status: 400 });
  const tags = await getWordTags(book);
  return NextResponse.json({ tags });
}

// POST /api/word-tags  body: { name, color, type, book }
export async function POST(request: NextRequest) {
  let body: { name?: string; color?: string; type?: string; book?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, color, type, book } = body;
  if (!name || !color || !type || !book) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const tag = await createWordTag(name, color, type, book);
  return NextResponse.json({ tag });
}
