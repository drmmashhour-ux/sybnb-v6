#!/usr/bin/env python3
"""Generate the Rezekme Stays / Rezekme Rides app icons, splash screens and store graphics.

Design (owner choice 2026-10-23, "option 2"): one bold monogram per app on a flat colour, in the
style of the big ride and stay apps. Stays: a white roof over a white R on coral #FF5A3C. Rides: a
white R whose leg turns into a coral forward arrow, on near-black #0E0E10. Same R in both apps.

Needs Pillow (python3 -m pip install pillow). Run from the repo root:  python3 scripts/rezekme-icons.py
Writes into native/rezekme-*/android, native/rezekme-*/ios and docs/store-assets/rezekme/.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHITE = (255, 255, 255, 255)
CORAL = (255, 90, 60, 255)
INK = (14, 14, 16, 255)
SS = 4  # supersampling factor

APPS = {
    'rezekme-stay': {'bg': CORAL, 'kind': 'stay', 'title': 'Rezekme Stays', 'tag_en': 'Book stays. Host your place.', 'tag_ar': ''},
    'rezekme-rides': {'bg': INK, 'kind': 'rides', 'title': 'Rezekme Rides', 'tag_en': 'Upfront fares. Approved drivers.', 'tag_ar': ''},
}


def hexrgb(c):
    return '#%02x%02x%02x' % c[:3]


MARKS = os.path.join(ROOT, 'scripts', 'rezekme-marks')


def draw_mark(img, kind, box_x, box_y, box_size):
    """Paste the mark inside a box_size square at box_x, box_y.

    The marks are drawn in scripts/rezekme-marks/{stay,rides}.svg on a 512 square that stands for the
    whole visible icon; {kind}-mark-2048.png is that SVG rendered by Chromium (transparent).
    Re-render the PNGs after editing an SVG (see scripts/rezekme-marks/README)."""
    mark = Image.open(os.path.join(MARKS, f'{kind}-mark-2048.png')).convert('RGBA')
    size = max(1, round(box_size))
    mark = mark.resize((size, size), Image.LANCZOS)
    img.alpha_composite(mark, (round(box_x), round(box_y)))


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
    for f in ('/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


for slug, app in APPS.items():
    bg, kind = app['bg'], app['kind']
    res = os.path.join(ROOT, 'native', slug, 'android', 'app', 'src', 'main', 'res')
    # Android launcher icons (legacy square + round) and adaptive-icon foreground (108dp canvas,
    # mark inside the 66dp safe zone).
    for dens, px in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        save(render(px, bg, kind, radius=0.22, mark_scale=1.0), f'{res}/mipmap-{dens}/ic_launcher.png')
        save(render(px, bg, kind, circle=True, mark_scale=0.92), f'{res}/mipmap-{dens}/ic_launcher_round.png')
        fg = int(px * 108 / 48)
        save(render(fg, bg, kind, transparent=True, mark_scale=0.667), f'{res}/mipmap-{dens}/ic_launcher_foreground.png')
    with open(f'{res}/values/ic_launcher_background.xml', 'w') as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' % hexrgb(bg))
    # Android splash (pre-Android-12 devices; 12+ show the launcher icon on the splash colour).
    for name, (wd, ht) in {
        'drawable': (480, 320),
        'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480), 'drawable-land-xhdpi': (1280, 720),
        'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
        'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
        'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920),
    }.items():
        save(splash(wd, ht, bg, kind, int(min(wd, ht) * 0.6)), f'{res}/{name}/splash.png')
    # iOS: one 1024 icon (no transparency, no rounded corners: iOS applies the mask) + splash.
    ios = os.path.join(ROOT, 'native', slug, 'ios', 'App', 'App', 'Assets.xcassets')
    save(render(1024, bg, kind, mark_scale=1.0), f'{ios}/AppIcon.appiconset/AppIcon-512@2x.png', rgb=True)
    sp = splash(2732, 2732, bg, kind, 1100)
    for n in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
        save(sp, f'{ios}/Splash.imageset/{n}')
    # Store graphics: Play icon 512 (full square, Google masks it), Play feature graphic 1024x500,
    # and a 1024 master for App Store Connect.
    out = os.path.join(ROOT, 'docs', 'store-assets', 'rezekme')
    save(render(512, bg, kind, mark_scale=1.0), f'{out}/{slug}-play-icon-512.png', rgb=True)
    save(render(1024, bg, kind, mark_scale=1.0), f'{out}/{slug}-icon-1024.png', rgb=True)
    fgx = Image.new('RGBA', (2048, 1000), bg)
    draw_mark(fgx, kind, 60, 100, 800)
    d = ImageDraw.Draw(fgx)
    d.text((780, 360), app['title'], font=font(132), fill=WHITE)
    d.text((786, 540), app['tag_en'], font=font(64), fill=WHITE if kind == 'stay' else CORAL)
    save(fgx.resize((1024, 500), Image.LANCZOS), f'{out}/{slug}-play-feature-1024x500.png', rgb=True)
    print(f'{slug}: icons, splash and store graphics written ({hexrgb(bg)})')
