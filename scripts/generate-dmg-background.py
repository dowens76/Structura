#!/usr/bin/env python3
"""Generate DMG background images for the Structura macOS installer."""

import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Pillow not found. Install with: pip3 install Pillow")
    sys.exit(1)

# --- Config ---
BG_COLOR = "#f8f6f2"           # matches --background in globals.css
ACCENT_COLOR = "#c89b3c"       # matches --accent
NAV_COLOR = "#1f2f3f"          # matches --foreground / nav-bg
MUTED_COLOR = "#ddd8ce"        # matches --border

W, H = 660, 420                # 1x DMG window size
APP_X, APP_Y = 165, 285        # app icon center (matches tauri.conf.json)
FOLDER_X, FOLDER_Y = 495, 285  # Applications alias center

ICON_PATH = Path(__file__).parent.parent / "src-tauri" / "icons" / "icon.png"
OUT_1X = Path(__file__).parent.parent / "src-tauri" / "icons" / "dmg-background.png"
OUT_2X = Path(__file__).parent.parent / "src-tauri" / "icons" / "dmg-background@2x.png"


def draw_arrow(draw, x1, y1, x2, y2, color, width=2, head=10):
    """Draw a simple horizontal arrow."""
    draw.line([(x1, y1), (x2, y2)], fill=color, width=width)
    # arrowhead
    angle = math.atan2(y2 - y1, x2 - x1)
    for side in [math.pi / 6, -math.pi / 6]:
        ax = x2 - head * math.cos(angle - side)
        ay = y2 - head * math.sin(angle - side)
        draw.line([(x2, y2), (ax, ay)], fill=color, width=width)


def render(scale: int) -> Image.Image:
    w, h = W * scale, H * scale
    img = Image.new("RGBA", (w, h), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # --- Structura icon centered at top ---
    icon_size = 120 * scale
    icon_y_top = 24 * scale          # top of icon
    icon_x_left = (w - icon_size) // 2

    icon = Image.open(ICON_PATH).convert("RGBA")
    icon = icon.resize((icon_size, icon_size), Image.LANCZOS)
    img.paste(icon, (icon_x_left, icon_y_top), icon)

    # --- Thin separator line ---
    sep_y = icon_y_top + icon_size + 18 * scale
    draw.line([(40 * scale, sep_y), (w - 40 * scale, sep_y)],
              fill=MUTED_COLOR, width=max(1, scale))

    # --- "Drag to install" arrow between the two icon positions ---
    arrow_y = APP_Y * scale - 6 * scale      # slightly above icon centers
    arrow_x1 = APP_X * scale + 52 * scale   # right edge of app icon area
    arrow_x2 = FOLDER_X * scale - 52 * scale  # left edge of Applications area

    arrow_color_rgb = tuple(int(ACCENT_COLOR.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    arrow_color = arrow_color_rgb + (200,)

    draw_arrow(draw, arrow_x1, arrow_y, arrow_x2, arrow_y,
               color=arrow_color, width=2 * scale, head=10 * scale)

    # --- Labels below the icon positions ---
    label_y = (APP_Y + 46) * scale
    try:
        font_size = 11 * scale
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except Exception:
        font = ImageFont.load_default()

    text_color_rgb = tuple(int(NAV_COLOR.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    text_color = text_color_rgb + (160,)

    for label, cx in [("Structura", APP_X * scale), ("Applications", FOLDER_X * scale)]:
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2, label_y), label, fill=text_color, font=font)

    return img.convert("RGB")


def main():
    print("Generating DMG background images…")
    for scale, out in [(1, OUT_1X), (2, OUT_2X)]:
        img = render(scale)
        img.save(out, "PNG", optimize=True)
        print(f"  Wrote {out}  ({img.width}×{img.height})")
    print("Done.")


if __name__ == "__main__":
    main()
