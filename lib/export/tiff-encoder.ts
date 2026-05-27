/**
 * Minimal uncompressed TIFF encoder.
 *
 * Converts an RGBA HTMLCanvasElement to a CMYK TIFF Uint8Array suitable for
 * print-production workflows.  No external dependencies — pure TypeScript.
 *
 * Spec:
 *   - Byte order:             Little-endian ("II")
 *   - Compression:            None (tag 259 = 1)
 *   - PhotometricInterpret.:  CMYK (tag 262 = 5)
 *   - SamplesPerPixel:        4 (C, M, Y, K)
 *   - BitsPerSample:          8 per channel
 *   - PlanarConfiguration:    Chunky (tag 284 = 1)
 *   - ResolutionUnit:         Inch (tag 296 = 2)
 *   - One strip = entire image
 *
 * Alpha is composited on white before conversion — transparent pixels become
 * white paper, which is correct for print output.
 *
 * sRGB → CMYK formula (no ICC profile):
 *   K  = 1 − max(R′, G′, B′)
 *   C  = (1 − R′ − K) / (1 − K)
 *   M  = (1 − G′ − K) / (1 − K)
 *   Y  = (1 − B′ − K) / (1 − K)
 */
export function rgbaCanvasToTiff(canvas: HTMLCanvasElement, dpi: number): Uint8Array<ArrayBuffer> {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;

  // ── RGBA → CMYK conversion ────────────────────────────────────────────────
  const cmyk = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 4) {
    // Composite on white background (alpha premultiplication)
    const a  = rgba[i + 3] / 255;
    const r  = (rgba[i]     / 255) * a + (1 - a);
    const g  = (rgba[i + 1] / 255) * a + (1 - a);
    const b  = (rgba[i + 2] / 255) * a + (1 - a);

    const k = 1 - Math.max(r, g, b);
    if (k >= 1) {
      // Pure black
      cmyk[j] = cmyk[j + 1] = cmyk[j + 2] = 0;
      cmyk[j + 3] = 255;
    } else {
      const d = 1 - k;
      cmyk[j]     = Math.round((1 - r - k) / d * 255); // C
      cmyk[j + 1] = Math.round((1 - g - k) / d * 255); // M
      cmyk[j + 2] = Math.round((1 - b - k) / d * 255); // Y
      cmyk[j + 3] = Math.round(k * 255);                // K
    }
  }

  // ── TIFF file layout (little-endian) ─────────────────────────────────────
  //
  //   0 –   7: TIFF header  (8 bytes)
  //   8 – 169: IFD          (2 + 13×12 + 4 = 162 bytes, 13 entries)
  // 170 – 177: BitsPerSample data   [8, 8, 8, 8]  (4 × SHORT = 8 bytes)
  // 178 – 185: XResolution rational [dpi, 1]       (2 × LONG  = 8 bytes)
  // 186 – 193: YResolution rational [dpi, 1]       (2 × LONG  = 8 bytes)
  // 194 –    : CMYK image data (chunky, one strip)

  const NUM_ENTRIES = 13;
  const IFD_OFFSET  = 8;
  const IFD_SIZE    = 2 + NUM_ENTRIES * 12 + 4; // = 162
  const BPS_OFFSET  = IFD_OFFSET + IFD_SIZE;    // = 170
  const XRES_OFFSET = BPS_OFFSET  + 8;          // = 178
  const YRES_OFFSET = XRES_OFFSET + 8;          // = 186
  const DATA_OFFSET = YRES_OFFSET + 8;          // = 194
  const imageBytes  = cmyk.length;              // width × height × 4

  const buf: ArrayBuffer = new ArrayBuffer(DATA_OFFSET + imageBytes);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);

  // TIFF header
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); // "II" — little-endian
  dv.setUint16(2, 42, true);                   // TIFF magic number
  dv.setUint32(4, IFD_OFFSET, true);           // offset to first IFD

  // IFD — entries MUST be sorted by tag number ascending
  let pos = IFD_OFFSET;
  dv.setUint16(pos, NUM_ENTRIES, true); pos += 2;

  // Write one 12-byte IFD entry.  For values ≤ 4 bytes (SHORT×1, LONG×1) the
  // value is stored directly in the last 4 bytes; otherwise it is an offset.
  const SHORT    = 3;
  const LONG     = 4;
  const RATIONAL = 5;
  const entry = (tag: number, type: number, count: number, valOrOff: number) => {
    dv.setUint16(pos,      tag,       true);
    dv.setUint16(pos + 2,  type,      true);
    dv.setUint32(pos + 4,  count,     true);
    dv.setUint32(pos + 8,  valOrOff,  true);
    pos += 12;
  };

  entry(256, LONG,     1, width);       // ImageWidth
  entry(257, LONG,     1, height);      // ImageLength
  entry(258, SHORT,    4, BPS_OFFSET);  // BitsPerSample → external (4 values)
  entry(259, SHORT,    1, 1);           // Compression: None
  entry(262, SHORT,    1, 5);           // PhotometricInterpretation: CMYK
  entry(273, LONG,     1, DATA_OFFSET); // StripOffsets
  entry(277, SHORT,    1, 4);           // SamplesPerPixel
  entry(278, LONG,     1, height);      // RowsPerStrip (one strip = whole image)
  entry(279, LONG,     1, imageBytes);  // StripByteCounts
  entry(282, RATIONAL, 1, XRES_OFFSET); // XResolution → external rational
  entry(283, RATIONAL, 1, YRES_OFFSET); // YResolution → external rational
  entry(284, SHORT,    1, 1);           // PlanarConfiguration: Chunky
  entry(296, SHORT,    1, 2);           // ResolutionUnit: Inch

  dv.setUint32(pos, 0, true); // next IFD offset = 0 (no more IFDs)

  // BitsPerSample data: 8, 8, 8, 8
  dv.setUint16(BPS_OFFSET,     8, true);
  dv.setUint16(BPS_OFFSET + 2, 8, true);
  dv.setUint16(BPS_OFFSET + 4, 8, true);
  dv.setUint16(BPS_OFFSET + 6, 8, true);

  // XResolution rational: dpi/1
  dv.setUint32(XRES_OFFSET,     dpi, true);
  dv.setUint32(XRES_OFFSET + 4, 1,   true);

  // YResolution rational: dpi/1
  dv.setUint32(YRES_OFFSET,     dpi, true);
  dv.setUint32(YRES_OFFSET + 4, 1,   true);

  // Image data
  u8.set(cmyk, DATA_OFFSET);

  return u8;
}
