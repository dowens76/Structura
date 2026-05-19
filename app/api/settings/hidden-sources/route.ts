import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const KEY = "hiddenSources";

export async function GET() {
  const raw = await getAppSetting(KEY);
  const hidden: string[] = raw ? JSON.parse(raw) : [];
  return NextResponse.json({ hidden });
}

export async function PUT(request: NextRequest) {
  let body: { hidden?: string[] };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const hidden = Array.isArray(body.hidden) ? body.hidden : [];
  await setAppSetting(KEY, JSON.stringify(hidden));
  return NextResponse.json({ hidden });
}
