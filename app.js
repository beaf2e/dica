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
  zoomPill: $("#zoomPill"),
};

/* ── 필름 프리셋 ──────────────────────────────────────────────
   filter: ctx.filter 문자열 / tint: 빛바램·웜 오버레이 / grain / stamp(날짜) */
const PRESETS = [
  { id: "RAW", label: "RAW", filter: "none", grain: 0, tint: null, stamp: false },
  {
    id: "DICA2000", label: "DI-CA 2000",
    filter: "contrast(1.3) saturate(1.34) brightness(1.04)",
    grain: 0.20, tint: { color: "#0a1a33", alpha: 0.06, blend: "screen" }, stamp: false,
  },
  {
    id: "FILM90", label: "FILM 90s",
    filter: "contrast(0.96) saturate(0.9) sepia(0.16) brightness(1.05)",
    grain: 0.13, tint: { color: "#fff1d0", alpha: 0.10, blend: "soft-light" }, stamp: true,
  },
  {
    id: "VINTAGE", label: "VINTAGE WARM",
    filter: "contrast(0.9) saturate(0.85) sepia(0.34) brightness(1.06) hue-rotate(-8deg)",
    grain: 0.15, tint: { color: "#ff8a3d", alpha: 0.13, blend: "soft-light" }, stamp: true,
  },
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
  zoom: 1,
};

const LIVE_CAP = 1280;    // 라이브/녹화 캔버스 긴 변 상한
const SHOT_CAP = 2200;    // 사진 캡처 긴 변 상한
const vctx = dom.view.getContext("2d");

/* ── 그레인 타일(노이즈) — 1회 생성 후 패턴 재사용 ── */
const noisePattern = (() => {
  const n = document.createElement("canvas");
  n.width = n.height = 96;
  const nx = n.getContext("2d");
  const img = nx.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nx.putImageData(img, 0, 0);
  return vctx.createPattern(n, "repeat");
})();

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
  startLoop();
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
  setZoom(1);
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

function drawCover(ctx, src, cw, ch, zoom) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return false;
  const scale = Math.max(cw / sw, ch / sh) * (zoom || 1);  // 디지털 줌 = 중앙 크롭 확대
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  return true;
}

/* 프레임 1장을 ctx에 합성 (라이브·사진·영상 공용) */
function renderFrame(ctx, src, cw, ch, preset, animate, zoom) {
  ctx.save();
  ctx.filter = preset.filter || "none";
  const ok = drawCover(ctx, src, cw, ch, zoom || 1);
  ctx.filter = "none";
  ctx.restore();
  if (!ok) return false;

  if (preset.tint) {
    ctx.save();
    ctx.globalCompositeOperation = preset.tint.blend;
    ctx.globalAlpha = preset.tint.alpha;
    ctx.fillStyle = preset.tint.color;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
  if (preset.grain && noisePattern) {
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = preset.grain;
    const ox = animate ? (Math.random() - 0.5) * 12 : 4;
    const oy = animate ? (Math.random() - 0.5) * 12 : 4;
    ctx.translate(ox, oy);
    ctx.fillStyle = noisePattern;
    ctx.fillRect(-12, -12, cw + 24, ch + 24);
    ctx.restore();
  }
  if (preset.stamp) dateStamp(ctx, cw, ch);
  return true;
}

function loop() {
  state.rafId = requestAnimationFrame(loop);
  if (dom.video.readyState < 2) return;
  renderFrame(vctx, dom.video, dom.view.width, dom.view.height, PRESETS[state.preset], true, state.zoom);
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

/* ─────────────────────────── 줌 (디지털) ───────────────────────────
   뷰파인더 핀치 = 무단계, 알약 탭 = 1×→2×→3× 순환. 사진/영상에 동일 적용. */
const ZOOM_MAX = 5, ZOOM_STEPS = [1, 2, 3];
function setZoom(v) {
  state.zoom = Math.min(ZOOM_MAX, Math.max(1, v));
  const z = state.zoom;
  dom.zoomPill.textContent = (Math.abs(z - Math.round(z)) < 0.05 ? Math.round(z) : z.toFixed(1)) + "×";
  dom.zoomPill.classList.toggle("active", z > 1.02);
}
(function pinchZoom() {
  let base = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  dom.stage.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) base = { d: dist(e.touches) || 1, z: state.zoom };
  }, { passive: true });
  dom.stage.addEventListener("touchmove", (e) => {
    if (base && e.touches.length === 2) { e.preventDefault(); setZoom(base.z * (dist(e.touches) / base.d)); }
  }, { passive: false });
  const end = (e) => { if (e.touches.length < 2) base = null; };
  dom.stage.addEventListener("touchend", end);
  dom.stage.addEventListener("touchcancel", end);
})();
dom.zoomPill.addEventListener("click", () => {
  const next = ZOOM_STEPS.find((s) => s > state.zoom + 0.05);
  setZoom(next == null ? ZOOM_STEPS[0] : next);
  haptic(8);
});

/* ─────────────────────────── 촬영: 사진 ─────────────────────────── */
function takePhoto() {
  const v = dom.video;
  if (v.readyState < 2) return;
  haptic([10]); fireFlash();

  const aspect = dom.view.width / dom.view.height;
  let w, h;
  const nLong = Math.min(Math.max(v.videoWidth, v.videoHeight) || 1280, SHOT_CAP);
  if (aspect >= 1) { w = nLong; h = Math.round(nLong / aspect); }
  else { h = nLong; w = Math.round(nLong * aspect); }

  dom.shot.width = w; dom.shot.height = h;
  const sctx = dom.shot.getContext("2d");
  renderFrame(sctx, v, w, h, PRESETS[state.preset], false, state.zoom);

  dom.shot.toBlob((blob) => {
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
    renderFrame(dom.shot.getContext("2d"), img, w, h, PRESETS[state.preset], false);
    dom.shot.toBlob((blob) => {
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

let resizeT = 0;
function onResize() { clearTimeout(resizeT); resizeT = setTimeout(layout, 120); }
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", () => setTimeout(layout, 250));

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
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
