"use client";

/**
 * Fetches the user's interface font-size preference from the API on first
 * render, syncs it to localStorage, and applies it to <html>. This runs after
 * hydration; the inline <script> in layout.tsx handles the zero-FOUC initial
 * application from localStorage.
 */

import { useEffect } from "react";
import {
  applyUiFontSize,
  writeUiFontSizeToStorage,
  UI_FONT_SIZE_KEYS,
  type UiFontSizeKey,
} from "@/lib/uiFontSize";

export default function UiFontSizeApplier() {
  useEffect(() => {
    async function syncFromApi() {
      try {
        const res = await fetch("/api/settings/ui-font-size");
        if (!res.ok) return;
        const data = await res.json() as { size?: string };
        if (!UI_FONT_SIZE_KEYS.includes(data.size as UiFontSizeKey)) return;
        const size = data.size as UiFontSizeKey;
        writeUiFontSizeToStorage(size);
        applyUiFontSize(size);
      } catch { /* network error — CSS default (100%) remains in place */ }
    }
    syncFromApi();
  }, []);

  return null;
}
