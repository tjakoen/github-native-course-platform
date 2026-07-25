// Camera + QR decode loop for the Scan tab. Native BarcodeDetector when the
// browser has it (Chrome/Android); the vendored jsQR (site/vendor/jsQR.js,
// Apache-2.0, lazy-loaded classic script so it satisfies script-src 'self')
// covers the rest (iOS Safari). Holds NO app logic: it hands decoded strings to
// onCode and leaves parsing/recording to the caller.

let jsqrLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrLoading) {
    jsqrLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/jsQR.js";
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => reject(new Error("could not load vendor/jsQR.js"));
      document.head.append(s);
    });
  }
  return jsqrLoading;
}

// Starts the camera into `video` and calls onCode(text) for each decode.
// Returns { stop } . A repeat-decode cooldown keeps one QR held in front of the
// lens from firing dozens of times; a DIFFERENT code fires immediately.
export async function startScan(video, onCode, { fps = 8, cooldownMs = 2500 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");   // iOS: stay inline, not fullscreen
  video.muted = true;
  await video.play();

  let detector = null, jsqr = null;
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch { /* fall through to jsQR */ }
  }
  if (!detector) jsqr = await loadJsQR();

  // Keep the screen awake while scanning (progressive; not everywhere)
  let wake = null;
  try { wake = await navigator.wakeLock?.request("screen"); } catch { /* fine without */ }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false, busy = false;
  let lastText = "", lastAt = 0;

  const emit = (text) => {
    const now = Date.now();
    if (text === lastText && now - lastAt < cooldownMs) { lastAt = now; return; }
    lastText = text; lastAt = now;
    onCode(text);
  };

  const tick = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && video.videoWidth) {
      busy = true;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) emit(codes[0].rawValue);
        } else {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const hit = jsqr(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (hit && hit.data) emit(hit.data);
        }
      } catch { /* transient decode errors are normal */ }
      busy = false;
    }
    if (!stopped) setTimeout(tick, 1000 / fps);
  };
  tick();

  return {
    stop() {
      stopped = true;
      try { wake?.release(); } catch { /* released on tab hide anyway */ }
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
  };
}
