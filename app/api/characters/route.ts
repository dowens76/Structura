import { NextRequest, NextResponse } from "next/server";
import { getCharacters, createCharacter } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/characters?book=Gen
export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  if (!book) {
    return NextResponse.json({ error: "Missing book param" }, { status: 400 });
  }
  const chars = await getCharacters(book, workspaceId);
  return NextResponse.json({ characters: chars });
}

// POST /api/characters  body: { name, color, book }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { name?: string; color?: string; book?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, color, book } = body;
  if (!name || !color || !book) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const character = await createCharacter(name, color, book, workspaceId);
  return NextResponse.json({ character });
}
