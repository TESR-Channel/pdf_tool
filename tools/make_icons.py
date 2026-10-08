#!/usr/bin/env python3
"""TESR PDF Editor — app icon generator.
Reads logo.png from the repo root and writes:
  icon-192.png, icon-512.png  (purpose: any — full-bleed square)
  icon-maskable-512.png       (purpose: maskable — content inside the 80% safe zone)
  apple-touch-icon.png        (180x180, opaque, for iOS Add-to-Home-Screen)
  favicon-64.png
Design: TESR CI — dark #0b0b0d background, white document with gold folded
corner, TESR shield logo, crimson "PDF" ribbon.
Runs locally and in GitHub Actions (needs: pillow + DejaVuSans-Bold).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024  # master canvas

BG0, BG1 = (26, 26, 34), (11, 11, 13)      # background gradient
RED0, RED1 = (220, 20, 60), (122, 6, 24)   # ribbon gradient (crimson -> dark red)
GOLD = (201, 168, 76)
GOLD2 = (228, 199, 122)
WHITE = (255, 255, 255)

def find_font():
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
              "/Library/Fonts/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return p
    sys.exit("DejaVuSans-Bold.ttf not found — install fonts-dejavu-core")

FONT = find_font()

def rounded(draw, box, r, **kw):
    draw.rounded_rectangle(box, radius=r, **kw)

def v_gradient(size, c0, c1):
    w, h = size
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)))
    return g.resize((w, h))

def radial_bg():
    """Smooth dark gradient + deep red glow (built small, upscaled -> no banding)."""
    import math
    small = 96
    bg = Image.new("RGB", (small, small))
    px = bg.load()
    cx, cy, maxd = small * 0.5, small * 0.40, small * 0.80
    for y in range(small):
        for x in range(small):
            d = min(1.0, math.hypot(x - cx, y - cy) / maxd) ** 1.3
            px[x, y] = tuple(int(BG0[i] + (BG1[i] - BG0[i]) * d) for i in range(3))
    bg = bg.resize((S, S), Image.LANCZOS)
    # deep red glow, top-right
    glow = Image.new("RGB", (small, small), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([small * 0.52, -small * 0.30, small * 1.25, small * 0.42],
                                 fill=(120, 8, 28))
    glow = glow.filter(ImageFilter.GaussianBlur(18)).resize((S, S), Image.LANCZOS)
    from PIL import ImageChops
    bg = ImageChops.add(bg, glow)
    # faint gold grid
    grid = Image.new("L", (S, S), 0)
    gdr = ImageDraw.Draw(grid)
    for k in range(0, S + 1, 96):
        gdr.line([(k, 0), (k, S)], fill=10, width=2)
        gdr.line([(0, k), (S, k)], fill=10, width=2)
    bg = Image.composite(Image.new("RGB", (S, S), GOLD), bg, grid)
    return bg

def trimmed_logo():
    im = Image.open(os.path.join(ROOT, "logo.png")).convert("RGB")
    # trim near-white margins
    gray = ImageOps.invert(im.convert("L")).point(lambda v: 255 if v > 18 else 0)
    bbox = gray.getbbox() or (0, 0, im.width, im.height)
    im = im.crop(bbox)
    # white -> transparent so the page shows through cleanly
    rgba = im.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = px[x, y]
            if r > 243 and g > 243 and b > 243:
                px[x, y] = (r, g, b, 0)
    return rgba

def shadow_of(mask_img, blur, alpha):
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    black = Image.new("RGBA", (S, S), (0, 0, 0, alpha))
    sh.paste(black, (0, 0), mask_img)
    return sh.filter(ImageFilter.GaussianBlur(blur))

def compose(scale=1.0):
    """Build the full-bleed 1024 icon; scale<1 shrinks the foreground for maskable."""
    base = radial_bg().convert("RGBA")
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)

    # --- white document with gold folded corner ---
    pw, ph = 560, 690
    px0, py0 = (S - pw) // 2, 118
    fold = 150
    r = 42
    page_mask = Image.new("L", (S, S), 0)
    pm = ImageDraw.Draw(page_mask)
    pm.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=r, fill=255)
    pm.polygon([(px0 + pw - fold, py0), (px0 + pw, py0), (px0 + pw, py0 + fold)], fill=0)
    # page shadow
    fg.alpha_composite(shadow_of(page_mask, 26, 150), (0, 18))
    page = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    page_fill = Image.new("RGBA", (S, S), (250, 249, 246, 255))
    page.paste(page_fill, (0, 0), page_mask)
    fg.alpha_composite(page)
    # gold dog-ear
    d = ImageDraw.Draw(fg)
    d.polygon([(px0 + pw - fold, py0), (px0 + pw - fold, py0 + fold), (px0 + pw, py0 + fold)], fill=GOLD)
    d.line([(px0 + pw - fold, py0), (px0 + pw - fold, py0 + fold), (px0 + pw, py0 + fold)],
           fill=(154, 122, 42), width=6)

    # --- TESR shield logo on the page ---
    logo = trimmed_logo()
    lw = 330
    lh = int(logo.height * lw / logo.width)
    logo = logo.resize((lw, lh), Image.LANCZOS)
    fg.alpha_composite(logo, ((S - lw) // 2, py0 + 64))

    # faint content lines under the logo (document feel)
    ly = py0 + 64 + lh + 46
    for k, wfrac in enumerate((0.60, 0.44)):
        lw2 = int(pw * wfrac)
        d.rounded_rectangle([(S - lw2) // 2, ly + k * 40, (S + lw2) // 2, ly + k * 40 + 14],
                            radius=7, fill=(205, 203, 198, 255))

    # --- crimson PDF ribbon ---
    rw, rh = 790, 225
    rx0 = (S - rw) // 2
    ry0 = py0 + ph - rh + 36  # overlaps the page bottom
    rib_mask = Image.new("L", (S, S), 0)
    rm = ImageDraw.Draw(rib_mask)
    rm.rounded_rectangle([rx0, ry0, rx0 + rw, ry0 + rh], radius=54, fill=255)
    fg.alpha_composite(shadow_of(rib_mask, 22, 160), (0, 16))
    rib = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rib.paste(v_gradient((S, S), RED0, RED1).convert("RGBA"), (0, 0), rib_mask)
    fg.alpha_composite(rib)
    d = ImageDraw.Draw(fg)
    d.rounded_rectangle([rx0, ry0, rx0 + rw, ry0 + rh], radius=54, outline=GOLD2 + (210,), width=7)

    # "PDF" lettering
    font = ImageFont.truetype(FONT, 168)
    txt = "PDF"
    # letter-spaced centered draw
    sp = 26
    widths = [d.textlength(ch, font=font) for ch in txt]
    total = sum(widths) + sp * (len(txt) - 1)
    tx = (S - total) / 2
    bbox = font.getbbox("PDF")
    ty = ry0 + (rh - (bbox[3] - bbox[1])) / 2 - bbox[1]
    for ch, w in zip(txt, widths):
        d.text((tx + 2, ty + 5), ch, font=font, fill=(0, 0, 0, 90))   # soft text shadow
        d.text((tx, ty), ch, font=font, fill=WHITE)
        tx += w + sp

    if scale != 1.0:
        sw = int(S * scale)
        fg = fg.resize((sw, sw), Image.LANCZOS)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        canvas.alpha_composite(fg, ((S - sw) // 2, (S - sw) // 2 + int(S * 0.01)))
        fg = canvas
    base.alpha_composite(fg)
    return base.convert("RGB")

def save(im, name, size):
    im.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, name), "PNG", optimize=True)
    print("wrote", name, size)

def main():
    any_icon = compose(1.0)
    mask_icon = compose(0.74)
    save(any_icon, "icon-512.png", 512)
    save(any_icon, "icon-192.png", 192)
    save(mask_icon, "icon-maskable-512.png", 512)
    save(any_icon, "apple-touch-icon.png", 180)
    save(any_icon, "favicon-64.png", 64)

if __name__ == "__main__":
    main()
