"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LINK_TYPES, getLinkTypeColor } from "@/lib/utils/annotations";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import type { IntertextualLink } from "@/lib/db/schema";

type Scope = "chapter" | "book" | "workspace";

interface Node {
  id: string;       // osis book code
  label: string;
  x: number;
  y: number;
  r: number;
  angle: number;    // radians, from center — used for label placement
  isCurrent: boolean;
}

interface Edge {
  source: Node;
  target: Node;
  link: IntertextualLink;
}

// ── Layout ────────────────────────────────────────────────────────────────

function buildGraph(
  links: IntertextualLink[],
  currentBook: string,
  width: number,
  height: number,
): { nodes: Node[]; edges: Edge[] } {
  // Collect unique books
  const bookSet = new Set<string>();
  for (const l of links) {
    bookSet.add(l.sourceBook);
    bookSet.add(l.targetBook);
  }
  if (!bookSet.has(currentBook)) bookSet.add(currentBook);

  const bookArr = [...bookSet];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) * 0.58;
  const nodeR = 34;

  const nodes: Node[] = bookArr.map((book, i) => {
    const angle = (2 * Math.PI * i) / bookArr.length - Math.PI / 2;
    return {
      id: book,
      label: OSIS_REF_BOOK_NAMES[book] ?? book,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      r: nodeR,
      angle,
      isCurrent: book === currentBook,
    };
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const edges: Edge[] = links
    .map((link) => {
      const source = nodeMap.get(link.sourceBook);
      const target = nodeMap.get(link.targetBook);
      if (!source || !target) return null;
      return { source, target, link };
    })
    .filter(Boolean) as Edge[];

  return { nodes, edges };
}

// ── Tooltip ────────────────────────────────────────────────────────────────

function EdgeTooltip({
  link, x, y, onClose,
}: {
  link: IntertextualLink; x: number; y: number; onClose: () => void;
}) {
  const typeLabel = LINK_TYPES.find((t) => t.value === link.linkType)?.label ?? link.linkType;
  const color = getLinkTypeColor(link.linkType);
  const srcV = link.sourceEndVerse && link.sourceEndVerse !== link.sourceVerse ? `${link.sourceVerse}–${link.sourceEndVerse}` : `${link.sourceVerse}`;
  const tgtV = link.targetEndVerse && link.targetEndVerse !== link.targetVerse ? `${link.targetVerse}–${link.targetEndVerse}` : `${link.targetVerse}`;
  const srcLabel = `${OSIS_REF_BOOK_NAMES[link.sourceBook] ?? link.sourceBook} ${link.sourceChapter}:${srcV}`;
  const tgtLabel = `${OSIS_REF_BOOK_NAMES[link.targetBook] ?? link.targetBook} ${link.targetChapter}:${tgtV}`;

  return (
    <div
      style={{
        position: "absolute",
        left: x + 12,
        top: y - 10,
        zIndex: 20,
        backgroundColor: "var(--nav-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 200,
        maxWidth: 300,
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        color: "var(--foreground)",
        fontSize: 13,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: color + "25", color }}
        >
          {typeLabel}
        </span>
        <button onClick={onClose} style={{ color: "var(--text-muted)", fontSize: 14, marginLeft: 8 }}>✕</button>
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {srcLabel} → {tgtLabel}
      </div>
      <div className="flex gap-1 mt-1">
        {[1,2,3,4,5].map((n) => (
          <span key={n} style={{ color: n <= link.strength ? "#f59e0b" : "var(--text-muted)", fontSize: 12 }}>★</span>
        ))}
      </div>
      {link.notes && (
        <p className="text-xs mt-1 line-clamp-3" style={{ color: "var(--text-muted)" }}>{link.notes}</p>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

interface Props {
  book: string;
  chapter: number | null;
  textSource: string;
  workspaceId: number;
}

export default function IntertextualGraphView({ book, chapter, textSource, workspaceId }: Props) {
  const [scope, setScope] = useState<Scope>(chapter !== null ? "chapter" : "book");
  const [links, setLinks] = useState<IntertextualLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredEdge, setHoveredEdge] = useState<{ link: IntertextualLink; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDims({ w: rect.width || 800, h: rect.height || 600 });
      }
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      let url: string;
      if (s === "workspace") {
        url = `/api/intertextual-links?scope=all`;
      } else if (s === "book") {
        url = `/api/intertextual-links?book=${encodeURIComponent(book)}`;
      } else {
        url = `/api/intertextual-links?book=${encodeURIComponent(book)}&chapter=${chapter ?? 1}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setLinks(data.links ?? []);
    } finally {
      setLoading(false);
    }
  }, [book, chapter]);

  useEffect(() => { load(scope); }, [load, scope]);

  const { nodes, edges } = buildGraph(links, book, dims.w, dims.h);

  // Legend items that appear in this set
  const presentTypes = [...new Set(links.map((l) => l.linkType))];

  return (
    <div className="flex flex-col h-full min-h-0" ref={containerRef}>
      {/* Controls bar */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-2 border-b text-sm"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--nav-bg)" }}
      >
        <span className="text-xs text-[var(--text-muted)]">Scope:</span>
        {(["chapter","book","workspace"] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={[
              "px-3 py-1 rounded text-xs font-medium transition-colors",
              scope === s
                ? "bg-amber-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
            disabled={s === "chapter" && chapter === null}
          >
            {s === "chapter" ? `Chapter ${chapter ?? "—"}` : s === "book" ? "Book" : "Workspace"}
          </button>
        ))}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {LINK_TYPES.filter((t) => presentTypes.includes(t.value)).map((t) => (
            <span key={t.value} className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <span style={{ width: 10, height: 3, backgroundColor: t.color, display: "inline-block", borderRadius: 2 }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">
            Loading…
          </div>
        ) : links.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">
            No intertextual links in this scope.
          </div>
        ) : (
          <svg
            width={dims.w}
            height={dims.h}
            style={{ position: "absolute", inset: 0 }}
          >
            <defs>
              {LINK_TYPES.map((t) => (
                <marker
                  key={t.value}
                  id={`arrow-${t.value}`}
                  markerWidth="8" markerHeight="8"
                  refX="6" refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill={t.color} />
                </marker>
              ))}
            </defs>

            {/* Edges — clipped to node boundaries, no verse labels (those live inside circles) */}
            {edges.map((edge, i) => {
              const color = getLinkTypeColor(edge.link.linkType);
              const strokeW = 1 + (edge.link.strength - 1) * 0.5;
              const dx = edge.target.x - edge.source.x;
              const dy = edge.target.y - edge.source.y;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const offset = edge.link.direction === "bidirectional" ? 5 : 0;
              const nx = -uy * offset;
              const ny = ux * offset;
              const x1 = edge.source.x + ux * (edge.source.r + 2) + nx;
              const y1 = edge.source.y + uy * (edge.source.r + 2) + ny;
              const x2 = edge.target.x - ux * (edge.target.r + 8) + nx;
              const y2 = edge.target.y - uy * (edge.target.r + 8) + ny;
              return (
                <line
                  key={i}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={color} strokeWidth={strokeW} strokeOpacity={0.65}
                  markerEnd={`url(#arrow-${edge.link.linkType})`}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement).getBoundingClientRect();
                    setHoveredEdge({ link: edge.link, x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }}
                  onMouseLeave={() => setHoveredEdge(null)}
                />
              );
            })}

            {/* Nodes — two passes so text is never covered by a circle from another node */}
            {(() => {
              function fmtRef(ch: number, v: number, ev: number | null | undefined) {
                return ev && ev !== v ? `${ch}:${v}–${ev}` : `${ch}:${v}`;
              }
              const nodeVerses = new Map<string, string[]>();
              for (const edge of edges) {
                const srcRef = fmtRef(edge.link.sourceChapter, edge.link.sourceVerse, edge.link.sourceEndVerse);
                const tgtRef = fmtRef(edge.link.targetChapter, edge.link.targetVerse, edge.link.targetEndVerse);
                if (!nodeVerses.has(edge.source.id)) nodeVerses.set(edge.source.id, []);
                if (!nodeVerses.get(edge.source.id)!.includes(srcRef)) nodeVerses.get(edge.source.id)!.push(srcRef);
                if (!nodeVerses.has(edge.target.id)) nodeVerses.set(edge.target.id, []);
                if (!nodeVerses.get(edge.target.id)!.includes(tgtRef)) nodeVerses.get(edge.target.id)!.push(tgtRef);
              }

              const lineH = 11;

              return (
                <>
                  {/* Pass 1 — circles only */}
                  {nodes.map((node) => (
                    <circle
                      key={node.id}
                      cx={node.x} cy={node.y} r={node.r}
                      fill={node.isCurrent ? "rgba(200,155,60,0.22)" : "var(--nav-bg)"}
                      stroke={node.isCurrent ? "var(--accent)" : "var(--border)"}
                      strokeWidth={node.isCurrent ? 2 : 1.5}
                    />
                  ))}

                  {/* Pass 2 — all text on top of all circles */}
                  {nodes.map((node) => {
                    const verses = nodeVerses.get(node.id) ?? [];
                    const totalH = verses.length * lineH;
                    const labelDist = node.r + 14;
                    const lx = node.x + Math.cos(node.angle) * labelDist;
                    const ly = node.y + Math.sin(node.angle) * labelDist;
                    const cos = Math.cos(node.angle);
                    const sin = Math.sin(node.angle);
                    const textAnchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
                    const dominantBaseline = sin < -0.25 ? "auto" : sin > 0.25 ? "hanging" : "middle";

                    return (
                      <g key={node.id} style={{ pointerEvents: "none", userSelect: "none" }}>
                        {verses.map((ref, vi) => (
                          <text
                            key={ref}
                            x={node.x}
                            y={node.y - totalH / 2 + vi * lineH + lineH / 2}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={9}
                            fontFamily="ui-monospace, monospace"
                            fill={node.isCurrent ? "var(--accent)" : "white"}
                            style={{ paintOrder: "stroke" } as React.CSSProperties}
                            stroke={node.isCurrent ? "rgba(200,155,60,0.15)" : "var(--nav-bg)"}
                            strokeWidth={2.5}
                            strokeLinejoin="round"
                          >
                            {ref}
                          </text>
                        ))}
                        <text
                          x={lx} y={ly}
                          textAnchor={textAnchor}
                          dominantBaseline={dominantBaseline}
                          fontSize={12}
                          fontWeight={node.isCurrent ? 700 : 400}
                          fontFamily="Georgia, serif"
                          fill={node.isCurrent ? "var(--accent)" : "var(--foreground)"}
                          style={{ paintOrder: "stroke" } as React.CSSProperties}
                          stroke="var(--background)"
                          strokeWidth={3}
                          strokeLinejoin="round"
                        >
                          {node.label}
                        </text>
                      </g>
                    );
                  })}
                </>
              );
            })()}
          </svg>
        )}

        {/* Edge tooltip */}
        {hoveredEdge && (
          <EdgeTooltip
            link={hoveredEdge.link}
            x={hoveredEdge.x}
            y={hoveredEdge.y}
            onClose={() => setHoveredEdge(null)}
          />
        )}
      </div>
    </div>
  );
}
