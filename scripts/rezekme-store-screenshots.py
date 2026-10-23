#!/usr/bin/env python3
"""Draft store screenshots of Rezekme Stays / Rides from the live websites (read-only page loads).

Sizes: 1290x2796 (Apple 6.9" iPhone, the one size App Store Connect requires for an iPhone-only app)
and 1080x1920 (Google Play phone). Arabic and English. Output: store-screenshots/ (git-ignored).
Needs Python Playwright + Chromium:  python3 -m pip install playwright && python3 -m playwright install chromium
Run:  python3 scripts/rezekme-store-screenshots.py [out_dir]
Remove test listings from the live site first: reviewers reject screenshots showing test/placeholder data.
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'store-screenshots'
PAGES = [
    ('stay', 'home', 'https://stay.rezekme.com/?lang={l}#/'),
    ('stay', 'search', 'https://stay.rezekme.com/?lang={l}#/stays'),
    ('rides', 'home', 'https://rides.rezekme.com/?lang={l}#/ride'),
    ('rides', 'signin', 'https://rides.rezekme.com/?lang={l}#/account/open'),
]
SIZES = {'apple-6.9in-1290x2796': (430, 932), 'play-phone-1080x1920': (360, 640)}


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for size, (w, h) in SIZES.items():
            for lang in ('ar', 'en'):
                ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=3, is_mobile=True, has_touch=True, locale=lang)
                page = await ctx.new_page()
                for app, name, url in PAGES:
                    try:
                        await page.goto(url.format(l=lang), wait_until='networkidle', timeout=60000)
                    except Exception as e:  # slow API cold start: still take the picture
                        print('warning', app, name, e)
                    await page.wait_for_timeout(2500)
                    path = os.path.join(OUT, f'{app}-{name}-{lang}-{size}.png')
                    await page.screenshot(path=path)
                    print(path)
                await ctx.close()
        await browser.close()

asyncio.run(main())
