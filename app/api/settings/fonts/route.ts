import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/db/queries";
import type { FontSettings } from "@/lib/fonts";

export const dynamic = "force-dynamic";

const KEY = "fontSettings";

export async function GET() {
  const raw = await getAppSetting(KEY);
  if (!raw) return NextResponse.json({} satisfies FontSettings);
  try {
    return NextResponse.json(JSON.parse(raw) as FontSettings);
  } catch {
    return NextResponse.json({} satisfies FontSettings);
  }
}

export async function PUT(request: NextRequest) {
  let body: FontSettings;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Persist only non-empty strings; omit keys that revert to the CSS default.
  const cleaned: FontSettings = {};
  if (body.hebrew?.trim())      cleaned.hebrew      = body.hebrew.trim();
  if (body.greek?.trim())       cleaned.greek       = body.greek.trim();
  if (body.translation?.trim()) cleaned.translation = body.translation.trim();
  await setAppSetting(KEY, JSON.stringify(cleaned));
  return NextResponse.json(cleaned);
}
