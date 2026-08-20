from pathlib import Path
import struct
import zlib


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int) -> None:
    rows = []
    for y in range(size):
        row = [0]
        for x in range(size):
            cx, cy = size // 2, size // 2
            dx, dy = x - cx, y - cy
            in_rack = abs(dx) < size * 0.28 and abs(dy) < size * 0.38
            ru = (y * 18) // size
            stripe = ru % 2 == 0
            if in_rack:
                if stripe:
                    row.extend([61, 156, 240, 255])
                else:
                    row.extend([18, 32, 42, 255])
            else:
                row.extend([11, 15, 20, 255])
        rows.append(bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw, 9)) + _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    public = Path(__file__).resolve().parents[1] / "frontend" / "public"
    public.mkdir(parents=True, exist_ok=True)
    write_png(public / "icon-192.png", 192)
    write_png(public / "icon-512.png", 512)
    write_png(public / "apple-touch-icon.png", 180)
    print("wrote icons to", public)


if __name__ == "__main__":
    main()
