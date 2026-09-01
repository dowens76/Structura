import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// Durable (DB-backed) copy of "which translations are toggled on for display".
// Also mirrored into localStorage for a fast first paint, but the DB copy is
// authoritative — in the packaged Tauri app, the embedded server's port isn't
// always stable across launches (falls back off 3737 when that port is
// taken), and WKWebView scopes localStorage per-origin, so a port change
// silently drops the localStorage copy. See ChapterDisplay.tsx's mount
// effect, which prefers this value over localStorage when both exist.
const KEY = "activeTranslations";

export async function GET() {
  const raw = await getAppSetting(KEY);
  const abbrs: string[] = raw ? JSON.parse(raw) : [];
  return NextResponse.json({ abbrs });
}

export async function PUT(request: NextRequest) {
  let body: { abbrs?: string[] };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const abbrs = Array.isArray(body.abbrs) ? body.abbrs : [];
  await setAppSetting(KEY, JSON.stringify(abbrs));
  return NextResponse.json({ abbrs });
}
