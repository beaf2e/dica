/* ──────────────────────────────────────────────────────────────
   DICA — Y2K Film Camera  (Vanilla JS, no build step)

   설계 메모
   - 라이브 프리뷰: <video>에 가벼운 CSS filter만 적용(60fps, GPU). 매 프레임
     픽셀 루프를 돌리면 모바일에서 끊기므로, 무거운 그레인/노이즈/날짜 스탬프는
     "촬영 순간"에만 captureCanvas에서 1회 처리한다.
   - 필터 알고리즘은 CamanJS / glfx.js 류 오픈소스 캔버스 필터의 보편적인 기법
     (S-curve 대비, 채널 게인, 섀도 리프트, luma 그레인, vignette)을 참고.
   ────────────────────────────────────────────────────────────── */

const $ = (s) => document.querySelector(s);

const els = {
  start:   $("#start"),
  startBtn:$("#startBtn"),
  startHint:$("#startHint"),
  app:     $("#app"),
  video:   $("#video"),
  grain:   $("#grain"),
  flash:   $("#flash"),
  modeLabel:$("#modeLabel"),
  modeBtns:document.querySelectorAll(".mode-btn"),
  flipBtn: $("#flipBtn"),
  shutter: $("#shutter"),
  galleryBtn:$("#galleryBtn"),
  result:  $("#result"),
  resultImg:$("#resultImg"),
  retakeBtn:$("#retakeBtn"),
  saveBtn: $("#saveBtn"),
  canvas:  $("#captureCanvas"),
};

const state = {
  mode: "digicam",      // 'digicam' | 'film'
  facing: "environment",// 후면 우선
  stream: null,
  lastBlob: null,
  audioCtx: null,
};

const MAX_EDGE = 1600;   // 결과물 긴 변 상한(성능/용량)

/* ── 카메라 ─────────────────────────────────────────────── */
async function startCamera() {
  stopStream();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: state.facing },
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play().catch(() => {});
    els.start.classList.add("hidden");
    els.app.classList.remove("hidden");
  } catch (err) {
    els.startHint.textContent = errorText(err);
    els.startHint.classList.add("error");
  }
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

function errorText(err) {
  if (location.protocol !== "https:" && location.hostname !== "localhost")
    return "카메라는 HTTPS에서만 동작해요 (배포된 https 주소로 접속).";
  if (err && (err.name === "NotAllowedError" || err.name === "SecurityError"))
    return "카메라 권한이 거부됐어요. 설정 → Safari에서 허용해 주세요.";
  if (err && err.name === "NotFoundError") return "사용 가능한 카메라가 없어요.";
  return "카메라를 열 수 없어요: " + (err && err.name ? err.name : err);
}

/* ── 모드 전환 ──────────────────────────────────────────── */
function setMode(mode) {
  state.mode = mode;
  els.video.classList.remove("mode-digicam", "mode-film");
  els.video.classList.add("mode-" + mode);
  els.grain.classList.toggle("film", mode === "film");
  els.modeLabel.textContent = mode === "film" ? "아날로그 필름" : "Y2K 디카";
  els.modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

/* ── 촬영 ───────────────────────────────────────────────── */
function capture() {
  const v = els.video;
  if (!v.videoWidth) return;

  haptic([12]);
  shutterFx();

  // 긴 변 기준 다운스케일
  let w = v.videoWidth, h = v.videoHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);

  const cv = els.canvas;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.drawImage(v, 0, 0, w, h);

  if (state.mode === "film") applyFilm(ctx, w, h);
  else                       applyDigicam(ctx, w, h);

  cv.toBlob((blob) => {
    state.lastBlob = blob;
    const url = URL.createObjectURL(blob);
    els.resultImg.src = url;
    els.galleryBtn.style.backgroundImage = `url(${url})`;
    els.result.classList.remove("hidden");
  }, "image/jpeg", 0.92);
}

/* ── 필터: Y2K 디카 ──────────────────────────────────────
   거친 화질 + 높은 대비 + 자글자글 노이즈 (CCD 저화소 룩) */
function applyDigicam(ctx, w, h) {
  // 1) 저해상 소프트닝: 한 번 줄였다 키워 옛 CCD 느낌
  softenViaDownscale(ctx, w, h, 0.78);

  // 2) 픽셀 루프: S-curve 대비 + 채도 + RGB 노이즈
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const contrast = 1.28, sat = 1.18, noise = 26;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    // 대비
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    // 채도
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    // 살짝 차가운 CCD 캐스트
    b += 6;
    // 자글자글 노이즈(채널별)
    r += (Math.random() - 0.5) * noise;
    g += (Math.random() - 0.5) * noise;
    b += (Math.random() - 0.5) * noise;
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
  ctx.putImageData(img, 0, 0);

  vignette(ctx, w, h, 0.32);
}

/* ── 필터: 아날로그 필름 ─────────────────────────────────
   빛바랜 톤 + 따뜻한 캐스트 + 고운 그레인 + 우하단 날짜 스탬프 */
function applyFilm(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const contrast = 0.9, sat = 0.82, lift = 18, grain = 14;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    // 대비 낮추고 섀도 리프트(빛바램)
    r = (r - 128) * contrast + 128 + lift;
    g = (g - 128) * contrast + 128 + lift;
    b = (b - 128) * contrast + 128 + lift;
    // 채도 낮춤
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    // 따뜻한 필름 캐스트
    r *= 1.07; g *= 1.02; b *= 0.9;
    // 고운 luma 그레인(채널 공통)
    const n = (Math.random() - 0.5) * grain;
    r += n; g += n; b += n;
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
  ctx.putImageData(img, 0, 0);

  lightLeak(ctx, w, h);
  vignette(ctx, w, h, 0.4);
  dateStamp(ctx, w, h);
}

/* ── 공통 효과 ──────────────────────────────────────────── */
function softenViaDownscale(ctx, w, h, factor) {
  const tmp = document.createElement("canvas");
  tmp.width = Math.round(w * factor);
  tmp.height = Math.round(h * factor);
  const tctx = tmp.getContext("2d");
  tctx.drawImage(ctx.canvas, 0, 0, tmp.width, tmp.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, w, h);
}

function vignette(ctx, w, h, strength) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function lightLeak(ctx, w, h) {
  const g = ctx.createRadialGradient(w * 0.85, h * 0.12, 0, w * 0.85, h * 0.12, Math.max(w, h) * 0.5);
  g.addColorStop(0, "rgba(255,120,30,0.22)");
  g.addColorStop(1, "rgba(255,120,30,0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* 우하단 주황 날짜 스탬프 — '26 06 14 (7-세그 느낌) */
function dateStamp(ctx, w, h) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const text = `'${yy} ${mm} ${dd}`;

  const size = Math.round(Math.max(w, h) * 0.045);
  const pad = Math.round(size * 0.9);
  ctx.save();
  ctx.font = `700 ${size}px "DSEG7 Classic", "Courier New", ui-monospace, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  // LED 번짐
  ctx.shadowColor = "rgba(255,120,0,0.9)";
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = "#ff7a18";
  ctx.fillText(text, w - pad, h - pad);
  // 코어를 한 번 더 찍어 선명하게
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffb066";
  ctx.fillText(text, w - pad, h - pad);
  ctx.restore();
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/* ── 촬영 피드백 (햅틱/플래시/셔터음) ───────────────────── */
function haptic(pattern) {
  // iOS Safari는 navigator.vibrate 미지원 → Android에서만 동작(무해한 no-op)
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
}

function shutterFx() {
  els.flash.classList.remove("fire");
  void els.flash.offsetWidth;      // reflow로 애니메이션 리셋
  els.flash.classList.add("fire");
  shutterSound();
}

/* iOS에서 진동이 안 되므로 짧은 셔터 '찰칵' 사운드로 촉감을 보완 */
function shutterSound() {
  try {
    if (!state.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AC();
    }
    const ac = state.audioCtx;
    if (ac.state === "suspended") ac.resume();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.05);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ac.destination);
    osc.start(t); osc.stop(t + 0.1);
  } catch (_) {}
}

/* ── 저장 (아이폰 사진첩) ────────────────────────────────
   1순위: Web Share API → 공유 시트의 "이미지 저장"으로 사진첩 저장
   2순위: 다운로드(데스크톱/안드로이드) */
async function savePhoto() {
  if (!state.lastBlob) return;
  const fname = `DICA_${stamp()}.jpg`;
  const file = new File([state.lastBlob], fname, { type: "image/jpeg" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  // fallback
  const url = URL.createObjectURL(state.lastBlob);
  const a = document.createElement("a");
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function stamp() {
  const n = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
}

/* ── 이벤트 바인딩 ──────────────────────────────────────── */
els.startBtn.addEventListener("click", () => { shutterSound(); startCamera(); });
els.shutter.addEventListener("click", capture);
els.modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
els.flipBtn.addEventListener("click", () => {
  state.facing = state.facing === "environment" ? "user" : "environment";
  startCamera();
});
els.retakeBtn.addEventListener("click", () => els.result.classList.add("hidden"));
els.saveBtn.addEventListener("click", savePhoto);
els.galleryBtn.addEventListener("click", () => { if (state.lastBlob) els.result.classList.remove("hidden"); });

// 탭이 백그라운드로 가면 카메라 정지(배터리/프라이버시), 복귀 시 재개
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopStream();
  else if (!els.app.classList.contains("hidden") && !state.stream) startCamera();
});

setMode("digicam");

/* ── PWA Service Worker 등록 ─────────────────────────────── */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
