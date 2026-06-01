/**
 * generate-dmg-background.mjs
 *
 * Generates DMG background PNGs (1x and 2x) using sharp + SVG.
 * No Python or system dependencies — only sharp, which is already
 * a project dependency.
 *
 * Outputs:
 *   src-tauri/icons/dmg-background.png      (660×420, 1x)
 *   src-tauri/icons/dmg-background@2x.png   (1320×840, 2x Retina)
 */

import sharp from "sharp";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BG     = "#f8f6f2";
const ACCENT = "#c89b3c";
const BORDER = "#ddd8ce";
const TEXT   = "#1f2f3f";

const W = 660, H = 420;
const APP_X = 165, APP_Y = 285;
const FOL_X = 495;
const ICON_SIZE = 120;
const ICON_TOP  = 24;
const ARROW_Y   = APP_Y - 6;
const ARROW_X1  = APP_X + 52;
const ARROW_X2  = FOL_X - 52;
const HEAD      = 10;
const SEP_Y     = ICON_TOP + ICON_SIZE + 18;
const LABEL_Y   = APP_Y + 46;
const FONT_SZ   = 11;

async function render(scale) {
  const w   = W * scale,          h   = H * scale;
  const ic  = ICON_SIZE * scale,  it  = ICON_TOP * scale;
  const icx = (W / 2) * scale;
  const ay  = ARROW_Y   * scale;
  const ax1 = ARROW_X1  * scale,  ax2 = ARROW_X2 * scale;
  const hd  = HEAD      * scale;
  const sy  = SEP_Y     * scale;
  const ly  = LABEL_Y   * scale;
  const fs  = FONT_SZ   * scale;
  const sw  = Math.max(1, scale);

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
    <text x="${APP_X * scale}" y="${ly}" text-anchor="middle"
          font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
          font-size="${fs}" fill="${TEXT}" fill-opacity="0.55">Structura</text>
    <text x="${FOL_X * scale}" y="${ly}" text-anchor="middle"
          font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
          font-size="${fs}" fill="${TEXT}" fill-opacity="0.55">Applications</text>
  </svg>`;

  const iconPath = path.join(ROOT, "src-tauri/icons/icon.png");
  const iconBuf = await sharp(iconPath)
    .resize(ic, ic, { fit: "contain" })
    .png()
    .toBuffer();

  return sharp(Buffer.from(svg))
    .png()
    .composite([{ input: iconBuf, left: Math.round(icx - ic / 2), top: it }])
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
