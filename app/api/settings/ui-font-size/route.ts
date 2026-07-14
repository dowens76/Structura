import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/db/queries";
import { UI_FONT_SIZE_KEYS, type UiFontSizeKey } from "@/lib/uiFontSize";

export const dynamic = "force-dynamic";

const KEY = "uiFontSize";

export async function GET() {
  const raw = await getAppSetting(KEY);
  const size = UI_FONT_SIZE_KEYS.includes(raw as UiFontSizeKey) ? (raw as UiFontSizeKey) : "md";
  return NextResponse.json({ size });
}

export async function PUT(request: NextRequest) {
  let body: { size?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!UI_FONT_SIZE_KEYS.includes(body.size as UiFontSizeKey)) {
    return NextResponse.json({ error: "Invalid size" }, { status: 400 });
  }
  await setAppSetting(KEY, body.size!);
  return NextResponse.json({ size: body.size });
}
