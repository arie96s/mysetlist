/* ════════════════════════════════════════════════════
   CAMERA / SCANNER MANAGER
   Satu sumber kebenaran untuk lifecycle kamera barcode scanner.
   Menjamin getUserMedia stream SELALU dihentikan saat:
     - modal scanner ditutup (lewat modal-manager onModalClose)
     - pindah halaman (page visibility / navigasi)
     - permission ditolak / error
     - tab di-hide (menghemat baterai)
   Ini mencegah baterai boros & kamera "freeze" nyangkut aktif
   di background yang jadi masalah umum di single-file app lama.
════════════════════════════════════════════════════ */

let stream = null;
let rafHandle = null;
let detector = null;
let videoEl = null;
let onDetectCb = null;
let statusCb = null;

function stopLoop() {
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = null;
}

/** Hentikan semua track kamera & lepas semua referensi. Aman dipanggil berkali-kali. */
export function stopCamera() {
  stopLoop();
  if (stream) {
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    stream = null;
  }
  if (videoEl) {
    try { videoEl.srcObject = null; } catch {}
  }
  detector = null;
}

/**
 * Mulai scanner barcode pada elemen <video> tertentu.
 * @param {HTMLVideoElement} video
 * @param {(code:string)=>void} onDetect dipanggil sekali saat barcode terdeteksi
 * @param {(msg:string)=>void} onStatus untuk update teks status ke UI
 */
export async function startCamera(video, onDetect, onStatus) {
  stopCamera(); // pastikan tidak ada sesi lama yang masih nyangkut
  videoEl = video;
  onDetectCb = onDetect;
  statusCb = onStatus;

  if (!('BarcodeDetector' in window)) {
    statusCb?.('⚠️ Browser ini belum mendukung scan otomatis. Silakan ketik kode secara manual.');
    return false;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    statusCb?.('⚠️ Perangkat/browser tidak mendukung akses kamera.');
    return false;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    statusCb?.('⚠️ Tidak bisa mengakses kamera. Periksa izin kamera, atau ketik kode manual.');
    return false;
  }

  // Kalau user menutup modal SEBELUM getUserMedia resolve, stream harus
  // langsung dimatikan lagi (race condition klasik).
  if (!videoEl || !videoEl.isConnected) {
    stopCamera();
    return false;
  }

  videoEl.srcObject = stream;
  try {
    detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
    });
  } catch (e) {
    statusCb?.('⚠️ Gagal menyiapkan detektor barcode.');
    stopCamera();
    return false;
  }

  statusCb?.('Arahkan kamera ke barcode produk…');
  scanLoop();
  return true;
}

async function scanLoop() {
  if (!stream || !detector || !videoEl) return;
  try {
    const codes = await detector.detect(videoEl);
    if (codes && codes.length) {
      const value = codes[0].rawValue;
      statusCb?.('✅ Kode terdeteksi: ' + value);
      onDetectCb?.(value);
      stopCamera();
      return;
    }
  } catch {
    // frame gagal dibaca — bukan fatal, coba lagi di frame berikutnya
  }
  rafHandle = requestAnimationFrame(scanLoop);
}

/** Hentikan kamera otomatis saat tab disembunyikan (hemat baterai). */
export function installCameraLifecycleGuards() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
  });
  window.addEventListener('pagehide', stopCamera);
  window.addEventListener('beforeunload', stopCamera);
}

export function isCameraActive() {
  return !!stream;
}
