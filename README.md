# DICA — Y2K Film Camera (PWA)

아이폰 Safari에서 **홈 화면에 추가**해 앱처럼 쓰는 Y2K 디카 & 아날로그 필름 카메라.
빌드 단계 없는 **순수 Vanilla JS + HTML5 Canvas**. Apple 개발자 비용 없이 **Cloudflare Pages 무료 배포**.

## 기능
- **후면 카메라** 라이브 프리뷰 (`getUserMedia`, iOS Safari `playsinline`)
- 필터 2종 (`Canvas API`)
  - **Y2K 디카** — 저화소 소프트닝 · 높은 대비 · 자글자글 RGB 노이즈 · 비네팅
  - **아날로그 필름** — 빛바램(섀도 리프트) · 따뜻한 캐스트 · 고운 그레인 · 라이트릭 · **우하단 주황 날짜 스탬프** `'YY MM DD`
- 셔터: 화면 플래시 + 셔터음 + 진동(`navigator.vibrate`, Android)
- 저장: **Web Share API** → 공유 시트 *이미지 저장* 으로 아이폰 사진첩에 저장 (미지원 환경은 다운로드 폴백)
- PWA: `manifest` + iOS 메타태그 + Service Worker(오프라인 셸 캐시)

## 로컬 미리보기
```bash
cd dica
python3 -m http.server 8000      # http://localhost:8000
```
> 데스크톱 localhost 는 secure context 라 카메라가 동작합니다.
> **아이폰 실기기 테스트는 HTTPS가 필수** → 아래 Vercel 배포 주소로 접속하세요.

## 아이콘 다시 생성
```bash
python3 tools/generate_icons.py
```

## 배포 — Cloudflare Pages (무료)
**라이브: https://dica-asp.pages.dev**

wrangler Direct Upload 로 배포돼 있습니다. 코드 수정 후 재배포:
```bash
cd dica
rm -rf dist && mkdir dist
cp index.html styles.css app.js manifest.webmanifest sw.js _headers dist/ && cp -R icons dist/
npx wrangler pages deploy dist --project-name dica --branch main
```
아이폰: 위 주소를 **Safari로** 열기 → 공유 → **홈 화면에 추가**.

> `_headers`(서비스워커 no-cache·manifest content-type)는 Cloudflare Pages가 자동 적용합니다.
> GitHub: `beaf2e/dica` · Cloudflare: `minsoo.lee2405@gmail.com` 계정.

## 알려진 iOS 제약
- iOS Safari는 `navigator.vibrate`(진동 API)를 **지원하지 않음** → 셔터 플래시 + 셔터음으로 촉감을 보완.
- 카메라/사진 저장은 **HTTPS(또는 localhost)** 에서만 동작.
