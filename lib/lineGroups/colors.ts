/**
 * Default per-nesting-level bracket colors for line groups. Level 1 = the
 * innermost brackets (groups whose members are all plain lines); level
 * increases going outward (a group's level = 1 + the max level of its
 * child groups — i.e. subtree height, matching d3-hierarchy's `node.height`
 * on a group node). Levels beyond the palette length cycle back to the start.
 */
export const DEFAULT_LEVEL_COLORS = ["#16A34A", "#DC2626", "#2563EB"]; // green, red, blue

export function defaultColorForLevel(level: number): string {
  return DEFAULT_LEVEL_COLORS[(level - 1) % DEFAULT_LEVEL_COLORS.length];
}

/** Cap on how many nesting levels a user can independently color. Deeper
 *  levels cycle back through this many stored (or default) colors. */
export const MAX_CONFIGURABLE_LEVELS = 6;
