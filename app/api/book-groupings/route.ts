import { NextRequest, NextResponse } from "next/server";
import { getBookGroupings, createBookGrouping } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/book-groupings
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const groupings = await getBookGroupings(workspaceId);
  return NextResponse.json({ groupings });
}

// POST /api/book-groupings
// Body: { name, books, features }
export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: { name?: string; books?: string[]; features?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, books = [], features = [] } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const grouping = await createBookGrouping(workspaceId, name.trim(), books, features);
  return NextResponse.json({ grouping }, { status: 201 });
}
