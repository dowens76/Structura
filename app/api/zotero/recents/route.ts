import { NextRequest, NextResponse } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/db/queries";
import type { ZoteroItem } from "@/lib/utils/zotero";

export const dynamic = "force-dynamic";

const KEY = "zotero:recents";
const MAX = 5;

async function loadRecents(): Promise<ZoteroItem[]> {
  const raw = await getAppSetting(KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as ZoteroItem[]; } catch { return []; }
}

/** GET /api/zotero/recents — returns the last MAX inserted items */
export async function GET() {
  return NextResponse.json({ items: await loadRecents() });
}

/** POST /api/zotero/recents — prepend item, deduplicate by key, cap at MAX */
export async function POST(request: NextRequest) {
  let item: ZoteroItem;
  try { item = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await loadRecents();
  const deduped = [item, ...existing.filter((r) => r.key !== item.key)].slice(0, MAX);
  await setAppSetting(KEY, JSON.stringify(deduped));
  return NextResponse.json({ ok: true });
}
