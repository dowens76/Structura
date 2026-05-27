"use client";

/**
 * Fetches the user's custom font settings from the API on first render,
 * syncs them to localStorage, and applies them as CSS custom properties on
 * <html>.  This runs after hydration; the inline <script> in layout.tsx
 * handles the zero-FOUC initial application from localStorage.
 */

import { useEffect } from "react";
import {
  applyFontSettings,
  FONT_SETTINGS_LS_KEY,
  type FontSettings,
} from "@/lib/fonts";

export default function FontSettingsApplier() {
  useEffect(() => {
    async function syncFromApi() {
      try {
        const res = await fetch("/api/settings/fonts");
        if (!res.ok) return;
        const data = await res.json() as FontSettings;
        // Keep localStorage in sync so the inline script can apply on next load
        localStorage.setItem(FONT_SETTINGS_LS_KEY, JSON.stringify(data));
        applyFontSettings(data);
      } catch { /* network error — CSS defaults remain in place */ }
    }
    syncFromApi();
  }, []);

  return null;
}
