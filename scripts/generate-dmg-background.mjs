/**
 * generate-dmg-background.mjs
 *
 * Generates DMG background PNGs (1x and 2x) using sharp + SVG.
 * No Python or system dependencies — only sharp, which is already
 * a project dependency.
 *
 * Layout (1x):
 *   Window:  660 × 480
 *   Logo:    560 × 261 px (structura-full-logo.svg, aspect 900:420), centered, top=24
 *   Sep:     y=299
 *   Icons:   APP_X=165 APP_Y=400  FOL_X=495 FOL_Y=400
 *   Arrow:   between the two icon positions
 *   Labels:  none — Finder renders its own labels below each icon
 *
 * Outputs:
 *   src-tauri/icons/dmg-background.png      (660×480, 1x)
 *   src-tauri/icons/dmg-background@2x.png   (1320×960, 2x Retina)
 */

import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BG     = "#f8f6f2";
const ACCENT = "#c89b3c";
const BORDER = "#ddd8ce";
const TEXT   = "#1f2f3f";

// Window dimensions — must match create-dmg.mjs window.size
export const W = 660, H = 480;

// Icon center positions — must match create-dmg.mjs contents[].x/y
export const APP_X = 165, APP_Y = 400;
export const FOL_X = 495, FOL_Y = 400;

// Logo dimensions at 1x (SVG viewBox 900×420, rendered at width 560)
const LOGO_W   = 560;
const LOGO_H   = Math.round(LOGO_W * 420 / 900); // ≈ 261
const LOGO_TOP = 24;
const LOGO_LEFT = Math.round((W - LOGO_W) / 2);  // 50

const SEP_Y  = LOGO_TOP + LOGO_H + 14;           // ≈ 299

// Filled arrow polygon centered between the two icon positions.
// All values at 1x; multiplied by scale at render time.
const ARR_CX    = Math.round((APP_X + FOL_X) / 2); // 330 — horizontal center
const ARR_CY    = APP_Y;                            // 400 — vertical center (same as icons)
const ARR_W     = 120;  // total width  (tip-to-tail)
const ARR_H     = 32;   // total height (arrowhead top to bottom)
const ARR_NECK  = 14;   // shaft height
const ARR_SPLIT = 0.62; // fraction of width where shaft ends / arrowhead begins

async function render(scale) {
  const w   = W * scale, h = H * scale;
  const sw  = Math.max(1, scale);

  const sy  = SEP_Y * scale;

  // Filled arrow polygon (all coords scaled)
  const cx  = ARR_CX    * scale;
  const cy  = ARR_CY    * scale;
  const hw  = (ARR_W / 2) * scale;           // half-width
  const hh  = (ARR_H / 2) * scale;           // half-height
  const hn  = (ARR_NECK / 2) * scale;        // half-neck height
  const sx  = cx - hw;                        // shaft left
  const jx  = cx - hw + ARR_W * ARR_SPLIT * scale; // junction x (shaft→head)
  const tx  = cx + hw;                        // tip x
  // Polygon points (right-pointing arrow):
  // tail-top → junction-top → head-top → tip → head-bottom → junction-bottom → tail-bottom
  const pts = [
    `${sx},${cy - hn}`,
    `${jx},${cy - hn}`,
    `${jx},${cy - hh}`,
    `${tx},${cy}`,
    `${jx},${cy + hh}`,
    `${jx},${cy + hn}`,
    `${sx},${cy + hn}`,
  ].join(" ");

  // Instruction text sits midway between separator and icons
  const instrY = Math.round((SEP_Y + (APP_Y - ARR_H / 2 - 8)) / 2) * scale;
  const instrFS = 13 * scale;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${BG}"/>
    <line x1="${40 * scale}" y1="${sy}" x2="${(W - 40) * scale}" y2="${sy}"
          stroke="${BORDER}" stroke-width="${sw}"/>
    <text x="${(W / 2) * scale}" y="${instrY}" text-anchor="middle"
          font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
          font-size="${instrFS}" fill="${TEXT}" fill-opacity="0.65">Click and drag the Structura app to your Applications folder.</text>
    <polygon points="${pts}" fill="${ACCENT}" opacity="0.85"/>
  </svg>`;

  // Rasterise the full Structura SVG logo at the target size
  const logoSvg = readFileSync(path.join(ROOT, "public/structura-full-logo.svg"));
  const logoBuf = await sharp(logoSvg, { density: 300 })
    .resize(LOGO_W * scale, LOGO_H * scale, { fit: "fill" })
    .png()
    .toBuffer();

  return sharp(Buffer.from(svg))
    .png()
    .composite([{
      input: logoBuf,
      left: LOGO_LEFT * scale,
      top:  LOGO_TOP  * scale,
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

console.log("Generating DMG background images…");
for (const [scale, name] of [[1, "dmg-background.png"], [2, "dmg-background@2x.png"]]) {
  const buf = await render(scale);
  const out = path.join(ROOT, "src-tauri/icons", name);
  writeFileSync(out, buf);
  console.log(`  Wrote ${name}  (${W * scale}x${H * scale})`);
}
console.log("Done.");
