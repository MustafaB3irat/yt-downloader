"""Draw the extension icons (blue rounded square, white download arrow) with no dependencies.

Usage: python3 scripts/make_icons.py extension/icons
"""
from __future__ import annotations

import os
import struct
import sys
import zlib

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4
BLUE = (37, 99, 235)


def in_rounded_square(x: float, y: float, n: float) -> bool:
    r = 0.22 * n
    cx = min(max(x, r), n - r)
    cy = min(max(y, r), n - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_arrow(u: float, v: float) -> bool:
    """u, v are 0..1 coordinates inside the icon."""
    shaft = 0.445 <= u <= 0.555 and 0.20 <= v <= 0.60
    head = 0.40 <= v <= 0.68 and abs(u - 0.5) <= (0.68 - v) * 0.95
    base = 0.24 <= u <= 0.76 and 0.74 <= v <= 0.83
    return shaft or head or base


def pixel(px: int, py: int, size: int) -> bytes:
    n = size * SUPERSAMPLE
    covered = white = 0
    for sy in range(SUPERSAMPLE):
        for sx in range(SUPERSAMPLE):
            x = px * SUPERSAMPLE + sx + 0.5
            y = py * SUPERSAMPLE + sy + 0.5
            if in_rounded_square(x, y, n):
                covered += 1
                white += in_arrow(x / n, y / n)
    if not covered:
        return bytes(4)
    t = white / covered
    rgb = (int(c + (255 - c) * t) for c in BLUE)  # blend toward white
    return bytes([*rgb, int(255 * covered / SUPERSAMPLE**2)])


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: str, size: int) -> None:
    rows = b"".join(b"\x00" + b"".join(pixel(px, py, size) for px in range(size)) for py in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
    os.makedirs(out, exist_ok=True)
    for size in SIZES:
        write_png(os.path.join(out, f"{size}.png"), size)


if __name__ == "__main__":
    main()
