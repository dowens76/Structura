/**
 * Client-side: make `id` the active workspace. Sets the session cookie the
 * server reads on every request, and persists the choice in app_settings so
 * the app reopens in this workspace after a restart.
 */
export async function setActiveWorkspace(id: number): Promise<void> {
  document.cookie = `structura_active_workspace=${id}; path=/; SameSite=Lax`;
  try {
    await fetch("/api/workspaces/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  } catch {
    // Non-fatal: the cookie still switches the workspace for this session.
  }
}
