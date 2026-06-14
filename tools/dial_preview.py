#!/usr/bin/env python3
"""줌 다이얼(곡선 눈금) 기하 시각 검증 — 캔버스 포팅 전 프로토타입."""
import math, os
from PIL import Image, ImageDraw, ImageFont

W, H, SS = 374, 127, 3
MAJORS = [0.5, 1, 2, 3, 5, 10]
ANG = 0.80
WIN = 0.72

def fnt(px):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc"]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, px)
            except Exception: pass
    return ImageFont.load_default()

def fmt(z):
    return ("%g" % round(z, 1))

def render(z):
    im = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = W * SS / 2
    Hs = H * SS
    apexY = 0.40 * Hs
    R = 0.656 * W * SS
    cy = apexY + R
    cur = math.log(z)
    step = 0.06
    majpos = [math.log(m) for m in MAJORS]
    alpha = lambda th: int(255 * (0.28 + 0.72 * max(0.0, 1 - abs(th) / WIN)))

    def tick(th, tlen, w, col):
        s, c = math.sin(th), math.cos(th)
        d.line([cx + R * s, cy - R * c, cx + (R - tlen) * s, cy - (R - tlen) * c],
               fill=col, width=int(w * SS))

    # 마이너 눈금(격자) — 메이저 근처는 건너뜀
    p = math.ceil(math.log(0.5) / step) * step
    while p <= math.log(10) + 1e-6:
        th = (p - cur) * ANG
        if abs(th) <= WIN and not any(abs(mp - p) < step * 0.6 for mp in majpos):
            tick(th, 0.13 * Hs, 1.7, (255, 255, 255, alpha(th)))
        p += step

    # 메이저 눈금 + 숫자(정확한 위치)
    f = fnt(int(0.19 * Hs))
    for m, mp in zip(MAJORS, majpos):
        th = (mp - cur) * ANG
        if abs(th) > WIN:
            continue
        a = alpha(th)
        tick(th, 0.25 * Hs, 3.2, (255, 255, 255, a))
        lr = R - 0.38 * Hs
        lx, ly = cx + lr * math.sin(th), cy - lr * math.cos(th)
        t = fmt(m)
        bb = d.textbbox((0, 0), t, font=f)
        d.text((lx - (bb[2] - bb[0]) / 2 - bb[0], ly - (bb[3] - bb[1]) / 2 - bb[1]),
               t, font=f, fill=(255, 255, 255, a))
    # 중앙 인디케이터(옐로)
    d.line([cx, apexY - 0.12 * Hs, cx, apexY + 0.05 * Hs], fill=(255, 212, 0, 255), width=int(3 * SS))
    return im.resize((W, H), Image.LANCZOS)

def main():
    states = [0.5, 1, 2, 5]
    pad = 12
    canvas = Image.new("RGB", (W + pad * 2, (H + pad) * len(states) + pad), (10, 10, 12))
    for i, z in enumerate(states):
        tile = render(z)
        bg = Image.new("RGB", (W, H), (14, 14, 16))
        bg.paste(tile, (0, 0), tile)
        canvas.paste(bg, (pad, pad + i * (H + pad)))
    out = os.path.join(os.path.dirname(__file__), "..", "dial_preview.png")
    canvas.save(out)
    print("saved", out)

if __name__ == "__main__":
    main()
