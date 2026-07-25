#!/usr/bin/env python3
"""
Gera todos os assets visuais do site a partir de UMA imagem: assets/avatar.jpg.

    python3 build-assets.py

O script recorta a marca, descobre sozinho a cor mais viva dela (a mesma
lógica que o site usa em tempo de execução) e produz ícones, favicons,
telas de abertura de iPhone e a imagem de compartilhamento já nessa cor.
Trocou o logo, rodou de novo, tudo acompanha.
"""
import colorsys, math, os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT   = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, "assets")
ICONS  = os.path.join(ROOT, "icons")
SPLASH = os.path.join(ROOT, "splash")
for d in (ASSETS, ICONS, SPLASH):
    os.makedirs(d, exist_ok=True)

SOURCE   = os.path.join(ASSETS, "avatar.jpg")
WORDMARK = "SUNN"
TAGLINE  = "Belo Horizonte · MG"

FONT_BOLD  = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_LIGHT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-ExtraLight.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def tracked_text(draw, xy, text, fnt, fill, tracking=0.0, center=True):
    widths = [draw.textlength(c, font=fnt) for c in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x, y = xy
    if center:
        x -= total / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += w + tracking
    return total


# ────────────────────────────────────────────────────────────────
# A MARCA — recortada do fundo preto e centralizada num quadrado
# ────────────────────────────────────────────────────────────────
def load_mark():
    """
    Recorta a marca do fundo preto preservando os vazados internos.

    O alfa sai da luminância (o fundo é preto), mas isso sozinho abriria
    também os miolos escuros do desenho — no logo do sol, o disco atrás
    do "S". Então o fundo é identificado por preenchimento a partir das
    bordas: o que é preto mas não se conecta à borda é miolo, e continua
    opaco. É o que faz o brilho contornar o sol em vez de vazar por dentro.
    """
    src = Image.open(SOURCE).convert("RGB")
    lum = src.convert("L")
    alpha = lum.point(lambda v: min(255, int(v * 1.9)))

    solid = alpha.point(lambda v: 255 if v > 14 else 0)
    outside = ImageChops.invert(solid).convert("L")
    ImageDraw.floodfill(outside, (0, 0), 0)          # apaga o fundo ligado à borda
    for corner in ((outside.width - 1, 0), (0, outside.height - 1),
                   (outside.width - 1, outside.height - 1)):
        if outside.getpixel(corner):
            ImageDraw.floodfill(outside, corner, 0)
    alpha = ImageChops.lighter(alpha, outside)       # o que sobrou são os miolos

    mark = src.copy()
    mark.putalpha(alpha)

    box = alpha.point(lambda v: 255 if v > 14 else 0).getbbox()
    if box:
        mark = mark.crop(box)

    side = max(mark.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    return square


def accent_from(mark):
    """Mesma heurística do site: vence o matiz de maior croma acumulado."""
    small = mark.resize((72, 72), Image.LANCZOS)
    bins = 36
    w  = [0.0] * bins
    xs = [0.0] * bins
    ys = [0.0] * bins
    ss = [0.0] * bins
    ls = [0.0] * bins

    for r, g, b, a in small.getdata():
        if a < 128:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < .16 or l < .08 or l > .95:
            continue
        weight = s * (1 - abs(l * 2 - 1) * .6)
        i = int(h * 360 // (360 / bins)) % bins
        rad = h * 2 * math.pi
        w[i]  += weight
        xs[i] += math.cos(rad) * weight
        ys[i] += math.sin(rad) * weight
        ss[i] += s * weight
        ls[i] += l * weight

    top = max(range(bins), key=lambda i: w[i])
    if w[top] < 3:
        return (250, 91, 0)                      # laranja de segurança

    X = Y = S = L = W = 0.0
    for k in (-1, 0, 1):
        i = (top + k) % bins
        X += xs[i]; Y += ys[i]; S += ss[i]; L += ls[i]; W += w[i]

    hue = (math.degrees(math.atan2(Y, X)) % 360) / 360
    sat = min(1, max(.55, S / W))
    lig = min(.64, max(.46, (L / W) * .85 + .12))
    r, g, b = colorsys.hls_to_rgb(hue, lig, sat)
    return (round(r * 255), round(g * 255), round(b * 255))


MARK   = load_mark()
ACCENT = accent_from(MARK)


def paste_mark(img, size, cx, cy, glow=0.0):
    """Aplica a marca de forma aditiva, com brilho opcional na cor dela."""
    m = MARK.resize((size, size), Image.LANCZOS)
    left, top = int(cx - size / 2), int(cy - size / 2)
    box = (left, top, left + size, top + size)

    if glow:
        # a silhueta é desenhada numa tela maior: sem essa folga, o brilho
        # seria cortado no quadro da marca e viraria um retângulo
        pad = int(size * .38)
        big = Image.new("L", (size + 2 * pad,) * 2, 0)
        big.paste(m.getchannel("A"), (pad, pad))
        halo = big.filter(ImageFilter.GaussianBlur(size * .075)).point(lambda v: int(v * glow))
        halo = ImageChops.subtract(halo, big)        # o brilho só escapa por fora
        gl, gt = int(cx - big.width / 2), int(cy - big.height / 2)
        gbox = (gl, gt, gl + big.width, gt + big.height)
        tinted = Image.composite(Image.new("RGB", big.size, ACCENT),
                                 Image.new("RGB", big.size, (0, 0, 0)), halo)
        img.paste(ImageChops.lighter(img.crop(gbox), tinted), gbox)

    flat = Image.new("RGB", m.size, (0, 0, 0))
    flat.paste(m, (0, 0), m)
    img.paste(ImageChops.lighter(img.crop(box), flat), box)


# ────────────────────────────────────────────────────────────────
# ONDAS de fundo, na cor da marca puxada para o branco
# ────────────────────────────────────────────────────────────────
BANDS = [
    dict(y=.520, amp=.055, ln=.95,  th=.10, a=.50, ph=0.0),
    dict(y=.552, amp=.041, ln=1.42, th=.08, a=.36, ph=2.1),
    dict(y=.488, amp=.070, ln=.64,  th=.13, a=.26, ph=4.0),
    dict(y=.660, amp=.052, ln=1.15, th=.17, a=.18, ph=1.2),
    dict(y=.382, amp=.046, ln=.84,  th=.15, a=.16, ph=5.3),
]


def mix_to_white(k):
    return tuple(round(c * k + 255 * (1 - k)) for c in ACCENT)


def wave_layer(w, h, blur=None, gain=1.0, shift=0.0, line_gain=1.0, span=1.0):
    soft  = Image.new("L", (w, h), 0)
    crisp = Image.new("L", (w, h), 0)
    for b in BANDS:
        top, bot = [], []
        for i in range(0, w + 8, 6):
            u = i / w * span
            off = b["amp"] * (
                math.sin(u / b["ln"] * math.tau + b["ph"]) * .62
                + math.sin(u / (b["ln"] * .46) * math.tau + b["ph"] * 1.7) * .24
                + math.sin(u / (b["ln"] * 2.35) * math.tau + b["ph"] * .55) * .31
            )
            y = (b["y"] + off + shift) * h
            top.append((i, y))
            bot.append((i, y + b["th"] * h))

        band = Image.new("L", (w, h), 0)
        ImageDraw.Draw(band).polygon(top + bot[::-1], fill=int(255 * b["a"] * gain))
        soft = ImageChops.add(soft, band)

        line = Image.new("L", (w, h), 0)
        ImageDraw.Draw(line).line(
            top, fill=min(255, int(255 * b["a"] * gain * line_gain)),
            width=max(1, int(h / 300)), joint="curve")
        crisp = ImageChops.add(crisp, line)

    soft  = soft.filter(ImageFilter.GaussianBlur(blur or h * .05))
    crisp = crisp.filter(ImageFilter.GaussianBlur(max(1.2, h * .006)))
    return soft, crisp


def paint_waves(img, gain=.26, line_gain=2.4, shift=0.0, blur=None, span=1.0, mask=None):
    w, h = img.size
    soft, crisp = wave_layer(w, h, blur=blur, gain=gain, shift=shift,
                             line_gain=line_gain, span=span)
    if mask is not None:
        soft  = ImageChops.multiply(soft, mask)
        crisp = ImageChops.multiply(crisp, mask)
    img.paste(Image.composite(Image.new("RGB", (w, h), mix_to_white(.30)), img, soft),  (0, 0))
    img.paste(Image.composite(Image.new("RGB", (w, h), mix_to_white(.52)), img, crisp), (0, 0))


def radial_mask(w, h, cx=.5, cy=.54, rx=1.25, ry=.96, inner=.26, outer=.88):
    m = Image.new("L", (w, h), 0)
    px = m.load()
    for y in range(h):
        dy = ((y / h) - cy) / ry
        for x in range(w):
            dx = ((x / w) - cx) / rx
            t = math.sqrt(dx * dx + dy * dy) * 2
            if t <= inner:
                v = 255
            elif t >= outer:
                v = 0
            else:
                v = int(255 * (1 - (t - inner) / (outer - inner)) ** 1.6)
            px[x, y] = v
    return m


# ────────────────────────────────────────────────────────────────
# 1. ÍCONES E FAVICONS
# ────────────────────────────────────────────────────────────────
def icon(size, coverage=.80, glow=.5):
    img = Image.new("RGB", (size, size), (0, 0, 0))
    paste_mark(img, int(size * coverage), size / 2, size / 2, glow=glow)
    return img


def build_icons():
    icon(512).save(os.path.join(ICONS, "icon-512.png"), optimize=True)
    icon(192).save(os.path.join(ICONS, "icon-192.png"), optimize=True)
    icon(180).save(os.path.join(ICONS, "apple-touch-icon.png"), optimize=True)
    icon(512, coverage=.60).save(os.path.join(ICONS, "icon-maskable-512.png"), optimize=True)
    icon(32, glow=0).save(os.path.join(ICONS, "favicon-32.png"), optimize=True)
    icon(16, glow=0).save(os.path.join(ICONS, "favicon-16.png"), optimize=True)
    icon(64, glow=0).save(os.path.join(ICONS, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])

    # favicon vetorial: moldura SVG com a marca embutida, nítida em qualquer tela
    import base64, io
    buf = io.BytesIO()
    MARK.resize((128, 128), Image.LANCZOS).save(buf, "PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    with open(os.path.join(ICONS, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            'viewBox="0 0 64 64">\n'
            '  <rect width="64" height="64" rx="14" fill="#000"/>\n'
            f'  <image x="6" y="6" width="52" height="52" xlink:href="data:image/png;base64,{b64}"/>\n'
            '</svg>\n'
        )


# ────────────────────────────────────────────────────────────────
# 2. SPLASH SCREENS iOS
# ────────────────────────────────────────────────────────────────
DEVICES = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3),
    (375, 812, 3), (414, 896, 2), (414, 896, 3),
    (390, 844, 3), (428, 926, 3), (393, 852, 3),
    (430, 932, 3), (402, 874, 3), (440, 956, 3),
]


def build_splash():
    tags = []
    for cw, ch, dpr in DEVICES:
        w, h = cw * dpr, ch * dpr
        img = Image.new("RGB", (w, h), (0, 0, 0))
        paint_waves(img, gain=.26, line_gain=2.2, blur=h * .045,
                    span=max(.7, min(2.7, cw / 760)), mask=radial_mask(w, h))

        m = int(min(w, h) * .30)
        paste_mark(img, m, w / 2, h * .5 - m * .26, glow=.55)

        d = ImageDraw.Draw(img)
        size = max(16, int(min(w, h) * .066))
        tracked_text(d, (w / 2, h * .5 + m * .34), WORDMARK, font(FONT_BOLD, size),
                     (255, 255, 255), tracking=-size * .04)

        name = f"splash-{w}x{h}.png"
        img.save(os.path.join(SPLASH, name), optimize=True)
        tags.append(
            f'<link rel="apple-touch-startup-image" href="./splash/{name}" '
            f'media="(device-width: {cw}px) and (device-height: {ch}px) and '
            f'(-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)">'
        )
    return tags


# ────────────────────────────────────────────────────────────────
# 3. OPEN GRAPH 1200×630
# ────────────────────────────────────────────────────────────────
def build_og():
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), (0, 0, 0))
    paint_waves(img, gain=.26, line_gain=2.6, shift=.20, blur=46, span=1.6,
                mask=radial_mask(w, h, cy=.66, rx=1.2, ry=1.0, outer=.95))

    paste_mark(img, 176, w / 2, h * .29, glow=.6)

    d = ImageDraw.Draw(img)
    tracked_text(d, (w / 2, h * .49), WORDMARK, font(FONT_BOLD, 104),
                 (255, 255, 255), tracking=-4)
    tracked_text(d, (w / 2, h * .755), TAGLINE, font(FONT_LIGHT, 26),
                 (152, 152, 156), tracking=3)

    img.save(os.path.join(ASSETS, "og.png"), optimize=True)


def build_mark_png():
    """Versão recortada da marca, é ela que a página usa."""
    MARK.resize((720, 720), Image.LANCZOS).save(
        os.path.join(ASSETS, "mark.png"), optimize=True)


if __name__ == "__main__":
    print(f"  cor detectada: #{ACCENT[0]:02x}{ACCENT[1]:02x}{ACCENT[2]:02x}")
    print("marca…");   build_mark_png()
    print("ícones…");  build_icons()
    print("og…");      build_og()
    print("splash…");  tags = build_splash()
    with open(os.path.join(ROOT, "splash-tags.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(tags) + "\n")
    print("pronto ✓")
