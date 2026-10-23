#!/usr/bin/env python3
"""Generate the Rezekme Stays / Rezekme Rides app icons, splash screens and store graphics.

Source artwork: the Rezekme mark used on rezekme.com (apps/rezekme-landing/index.html, 120x120 SVG):
an "R" in white on #14261f with two coral (#e07a52) wheels. Rides uses that mark as is; Stays
replaces the wheels with a coral roof over the R (same R, same colours, navy #0a0f1d background).
These are placeholders good enough for store review; a designer can replace them later (same file
names/sizes) and the apps pick them up on the next build.

Needs Pillow (python3 -m pip install pillow). Run from the repo root:  python3 scripts/rezekme-icons.py
Writes into native/rezekme-*/android, native/rezekme-*/ios and docs/store-assets/rezekme/.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHITE = (255, 255, 255, 255)
CORAL = (224, 122, 82, 255)
HUB = (20, 38, 31, 255)  # wheel hub, the logo's dark green
SS = 4  # supersampling factor

APPS = {
    'rezekme-stay': {'bg': (10, 15, 29, 255), 'kind': 'stay', 'title': 'Rezekme Stays', 'tag_en': 'Book stays. Host your place.', 'tag_ar': ''},
    'rezekme-rides': {'bg': (20, 38, 31, 255), 'kind': 'rides', 'title': 'Rezekme Rides', 'tag_en': 'Rides by card. Safe and simple.', 'tag_ar': ''},
}


def hexrgb(c):
    return '#%02x%02x%02x' % c[:3]


def r_path(dy=0.0):
    """The R stroke as polylines in the 120-unit design space."""
    arc = [(62 + 16 * math.cos(t), 40 + dy + 16 * math.sin(t)) for t in [(-math.pi / 2) + i * math.pi / 40 for i in range(41)]]
    stem = [(40, 82 + dy), (40, 24 + dy), (62, 24 + dy)] + arc[1:] + [(40, 56 + dy)]
    leg = [(62, 56 + dy), (82, 82 + dy)]
    return [stem, leg]


def draw_mark(img, kind, box_x, box_y, box_size):
    """Draw the mark (no background) inside a box_size square (120-unit design space) at box_x, box_y."""
    d = ImageDraw.Draw(img)
    k = box_size / 120.0
    P = lambda x, y: (box_x + x * k, box_y + y * k)
    w = 9 * k

    def poly(points, color):
        pts = [P(x, y) for x, y in points]
        # Segment by segment with a round dot on every vertex: clean round joins and caps.
        for a, b in zip(pts, pts[1:]):
            d.line([a, b], fill=color, width=max(1, round(w)))
        for x, y in pts:
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)

    if kind == 'rides':
        for line in r_path(0):
            poly(line, WHITE)
        for cx in (44, 82):
            x, y = P(cx, 96)
            d.ellipse([x - 9 * k, y - 9 * k, x + 9 * k, y + 9 * k], fill=CORAL)
            d.ellipse([x - 3.5 * k, y - 3.5 * k, x + 3.5 * k, y + 3.5 * k], fill=HUB)
    else:
        poly([(26, 40), (60, 16), (94, 40)], CORAL)
        for line in r_path(18):
            poly(line, WHITE)


def render(size, bg, kind, radius=0.0, mark_scale=1.0, transparent=False, circle=False):
    """Square image: background (optionally rounded / circle) with the mark centred."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not transparent:
        if circle:
            d.ellipse([0, 0, big - 1, big - 1], fill=bg)
        elif radius:
            d.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius * big, fill=bg)
        else:
            d.rectangle([0, 0, big, big], fill=bg)
    box = big * mark_scale
    draw_mark(img, kind, (big - box) / 2, (big - box) / 2, box)
    return img.resize((size, size), Image.LANCZOS)


def splash(wd, ht, bg, kind, mark_px):
    big_w, big_h = wd * 2, ht * 2
    img = Image.new('RGBA', (big_w, big_h), bg)
    box = mark_px * 2
    draw_mark(img, kind, (big_w - box) / 2, (big_h - box) / 2, box)
    return img.resize((wd, ht), Image.LANCZOS).convert('RGB')


def save(img, path, rgb=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    (img.convert('RGB') if rgb else img).save(path, optimize=True)


def font(size):
    for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


for slug, app in APPS.items():
    bg, kind = app['bg'], app['kind']
    res = os.path.join(ROOT, 'native', slug, 'android', 'app', 'src', 'main', 'res')
    # Android launcher icons (legacy square + round) and adaptive-icon foreground (108dp canvas,
    # mark inside the 66dp safe zone).
    for dens, px in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        save(render(px, bg, kind, radius=0.22, mark_scale=0.78), f'{res}/mipmap-{dens}/ic_launcher.png')
        save(render(px, bg, kind, circle=True, mark_scale=0.70), f'{res}/mipmap-{dens}/ic_launcher_round.png')
        fg = int(px * 108 / 48)
        save(render(fg, bg, kind, transparent=True, mark_scale=0.62), f'{res}/mipmap-{dens}/ic_launcher_foreground.png')
    # Android splash (pre-Android-12 devices; 12+ show the launcher icon on the splash colour).
    for name, (wd, ht) in {
        'drawable': (480, 320),
        'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480), 'drawable-land-xhdpi': (1280, 720),
        'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
        'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
        'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920),
    }.items():
        save(splash(wd, ht, bg, kind, int(min(wd, ht) * 0.35)), f'{res}/{name}/splash.png')
    # iOS: one 1024 icon (no transparency, no rounded corners: iOS applies the mask) + splash.
    ios = os.path.join(ROOT, 'native', slug, 'ios', 'App', 'App', 'Assets.xcassets')
    save(render(1024, bg, kind, mark_scale=0.78), f'{ios}/AppIcon.appiconset/AppIcon-512@2x.png', rgb=True)
    sp = splash(2732, 2732, bg, kind, 640)
    for n in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
        save(sp, f'{ios}/Splash.imageset/{n}')
    # Store graphics: Play icon 512 (full square, Google masks it), Play feature graphic 1024x500,
    # and a 1024 master for App Store Connect.
    out = os.path.join(ROOT, 'docs', 'store-assets', 'rezekme')
    save(render(512, bg, kind, mark_scale=0.78), f'{out}/{slug}-play-icon-512.png', rgb=True)
    save(render(1024, bg, kind, mark_scale=0.78), f'{out}/{slug}-icon-1024.png', rgb=True)
    fgx = Image.new('RGBA', (2048, 1000), bg)
    draw_mark(fgx, kind, 140, 220, 560)
    d = ImageDraw.Draw(fgx)
    d.text((780, 360), app['title'], font=font(132), fill=WHITE)
    d.text((786, 540), app['tag_en'], font=font(64), fill=CORAL)
    save(fgx.resize((1024, 500), Image.LANCZOS), f'{out}/{slug}-play-feature-1024x500.png', rgb=True)
    print(f'{slug}: icons, splash and store graphics written ({hexrgb(bg)})')
