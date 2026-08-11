/**
 * Shared DOM-measurement logic for margin overlays (RstRelationOverlay,
 * LineGroupOverlay) that draw SVG trees/brackets anchored to paragraph
 * segment positions. Reads the data-rst-seg / data-rst-text / data-rst-src-block
 * / data-seg-label / data-seg-translation attributes that VerseDisplay stamps
 * on every segment unconditionally.
 */

export interface SegPos {
  top: number;
  bottom: number;
  leftX: number;
  rightX: number;
  transLeftX?: number;
  /** Full bounding-box top/bottom of the translation column's own text block
   *  (unlike `top`/`bottom`, which anchor to the source text's first line).
   *  Needed so a translation-side bracket can extend to the bottom of a
   *  translation that wraps onto more lines than its source line — see
   *  LineGroupOverlay's yTopTrans/yBottomTrans. */
  transTop?: number;
  transBottom?: number;
  /** Right edge of the source grid-cell div (3-col layout only). Used to anchor
   *  the source tree from the column boundary rather than from the inline text span. */
  srcCellRightX?: number;
  /** Left edge of the verse-label element.  Used in Hebrew 2-col to prevent the
   *  tree from extending into the verse-number column. */
  labelLeftX?: number;
}

export function measureSegments(
  wordIds: string[],
  container: HTMLElement,
): Map<string, SegPos> {
  const cRect     = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;
  const result    = new Map<string, SegPos>();

  for (const id of wordIds) {
    const outerEl = container.querySelector<HTMLElement>(
      `[data-rst-seg="${CSS.escape(id)}"]`,
    );
    if (!outerEl) continue;

    // Y anchors to the source-text span so ticks land at the text line,
    // not in the middle of a tall div that includes translation rows.
    const textEl = container.querySelector<HTMLElement>(
      `[data-rst-text="${CSS.escape(id)}"]`,
    ) ?? outerEl;
    const textR = textEl.getBoundingClientRect();

    // For multi-line block segments, use the first text line's bounding rect
    // so the anchor lands on the first line rather than the vertical midpoint
    // of the entire block.
    let anchorTop    = textR.top;
    let anchorBottom = textR.bottom;
    try {
      const tw = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
      let tn: Node | null;
      while ((tn = tw.nextNode())) {
        if ((tn as Text).textContent?.trim()) {
          const r = document.createRange();
          r.setStart(tn as Text, 0);
          r.setEnd(tn as Text, Math.min(1, (tn as Text).length));
          const rr = r.getBoundingClientRect();
          if (rr.height > 0) { anchorTop = rr.top; anchorBottom = rr.bottom; }
          break;
        }
      }
    } catch { /* ignore */ }

    const transEl    = container.querySelector<HTMLElement>(
      `[data-seg-translation="${CSS.escape(id)}"]`,
    );
    // Indentation on the translation column lives on the first <p> inside the
    // translation div, not on the div itself — read padding from that element.
    const transPEl   = transEl?.querySelector("p");
    const transPCs   = transPEl ? getComputedStyle(transPEl) : null;
    const transPadL  = transPCs ? (parseFloat(transPCs.paddingLeft) || 0) : 0;
    const transLeftX = transEl
      ? transEl.getBoundingClientRect().left - cRect.left + transPadL
      : undefined;
    // Full block extent (not just first line) — a translation can wrap onto
    // more lines than its source, so its bottom edge needs its own measurement
    // rather than inheriting the source text's (shorter) anchorBottom.
    const transR = transEl?.getBoundingClientRect();
    const transTop    = transR ? transR.top    - cRect.top + scrollTop : undefined;
    const transBottom = transR ? transR.bottom - cRect.top + scrollTop : undefined;

    // Measure the source grid-cell div.  Its padding carries the paragraph
    // indentation (paddingLeft for LTR, paddingRight for Hebrew RTL), so we
    // read leftX/rightX from it rather than from the inner text span (which
    // has no padding of its own and therefore always reports the same position
    // regardless of indentation level).
    const srcBlockEl = container.querySelector<HTMLElement>(
      `[data-rst-src-block="${CSS.escape(id)}"]`,
    );
    const srcBlockR    = srcBlockEl?.getBoundingClientRect() ?? null;
    // srcCellRightX = raw border-box right (used as stable column boundary in 3-col).
    const srcCellRightX = srcBlockR ? srcBlockR.right - cRect.left : undefined;

    // Hebrew 2-col: measure the verse-label left edge so the tree stays clear of it.
    const labelEl = container.querySelector<HTMLElement>(
      `[data-seg-label="${CSS.escape(id)}"]`,
    );
    const labelLeftX = labelEl
      ? labelEl.getBoundingClientRect().left - cRect.left
      : undefined;

    // Read indentation padding from the source-block element (which carries it).
    // Fall back to the text span when srcBlockEl is unavailable.
    const posEl  = srcBlockEl ?? textEl;
    const posR   = srcBlockR  ?? textR;
    const cs     = getComputedStyle(posEl);
    const padLeft  = parseFloat(cs.paddingLeft)  || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;

    result.set(id, {
      top:       anchorTop    - cRect.top + scrollTop,
      bottom:    anchorBottom - cRect.top + scrollTop,
      leftX:     posR.left  - cRect.left + padLeft,
      rightX:    posR.right - cRect.left - padRight,
      transLeftX,
      transTop,
      transBottom,
      srcCellRightX,
      labelLeftX,
    });
  }
  return result;
}
