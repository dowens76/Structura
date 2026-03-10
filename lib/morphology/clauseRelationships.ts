/**
 * Clause relationship type definitions for discourse analysis.
 * Each type has a unique key, human-readable label, category, 3-char abbreviation,
 * and a distinct color for visual display.
 */

export const RELATIONSHIP_TYPES = [
  // Coordinate
  { key: "contrast",     label: "Contrast",      category: "coordinate",  abbr: "Ctr", color: "#DC2626" },
  { key: "coordination", label: "Coordination",   category: "coordinate",  abbr: "Coo", color: "#16A34A" },
  // Subordinate
  { key: "cause",        label: "Cause/Reason",   category: "subordinate", abbr: "Cau", color: "#EA580C" },
  { key: "comparison",   label: "Comparison",     category: "subordinate", abbr: "Cmp", color: "#7C3AED" },
  { key: "concession",   label: "Concession",     category: "subordinate", abbr: "Con", color: "#CA8A04" },
  { key: "condition",    label: "Condition",      category: "subordinate", abbr: "Cnd", color: "#2563EB" },
  { key: "content",      label: "Content",        category: "subordinate", abbr: "Cnt", color: "#0891B2" },
  { key: "degree",       label: "Degree",         category: "subordinate", abbr: "Deg", color: "#C026D3" },
  { key: "explanation",  label: "Explanation",    category: "subordinate", abbr: "Exp", color: "#059669" },
  { key: "manner",       label: "Manner/Means",   category: "subordinate", abbr: "Mnr", color: "#4F46E5" },
  { key: "purpose",      label: "Purpose",        category: "subordinate", abbr: "Pur", color: "#DB2777" },
  { key: "relative",     label: "Relative",       category: "subordinate", abbr: "Rel", color: "#0284C7" },
  { key: "result",       label: "Result",         category: "subordinate", abbr: "Res", color: "#D97706" },
  { key: "temporal",     label: "Temporal",       category: "subordinate", abbr: "Tmp", color: "#65A30D" },
] as const;

export type ClauseRelType = typeof RELATIONSHIP_TYPES[number]["key"];

export const RELATIONSHIP_MAP = Object.fromEntries(
  RELATIONSHIP_TYPES.map((r) => [r.key, r])
) as Record<string, typeof RELATIONSHIP_TYPES[number]>;
