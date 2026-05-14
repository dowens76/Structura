import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting, deleteAppSetting } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const KEY_API_KEY = "apiBible:apiKey";

/**
 * GET /api/credentials/apibible
 * Returns whether an api.bible API key is configured.
 * The actual key is never returned to the browser.
 */
export async function GET() {
  const apiKey = await getAppSetting(KEY_API_KEY);
  return NextResponse.json({ hasApiKey: apiKey !== null && apiKey.length > 0 });
}

/**
 * PUT /api/credentials/apibible
 * Body: { apiKey: string }
 */
export async function PUT(request: NextRequest) {
  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? "").trim();
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }

  await setAppSetting(KEY_API_KEY, apiKey);
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/credentials/apibible
 * Clears the stored API key.
 */
export async function DELETE() {
  await deleteAppSetting(KEY_API_KEY);
  return NextResponse.json({ ok: true });
}
