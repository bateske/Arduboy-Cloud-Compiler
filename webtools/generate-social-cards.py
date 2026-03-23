"""Generate social card images with retro code-glyph art deco pattern."""
from PIL import Image, ImageDraw, ImageFont
import random
import math
import os

OUT_DIR = r"D:\Projects\ArduboyCloud\Arduboy-Cloud-Compiler\webtools"
BRAND_ICON = os.path.join(OUT_DIR, "brand-icon.png")

# --- Palette ---
BG         = (13, 13, 23)
PURPLE     = (124, 58, 237)
NEON_PINK  = (236, 72, 153)
NEON_CYAN  = (34, 211, 238)
WHITE      = (255, 255, 255)
GOLD       = (251, 191, 36)

# Code glyphs
GLYPHS = ["{ }", "</>", "=>", "::", "&&", "||", "!=", "==", "<<", ">>",
           "0x", "++", "--", "/**", "*/", "->", "#!", "~/", "[];",
           "int", "for", "if(", "else", "void", "0xFF", "0b10",
           "<< >>", "{ };", "( )", "[ ]", ":::", "///"]
MICRO_GLYPHS = list("{}()<>[];:/*\\|&^~!?#=+-_.,$@%01")

random.seed(42)


def load_brand_icon():
    """Load brand icon with alpha channel."""
    icon = Image.open(BRAND_ICON).convert("RGBA")
    return icon


def make_card(w, h, filename):
    img = Image.new("RGBA", (w, h), BG + (255,))
    brand = load_brand_icon()

    # --- Scale factor: ~2x bigger than before ---
    SCALE = 3.0

    # --- Load fonts (scaled up) ---
    try:
        micro_font = ImageFont.truetype("consola.ttf", max(14, int(h * 0.022 * SCALE)))
        small_font = ImageFont.truetype("consola.ttf", max(20, int(h * 0.035 * SCALE)))
        med_font   = ImageFont.truetype("consola.ttf", max(28, int(h * 0.055 * SCALE)))
        big_font   = ImageFont.truetype("consola.ttf", max(48, int(h * 0.09 * SCALE)))
    except Exception:
        micro_font = ImageFont.load_default()
        small_font = med_font = big_font = micro_font

    # --- Layer 1: Dense micro-glyph field (scaled up spacing + font) ---
    glyph_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyph_layer)

    step_x = max(28, int(w * 0.025 * SCALE))
    step_y = max(24, int(h * 0.04 * SCALE))
    for gy in range(-step_y, h + step_y, step_y):
        offset = (step_x // 2) if (gy // step_y) % 2 else 0
        for gx in range(-step_x, w + step_x, step_x):
            x = gx + offset + random.randint(-4, 4)
            y = gy + random.randint(-4, 4)
            ch = random.choice(MICRO_GLYPHS)
            dx = (x - w / 2) / (w / 2)
            dy = (y - h / 2) / (h / 2)
            dist = math.sqrt(dx * dx + dy * dy)
            base_alpha = int(20 + 28 * min(dist, 1.2))
            r = random.random()
            if r < 0.45:
                color = PURPLE
            elif r < 0.65:
                color = NEON_CYAN
            elif r < 0.80:
                color = NEON_PINK
            elif r < 0.90:
                color = GOLD
            else:
                color = WHITE
            alpha = max(10, min(65, base_alpha + random.randint(-8, 8)))
            gd.text((x, y), ch, fill=color + (alpha,), font=micro_font)

    img = Image.alpha_composite(img, glyph_layer)

    # --- Layer 2: Scattered medium/large glyphs (fewer but bigger) ---
    scatter_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    num_large = int((w * h) / 18000)
    for _ in range(num_large):
        x = random.randint(-60, w + 40)
        y = random.randint(-40, h + 20)
        glyph = random.choice(GLYPHS)
        font_choice = random.choice([small_font, med_font, med_font, big_font])
        r = random.random()
        if r < 0.35:
            color = PURPLE
        elif r < 0.55:
            color = NEON_CYAN
        elif r < 0.70:
            color = NEON_PINK
        elif r < 0.82:
            color = GOLD
        else:
            color = WHITE
        dx = (x - w / 2) / (w / 2)
        dy = (y - h / 2) / (h / 2)
        dist = math.sqrt(dx * dx + dy * dy)
        alpha = int(15 + 45 * min(dist, 1.0)) + random.randint(-5, 10)
        alpha = max(8, min(70, alpha))
        bbox = font_choice.getbbox(glyph)
        tw = bbox[2] - bbox[0] + 20
        th = bbox[3] - bbox[1] + 20
        if tw < 4 or th < 4:
            continue
        tmp = Image.new("RGBA", (tw * 2, th * 2), (0, 0, 0, 0))
        td = ImageDraw.Draw(tmp)
        td.text((tw // 2, th // 2), glyph, fill=color + (alpha,), font=font_choice)
        angle = random.uniform(-35, 35)
        tmp = tmp.rotate(angle, expand=False, resample=Image.BICUBIC)
        scatter_layer.paste(tmp, (x - tmp.width // 2, y - tmp.height // 2), tmp)

    img = Image.alpha_composite(img, scatter_layer)

    # --- Layer 3: Art deco geometric lines + CRT scanlines ---
    deco_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(deco_layer)

    for i in range(0, max(w, h), int(h * 0.08)):
        dd.line([(0, i), (i, 0)], fill=PURPLE + (25,), width=1)
        dd.line([(w, h - i), (w - i, h)], fill=PURPLE + (25,), width=1)

    for y in range(0, h, 4):
        dd.line([(0, y), (w, y)], fill=(0, 0, 0, 18), width=1)

    img = Image.alpha_composite(img, deco_layer)

    # --- Layer 4: Radial vignette ---
    vignette = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    cx, cy = w // 2, h // 2
    max_r = math.sqrt(cx * cx + cy * cy)
    for ring in range(int(max_r), 0, -4):
        t = ring / max_r
        if t > 0.5:
            alpha = int(80 * ((t - 0.5) / 0.5) ** 1.5)
            alpha = min(alpha, 120)
            vd.ellipse([cx - ring, cy - ring, cx + ring, cy + ring],
                       fill=None, outline=BG + (alpha,), width=4)

    img = Image.alpha_composite(img, vignette)

    # --- Layer 5: Brand icon + central content ---
    text_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    txd = ImageDraw.Draw(text_layer)

    title_size = int(h * 0.13)
    sub_size = int(h * 0.048)
    tag_size = int(h * 0.032)
    try:
        title_bold = ImageFont.truetype("arialbd.ttf", title_size)
        sub_font = ImageFont.truetype("arial.ttf", sub_size)
        tag_font = ImageFont.truetype("consola.ttf", tag_size)
    except Exception:
        title_bold = ImageFont.load_default()
        sub_font = title_bold
        tag_font = title_bold

    # -- Brand icon above title --
    icon_h = int(h * 0.22)
    icon_w = int(brand.width * (icon_h / brand.height))
    brand_resized = brand.resize((icon_w, icon_h), Image.LANCZOS)

    # Calculate full content block height to center everything
    title_bbox = title_bold.getbbox("Arduboy Cloud")
    title_h = title_bbox[3] - title_bbox[1]
    sub_bbox = sub_font.getbbox("Browser IDE for Arduboy")
    sub_h = sub_bbox[3] - sub_bbox[1]
    tag_bbox = tag_font.getbbox("compile")
    tag_h = tag_bbox[3] - tag_bbox[1]

    icon_gap = int(h * -0.02)  # negative = icon overlaps toward title
    title_gap = int(h * 0.015)
    div_gap = int(h * 0.02)
    tag_gap = int(h * 0.03)

    total_h = icon_h + icon_gap + title_h + title_gap + sub_h + div_gap + 8 + tag_gap + tag_h
    start_y = (h - total_h) // 2

    # Brand icon with purple glow
    icon_x = (w - icon_w) // 2
    icon_y = start_y

    # Glow behind icon
    glow_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glow_icon = brand_resized.copy()
    # Tint the glow purple by using only the alpha channel
    glow_size = (icon_w + 30, icon_h + 30)
    glow_base = brand_resized.resize(glow_size, Image.LANCZOS)
    for gpass in range(3):
        expand = 8 + gpass * 6
        gi = brand_resized.resize((icon_w + expand, icon_h + expand), Image.LANCZOS)
        # Create purple-tinted version using alpha as mask
        purple_glow = Image.new("RGBA", gi.size, PURPLE + (0,))
        for px in range(gi.width):
            for py in range(gi.height):
                r, g, b, a = gi.getpixel((px, py))
                if a > 10:
                    ga = min(255, int(a * 0.15 / (gpass + 1)))
                    purple_glow.putpixel((px, py), PURPLE + (ga,))
        gx = icon_x - expand // 2
        gy = icon_y - expand // 2
        glow_layer.paste(purple_glow, (gx, gy), purple_glow)
    text_layer = Image.alpha_composite(text_layer, glow_layer)

    # Paste actual brand icon
    text_layer.paste(brand_resized, (icon_x, icon_y), brand_resized)

    # Redraw since we composited
    txd = ImageDraw.Draw(text_layer)

    # Title with glow
    center_y = icon_y + icon_h + icon_gap
    title = "Arduboy Cloud"
    bbox = title_bold.getbbox(title)
    tw = bbox[2] - bbox[0]
    tx = (w - tw) // 2

    for glow_offset in range(12, 0, -2):
        glow_alpha = max(5, 25 - glow_offset * 2)
        for ox in range(-glow_offset, glow_offset + 1, 3):
            for oy in range(-glow_offset, glow_offset + 1, 3):
                txd.text((tx + ox, center_y + oy), title,
                         fill=PURPLE + (glow_alpha,), font=title_bold)

    txd.text((tx, center_y), title, fill=WHITE + (240,), font=title_bold)

    # Subtitle
    sub = "Browser IDE for Arduboy"
    bbox = sub_font.getbbox(sub)
    sw = bbox[2] - bbox[0]
    sub_y = center_y + title_h + title_gap
    txd.text(((w - sw) // 2, sub_y), sub, fill=NEON_CYAN + (200,), font=sub_font)

    # Art deco divider
    div_y = sub_y + sub_h + div_gap
    line_w = int(w * 0.35)
    lx = (w - line_w) // 2
    dd_size = 4
    txd.line([(lx, div_y), (w // 2 - dd_size * 3, div_y)], fill=GOLD + (120,), width=1)
    txd.line([(w // 2 + dd_size * 3, div_y), (lx + line_w, div_y)], fill=GOLD + (120,), width=1)
    txd.polygon([(w // 2, div_y - dd_size), (w // 2 + dd_size, div_y),
                  (w // 2, div_y + dd_size), (w // 2 - dd_size, div_y)],
                 fill=GOLD + (140,))

    # Feature tags
    tags_y = div_y + tag_gap
    tags = "compile  \u00b7  simulate  \u00b7  flash  \u00b7  create"
    bbox = tag_font.getbbox(tags)
    ftw = bbox[2] - bbox[0]
    txd.text(((w - ftw) // 2, tags_y), tags, fill=PURPLE + (180,), font=tag_font)

    img = Image.alpha_composite(img, text_layer)

    # --- Layer 6: Accent bars ---
    bar_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bar_layer)
    for i in range(4):
        bd.line([(0, i), (w, i)], fill=PURPLE + (255 - i * 50,), width=1)
    for i in range(2):
        bd.line([(0, h - 1 - i), (w, h - 1 - i)], fill=GOLD + (80 - i * 30,), width=1)

    img = Image.alpha_composite(img, bar_layer)

    # --- Save ---
    final = Image.new("RGB", (w, h), BG)
    final.paste(img, mask=img.split()[3])
    path = os.path.join(OUT_DIR, filename)
    final.save(path, "PNG", optimize=True)
    print(f"Created {path} ({w}x{h})")


def make_icon(size, filename):
    """Apple touch icon: brand icon over code-glyph background."""
    img = Image.new("RGBA", (size, size), BG + (255,))
    draw = ImageDraw.Draw(img)
    brand = load_brand_icon()

    SCALE = 2.0

    try:
        micro = ImageFont.truetype("consola.ttf", max(10, int(8 * SCALE)))
    except Exception:
        micro = ImageFont.load_default()

    # Micro glyph background (scaled up)
    step = max(14, int(10 * SCALE))
    step_x = max(16, int(12 * SCALE))
    for y in range(-4, size + 4, step):
        off = step_x // 2 if (y // step) % 2 else 0
        for x in range(-4, size + 4, step_x):
            ch = random.choice(MICRO_GLYPHS)
            dx = (x - size / 2) / (size / 2)
            dy = (y - size / 2) / (size / 2)
            dist = math.sqrt(dx * dx + dy * dy)
            alpha = int(18 + 25 * min(dist, 1.0))
            r = random.random()
            c = PURPLE if r < 0.5 else NEON_CYAN if r < 0.7 else NEON_PINK if r < 0.85 else GOLD
            draw.text((x + off, y), ch, fill=c + (alpha,), font=micro)

    # CRT scanlines
    for y in range(0, size, 3):
        draw.line([(0, y), (size, y)], fill=(0, 0, 0, 15), width=1)

    # Brand icon centered, sized to ~65% of the icon
    icon_size = int(size * 0.65)
    icon_h = icon_size
    icon_w = int(brand.width * (icon_h / brand.height))
    brand_resized = brand.resize((icon_w, icon_h), Image.LANCZOS)
    ix = (size - icon_w) // 2
    iy = (size - icon_h) // 2

    # Purple glow behind brand icon
    for gpass in range(4):
        expand = 6 + gpass * 5
        gi = brand_resized.resize((icon_w + expand, icon_h + expand), Image.LANCZOS)
        purple_glow = Image.new("RGBA", gi.size, (0, 0, 0, 0))
        for px in range(gi.width):
            for py in range(gi.height):
                _, _, _, a = gi.getpixel((px, py))
                if a > 10:
                    ga = min(255, int(a * 0.18 / (gpass + 1)))
                    purple_glow.putpixel((px, py), PURPLE + (ga,))
        gx = ix - expand // 2
        gy = iy - expand // 2
        img.paste(Image.alpha_composite(
            Image.new("RGBA", img.size, (0, 0, 0, 0)).copy(),
            Image.new("RGBA", img.size, (0, 0, 0, 0))
        ), (0, 0))
        # Simpler: just composite the glow onto img directly
        glow_full = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow_full.paste(purple_glow, (gx, gy), purple_glow)
        img = Image.alpha_composite(img, glow_full)

    # Paste brand icon
    img.paste(brand_resized, (ix, iy), brand_resized)

    # Top bar
    draw2 = ImageDraw.Draw(img)
    for i in range(3):
        draw2.line([(0, i), (size, i)], fill=PURPLE + (200 - i * 50,), width=1)
    draw2.rectangle([0, 0, size - 1, size - 1], outline=PURPLE + (60,), width=1)

    final = Image.new("RGB", (size, size), BG)
    final.paste(img, mask=img.split()[3])
    path = os.path.join(OUT_DIR, filename)
    final.save(path, "PNG", optimize=True)
    print(f"Created {path} ({size}x{size})")


# --- Generate all ---
make_card(1200, 630, "social-card-og.png")
make_card(1200, 600, "social-card-tw.png")
make_card(400, 400, "social-card-square.png")
make_icon(180, "apple-touch-icon.png")

print("\nDone!")
