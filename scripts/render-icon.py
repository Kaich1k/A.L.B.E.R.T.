#!/usr/bin/env python3
"""Render a clean flat baby-blue Electron-style atom icon (no letter) to resources/icon-source.png."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'resources' / 'icon-source.png'
SIZE = 1024
ACCENT = (137, 207, 240)  # baby blue #89CFF0
BLACK = (0, 0, 0)


def write_png_rgba(path: Path, width: int, height: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def squircle_cover(nx: float, ny: float, n: float = 5.0) -> float:
    v = abs(nx) ** n + abs(ny) ** n
    edge, band = 1.0, 1.6 / (SIZE / 2)
    if v <= edge - band:
        return 1.0
    if v >= edge + band:
        return 0.0
    t = (edge + band - v) / (2 * band)
    return t * t * (3 - 2 * t)


def rotate(x: float, y: float, deg: float) -> tuple[float, float]:
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return x * c - y * s, x * s + y * c


def ellipse_dist(px: float, py: float, rx: float, ry: float, rot: float) -> float:
    """Approx signed distance to ellipse path (0 on the stroke centerline)."""
    x, y = rotate(px, py, -rot)
    rx = max(rx, 1e-3)
    ry = max(ry, 1e-3)
    q = math.hypot(x / rx, y / ry)
    if q < 1e-6:
        return -min(rx, ry)
    # Ray length from center to this pixel, scaled by normalized ellipse radius
    r_pixel = math.hypot(x, y)
    r_edge = r_pixel / q
    return r_pixel - r_edge


def stroke_aa(dist: float, half: float = 7.0) -> float:
    # Soft AA band ~1.5px
    d = abs(dist)
    aa = 1.5
    if d <= half - aa:
        return 1.0
    if d >= half + aa:
        return 0.0
    t = (half + aa - d) / (2 * aa)
    return t * t * (3 - 2 * t)


def disc_aa(px: float, py: float, cx: float, cy: float, r: float) -> float:
    d = math.hypot(px - cx, py - cy) - r
    aa = 1.5
    if d <= -aa:
        return 1.0
    if d >= aa:
        return 0.0
    t = (aa - d) / (2 * aa)
    return t * t * (3 - 2 * t)


def blend(dst: list[int], r: int, g: int, b: int, a: float) -> None:
    if a <= 0:
        return
    if a >= 1:
        dst[0], dst[1], dst[2], dst[3] = r, g, b, 255
        return
    oa = dst[3] / 255.0
    na = a + oa * (1 - a)
    if na <= 0:
        return
    dst[0] = int(round((r * a + dst[0] * oa * (1 - a)) / na))
    dst[1] = int(round((g * a + dst[1] * oa * (1 - a)) / na))
    dst[2] = int(round((b * a + dst[2] * oa * (1 - a)) / na))
    dst[3] = int(round(na * 255))


def sample_pixel(
    x: float,
    y: float,
    cx: float,
    cy: float,
    orbits: list[tuple[float, float, float]],
    electron_pts: list[tuple[float, float]],
    nucleus_r: float,
    stroke_half: float,
    electron_r: float,
) -> tuple[int, int, int, int]:
    inset = 0.04
    nx = ((x / SIZE) * 2 - 1) / (1 - inset)
    ny = ((y / SIZE) * 2 - 1) / (1 - inset)
    cover = squircle_cover(nx, ny)
    if cover <= 0:
        return (0, 0, 0, 0)

    pix = [0, 0, 0, 0]
    blend(pix, *BLACK, cover)

    px = x - cx
    py = y - cy
    accent_a = 0.0
    for rx, ry, rot in orbits:
        accent_a = max(accent_a, stroke_aa(ellipse_dist(px, py, rx, ry, rot), stroke_half))
    # No center nucleus — keeps the mark from reading as a letter "A"
    for ex, ey in electron_pts:
        accent_a = max(accent_a, disc_aa(px, py, ex, ey, electron_r))
    if accent_a > 0:
        blend(pix, *ACCENT, accent_a * cover)
    return (pix[0], pix[1], pix[2], pix[3])


def main() -> None:
    cx = cy = SIZE / 2.0
    orbits = [
        (300, 112, 0),
        (300, 112, 60),
        (300, 112, -60),
    ]
    # Spread electrons so all three read clearly
    electron_angles = [(0, 15), (1, 130), (2, 250)]
    electron_pts: list[tuple[float, float]] = []
    for oi, ang in electron_angles:
        rx, ry, rot = orbits[oi]
        t = math.radians(ang)
        ex, ey = rotate(rx * math.cos(t), ry * math.sin(t), rot)
        electron_pts.append((ex, ey))

    nucleus_r = 24.0
    stroke_half = 9.0
    electron_r = 17.0
    # 2x2 supersampling for cleaner edges
    rgba = bytearray(SIZE * SIZE * 4)
    offs = (-0.25, 0.25)

    for y in range(SIZE):
        for x in range(SIZE):
            acc = [0.0, 0.0, 0.0, 0.0]
            for dy in offs:
                for dx in offs:
                    r, g, b, a = sample_pixel(
                        x + 0.5 + dx,
                        y + 0.5 + dy,
                        cx,
                        cy,
                        orbits,
                        electron_pts,
                        nucleus_r,
                        stroke_half,
                        electron_r,
                    )
                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
                    acc[3] += a
            i = (y * SIZE + x) * 4
            rgba[i] = int(round(acc[0] / 4))
            rgba[i + 1] = int(round(acc[1] / 4))
            rgba[i + 2] = int(round(acc[2] / 4))
            rgba[i + 3] = int(round(acc[3] / 4))

    write_png_rgba(OUT, SIZE, SIZE, bytes(rgba))
    print(f'Wrote {OUT}')


if __name__ == '__main__':
    main()
