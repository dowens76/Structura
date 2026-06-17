import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

interface SyncFolder {
  name: string;
  path: string;
}

function probe(p: string): string | null {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : null;
  } catch {
    return null;
  }
}

// Read Dropbox's config file to find the actual sync root (may be non-default).
function dropboxPath(): string | null {
  const home = os.homedir();
  const configPaths =
    process.platform === "win32"
      ? [path.join(process.env.APPDATA ?? "", "Dropbox", "info.json")]
      : [path.join(home, ".dropbox", "info.json")];

  for (const cfgPath of configPaths) {
    try {
      const json = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
        personal?: { path?: string };
      };
      const p = json?.personal?.path;
      if (p && fs.existsSync(p)) return p;
    } catch { /* not installed or unreadable */ }
  }
  return null;
}

// On macOS, Google Drive via Drive for Desktop mounts under CloudStorage with
// an account-specific suffix: GoogleDrive-user@example.com/My Drive
function googleDrivePath(): string | null {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const cloudStorage = path.join(home, "Library", "CloudStorage");
    try {
      const entries = fs.readdirSync(cloudStorage);
      for (const entry of entries) {
        if (entry.startsWith("GoogleDrive-")) {
          const myDrive = path.join(cloudStorage, entry, "My Drive");
          if (probe(myDrive)) return myDrive;
          const root = path.join(cloudStorage, entry);
          if (probe(root)) return root;
        }
      }
    } catch { /* CloudStorage not present */ }
    // Legacy Google Drive (Backup and Sync)
    return probe(path.join(home, "Google Drive"));
  }
  if (process.platform === "win32") {
    return probe(path.join(os.homedir(), "Google Drive"));
  }
  return null;
}

// OneDrive may have an account-specific suffix on macOS CloudStorage.
function oneDrivePath(): string | null {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const cloudStorage = path.join(home, "Library", "CloudStorage");
    try {
      const entries = fs.readdirSync(cloudStorage);
      for (const entry of entries) {
        if (entry.startsWith("OneDrive-")) {
          const p = path.join(cloudStorage, entry);
          if (probe(p)) return p;
        }
      }
    } catch { /* CloudStorage not present */ }
    return probe(path.join(home, "OneDrive"));
  }
  if (process.platform === "win32") {
    return probe(path.join(os.homedir(), "OneDrive"));
  }
  return null;
}

export async function GET() {
  const home = os.homedir();
  const results: SyncFolder[] = [];

  const SUBDIR = "Structura Backups";

  function add(name: string, root: string | null) {
    if (root) results.push({ name, path: path.join(root, SUBDIR) });
  }

  if (process.platform === "darwin") {
    // iCloud Drive
    add("iCloud Drive", probe(path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs")));
    // Dropbox
    add("Dropbox", dropboxPath() ?? probe(path.join(home, "Dropbox")));
    // Google Drive
    add("Google Drive", googleDrivePath());
    // OneDrive
    add("OneDrive", oneDrivePath());
  } else if (process.platform === "win32") {
    // iCloud for Windows
    add("iCloud Drive", probe(path.join(home, "iCloudDrive")));
    // Dropbox
    add("Dropbox", dropboxPath() ?? probe(path.join(home, "Dropbox")));
    // Google Drive
    add("Google Drive", googleDrivePath());
    // OneDrive
    add("OneDrive", oneDrivePath() ?? probe(path.join(home, "OneDrive")));
  } else {
    // Linux: Dropbox is most common
    add("Dropbox", dropboxPath() ?? probe(path.join(home, "Dropbox")));
  }

  return NextResponse.json({ folders: results });
}
