/* ──────────────────────────────────────────────────────────────────────────
   DICA — Y2K Film Camera  (Vanilla JS · no build)

   아키텍처
   ───────
   [getUserMedia: 후면 카메라 + 마이크]
        │
   <video> (숨김, 디코딩 전용, muted/playsinline)
        │  매 프레임 ctx.filter 로 필터를 "구워서" 그림
   <canvas#view> = 실제 뷰파인더 (보이는 화면)
        ├── 사진: shotCanvas 에 고해상 1프레임 렌더 → toBlob
        └── 영상: view.captureStream(30) + audioTrack → MediaRecorder → Blob

   CSS 필터가 아니라 ctx.filter(GPU) 로 캔버스에 직접 구우므로
   라이브·사진·영상이 항상 동일하게 보인다(WYSIWYG). MediaRecorder 로
   캔버스를 녹화하는 오픈소스들의 표준 패턴을 차용.
   ────────────────────────────────────────────────────────────────────────── */

const $ = (s) => document.querySelector(s);

const dom = {
  cam: $("#cam"),
  video: $("#video"),
  view: $("#view"),
  stage: $(".stage"),
  flash: $("#flash"),
  recTimer: $("#recTimer"),
  recTime: $("#recTimer span"),
  modeSwitch: $("#modeSwitch"),
  mBtns: document.querySelectorAll(".m-btn"),
  wheel: $("#presetWheel"),
  track: $("#pwTrack"),
  shutter: $("#shutter"),
  galleryBtn: $("#galleryBtn"),
  flipBtn: $("#flipBtn"),
  perm: $("#perm"),
  permBtn: $("#permBtn"),
  permErr: $("#permErr"),
  result: $("#result"),
  resultImg: $("#resultImg"),
  resultVid: $("#resultVid"),
  retakeBtn: $("#retakeBtn"),
  saveBtn: $("#saveBtn"),
  saveHint: $("#saveHint"),
  shot: $("#shotCanvas"),
  fileInput: $("#fileInput"),
  zoomCluster: $("#zoomCluster"),
  zoomArc: $("#zoomArc"),
  zaDial: $("#zaDial"),
  zaValue: $("#zaValue"),
};

/* ── 필름 프리셋 (ToyDigi 이식) ─────────────────────────────────
   filter: ctx.filter 색보정 / vignette·grain·scanline·bloom·halation·chroma·leak·lofi: 0~1
   tint: {color,alpha,blend} / date: 날짜각인 / border: null|'polaroid' */
const PRESETS = [
  { id: "raw",   label: "RAW",   filter: "none", vignette: 0, grain: 0, scanline: 0, bloom: 0, halation: 0, chroma: 0, leak: 0, lofi: 0, tint: null, date: false, border: null },
  { id: "ccd",   label: "CCD",   filter: "contrast(1.12) saturate(1.18) brightness(1.03)", vignette: 0.28, grain: 0.10, scanline: 0, bloom: 0.18, halation: 0, chroma: 0.15, leak: 0, lofi: 0.25, tint: { color: "#0a2e3a", alpha: 0.06, blend: "screen" }, date: true, border: null },
  { id: "ixus",  label: "IXUS",  filter: "contrast(1.08) saturate(1.12) brightness(1.05) sepia(0.08)", vignette: 0.22, grain: 0.08, scanline: 0, bloom: 0.22, halation: 0.25, chroma: 0, leak: 0, lofi: 0.25, tint: { color: "#ffae57", alpha: 0.07, blend: "soft-light" }, date: true, border: null },
  { id: "night", label: "NIGHT", filter: "contrast(1.25) saturate(1.05) brightness(0.96)", vignette: 0.5, grain: 0.16, scanline: 0, bloom: 0.4, halation: 0.3, chroma: 0.2, leak: 0, lofi: 0.3, tint: { color: "#10204a", alpha: 0.12, blend: "multiply" }, date: true, border: null },
  { id: "toy",   label: "TOY",   filter: "contrast(1.3) saturate(1.6) brightness(1.02) hue-rotate(-6deg)", vignette: 0.6, grain: 0.14, scanline: 0, bloom: 0.1, halation: 0, chroma: 0.15, leak: 0.2, lofi: 0.45, tint: { color: "#1d6e5a", alpha: 0.1, blend: "soft-light" }, date: false, border: null },
  { id: "lomo",  label: "LOMO",  filter: "contrast(1.4) saturate(1.7) brightness(0.98)", vignette: 0.75, grain: 0.16, scanline: 0, bloom: 0.08, halation: 0, chroma: 0.25, leak: 0.3, lofi: 0.4, tint: { color: "#0b3b66", alpha: 0.14, blend: "multiply" }, date: false, border: null },
  { id: "pink",  label: "PINK",  filter: "contrast(1.12) saturate(1.35) brightness(1.07) hue-rotate(8deg)", vignette: 0.3, grain: 0.12, scanline: 0, bloom: 0.25, halation: 0.2, chroma: 0, leak: 0.4, lofi: 0.35, tint: { color: "#ff5fb0", alpha: 0.12, blend: "soft-light" }, date: true, border: null },
  { id: "dream", label: "DREAM", filter: "contrast(0.92) saturate(1.1) brightness(1.08) sepia(0.12)", vignette: 0.2, grain: 0.18, scanline: 0, bloom: 0.3, halation: 0.6, chroma: 0, leak: 0.15, lofi: 0.15, tint: { color: "#ffd9a8", alpha: 0.12, blend: "soft-light" }, date: false, border: null },
  { id: "leak",  label: "LEAK",  filter: "contrast(1.05) saturate(1.2) brightness(1.05) sepia(0.1)", vignette: 0.3, grain: 0.2, scanline: 0, bloom: 0.15, halation: 0.2, chroma: 0, leak: 0.8, lofi: 0.2, tint: { color: "#ffb066", alpha: 0.1, blend: "soft-light" }, date: true, border: null },
  { id: "gold",  label: "GOLD",  filter: "contrast(1.06) saturate(1.15) brightness(1.04) sepia(0.18)", vignette: 0.25, grain: 0.22, scanline: 0, bloom: 0.12, halation: 0.35, chroma: 0, leak: 0, lofi: 0.15, tint: { color: "#ffb74d", alpha: 0.1, blend: "soft-light" }, date: false, border: null },
  { id: "fuji",  label: "FUJI",  filter: "contrast(1.1) saturate(1.1) brightness(1.02) hue-rotate(-10deg)", vignette: 0.24, grain: 0.2, scanline: 0, bloom: 0.1, halation: 0, chroma: 0, leak: 0, lofi: 0.15, tint: { color: "#1f8a5b", alpha: 0.08, blend: "soft-light" }, date: false, border: null },
  { id: "exp",   label: "EXP",   filter: "contrast(0.95) saturate(0.9) brightness(1.06) sepia(0.12) hue-rotate(-12deg)", vignette: 0.35, grain: 0.28, scanline: 0, bloom: 0.14, halation: 0.2, chroma: 0, leak: 0.5, lofi: 0.2, tint: { color: "#c060a0", alpha: 0.12, blend: "soft-light" }, date: false, border: null },
  { id: "bw",    label: "B&W",   filter: "grayscale(1) contrast(1.25) brightness(1.04)", vignette: 0.32, grain: 0.3, scanline: 0, bloom: 0.12, halation: 0, chroma: 0, leak: 0, lofi: 0.15, tint: null, date: false, border: null },
  { id: "vhs",   label: "VHS",   filter: "contrast(1.15) saturate(1.3) brightness(1.02)", vignette: 0.3, grain: 0.12, scanline: 0.5, bloom: 0.16, halation: 0, chroma: 0.4, leak: 0, lofi: 0.5, tint: { color: "#2a5bd7", alpha: 0.1, blend: "screen" }, date: true, border: null },
  { id: "pola",  label: "POLA",  filter: "contrast(1.0) saturate(1.05) brightness(1.08) sepia(0.1)", vignette: 0.2, grain: 0.16, scanline: 0, bloom: 0.18, halation: 0.2, chroma: 0, leak: 0, lofi: 0.2, tint: { color: "#eaf0d8", alpha: 0.12, blend: "soft-light" }, date: false, border: "polaroid" },
];

const state = {
  mode: "photo",          // 'photo' | 'video'
  preset: 0,
  facing: "environment",
  stream: null,
  audioOK: false,
  recorder: null,
  chunks: [],
  recording: false,
  recStart: 0,
  recTick: null,
  lastBlob: null,
  lastType: "image",      // 'image' | 'video'
  lastExt: "jpg",
  rafId: 0,
  landscape: false,
  // 줌 / 렌즈
  lens: "wide",                 // 'wide' | 'ultra'
  lensIds: { wide: null, ultra: null },
  dig: 1, digTarget: 1,         // 와이드 디지털 줌(이징값/목표값)
  zoomSteps: [1, 2, 3],
  switching: false,
  arcOn: false,
};

const LIVE_CAP = 1280;    // 라이브/녹화 캔버스 긴 변 상한
const SHOT_CAP = 2200;    // 사진 캡처 긴 변 상한
const vctx = dom.view.getContext("2d");

/* ── 그레인 타일 + 비네팅/스캔라인 캐시 (ToyDigi 효과 이식) ── */
function makeGrainCanvas(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ictx = c.getContext("2d"); const img = ictx.createImageData(w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (Math.random() * 2 - 1) * 90;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ictx.putImageData(img, 0, 0); return c;
}
const GRAIN_TILES = [makeGrainCanvas(180, 180), makeGrainCanvas(180, 180), makeGrainCanvas(180, 180)];
let grainFrame = 0;

let _kitKey = "", _kit = null;
function getKit(preset, w, h) {                 // 비네팅·스캔라인 래스터를 프리셋·크기별 캐시
  const key = `${preset.id}|${w}x${h}`;
  if (_kitKey === key && _kit) return _kit;
  let vig = null;
  if (preset.vignette > 0) {
    vig = document.createElement("canvas"); vig.width = w; vig.height = h;
    const c = vig.getContext("2d");
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${preset.vignette})`);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  let scan = null;
  if (preset.scanline > 0) {
    scan = document.createElement("canvas"); scan.width = w; scan.height = h;
    const c = scan.getContext("2d"); c.fillStyle = `rgba(0,0,0,${preset.scanline * 0.5})`;
    for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  }
  _kitKey = key; _kit = { vig, scan }; return _kit;
}

/* ─────────────────────────── 미디어 획득 ─────────────────────────── */
async function getStream(facing) {
  const vid = { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } };
  // 1순위: 카메라+마이크 동시
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: vid, audio: true });
    state.audioOK = s.getAudioTracks().length > 0;
    return s;
  } catch (e) {
    // 마이크가 막혔거나 동시 획득 실패 → 비디오만 재시도(영상은 무음)
    if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw e;
    const s = await navigator.mediaDevices.getUserMedia({ video: vid });
    state.audioOK = false;
    return s;
  }
}

async function acquire() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
  }
  stopStream();
  const stream = await getStream(state.facing);
  state.stream = stream;
  dom.video.srcObject = stream;
  await dom.video.play().catch(() => {});
  hidePerm();
  try { localStorage.setItem("dica_granted", "1"); } catch (_) {}
  state.lens = "wide"; state.dig = state.digTarget = 1;
  startLoop();
  await detectLenses();   // 권한 획득 후 렌즈 목록(초광각 포함) 탐지
}

function stopStream() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
}

function errText(err) {
  if (location.protocol !== "https:" && location.hostname !== "localhost")
    return "카메라는 HTTPS에서만 동작해요(배포 주소로 접속).";
  const n = err && err.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "권한이 거부됐어요. 설정 → Safari에서 카메라/마이크를 허용해 주세요.";
  if (n === "NotFoundError") return "사용 가능한 카메라가 없어요.";
  if (n === "NotReadableError") return "다른 앱이 카메라를 사용 중이에요. 닫고 다시 시도해 주세요.";
  if (n === "NotSupportedError") return "이 브라우저는 카메라를 지원하지 않아요. Safari로 열어 주세요.";
  return "카메라를 열 수 없어요: " + (n || err);
}

function showPerm(msg) { dom.perm.classList.remove("hidden"); dom.permErr.textContent = msg || ""; }
function hidePerm() { dom.perm.classList.add("hidden"); }

/* 첫 진입: 권한이 이미 있으면 바로 뷰파인더, 처음이면 프라이머 노출 */
async function init() {
  layout();
  buildWheel();
  setMode("photo");
  buildZoomCluster();
  buildZoomDial();
  const granted = (() => { try { return localStorage.getItem("dica_granted") === "1"; } catch (_) { return false; } })();
  if (granted) {
    try { await acquire(); return; } catch (_) { /* 만료/거부 → 프라이머 */ }
  }
  showPerm();
}

/* ─────────────────────────── 렌더 루프 ─────────────────────────── */
function layout() {
  state.landscape = window.matchMedia("(orientation: landscape)").matches;
  const r = dom.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = r.width * dpr, h = r.height * dpr;
  const long = Math.max(w, h);
  if (long > LIVE_CAP) { const k = LIVE_CAP / long; w *= k; h *= k; }
  dom.view.width = Math.max(2, Math.round(w));
  dom.view.height = Math.max(2, Math.round(h));
  // 휠 방향 전환
  dom.wheel.classList.toggle("vertical", state.landscape);
  dom.track.classList.toggle("vertical", state.landscape);
  positionWheel(false);
}

/* 가로모드 회전 보정각 — iOS는 가로로 돌려도 세로 프레임을 주는 경우가 있어
   기기 회전각의 반대로 90° 돌려 영상을 세운다. */
function landscapeAngle() {
  const a = (window.screen && screen.orientation && typeof screen.orientation.angle === "number")
    ? screen.orientation.angle
    : (typeof window.orientation === "number" ? window.orientation : 0);
  return a === 90 ? -Math.PI / 2 : Math.PI / 2;   // 90→-90° / (270·-90)→+90°
}

/* 소스를 캔버스에 object-fit:cover 로 그림(비율 보존).
   캔버스 방향(cw≥ch)과 프레임 방향(sw≥sh)이 어긋나면 ctx.rotate 로 90° 보정.
   → 세로(일치)는 회전 안 함(기존 정상 유지), 가로 불일치만 보정(자가교정). */
function drawCover(ctx, src, cw, ch, zoom) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return false;
  const rotate = (cw >= ch) !== (sw >= sh);
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  if (rotate) ctx.rotate(landscapeAngle());
  const tw = rotate ? ch : cw, th = rotate ? cw : ch;   // 회전 시 목표 박스 가로·세로 스왑
  const scale = Math.max(tw / sw, th / sh) * (zoom || 1);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);          // 중앙 정렬 크롭 확대
  ctx.restore();
  return true;
}

/* 프레임 1장을 ctx에 합성 (라이브·사진·영상 공용) */
function renderFrame(ctx, src, cw, ch, preset, animate, zoom, heavy) {
  // 1) 색보정 필터 + cover(줌·가로회전 보정 포함)
  ctx.save(); ctx.filter = preset.filter || "none";
  const ok = drawCover(ctx, src, cw, ch, zoom || 1);
  ctx.filter = "none"; ctx.restore();
  if (!ok) return false;

  // 2) 색감 틴트
  if (preset.tint && preset.tint.alpha > 0) {
    ctx.save();
    ctx.globalCompositeOperation = preset.tint.blend || "soft-light";
    ctx.globalAlpha = Math.min(1, preset.tint.alpha * 2.2);
    ctx.fillStyle = preset.tint.color; ctx.fillRect(0, 0, cw, ch); ctx.restore();
  }

  // 3) bloom + halation (무거움 → 캡처 시에만)
  if (heavy && "filter" in ctx) {
    if (preset.bloom > 0) {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = preset.bloom * 0.5;
      ctx.filter = "brightness(1.6) blur(6px)"; ctx.drawImage(ctx.canvas, 0, 0, cw, ch); ctx.restore();
    }
    if (preset.halation > 0) {                  // 하이라이트 둘레 따뜻한 붉은 글로우
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = preset.halation * 0.6;
      ctx.filter = "brightness(1.7) blur(9px) sepia(0.7) saturate(2.2) hue-rotate(-12deg)";
      ctx.drawImage(ctx.canvas, 0, 0, cw, ch); ctx.restore();
    }
  }
  // 4) 색수차(픽셀 단위 → 캡처 시에만)
  if (heavy && preset.chroma > 0) {
    const dd = Math.max(1, Math.round(cw * 0.0035 * preset.chroma * 3));
    try {
      const s = ctx.getImageData(0, 0, cw, ch), o = ctx.createImageData(cw, ch);
      const a = s.data, b = o.data;
      for (let y = 0; y < ch; y++) {
        const row = y * cw;
        for (let x = 0; x < cw; x++) {
          const i = (row + x) * 4;
          b[i] = a[(row + Math.min(cw - 1, x + dd)) * 4];
          b[i + 1] = a[i + 1];
          b[i + 2] = a[(row + Math.max(0, x - dd)) * 4 + 2];
          b[i + 3] = a[i + 3];
        }
      }
      ctx.putImageData(o, 0, 0);
    } catch (e) {}
  }
  // 5) 라이트릭 (라이브·캡처 공통)
  if (preset.leak > 0) {
    const lx = cw * 0.9, ly = ch * 0.12;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(cw, ch) * 0.65);
    g.addColorStop(0, `rgba(255,135,45,${0.55 * preset.leak})`);
    g.addColorStop(0.4, `rgba(255,60,80,${0.22 * preset.leak})`);
    g.addColorStop(1, "rgba(255,0,0,0)");
    ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); ctx.restore();
  }
  // 6) 스캔라인 → 그레인 → 비네팅 (캐시 활용)
  const k = getKit(preset, cw, ch);
  if (k.scan) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.drawImage(k.scan, 0, 0); ctx.restore(); }
  if (preset.grain > 0) {
    ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = Math.min(0.6, preset.grain);
    const pat = ctx.createPattern(GRAIN_TILES[(animate ? grainFrame++ : 0) % GRAIN_TILES.length], "repeat");
    if (pat) { ctx.fillStyle = pat; const o = animate ? (Math.random() * 60) | 0 : 0; ctx.translate(-o, -o); ctx.fillRect(o, o, cw, ch); }
    ctx.restore();
  }
  if (k.vig) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.drawImage(k.vig, 0, 0); ctx.restore(); }

  // 7) 날짜 스탬프
  if (preset.date) dateStamp(ctx, cw, ch);
  return true;
}

function loop() {
  state.rafId = requestAnimationFrame(loop);
  if (dom.video.readyState < 2) return;
  // 디지털 줌 이징 — 핀치/휠 입력을 매 프레임 부드럽게 따라감
  state.dig += (state.digTarget - state.dig) * 0.22;
  if (Math.abs(state.digTarget - state.dig) < 0.01) state.dig = state.digTarget;
  const crop = state.lens === "ultra" ? 1 : state.dig;
  renderFrame(vctx, dom.video, dom.view.width, dom.view.height, PRESETS[state.preset], true, crop, false);
  updateZoomCluster();
  if (state.arcOn) renderZoomArc();
}
function startLoop() { if (!state.rafId) loop(); }
function stopLoop() { cancelAnimationFrame(state.rafId); state.rafId = 0; }

/* 우하단 주황 날짜 스탬프 — '26 06 14 */
function dateStamp(ctx, w, h) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  const text = `'${String(d.getFullYear()).slice(2)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
  const size = Math.round(Math.max(w, h) * 0.042);
  const pad = Math.round(size);
  ctx.save();
  ctx.font = `700 ${size}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  ctx.shadowColor = "rgba(255,120,0,0.9)"; ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = "#ff7a18"; ctx.fillText(text, w - pad, h - pad);
  ctx.shadowBlur = 0; ctx.fillStyle = "#ffb066"; ctx.fillText(text, w - pad, h - pad);
  ctx.restore();
}

/* ─────────────────────────── 프리셋 휠 ─────────────────────────── */
function buildWheel() {
  dom.track.innerHTML = "";
  PRESETS.forEach((p, i) => {
    const el = document.createElement("button");
    el.className = "pw-item" + (i === state.preset ? " active" : "");
    el.textContent = p.label;
    el.addEventListener("click", () => selectPreset(i));
    dom.track.appendChild(el);
  });
  positionWheel(false);
}

function positionWheel(animate) {
  const items = dom.track.children;
  if (!items.length) return;
  dom.track.style.transition = animate ? "" : "none";
  const el = items[state.preset];
  if (state.landscape) {
    const center = el.offsetTop + el.offsetHeight / 2;
    dom.track.style.transform = `translateY(${-center}px)`;
  } else {
    const center = el.offsetLeft + el.offsetWidth / 2;
    dom.track.style.transform = `translateX(${-center}px)`;
  }
  if (!animate) requestAnimationFrame(() => (dom.track.style.transition = ""));
  [...items].forEach((it, i) => it.classList.toggle("active", i === state.preset));
}

function selectPreset(i) {
  state.preset = (i + PRESETS.length) % PRESETS.length;
  positionWheel(true);
  haptic(8);
}

/* 휠 스와이프 (가로=X, 세로=Y) */
(function wheelSwipe() {
  let down = false, startP = 0, moved = 0;
  const axis = () => (state.landscape ? "y" : "x");
  const pt = (e) => (axis() === "x" ? (e.touches ? e.touches[0].clientX : e.clientX)
                                    : (e.touches ? e.touches[0].clientY : e.clientY));
  const onDown = (e) => { down = true; startP = pt(e); moved = 0; };
  const onMove = (e) => { if (!down) return; moved = pt(e) - startP; };
  const onUp = () => {
    if (!down) return; down = false;
    const TH = 28;
    if (moved <= -TH) selectPreset(state.preset + 1);
    else if (moved >= TH) selectPreset(state.preset - 1);
  };
  dom.wheel.addEventListener("touchstart", onDown, { passive: true });
  dom.wheel.addEventListener("touchmove", onMove, { passive: true });
  dom.wheel.addEventListener("touchend", onUp);
})();

/* ─────────────────────────── 모드 ─────────────────────────── */
function setMode(mode) {
  if (state.recording) return;
  state.mode = mode;
  dom.mBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  dom.shutter.classList.toggle("video", mode === "video");
  dom.shutter.classList.toggle("photo", mode === "photo");
}

/* ─────────────────────── 줌 + 렌즈 전환 (0.5× 초광각) ───────────────────────
   · 0.5×  : enumerateDevices 로 후면 '초광각' deviceId 를 찾아 하드웨어 전환
   · 1×~5× : 와이드 렌즈에서 캔버스 중앙 크롭 디지털 줌(rAF 이징으로 부드럽게)
   · 입력  : 뷰파인더 핀치(무단계) + 줌 알약(상하 드래그=무단계 휠, 탭=배율 순환)
   canvas captureStream 은 그대로라 렌즈를 바꿔도 dom.video.srcObject 만 교체되어
   사진/영상에 동일하게 반영된다. */
const ZOOM_MAX = 10;

/* 권한 획득 후: 후면 카메라 목록에서 와이드/초광각 deviceId 탐지 */
async function detectLenses() {
  state.lensIds = { wide: null, ultra: null };
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const cur = state.stream && state.stream.getVideoTracks()[0];
    const curId = cur && cur.getSettings ? cur.getSettings().deviceId : null;
    state.lensIds.wide = curId || (cams[0] && cams[0].deviceId) || null;
    if (state.facing === "environment") {
      const back = cams.filter((d) => /back|rear|environment|후면/i.test(d.label));
      const pool = back.length ? back : cams;
      const ultra = pool.find((d) => /ultra.?wide|초광각|0\.5/i.test(d.label));
      if (ultra && ultra.deviceId && ultra.deviceId !== curId) state.lensIds.ultra = ultra.deviceId;
    }
  } catch (_) {}
  state.zoomSteps = state.lensIds.ultra ? [0.5, 1, 2, 3] : [1, 2, 3];
  buildZoomCluster();
  buildZoomDial();
}

/* 물리 렌즈 전환 (deviceId exact) */
async function switchLens(which, dig) {
  const id = state.lensIds[which];
  if (state.switching || id == null || state.recording) return;
  state.switching = true;
  try {
    const ns = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: state.audioOK,
    });
    const old = state.stream;
    state.stream = ns; dom.video.srcObject = ns;
    await dom.video.play().catch(() => {});
    if (old) old.getTracks().forEach((t) => t.stop());
    state.lens = which;
    state.dig = state.digTarget = which === "ultra" ? 1 : Math.max(1, dig || 1);
    haptic(12);
  } catch (e) {
    toast("렌즈 전환 실패: " + (e.name || e));
  } finally {
    state.switching = false;
    updateZoomCluster();
  }
}

/* 연속 줌값 v(0.5~5)를 렌즈/디지털 줌으로 라우팅 (경계 히스테리시스) */
function requestZoom(v) {
  const hasUltra = state.lensIds.ultra && state.facing === "environment" && !state.recording;
  if (hasUltra) {
    if (v < 0.7 && state.lens !== "ultra") { switchLens("ultra"); return; }
    if (v > 0.85 && state.lens === "ultra") { switchLens("wide", Math.max(1, v)); return; }
  }
  if (state.lens === "ultra") return;                 // 초광각에선 디지털 줌 고정(0.5×)
  state.digTarget = Math.min(ZOOM_MAX, Math.max(1, v));
}

/* iOS식 배율 버튼 클러스터 (0.5×·1×·2×·3×) — 탭하면 해당 배율로 점프 */
function buildZoomCluster() {
  if (!dom.zoomCluster) return;
  dom.zoomCluster.innerHTML = "";
  state.zoomSteps.forEach((s) => {
    const b = document.createElement("button");
    b.className = "zc-btn";
    b.dataset.zoom = String(s);
    b.textContent = fmtZoom(s) + "×";
    b.addEventListener("click", () => { requestZoom(s); showZoomArc(); scheduleHideArc(); haptic(8); });
    dom.zoomCluster.appendChild(b);
  });
  updateZoomCluster();
}

function updateZoomCluster() {
  if (!dom.zoomCluster || !dom.zoomCluster.children.length) return;
  const z = dispZoom();
  let best = 0, bd = Infinity;
  state.zoomSteps.forEach((s, i) => { const d = Math.abs(Math.log(s) - Math.log(z)); if (d < bd) { bd = d; best = i; } });
  [...dom.zoomCluster.children].forEach((b, i) => {
    const on = i === best;
    b.classList.toggle("active", on);
    const s = state.zoomSteps[i];
    b.textContent = (on && Math.abs(z - s) > 0.05) ? fmtZoom(z) + "×" : fmtZoom(s) + "×"; // 활성 버튼은 현재값 표시
  });
}

/* ─────────────────────── 줌 다이얼 (곡선 눈금 UI) ───────────────────────
   핀치/드래그 시 등장, 멈추면 서서히 사라짐. 메이저(0.5/1/2/3/5/10)는 정확한
   log 위치에 눈금+숫자, 중앙 옐로 인디케이터가 현재 배율. PIL로 기하 선검증 후 포팅. */
function fmtZoom(z) { return (Math.abs(z - Math.round(z)) < 0.05 ? Math.round(z) : z.toFixed(1)); }
function dispZoom() { return state.lens === "ultra" ? 0.5 : state.dig; }

/* ─────────────────────── 줌 다이얼 (ToyDigi DOM 아크 이식) ───────────────────────
   캔버스 대신 .za-tick DOM을 transform으로 호 배치 → 캔버스 표시 문제 원천 제거.
   dispZoom()(이징된 현재 배율)을 중심으로 눈금 위치를 매 프레임 갱신. */
const ZSP = 42;       // 1× 당 픽셀 (ToyDigi 동일)
const ZA_CX = 140;    // 아크 반폭(.zoom-arc width 280의 절반)

function buildZoomDial() {
  if (!dom.zaDial) return;
  dom.zaDial.innerHTML = "";
  const start = state.lensIds && state.lensIds.ultra ? 0.5 : 1;   // 초광각 있으면 0.5부터
  for (let v = start; v <= 10.001; v += 0.5) {
    const val = Math.round(v * 10) / 10;
    const major = Math.abs(val - Math.round(val)) < 0.01 || val === 0.5;
    const t = document.createElement("div");
    t.className = "za-tick" + (major ? " major" : "");
    t.dataset.v = val;
    if ([0.5, 1, 2, 3, 5, 10].includes(val)) {
      const l = document.createElement("span"); l.className = "za-label"; l.textContent = fmtZoom(val) + "×"; t.appendChild(l);
    }
    dom.zaDial.appendChild(t);
  }
}

function renderZoomArc() {
  if (!dom.zaDial) return;
  const z = dispZoom();
  for (const t of dom.zaDial.children) {
    const v = parseFloat(t.dataset.v);
    const dx = (v - z) * ZSP;
    if (Math.abs(dx) > ZA_CX) { t.style.display = "none"; continue; }
    t.style.display = "block";
    const r = dx / ZA_CX;
    const y = r * r * 22;                                  // 포물선 호
    t.style.transform = `translate(${dx}px,${y}px) rotate(${r * 14}deg)`;
    t.classList.toggle("on", Math.abs(v - z) < 0.26);
  }
  if (dom.zaValue) dom.zaValue.textContent = fmtZoom(z) + "×";
}

let arcHideT = 0;
function showZoomArc() {
  if (!dom.zoomArc) return;
  state.arcOn = true;
  dom.zoomArc.classList.remove("hidden");
  if (dom.zoomCluster) dom.zoomCluster.classList.add("dim");
  renderZoomArc();
  clearTimeout(arcHideT);
}
function scheduleHideArc() {
  clearTimeout(arcHideT);
  arcHideT = setTimeout(() => {
    state.arcOn = false;
    if (dom.zoomArc) dom.zoomArc.classList.add("hidden");
    if (dom.zoomCluster) dom.zoomCluster.classList.remove("dim");
  }, 1400);
}

/* 다이얼 직접 좌우 드래그 = 정밀 줌 (ToyDigi Pointer 방식) */
(function arcDrag() {
  if (!dom.zoomArc) return;
  let x0 = 0, z0 = 1, active = false;
  dom.zoomArc.addEventListener("pointerdown", (e) => {
    active = true; x0 = e.clientX; z0 = dispZoom(); showZoomArc();
    try { dom.zoomArc.setPointerCapture(e.pointerId); } catch (_) {}
  });
  dom.zoomArc.addEventListener("pointermove", (e) => {
    if (!active) return;
    requestZoom(z0 - (e.clientX - x0) / ZSP);             // 끌리는 눈금이 손가락을 따라옴
    showZoomArc();
  });
  const up = () => { if (active) { active = false; scheduleHideArc(); } };
  dom.zoomArc.addEventListener("pointerup", up);
  dom.zoomArc.addEventListener("pointercancel", up);
})();

/* 뷰파인더 핀치 = 무단계 줌 */
(function pinchZoom() {
  let base = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  dom.view.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();                       // 사파리 기본 핀치줌 차단
      base = { d: dist(e.touches) || 1, z: state.lens === "ultra" ? 0.5 : state.dig };
      showZoomArc();                            // 핀치 즉시 다이얼 등장
    }
  }, { passive: false });
  dom.view.addEventListener("touchmove", (e) => {
    if (base && e.touches.length === 2) { e.preventDefault(); requestZoom(base.z * (dist(e.touches) / base.d)); showZoomArc(); }
  }, { passive: false });
  const end = (e) => { if (e.touches.length < 2 && base) { base = null; scheduleHideArc(); } };
  dom.view.addEventListener("touchend", end);
  dom.view.addEventListener("touchcancel", end);
})();

/* 폴라로이드 흰 테두리 (POLA 프리셋) */
function applyPolaroid(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const pad = Math.round(w * 0.05), bottom = Math.round(w * 0.18);
  const fc = document.createElement("canvas");
  fc.width = w + pad * 2; fc.height = h + pad + bottom;
  const fx = fc.getContext("2d");
  fx.fillStyle = "#f6f4ec"; fx.fillRect(0, 0, fc.width, fc.height);
  fx.drawImage(srcCanvas, pad, pad);
  return fc;
}

/* ─────────────────────────── 촬영: 사진 ─────────────────────────── */
function takePhoto() {
  const v = dom.video;
  if (v.readyState < 2) return;
  haptic([10]); fireFlash();
  const preset = PRESETS[state.preset];

  const aspect = dom.view.width / dom.view.height;
  let nLong = Math.min(Math.max(v.videoWidth, v.videoHeight) || 1280, SHOT_CAP);
  nLong = Math.max(420, Math.round(nLong * (1 - (preset.lofi || 0) * 0.4)));   // lofi = 저해상 똑딱이 화질
  let w, h;
  if (aspect >= 1) { w = nLong; h = Math.round(nLong / aspect); }
  else { h = nLong; w = Math.round(nLong * aspect); }

  dom.shot.width = w; dom.shot.height = h;
  renderFrame(dom.shot.getContext("2d"), v, w, h, preset, false, state.lens === "ultra" ? 1 : state.dig, true);

  const out = preset.border === "polaroid" ? applyPolaroid(dom.shot) : dom.shot;
  out.toBlob((blob) => {
    if (!blob) return;
    state.lastBlob = blob; state.lastType = "image"; state.lastExt = "jpg";
    showResult(URL.createObjectURL(blob), "image");
  }, "image/jpeg", 0.92);
}

/* ─────────────────────── 갤러리 가져오기 (사진 보관함) ───────────────────────
   기존 사진을 선택 → 현재 프리셋 필터를 입혀 결과 화면에서 저장.
   원본 비율을 그대로 보존(크롭 없음). */
function importImage(file) {
  if (!/^image\//.test(file.type)) { toast("이미지 파일만 가져올 수 있어요."); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    let w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, SHOT_CAP / Math.max(w, h));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    dom.shot.width = w; dom.shot.height = h;
    const preset = PRESETS[state.preset];
    renderFrame(dom.shot.getContext("2d"), img, w, h, preset, false, 1, true);
    const out = preset.border === "polaroid" ? applyPolaroid(dom.shot) : dom.shot;
    out.toBlob((blob) => {
      URL.revokeObjectURL(url);
      if (!blob) { toast("이미지를 처리할 수 없어요."); return; }
      state.lastBlob = blob; state.lastType = "image"; state.lastExt = "jpg";
      showResult(URL.createObjectURL(blob), "image");
    }, "image/jpeg", 0.92);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("이미지를 불러올 수 없어요."); };
  img.src = url;
}

/* ─────────────────────────── 촬영: 영상 ─────────────────────────── */
function pickMime() {
  const cands = [
    "video/mp4", "video/mp4;codecs=h264,aac",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm",
  ];
  for (const m of cands) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return "";
}

function startRecording() {
  if (!window.MediaRecorder || !dom.view.captureStream) {
    toast("이 브라우저는 영상 녹화를 지원하지 않아요. iOS는 최신 Safari가 필요해요.");
    return;
  }
  let cstream;
  try {
    cstream = dom.view.captureStream(30);
    if (state.audioOK) {
      const a = state.stream.getAudioTracks()[0];
      if (a) cstream.addTrack(a);
    }
  } catch (e) {
    cstream = state.stream; // 최후 폴백(필터 미적용 원본)
  }

  const mime = pickMime();
  try {
    state.recorder = new MediaRecorder(cstream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  } catch (e) {
    toast("녹화를 시작할 수 없어요: " + (e.name || e));
    return;
  }

  state.chunks = [];
  state.lastExt = (state.recorder.mimeType || mime).includes("mp4") ? "mp4" : "webm";
  state.recorder.ondataavailable = (e) => { if (e.data && e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = () => {
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType || mime || "video/webm" });
    state.lastBlob = blob; state.lastType = "video";
    showResult(URL.createObjectURL(blob), "video");
  };
  state.recorder.start(120);

  state.recording = true;
  dom.shutter.classList.add("recording");
  lockControls(true);
  startTimer();
  haptic([14]);
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  dom.shutter.classList.remove("recording");
  lockControls(false);
  stopTimer();
  try { state.recorder.stop(); } catch (_) {}
  haptic([10]);
}

function lockControls(lock) {
  dom.modeSwitch.style.opacity = lock ? 0.35 : 1;
  dom.modeSwitch.style.pointerEvents = lock ? "none" : "auto";
  dom.flipBtn.style.opacity = lock ? 0.35 : 1;
  dom.flipBtn.style.pointerEvents = lock ? "none" : "auto";
}

function startTimer() {
  dom.recTimer.classList.remove("hidden");
  state.recStart = Date.now();
  const upd = () => {
    const s = Math.floor((Date.now() - state.recStart) / 1000);
    dom.recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  upd();
  state.recTick = setInterval(upd, 250);
}
function stopTimer() { clearInterval(state.recTick); dom.recTimer.classList.add("hidden"); }

/* ─────────────────────────── 셔터 ─────────────────────────── */
function onShutter() {
  if (state.mode === "photo") takePhoto();
  else if (state.recording) stopRecording();
  else startRecording();
}

function fireFlash() {
  dom.flash.classList.remove("fire"); void dom.flash.offsetWidth; dom.flash.classList.add("fire");
}

/* ─────────────────────────── 저장 ─────────────────────────── */
function showResult(url, type) {
  dom.resultImg.hidden = type !== "image";
  dom.resultVid.hidden = type !== "video";
  if (type === "image") { dom.resultImg.src = url; }
  else { dom.resultVid.src = url; }
  dom.saveHint.innerHTML = type === "image"
    ? "‘저장’ → 공유 시트에서 <b>이미지 저장</b>"
    : "‘저장’ → 공유 시트에서 <b>비디오 저장</b>";
  dom.result.classList.remove("hidden");
}
function closeResult() { dom.result.classList.add("hidden"); dom.resultVid.pause(); }

async function save() {
  if (!state.lastBlob) return;
  const name = `DICA_${stamp()}.${state.lastExt}`;
  const file = new File([state.lastBlob], name, { type: state.lastBlob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(state.lastBlob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function stamp() {
  const n = new Date(); const p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
}

/* ─────────────────────────── 유틸 ─────────────────────────── */
function haptic(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (_) {} } }

let toastT = 0;
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t);
    t.style.cssText = "position:fixed;left:50%;bottom:24%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 16px;border-radius:12px;font-size:.85rem;z-index:50;max-width:80%;text-align:center;backdrop-filter:blur(8px)"; }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(toastT); toastT = setTimeout(() => (t.style.opacity = "0"), 3200);
}

/* ─────────────────────────── 이벤트 ─────────────────────────── */
dom.permBtn.addEventListener("click", async () => {
  dom.permErr.textContent = "";
  try { await acquire(); } catch (e) { showPerm(errText(e)); }
});
dom.shutter.addEventListener("click", onShutter);
dom.mBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
dom.flipBtn.addEventListener("click", async () => {
  if (state.recording) return;
  state.facing = state.facing === "environment" ? "user" : "environment";
  try { await acquire(); } catch (e) { toast(errText(e)); }
});
dom.galleryBtn.addEventListener("click", () => dom.fileInput.click());
dom.fileInput.addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importImage(f);
  dom.fileInput.value = "";   // 같은 사진 다시 선택 가능하도록 리셋
});
dom.retakeBtn.addEventListener("click", closeResult);
dom.saveBtn.addEventListener("click", save);

/* iOS Safari 페이지 핀치줌/더블탭줌 차단 — 우리 핸들러가 제스처를 확실히 받게 */
["gesturestart", "gesturechange", "gestureend"].forEach((ev) =>
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

/* 가로/세로 전환 시 캔버스 백킹을 실제 픽셀로 재계산 (iOS 타이밍 대비 다중 호출) */
let resizeT = 0;
function relayoutSoon() { clearTimeout(resizeT); resizeT = setTimeout(layout, 120); }
window.addEventListener("resize", relayoutSoon);
window.addEventListener("orientationchange", () => { layout(); setTimeout(layout, 180); setTimeout(layout, 450); });
if (window.visualViewport) window.visualViewport.addEventListener("resize", relayoutSoon);
if (window.screen && screen.orientation && screen.orientation.addEventListener)
  screen.orientation.addEventListener("change", () => setTimeout(layout, 180));

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.recording) stopRecording();
    stopLoop(); stopStream();
  } else if (localStorage.getItem("dica_granted") === "1" && !state.stream && dom.perm.classList.contains("hidden")) {
    acquire().catch(() => showPerm(""));
  }
});

init();

/* ── PWA ── */
if ("serviceWorker" in navigator) {
  let refreshing = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return;   // 새 SW가 제어 시작하면 1회 새로고침(최초 설치는 제외)
    refreshing = true; location.reload();
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
