import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// ── POST /api/auto-backup/validate-path ───────────────────────────────────────
// Validates that a given path is an absolute, writable directory on the server
// file system. Returns { ok, error? }.

export async function POST(request: NextRequest) {
  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const folderPath = body.path?.trim();

  if (!folderPath) {
    return NextResponse.json({ ok: false, error: "No path provided." });
  }

  if (!path.isAbsolute(folderPath)) {
    return NextResponse.json({
      ok: false,
      error: "Path must be absolute (e.g. /Users/you/Backups/Structura).",
    });
  }

  if (!fs.existsSync(folderPath)) {
    return NextResponse.json({
      ok: false,
      error: "Folder does not exist. Create it first, then try again.",
    });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(folderPath);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Cannot read path: ${e}` });
  }

  if (!stat.isDirectory()) {
    return NextResponse.json({ ok: false, error: "Path exists but is a file, not a folder." });
  }

  // Probe write permission
  const probe = path.join(folderPath, `.structura-probe-${Date.now()}`);
  try {
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Folder exists but is not writable. Check permissions.",
    });
  }

  return NextResponse.json({ ok: true });
}
