import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting, deleteAppSetting } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const KEY_USER_ID = "zotero:userId";
const KEY_API_KEY = "zotero:apiKey";

/**
 * GET /api/credentials/zotero
 * Returns the stored Zotero userId and whether an API key is configured.
 * The actual API key is NEVER returned to the browser.
 */
export async function GET() {
  const [userId, apiKey] = await Promise.all([
    getAppSetting(KEY_USER_ID),
    getAppSetting(KEY_API_KEY),
  ]);

  return NextResponse.json({
    userId:    userId ?? "",
    hasApiKey: apiKey !== null && apiKey.length > 0,
  });
}

/**
 * PUT /api/credentials/zotero
 * Body: { userId: string; apiKey?: string }
 * userId is required. apiKey is optional — omit to keep the existing key.
 */
export async function PUT(request: NextRequest) {
  let body: { userId?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = (body.userId ?? "").trim();
  const apiKey = body.apiKey !== undefined ? body.apiKey.trim() : undefined;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const ops: Promise<void>[] = [setAppSetting(KEY_USER_ID, userId)];
  if (apiKey !== undefined && apiKey.length > 0) {
    ops.push(setAppSetting(KEY_API_KEY, apiKey));
  }
  await Promise.all(ops);

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/credentials/zotero
 * Clears stored credentials.
 */
export async function DELETE() {
  await Promise.all([
    deleteAppSetting(KEY_USER_ID),
    deleteAppSetting(KEY_API_KEY),
  ]);
  return NextResponse.json({ ok: true });
}
