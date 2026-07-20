/** Hex swatches for word-dataset grouping labels — hues spaced ~45° apart
 *  around the wheel so consecutive single-letter labels (A, B, C, ...), which
 *  hash to consecutive indices, never land on two shades of the same color. */
export const DATASET_GROUP_SWATCHES = [
  "#EF4444", // red
  "#F59E0B", // amber
  "#84CC16", // lime
  "#10B981", // emerald
  "#06B6D4", // cyan
  "#3B82F6", // blue
  "#8B5CF6", // violet
  "#EC4899", // pink
];

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deterministic subtle color for a saved dataset grouping, keyed by its value
 *  text (e.g. "B") — so every grouping labeled "B" gets the same color,
 *  regardless of how many separate groupings share that label, unless the
 *  user has manually overridden that value's color (see wordDatasetLabelColors). */
export function colorForDatasetValue(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hexToRgba(DATASET_GROUP_SWATCHES[hash % DATASET_GROUP_SWATCHES.length], 0.25);
}

/** Resolve a label's highlight color: a user override if set, else the
 *  deterministic auto color. */
export function resolvedDatasetColor(value: string, overrides: Map<string, string>): string {
  const override = overrides.get(value);
  return override ? hexToRgba(override, 0.25) : colorForDatasetValue(value);
}
