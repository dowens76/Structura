/**
 * Interface font size — scales all rem-based UI text (nav bars, buttons, menus,
 * dialogs, Settings panel, Home screen, etc.) by adjusting the root <html>
 * font-size. Does not affect the Hebrew/Greek/translation scripture text sizes,
 * which have their own dedicated A−/A+ controls in the chapter toolbar.
 */
export type UiFontSizeKey = "sm" | "md" | "lg" | "xl";

/** Root <html> font-size percentage for each preset (100% = browser default, usually 16px). */
export const UI_FONT_SIZE_PERCENT: Record<UiFontSizeKey, number> = {
  sm: 87.5,
  md: 100,
  lg: 112.5,
  xl: 125,
};

export const UI_FONT_SIZE_KEYS: UiFontSizeKey[] = ["sm", "md", "lg", "xl"];

export const UI_FONT_SIZE_LS_KEY = "structura:uiFontSize";

function isUiFontSizeKey(v: unknown): v is UiFontSizeKey {
  return v === "sm" || v === "md" || v === "lg" || v === "xl";
}

/** Apply a preset to the document root. Call on load and whenever the user changes it. */
export function applyUiFontSize(key: UiFontSizeKey): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = `${UI_FONT_SIZE_PERCENT[key] ?? 100}%`;
}

/** Read the persisted preset from localStorage, defaulting to "md" if absent/invalid. */
export function readUiFontSizeFromStorage(): UiFontSizeKey {
  if (typeof localStorage === "undefined") return "md";
  const raw = localStorage.getItem(UI_FONT_SIZE_LS_KEY);
  return isUiFontSizeKey(raw) ? raw : "md";
}

export function writeUiFontSizeToStorage(key: UiFontSizeKey): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(UI_FONT_SIZE_LS_KEY, key);
}
