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
 * Body: { userId: string; apiKey: string }
 * Saves both values. Pass empty strings to clear.
 */
export async function PUT(request: NextRequest) {
  let body: { userId?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = (body.userId ?? "").trim();
  const apiKey = (body.apiKey ?? "").trim();

  if (!userId || !apiKey) {
    return NextResponse.json(
      { error: "Both userId and apiKey are required" },
      { status: 400 }
    );
  }

  await Promise.all([
    setAppSetting(KEY_USER_ID, userId),
    setAppSetting(KEY_API_KEY, apiKey),
  ]);

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
