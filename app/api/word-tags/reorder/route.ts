import { NextRequest, NextResponse } from "next/server";
import { reorderWordTags } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// POST /api/word-tags/reorder  body: { items: [{ id, sortOrder }] }
export async function POST(request: NextRequest) {
  let body: { items?: { id: number; sortOrder: number }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { items } = body;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }
  await reorderWordTags(items);
  return NextResponse.json({ ok: true });
}
