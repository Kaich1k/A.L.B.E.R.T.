#!/usr/bin/env python3
"""Apply a macOS-style squircle alpha mask and write build/icon.png."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_CANDIDATES = [
    ROOT / 'resources' / 'icon-source.png',
    Path('/Users/kai/.cursor/projects/Users-kai-Documents-VS-ALBERT/assets/albert-icon-simple.png'),
    ROOT / 'resources' / 'icon.png',
    ROOT / 'build' / 'icon.png',
]
OUT = ROOT / 'build' / 'icon.png'
RES = ROOT / 'resources' / 'icon.png'


def read_png(path: Path) -> tuple[int, int, int, int, bytes]:
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    i = 8
    width = height = color_type = bit_depth = None
    idat = b''
    while i < len(data):
        length = struct.unpack('>I', data[i : i + 4])[0]
        ctype = data[i + 4 : i + 8]
        chunk = data[i + 8 : i + 8 + length]
        if ctype == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack('>IIBB', chunk[:10])
        elif ctype == b'IDAT':
            idat += chunk
        elif ctype == b'IEND':
            break
        i += 12 + length
    assert width and height and bit_depth is not None and color_type is not None
    return width, height, bit_depth, color_type, zlib.decompress(idat)


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_rgba(width: int, height: int, bit_depth: int, color_type: int, raw: bytes) -> bytearray:
    if bit_depth != 8:
        raise SystemExit(f'unsupported bit depth {bit_depth}')
    bpp = {2: 3, 4: 2, 6: 4}.get(color_type)
    if bpp is None:
        raise SystemExit(f'unsupported color type {color_type}')
    stride = width * bpp
    out = bytearray(height * width * 4)
    prev = bytearray(stride)
    o = 0
    for y in range(height):
        filt = raw[o]
        o += 1
        scan = bytearray(raw[o : o + stride])
        o += stride
        for x in range(stride):
            left = scan[x - bpp] if x >= bpp else 0
            up = prev[x]
            ul = prev[x - bpp] if x >= bpp else 0
            if filt == 0:
                v = scan[x]
            elif filt == 1:
                v = (scan[x] + left) & 255
            elif filt == 2:
                v = (scan[x] + up) & 255
            elif filt == 3:
                v = (scan[x] + ((left + up) // 2)) & 255
            elif filt == 4:
                v = (scan[x] + paeth(left, up, ul)) & 255
            else:
                raise SystemExit(f'bad filter {filt}')
            scan[x] = v
        prev = scan
        for x in range(width):
            i = x * bpp
            di = (y * width + x) * 4
            if color_type == 6:
                out[di : di + 4] = scan[i : i + 4]
            elif color_type == 2:
                r, g, b = scan[i : i + 3]
                out[di : di + 4] = bytes((r, g, b, 255))
            else:
                g, a = scan[i : i + 2]
                out[di : di + 4] = bytes((g, g, g, a))
    return out


def write_png_rgba(path: Path, width: int, height: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

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


def squircle_alpha(nx: float, ny: float, n: float = 5.0) -> float:
    """Continuous-corner superellipse coverage in normalized [-1,1] space."""
    v = abs(nx) ** n + abs(ny) ** n
    # Soft AA band near the edge
    edge = 1.0
    band = 2.2 / 512.0  # ~2px at 1024
    if v <= edge - band:
        return 1.0
    if v >= edge + band:
        return 0.0
    t = (edge + band - v) / (2 * band)
    # smoothstep
    return t * t * (3 - 2 * t)


def sample_bg(rgba: bytearray, width: int, height: int) -> tuple[int, int, int]:
    pts = [(2, 2), (width - 3, 2), (2, height - 3), (width - 3, height - 3)]
    rs = gs = bs = 0
    for x, y in pts:
        i = (y * width + x) * 4
        rs += rgba[i]
        gs += rgba[i + 1]
        bs += rgba[i + 2]
    return rs // 4, gs // 4, bs // 4


def already_masked(rgba: bytearray, width: int, height: int) -> bool:
    """True if corners are already transparent (clean rendered icon)."""
    samples = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    return all(rgba[(y * width + x) * 4 + 3] < 8 for x, y in samples)


def apply_mask(rgba: bytearray, width: int, height: int) -> bytearray:
    if already_masked(rgba, width, height):
        return bytearray(rgba)

    # Slight inset so the Dock glyph matches other apps' visual weight
    inset = 0.04
    br, bg, bb = sample_bg(rgba, width, height)
    out = bytearray(rgba)
    for y in range(height):
        ny = (((y + 0.5) / height) * 2 - 1) / (1.0 - inset)
        for x in range(width):
            nx = (((x + 0.5) / width) * 2 - 1) / (1.0 - inset)
            cover = squircle_alpha(nx, ny)
            i = (y * width + x) * 4
            r, g, b, a = out[i], out[i + 1], out[i + 2], out[i + 3]
            # Knock out flat canvas behind a painted squircle (white/gray/black mats)
            dist = abs(r - br) + abs(g - bg) + abs(b - bb)
            if dist < 28 and (r + g + b < 90 or r + g + b > 600 or abs(r - g) + abs(g - b) < 18):
                cover = 0.0
            na = int(round(a * cover))
            out[i + 3] = na
            if na == 0:
                out[i] = out[i + 1] = out[i + 2] = 0
    return out


def main() -> None:
    src = next((p for p in SRC_CANDIDATES if p.exists()), None)
    if src is None:
        raise SystemExit('No source icon found')
    w, h, bd, ct, raw = read_png(src)
    rgba = decode_rgba(w, h, bd, ct, raw)

    # Scale to 1024 if needed (nearest / box via simple sampling)
    target = 1024
    if w != target or h != target:
        scaled = bytearray(target * target * 4)
        for y in range(target):
            sy = min(h - 1, int(y * h / target))
            for x in range(target):
                sx = min(w - 1, int(x * w / target))
                si = (sy * w + sx) * 4
                di = (y * target + x) * 4
                scaled[di : di + 4] = rgba[si : si + 4]
        rgba = scaled
        w = h = target

    masked = apply_mask(rgba, w, h)
    write_png_rgba(OUT, w, h, masked)
    write_png_rgba(RES, w, h, masked)
    # Stats
    zero = sum(1 for i in range(3, len(masked), 4) if masked[i] == 0)
    print(f'Wrote {OUT} and {RES}')
    print(f'transparent pixels: {zero} ({100 * zero / (w * h):.1f}%)')
    print('corner alpha:', masked[3], masked[(w - 1) * 4 + 3], masked[((h - 1) * w) * 4 + 3])


if __name__ == '__main__':
    main()
