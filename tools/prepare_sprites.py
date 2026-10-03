"""Turn the medallion sprites into small, tintable ink masks for the web.

Each output is a 320px WebP whose alpha channel is the ink (black lines) and
whose colour is black; the client paints it with CSS mask-image so one file
serves every player colour. Halftone fringe outside the outer ring is cut away.
"""
import math, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/Asus/Documents/Playground/skull/artwork/sprites")
OUT = Path(__file__).resolve().parent.parent / "public" / "img"
SIZE = 320
JOBS = {"skull-medallion.png": "skull", "flower-medallion.png": "flower", "mandala-emblem.png": "back"}


def outer_radius(g, cx, cy):
    """Outermost solid-dark run along diagonals (avoids the N/E/S/W diamonds)."""
    w, h = g.size
    px = g.load()
    radii = []
    for deg in range(20, 360, 10):
        if min(abs(deg % 90 - a) for a in (0, 90)) < 18:
            continue
        a = math.radians(deg)
        last, run = 0, 0
        for r in range(int(min(w, h) / 2) - 1):
            x, y = int(cx + r * math.cos(a)), int(cy + r * math.sin(a))
            if px[x, y] < 80:
                run += 1
                if run >= 6:
                    last = r
            else:
                run = 0
        radii.append(last)
    radii.sort()
    return radii[len(radii) // 2]


for src, name in JOBS.items():
    im = Image.open(SRC / src).convert("RGBA")
    # flatten onto white so transparent areas read as paper
    bg = Image.new("RGBA", im.size, "white")
    g = Image.alpha_composite(bg, im).convert("L")
    w, h = g.size
    cx, cy = w / 2, h / 2
    r = outer_radius(g, cx, cy) + 2
    g = g.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r))).resize((SIZE, SIZE), Image.LANCZOS)
    ink = g.point(lambda v: 255 - v).point(lambda v: 0 if v < 40 else (255 if v > 200 else v))
    circle = Image.new("L", (SIZE * 4, SIZE * 4), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, SIZE * 4 - 1, SIZE * 4 - 1), fill=255)
    circle = circle.resize((SIZE, SIZE), Image.LANCZOS)
    alpha = Image.composite(ink, Image.new("L", ink.size, 0), circle)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.putalpha(alpha)
    dst = OUT / f"{name}.webp"
    out.save(dst, "WEBP", quality=80, method=6)
    # preview on white for eyeballing
    Image.alpha_composite(Image.new("RGBA", out.size, "white"), out).save(OUT.parent.parent / "tools" / f"preview-{name}.png")
    print(name, "radius", r, "->", dst.stat().st_size, "bytes")
