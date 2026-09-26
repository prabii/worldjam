"""
Builds the Round 1 deck as offline files: docs/WorldJam-Round1.html and
docs/WorldJam-Round1.pdf.

Source of truth is docs/round1/ (deck.json + one <section> per slide, the same
files as the online deck). This script:

  * swaps the online image blobs for the local design images in docs/deck/,
  * inlines the images and the two Google fonts as data URIs, so the files
    render identically with no network (headless Chrome does not wait for a
    Google Fonts <link> before printing, so linked fonts silently substitute),
  * replaces the deck-only <x-shape kind="arrow-right"> with a plain SVG arrow,
  * drops speaker notes (<aside>) from the slides,
  * prints to PDF with @page sized in inches: Chrome treats px in @page as
    points, which would shrink a 1920px slide to 1440x810.

Run:  python docs/build_round1_deck.py
"""

import base64
import json
import os
import re
import subprocess
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'round1')
OUT_HTML = os.path.join(ROOT, 'WorldJam-Round1.html')
OUT_PDF = os.path.join(ROOT, 'WorldJam-Round1.pdf')

BLOBS = {
    '/_blob/0ccb358667c14197ebf1a3fa25cae351': 'deck/splash.jpg',
    '/_blob/63e802c5e516cab4270424d020479336': 'deck/scan1.jpg',
    '/_blob/1838bc829fc32b2e4fd48d3fe7331336': 'deck/arrange.jpg',
}

BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
]

# A desktop Chrome UA makes Google Fonts answer with woff2.
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')


def data_uri(path: str, mime: str) -> str:
    with open(path, 'rb') as fh:
        return f'data:{mime};base64,' + base64.b64encode(fh.read()).decode()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def inline_fonts(faces: dict) -> str:
    """Google Fonts CSS with every woff2 url replaced by a data URI (latin only)."""
    rules = []
    for face in faces.values():
        css = fetch(face['href']).decode()
        # Keep the latin blocks; the deck is English and this keeps the file small.
        for block in re.findall(r'/\* latin \*/\s*(@font-face\s*{[^}]+})', css):
            def repl(m):
                woff = fetch(m.group(1))
                return 'url(data:font/woff2;base64,' + base64.b64encode(woff).decode() + ')'
            rules.append(re.sub(r'url\((https://[^)]+\.woff2)\)', repl, block))
    return '\n'.join(rules)


ARROW = re.compile(
    r'<x-shape kind="arrow-right" style="width:(\d+)px; height:(\d+)px; background:(#[0-9A-Fa-f]{6})"></x-shape>')


def arrow_svg(m) -> str:
    w, h, c = int(m.group(1)), int(m.group(2)), m.group(3)
    # Same geometry as the deck's block arrow: shaft, then a head on the last 40%.
    head = w * 0.4
    shaft_top, shaft_bot = h * 0.3, h * 0.7
    pts = f'0,{shaft_top} {w - head},{shaft_top} {w - head},0 {w},{h / 2} {w - head},{h} {w - head},{shaft_bot} 0,{shaft_bot}'
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" style="flex:none" aria-hidden="true">'
            f'<polygon points="{pts}" fill="{c}"/></svg>')


def load_slides(order: list) -> list:
    images = {k: data_uri(os.path.join(ROOT, v), 'image/jpeg') for k, v in BLOBS.items()}
    out = []
    for sid in order:
        with open(os.path.join(SRC, 'slides', f'{sid}.html'), encoding='utf-8') as fh:
            html = fh.read()
        html = re.sub(r'<aside>.*?</aside>', '', html, flags=re.S)
        html = ARROW.sub(arrow_svg, html)
        for blob, uri in images.items():
            html = html.replace(blob, uri)
        out.append(html.strip())
    return out


PAGE_CSS = """
@page { size: 20in 11.25in; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #05060A }
section {
  position: relative; width: 1920px; height: 1080px; overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
section * { margin: 0 }
section h1, section h2, section h3 { font-weight: 600 }
section table { border-collapse: collapse; width: 100% }
section th, section td { padding: 0.45em 0.6em; border-bottom: 1px solid #2C3454; vertical-align: top }
section th { color: #8F8CA8; font-weight: 700; border-bottom: 2px solid #4A5275 }
section img { display: block }
.frame { width: 1920px; height: 1080px; overflow: hidden; page-break-after: always; break-after: page }

@media screen {
  body { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 0 }
  .frame { width: calc(1920px * var(--s, 0.5)); height: calc(1080px * var(--s, 0.5));
           border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,.5) }
  .frame > section { transform: scale(var(--s, 0.5)); transform-origin: top left }
}
"""

FIT_JS = """
function fit(){var s=Math.min((window.innerWidth-48)/1920,1);
document.documentElement.style.setProperty('--s',s)}
window.addEventListener('resize',fit);fit();
"""


def build_html() -> str:
    with open(os.path.join(SRC, 'deck.json'), encoding='utf-8') as fh:
        deck = json.load(fh)
    fonts = inline_fonts(deck['faces'])
    slides = load_slides(deck['order'])
    frames = '\n'.join(f'<div class="frame">{s}</div>' for s in slides)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<title>{deck["title"]}</title>'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<style>{fonts}\n{PAGE_CSS}</style></head>'
        f'<body>{frames}<script>{FIT_JS}</script></body></html>'
    )


def print_pdf(html_path: str, pdf_path: str) -> None:
    browser = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not browser:
        raise SystemExit('No Chrome or Edge found to print the PDF.')
    subprocess.run([
        browser, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw', '--virtual-time-budget=10000',
        f'--print-to-pdf={pdf_path}', 'file:///' + html_path.replace('\\', '/'),
    ], check=True, capture_output=True, timeout=180)


def main() -> None:
    html = build_html()
    with open(OUT_HTML, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print(f'HTML: {OUT_HTML} ({os.path.getsize(OUT_HTML) // 1024} KB)')
    print_pdf(OUT_HTML, OUT_PDF)
    print(f'PDF:  {OUT_PDF} ({os.path.getsize(OUT_PDF) // 1024} KB)')


if __name__ == '__main__':
    main()
