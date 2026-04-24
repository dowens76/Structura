import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q      = searchParams.get("q")?.trim()      ?? "";
  const userId = searchParams.get("userId")?.trim()  ?? "";
  const apiKey = searchParams.get("apiKey")?.trim()  ?? "";

  if (!userId || !apiKey) {
    return NextResponse.json(
      { error: "Missing userId or apiKey" },
      { status: 400 },
    );
  }

  const url = new URL(`https://api.zotero.org/users/${userId}/items`);
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "20");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": "3",
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Network error reaching Zotero API" },
      { status: 502 },
    );
  }

  if (res.status === 403)
    return NextResponse.json({ error: "Invalid Zotero API key" }, { status: 403 });
  if (res.status === 429)
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429 },
    );
  if (!res.ok)
    return NextResponse.json(
      { error: `Zotero API error: ${res.status}` },
      { status: res.status },
    );

  const items = await res.json();
  return NextResponse.json({ items });
}
