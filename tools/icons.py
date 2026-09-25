#!/usr/bin/env python3
"""SOTE — Favicon und App-Icons, aus dem Signet im Code erzeugt.

    pip install cairosvg pillow
    python3 tools/icons.py                 # -> packages/web/public/
    SOTE_ICONS_OUT=/tmp/x python3 tools/icons.py

Der Punkt dieser Datei ist, dass sie nichts nachzeichnet. Geometrie und Farben
werden aus `packages/web/src/components/Logo.tsx` und `packages/web/src/
styles.css` gelesen; ändert sich das Signet, wird neu erzeugt.

Warum es sie gibt: die Icons waren von Hand gebaut und dreizeilig, während die
Oberfläche vier Zeilen zeichnet — und niemandem fällt das auf, weil ein Favicon
genau dort erscheint, wo nichts danebensteht, mit dem man es vergleichen könnte.
Vier Zeilen in jeder Größe, heller Grund wie in SONE (dort ADR-0201).
"""
import io
import os
import re

import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("SOTE_ICONS_OUT") or os.path.join(ROOT, "packages/web/public")

LOGO = os.path.join(ROOT, "packages/web/src/components/Logo.tsx")
STYLES = os.path.join(ROOT, "packages/web/src/styles.css")


def mark():
    """Zeilen, Punktbreite, Abstand und rechte Kante, aus Logo.tsx."""
    src = open(LOGO).read()
    block = re.search(r"MARK_ROWS[^=]*=\s*\[(.*?)\];", src, re.S)
    rows = [(int(a), int(b)) for a, b in re.findall(r"\[(\d+),\s*(\d+)\]", block.group(1))]

    def const(name):
        return int(re.search(rf"export const {name} = (\d+);", src).group(1))

    return rows, const("MARK_DOT"), const("MARK_GAP"), const("MARK_RIGHT"), const("MARK_ACCENT_ROW")


def colour(token):
    src = open(STYLES).read()
    return re.search(rf"--{token}:\s*(#[0-9a-f]{{6}})", src).group(1)


ROWS, DOT, GAP, RIGHT, ACCENT_ROW = mark()
INK = colour("ink-900")
PAPER = colour("paper")
ACCENT = colour("accent-500")

# Der Tuschekasten des Signets: links die erste Spalte, rechts MARK_RIGHT,
# oben die erste Zeile, unten die letzte plus ihre Höhe.
BOX = (min(x for x, _ in ROWS), ROWS[0][1], RIGHT, ROWS[-1][1] + DOT)


def tile(size=100, inset=0.14, bg=None, bar=None, acc=None):
    bg, bar, acc = bg or PAPER, bar or INK, acc or ACCENT
    x0, y0, x1, y1 = BOX
    mw, mh = x1 - x0, y1 - y0
    avail = size * (1 - 2 * inset)
    s = min(avail / mw, avail / mh)
    dx, dy = (size - mw * s) / 2, (size - mh * s) / 2

    def rect(x, y, w, h, fill):
        return (
            f'  <rect x="{(x - x0) * s + dx:.4g}" y="{(y - y0) * s + dy:.4g}" '
            f'width="{w * s:.4g}" height="{h * s:.4g}" fill="{fill}"/>'
        )

    parts = [f'  <rect width="{size}" height="{size}" fill="{bg}"/>']
    for i, (x, y) in enumerate(ROWS):
        fill = acc if i == ACCENT_ROW else bar
        parts.append(rect(x, y, DOT, DOT, fill))
        line_x = x + DOT + GAP
        parts.append(rect(line_x, y, RIGHT - line_x, DOT, fill))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" role="img" aria-label="SOTE">\n'
        f'  <title>SOTE</title>\n' + "\n".join(parts) + "\n</svg>\n"
    )


def png(svg, size):
    return cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)

    face = tile()
    open(os.path.join(OUT, "favicon.svg"), "w").write(face)

    for name, size in (("apple-touch-icon", 180), ("icon-192", 192), ("icon-512", 512)):
        open(os.path.join(OUT, f"{name}.png"), "wb").write(png(face, size))

    # Maskierbar: das Signet im 80-%-Sicherheitskreis, damit ein runder oder
    # abgerundeter Zuschnitt keine Zeile abschneidet.
    safe = tile(inset=0.26)
    for size in (192, 512):
        open(os.path.join(OUT, f"icon-maskable-{size}.png"), "wb").write(png(safe, size))

    ims = [Image.open(io.BytesIO(png(face, s))).convert("RGBA") for s in (16, 32, 48)]
    ims[0].save(
        os.path.join(OUT, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=ims[1:],
    )

    print(f"icons -> {OUT}: favicon.svg, favicon.ico, 3 png, 2 maskable")
