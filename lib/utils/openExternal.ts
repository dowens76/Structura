export function isTauriApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// In the Tauri desktop app, plain <a target="_blank"> links don't reach the
// system browser — the webview has nowhere to send them. Route through the
// shell plugin there; fall back to a normal new-tab open on the web. If the
// shell plugin call itself fails (e.g. a scope/permission mismatch), fall
// back to window.open rather than silently dropping the click — a Tauri
// webview will normally just ignore that, but it's better than nothing.
export async function openExternal(url: string): Promise<void> {
  if (isTauriApp()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch (err) {
      console.error("openExternal: shell plugin open() failed, falling back to window.open", err);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
