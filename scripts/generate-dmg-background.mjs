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
const ARROW_Y  = APP_Y - 6;
const ARROW_X1 = APP_X + 52;
const ARROW_X2 = FOL_X - 52;
const HEAD     = 10;

async function render(scale) {
  const w   = W * scale, h = H * scale;
  const sw  = Math.max(1, scale);

  const ay  = ARROW_Y   * scale;
  const ax1 = ARROW_X1  * scale, ax2 = ARROW_X2 * scale;
  const hd  = HEAD      * scale;
  const sy  = SEP_Y     * scale;

  const arrowHead = [
    `M ${ax2} ${ay} L ${ax2 - hd} ${ay - hd * 0.6}`,
    `M ${ax2} ${ay} L ${ax2 - hd} ${ay + hd * 0.6}`,
  ].join(" ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${BG}"/>
    <line x1="${40 * scale}" y1="${sy}" x2="${(W - 40) * scale}" y2="${sy}"
          stroke="${BORDER}" stroke-width="${sw}"/>
    <line x1="${ax1}" y1="${ay}" x2="${ax2}" y2="${ay}"
          stroke="${ACCENT}" stroke-width="${sw * 2}" stroke-opacity="0.8"/>
    <path d="${arrowHead}" stroke="${ACCENT}" stroke-width="${sw * 2}" stroke-opacity="0.8"
          fill="none" stroke-linecap="round" stroke-linejoin="round"/>
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
