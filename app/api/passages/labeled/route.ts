import { NextResponse } from "next/server";
import { getLabeledPassages } from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// GET /api/passages/labeled — returns all passages with a non-empty label
export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  const list = await getLabeledPassages(workspaceId);
  return NextResponse.json({ passages: list });
}
