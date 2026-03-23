/**
 * Clause relationship type definitions for discourse analysis.
 * Each type has a unique key, human-readable label, category, abbreviation,
 * and a distinct color for visual display.
 *
 * Built-in types live here. User-defined custom types are stored in the DB
 * (rst_custom_types table) and merged at runtime.
 */

/** Shared shape for both built-in and user-defined RST relationship types. */
export interface RstTypeEntry {
  key:      string;
  label:    string;
  abbr:     string;                             // 1–4 chars shown on chip
  color:    string;                             // hex color
  category: "coordinate" | "subordinate";
  isBuiltIn?: boolean;
}

export const RELATIONSHIP_TYPES: RstTypeEntry[] = [
  // Coordinate
  { key: "contrast",     label: "Contrast",      category: "coordinate",  abbr: "Ctr", color: "#DC2626", isBuiltIn: true },
  { key: "coordination", label: "Sequence",        category: "coordinate",  abbr: "Seq", color: "#16A34A", isBuiltIn: true },
  // Subordinate
  { key: "cause",        label: "Cause/Reason",   category: "subordinate", abbr: "Cau", color: "#EA580C", isBuiltIn: true },
  { key: "comparison",   label: "Comparison",     category: "subordinate", abbr: "Cmp", color: "#7C3AED", isBuiltIn: true },
  { key: "concession",   label: "Concession",     category: "subordinate", abbr: "Con", color: "#CA8A04", isBuiltIn: true },
  { key: "condition",    label: "Condition",      category: "subordinate", abbr: "Cnd", color: "#2563EB", isBuiltIn: true },
  { key: "content",      label: "Content",        category: "subordinate", abbr: "Cnt", color: "#0891B2", isBuiltIn: true },
  { key: "degree",       label: "Degree",         category: "subordinate", abbr: "Deg", color: "#C026D3", isBuiltIn: true },
  { key: "explanation",  label: "Explanation",    category: "subordinate", abbr: "Exp", color: "#059669", isBuiltIn: true },
  { key: "manner",       label: "Manner/Means",   category: "subordinate", abbr: "Mnr", color: "#4F46E5", isBuiltIn: true },
  { key: "purpose",      label: "Purpose",        category: "subordinate", abbr: "Pur", color: "#DB2777", isBuiltIn: true },
  { key: "relative",     label: "Relative",       category: "subordinate", abbr: "Rel", color: "#0284C7", isBuiltIn: true },
  { key: "result",       label: "Result",         category: "subordinate", abbr: "Res", color: "#D97706", isBuiltIn: true },
  { key: "temporal",     label: "Temporal",       category: "subordinate", abbr: "Tmp", color: "#65A30D", isBuiltIn: true },
];

export type ClauseRelType = string;

export const RELATIONSHIP_MAP: Record<string, RstTypeEntry> = Object.fromEntries(
  RELATIONSHIP_TYPES.map((r) => [r.key, r])
);

/** Build a merged map from built-in types + any custom types. */
export function buildRelationshipMap(customTypes: RstTypeEntry[]): Record<string, RstTypeEntry> {
  const map = { ...RELATIONSHIP_MAP };
  for (const t of customTypes) map[t.key] = t;
  return map;
}
