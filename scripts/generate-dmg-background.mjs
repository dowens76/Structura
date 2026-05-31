// Generates src-tauri/icons/dmg-background.png (660x420) and dmg-background@2x.png (1320x840)
// Brand colors: bg #1f2f3f, gold #c89b3c, cream #e2dbd4
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const W = 660, H = 420;

// The full logo SVG (dark variant — cream/gold on transparent) scaled to fit nicely
const logoSvg = readFileSync(path.join(root, 'public/structura-full-logo-dark.svg'));

// Scale logo to 480w, centered horizontally, vertically in upper portion
const logoW = 480, logoH = Math.round(480 * (420 / 900));

async function generate(scale = 1) {
  const w = W * scale, h = H * scale;
  const lw = logoW * scale, lh = logoH * scale;

  // Render SVG logo at target size
  const logoPng = await sharp(logoSvg)
    .resize(lw, lh)
    .png()
    .toBuffer();

  // Background: solid #1f2f3f
  const bg = {
    create: { width: w, height: h, channels: 3, background: { r: 0x1f, g: 0x2f, b: 0x3f } }
  };

  // Subtle horizontal rule below logo — a thin gold line
  const lineY = Math.round((lh + (h - lh) / 2 - 20) * 0.72);
  const lineW = Math.round(lw * 0.6);
  const lineX = Math.round((w - lineW) / 2);
  const lineSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<line x1="${lineX}" y1="${lineY}" x2="${lineX + lineW}" y2="${lineY}" ` +
    `stroke="#c89b3c" stroke-width="${scale}" stroke-linecap="round" opacity="0.5"/>` +
    `</svg>`
  );

  const logoX = Math.round((w - lw) / 2);
  const logoY = Math.round((h - lh) / 2) - Math.round(20 * scale);

  const outFile = path.join(root, 'src-tauri/icons',
    scale === 1 ? 'dmg-background.png' : 'dmg-background@2x.png');

  await sharp(bg)
    .composite([
      { input: logoPng, left: logoX, top: logoY },
      { input: lineSvg, left: 0, top: 0 },
    ])
    .png()
    .toFile(outFile);

  console.log(`Written: ${outFile} (${w}x${h})`);
}

await generate(1);
await generate(2);
