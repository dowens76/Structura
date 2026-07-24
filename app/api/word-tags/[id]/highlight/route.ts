import { NextRequest, NextResponse } from "next/server";
import { setWordTagHighlighted } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// PATCH /api/word-tags/:id/highlight  body: { highlighted: boolean }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { highlighted?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.highlighted !== "boolean") {
    return NextResponse.json({ error: "Missing highlighted" }, { status: 400 });
  }

  const tag = await setWordTagHighlighted(numId, body.highlighted);
  return NextResponse.json({ tag });
}
