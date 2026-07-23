export function isTauriApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// In the Tauri desktop app, plain <a target="_blank"> links don't reach the
// system browser — the webview has nowhere to send them. Route through the
// shell plugin there; fall back to a normal new-tab open on the web.
export async function openExternal(url: string): Promise<void> {
  if (isTauriApp()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
