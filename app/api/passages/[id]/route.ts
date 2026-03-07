import { NextRequest, NextResponse } from "next/server";
import { getPassage, updatePassage, deletePassage } from "@/lib/db/queries";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/passages/[id]
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const passage = await getPassage(id);
  if (!passage) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ passage });
}

// PUT /api/passages/[id]
// Body: any subset of { label, startChapter, startVerse, endChapter, endVerse }
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: {
    label?: string;
    startChapter?: number;
    startVerse?: number;
    endChapter?: number;
    endVerse?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate ordering if range fields are present
  const existing = await getPassage(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sc = body.startChapter ?? existing.startChapter;
  const sv = body.startVerse   ?? existing.startVerse;
  const ec = body.endChapter   ?? existing.endChapter;
  const ev = body.endVerse     ?? existing.endVerse;
  if (sc > ec || (sc === ec && sv > ev)) {
    return NextResponse.json({ error: "Start must not be after end" }, { status: 400 });
  }

  const passage = await updatePassage(id, body);
  return NextResponse.json({ passage });
}

// DELETE /api/passages/[id]
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await deletePassage(id);
  return NextResponse.json({ ok: true });
}
