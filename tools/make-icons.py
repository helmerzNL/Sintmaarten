from PIL import Image, ImageDraw, ImageFilter
import math

def lantern(size, maskable=False):
    S = 1024
    bg = (31, 111, 74, 255)
    im = Image.new('RGBA', (S, S), bg if maskable else (0, 0, 0, 0))
    if not maskable:
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, S, S), radius=int(S * 0.22), fill=255)
        base = Image.new('RGBA', (S, S), bg)
        im.paste(base, (0, 0), m)
    k = 0.78 if maskable else 1.0
    cx, cy = S / 2, S * 0.56
    def P(x, y):  # schaal rond het midden
        return (S / 2 + (x - S / 2) * k, S / 2 + (y - S / 2) * k)
    def box(x0, y0, x1, y1):
        a, b = P(x0, y0); c, d = P(x1, y1); return (a, b, c, d)

    # gloed
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(box(cx - 400, cy - 400, cx + 400, cy + 400), fill=(255, 214, 90, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    im = Image.alpha_composite(im, glow)
    d = ImageDraw.Draw(im)

    rx, ry = 215, 245
    # lichaam met verloop (geel midden -> oranje rand)
    steps = 40
    for i in range(steps):
        t = i / (steps - 1)
        r = 1 - t
        col = (int(255), int(150 + 90 * t), int(30 + 90 * t * t), 255)
        d.ellipse(box(cx - rx * r, cy - ry * r, cx + rx * r, cy + ry * r), fill=col)
    # randlijn
    d.ellipse(box(cx - rx, cy - ry, cx + rx, cy + ry), outline=(176, 84, 14, 255), width=int(12 * k))
    # ribben
    for f in (0.62, 0.3):
        d.ellipse(box(cx - rx * f, cy - ry, cx + rx * f, cy + ry), outline=(190, 92, 16, 255), width=int(8 * k))
    d.line([P(cx, cy - ry), P(cx, cy + ry)], fill=(190, 92, 16, 255), width=int(8 * k))
    # dwarsband
    for yy in (cy - ry * 0.45, cy + ry * 0.45):
        w = rx * math.sqrt(1 - ((yy - cy) / ry) ** 2)
        d.line([P(cx - w, yy), P(cx + w, yy)], fill=(176, 84, 14, 255), width=int(8 * k))
    # kappen
    cap = (92, 52, 28, 255)
    d.rounded_rectangle(box(cx - 110, cy - ry - 40, cx + 110, cy - ry + 28), radius=int(26 * k), fill=cap)
    d.rounded_rectangle(box(cx - 90, cy + ry - 24, cx + 90, cy + ry + 36), radius=int(26 * k), fill=cap)
    # draagstok met haak
    stick = (255, 255, 255, 255)
    top = cy - ry - 40
    d.line([P(cx, top), P(cx, 170)], fill=stick, width=int(26 * k))
    d.arc(box(cx - 6, 110, cx + 190, 250), 180, 360 + 40, fill=stick, width=int(26 * k))
    # sterretje (Sint Maarten-licht)
    for dx, dy, r in ((cx - 300, 250, 22), (cx + 310, 330, 16), (cx + 250, 190, 12)):
        px, py = P(dx, dy)
        d.polygon([(px, py - r * 1.6), (px + r * .4, py - r * .4), (px + r * 1.6, py), (px + r * .4, py + r * .4),
                   (px, py + r * 1.6), (px - r * .4, py + r * .4), (px - r * 1.6, py), (px - r * .4, py - r * .4)],
                  fill=(255, 236, 160, 255))
    return im.resize((size, size), Image.LANCZOS)

if __name__ == '__main__':
    out = 'public/icons/'
    lantern(192).save(out + 'icon-192.png')
    lantern(512).save(out + 'icon-512.png')
    lantern(512, True).save(out + 'maskable-512.png')
    lantern(180).save(out + 'apple-touch-icon.png')
    lantern(32).save(out + 'favicon-32.png')
