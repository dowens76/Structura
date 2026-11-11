import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { workspaces } from "@/lib/db/user-schema";
import { getAppSetting } from "@/lib/db/queries";

/** app_settings key holding the last workspace the user switched to. */
export const ACTIVE_WORKSPACE_SETTING_KEY = "active_workspace_id";

/**
 * Returns the active workspace ID.
 *
 * Order of precedence:
 *  1. The structura_active_workspace cookie (a session cookie, set on switch).
 *  2. The last-used workspace persisted in app_settings — this is what makes
 *     the app reopen in the workspace you were last using. It lives in the DB
 *     rather than a long-lived cookie because the packaged app's origin (port)
 *     isn't stable across launches, which would orphan origin-scoped storage.
 *  3. 1 (the default workspace).
 */
export async function getActiveWorkspaceId(): Promise<number> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("structura_active_workspace")?.value;
  const parsed = parseInt(raw ?? "", 10);
  if (!isNaN(parsed) && parsed >= 1) return parsed;

  try {
    const saved = parseInt((await getAppSetting(ACTIVE_WORKSPACE_SETTING_KEY)) ?? "", 10);
    if (!isNaN(saved) && saved >= 1) {
      // Guard against a workspace that was deleted (or a restored backup).
      const exists = await userDb
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, saved))
        .limit(1);
      if (exists.length > 0) return saved;
    }
  } catch {
    // Fall through to the default workspace on any read failure.
  }
  return 1;
}
