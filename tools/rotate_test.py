#!/usr/bin/env python3
"""drawCover 회전+cover 수식 검증: 세로 프레임 → 가로 캔버스가 꽉 차고(비왜곡) 90° 보정되는지."""
import os
from PIL import Image, ImageDraw

def make_frame(sw, sh):
    """세로 프레임: 위=빨강(TOP), 그라데이션, 중앙 화살표(↑)."""
    im = Image.new("RGB", (sw, sh), (20, 20, 30))
    d = ImageDraw.Draw(im)
    for y in range(sh):
        t = y / sh
        d.line([(0, y), (sw, y)], fill=(int(40 + 180 * t), int(60 * (1 - t)), int(120 * (1 - t))))
    d.rectangle([0, 0, sw, sh // 12], fill=(220, 40, 40))           # 상단 띠 = TOP
    d.polygon([(sw // 2, sh // 4), (sw // 2 - sw // 6, sh // 2), (sw // 2 + sw // 6, sh // 2)], fill=(255, 255, 255))
    d.rectangle([sw // 2 - sw // 18, sh // 2, sw // 2 + sw // 18, sh * 3 // 4], fill=(255, 255, 255))
    return im

def cover_rotate(src, cw, ch, deg):
    sw, sh = src.size
    rotate = (cw >= ch) != (sw >= sh)
    tw, th = (ch, cw) if rotate else (cw, ch)
    scale = max(tw / sw, th / sh)
    dw, dh = int(sw * scale), int(sh * scale)
    scaled = src.resize((dw, dh), Image.LANCZOS)
    if rotate:
        scaled = scaled.rotate(deg, expand=True)        # PIL: +각도=반시계
    canvas = Image.new("RGB", (cw, ch), (0, 0, 0))
    canvas.paste(scaled, ((cw - scaled.width) // 2, (ch - scaled.height) // 2))
    return canvas, rotate

def main():
    frame = make_frame(1080, 1920)                       # iOS가 가로에서도 줄 수 있는 세로 프레임
    out = Image.new("RGB", (1280 + 20, 590 * 2 + 30), (8, 8, 10))
    for i, deg in enumerate([90, -90]):
        c, rot = cover_rotate(frame, 1280, 590, deg)
        out.paste(c, (10, 10 + i * (590 + 10)))
        ImageDraw.Draw(out).text((16, 12 + i * (590 + 10)), f"deg={deg} rotate={rot}", fill=(255, 255, 0))
    p = os.path.join(os.path.dirname(__file__), "..", "rotate_test.png")
    out.save(p)
    print("saved", p)

if __name__ == "__main__":
    main()
