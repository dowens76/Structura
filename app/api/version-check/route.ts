import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const RELEASES_API_URL = "https://api.github.com/repos/dowens76/Structura/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/dowens76/Structura/releases";

interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
}

function currentVersion(): string {
  const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf-8");
  return (JSON.parse(raw).version as string) ?? "0.0.0";
}

/** Compares two "major.minor.patch"-style version strings. Returns true if
 *  `latest` is newer than `current`. Non-numeric/missing parts count as 0,
 *  so this degrades gracefully on odd tags rather than throwing. */
function isNewer(current: string, latest: string): boolean {
  const a = current.split(".").map((n) => parseInt(n, 10) || 0);
  const b = latest.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0, bi = b[i] ?? 0;
    if (bi > ai) return true;
    if (bi < ai) return false;
  }
  return false;
}

// In-memory cache — GitHub's unauthenticated rate limit is 60 requests/hour
// per IP, and every home-screen load would otherwise hit this endpoint.
let cached: { result: VersionCheckResult; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Structura-App",
      },
      // GitHub's release list changes infrequently; let the platform cache too.
      next: { revalidate: 6 * 60 * 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name) return null;
    return { version: data.tag_name.replace(/^v/i, ""), url: data.html_url ?? RELEASES_PAGE_URL };
  } catch {
    return null;
  }
}

export async function GET() {
  const current = currentVersion();

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.result);
  }

  const latest = await fetchLatestRelease();
  const result: VersionCheckResult = latest
    ? {
        currentVersion: current,
        latestVersion: latest.version,
        updateAvailable: isNewer(current, latest.version),
        releaseUrl: latest.url,
      }
    : {
        currentVersion: current,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: RELEASES_PAGE_URL,
      };

  // Don't cache failed lookups — worth retrying sooner than 6h if GitHub
  // was just transiently unreachable.
  if (latest) cached = { result, fetchedAt: Date.now() };

  return NextResponse.json(result);
}
