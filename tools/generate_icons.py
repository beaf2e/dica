#!/usr/bin/env python3
"""
DICA 앱 아이콘 생성기 (Pillow)
- 하이엔드 블랙 배경 + Y2K 카메라 렌즈 + 오렌지 액센트 + 'DICA' 워드마크
- 4x 슈퍼샘플링으로 안티에일리어싱
출력: icons/icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png(180)
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

ACCENT = (255, 106, 0)        # 필름 스탬프 오렌지
SS = 4                         # supersample

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/Library/Fonts/Arial.ttf",
]

def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except Exception:
                continue
    return ImageFont.load_default()

def vgrad(size, top, bottom):
    """세로 그라데이션 배경"""
    g = Image.new("RGB", (1, size), 0)
    for y in range(size):
        t = y / max(1, size - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((size, size))

def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def draw_icon(px, maskable=False):
    S = px * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 배경 (maskable이면 풀블리드, 아니면 둥근 사각형)
    bg = vgrad(S, (26, 26, 28), (0, 0, 0)).convert("RGBA")
    if maskable:
        img.paste(bg, (0, 0))
    else:
        radius = int(S * 0.22)
        img.paste(bg, (0, 0), rounded_mask(S, radius))

    d = ImageDraw.Draw(img)

    # 렌즈 — maskable은 안전영역(중앙 80%) 안으로 축소
    cx, cy = S // 2, int(S * (0.44 if not maskable else 0.46))
    R = int(S * (0.245 if not maskable else 0.215))

    def circle(cxx, cyy, r, fill=None, outline=None, width=1):
        d.ellipse([cxx - r, cyy - r, cxx + r, cyy + r], fill=fill, outline=outline, width=width)

    circle(cx, cy, R + int(S * 0.012), fill=ACCENT)                 # 오렌지 림
    circle(cx, cy, R, fill=(18, 18, 20))                           # 베젤
    circle(cx, cy, int(R * 0.82), outline=(70, 70, 74), width=max(1, int(S * 0.006)))
    circle(cx, cy, int(R * 0.6), fill=(8, 8, 10))                  # 유리
    circle(cx, cy, int(R * 0.6), outline=(120, 150, 180), width=max(1, int(S * 0.004)))
    # 글래스 하이라이트
    hl = int(R * 0.26)
    d.ellipse([cx - R * 0.4 - hl, cy - R * 0.4 - hl, cx - R * 0.4 + hl, cy - R * 0.4 + hl],
              fill=(220, 235, 255, 160))
    circle(cx, cy, int(R * 0.14), fill=(0, 0, 0))                  # 동공

    # 워드마크
    font = load_font(int(S * 0.135))
    text = "DICA"
    try:
        bbox = d.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        off_x, off_y = bbox[0], bbox[1]
    except Exception:
        tw, th, off_x, off_y = font.getsize(text)[0], font.getsize(text)[1], 0, 0
    tx = cx - tw // 2 - off_x
    ty = int(S * 0.74) - off_y
    # 살짝 트래킹 느낌으로 그림자 + 본문
    d.text((tx, ty), text, font=font, fill=(245, 245, 247))

    img = img.resize((px, px), Image.LANCZOS)
    return img

def main():
    for name, size, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-512-maskable.png", 512, True),
        ("apple-touch-icon.png", 180, True),  # iOS가 알아서 둥글게 → 풀블리드
    ]:
        draw_icon(size, maskable).save(os.path.join(OUT, name))
        print("✓", name)

if __name__ == "__main__":
    main()
