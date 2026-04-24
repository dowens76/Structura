import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

// ── GET /api/auto-backup/pick-folder ──────────────────────────────────────────
// Opens the native OS folder-picker dialog in the server process and returns
// the chosen absolute path.  Returns { path } on success, { cancelled: true }
// when the user dismisses the dialog, or { error } on hard failure.
//
// Platform support:
//   macOS  → osascript (AppleScript)
//   Windows → PowerShell + System.Windows.Forms.FolderBrowserDialog
//   Linux  → zenity (GNOME) or kdialog (KDE), whichever is found first

export async function GET() {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const { stdout } = await run("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Choose a folder for automatic Structura backups:")',
      ]);
      // AppleScript appends a trailing slash — strip it for consistency.
      const folderPath = stdout.trim().replace(/\/+$/, "");
      if (!folderPath) return NextResponse.json({ cancelled: true });
      return NextResponse.json({ path: folderPath });

    } else if (platform === "win32") {
      const psScript = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$d.Description = 'Choose a folder for automatic Structura backups'",
        "$d.ShowNewFolderButton = $true",
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
      ].join("; ");
      const { stdout } = await run("powershell", ["-NoProfile", "-Command", psScript]);
      const folderPath = stdout.trim();
      if (!folderPath) return NextResponse.json({ cancelled: true });
      return NextResponse.json({ path: folderPath });

    } else {
      // Linux — try zenity first (GNOME/GTK), fall back to kdialog (KDE/Qt).
      let folderPath = "";
      try {
        const { stdout } = await run("zenity", [
          "--file-selection",
          "--directory",
          "--title=Choose a folder for automatic Structura backups",
        ]);
        folderPath = stdout.trim();
      } catch (zenityErr) {
        // zenity exits 1 on cancel; any other error → try kdialog.
        const msg = String(zenityErr);
        if (msg.includes("exit code 1") || msg.includes("status 1")) {
          return NextResponse.json({ cancelled: true });
        }
        const { stdout } = await run("kdialog", [
          "--getexistingdirectory",
          process.env.HOME ?? "/",
          "--title",
          "Choose a folder for automatic Structura backups",
        ]);
        folderPath = stdout.trim();
      }
      if (!folderPath) return NextResponse.json({ cancelled: true });
      return NextResponse.json({ path: folderPath });
    }

  } catch (err: unknown) {
    const msg = String(err);
    // AppleScript error -128 = user cancelled; PowerShell / zenity cancels are
    // caught above, but catch them here too just in case.
    if (
      msg.includes("-128") ||
      msg.includes("User canceled") ||
      msg.includes("cancelled") ||
      msg.includes("exit code 1")
    ) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
