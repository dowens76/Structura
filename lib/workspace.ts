import { cookies } from "next/headers";

/**
 * Returns the active workspace ID from the structura_active_workspace cookie.
 * Falls back to 1 (the default workspace) if the cookie is absent or invalid.
 */
export async function getActiveWorkspaceId(): Promise<number> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("structura_active_workspace")?.value;
  const parsed = parseInt(raw ?? "", 10);
  return isNaN(parsed) || parsed < 1 ? 1 : parsed;
}
