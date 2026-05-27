/**
 * Custom font settings — shared types and runtime CSS-variable applier.
 *
 * Values are CSS font-family strings (e.g. '"Frank Rühl Libre", serif').
 * An absent / empty string for any key means "use the CSS default".
 */
export interface FontSettings {
  hebrew?:      string;
  greek?:       string;
  translation?: string;
}

/** localStorage key for persisting font settings browser-side. */
export const FONT_SETTINGS_LS_KEY = "structura:fontSettings";

/**
 * Apply FontSettings to the document root as CSS custom properties.
 * Call this on page load (from the inline script or FontSettingsApplier)
 * and whenever the user saves new font preferences.
 *
 * Setting a property to an empty/absent value removes any previously set
 * override, restoring the CSS-file default.
 */
export function applyFontSettings(settings: FontSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const apply = (prop: string, val: string | undefined) => {
    const v = val?.trim();
    if (v) root.style.setProperty(prop, toCssFontFamily(v));
    else   root.style.removeProperty(prop);
  };
  apply("--hebrew-font-family",      settings.hebrew);
  apply("--greek-font-family",       settings.greek);
  apply("--translation-font-family", settings.translation);
}

/**
 * Convert a bare font-family name (as returned by queryLocalFonts /
 * NSFontManager) to a value that is safe to place inside a CSS custom
 * property.
 *
 * CSS custom properties are substituted verbatim.  That means
 *
 *   --foo: SBL Hebrew          →  font-family: SBL Hebrew
 *
 * is parsed as TWO font names ("SBL" and "Hebrew") rather than one.
 * The real family "SBL Hebrew" is never tried, so the browser falls back.
 *
 * Wrapping in double quotes fixes this:
 *
 *   --foo: "SBL Hebrew"        →  font-family: "SBL Hebrew"  ✓
 *
 * We leave the value alone when it already contains quotes or commas
 * (a user-entered fallback stack like `"Frank Rühl Libre", serif` is
 * already valid CSS) or when it is a CSS keyword like `inherit`.
 */
export function toCssFontFamily(name: string): string {
  const v = name.trim();
  if (!v) return v;
  // Already a full CSS value (has quotes, commas, or is a CSS keyword)
  if (v.includes('"') || v.includes("'") || v.includes(",")) return v;
  if (v === "inherit" || v === "initial" || v === "unset" || v === "revert") return v;
  // Bare name with spaces — must be quoted
  if (/\s/.test(v)) return `"${v}"`;
  return v;
}

/** Read FontSettings from localStorage, returning {} if absent or invalid. */
export function readFontSettingsFromStorage(): FontSettings {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(FONT_SETTINGS_LS_KEY);
    return raw ? (JSON.parse(raw) as FontSettings) : {};
  } catch {
    return {};
  }
}
