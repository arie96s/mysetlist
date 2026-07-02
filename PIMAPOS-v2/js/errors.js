/* ════════════════════════════════════════════════════
   GLOBAL ERROR HANDLING
   Menangkap seluruh error yang tidak tertangani (sync & promise
   rejection) supaya aplikasi TIDAK PERNAH menampilkan blank
   screen. Error dicatat, ditampilkan sebagai toast non-blocking
   untuk error ringan, dan sebagai recovery screen untuk error
   fatal saat boot.
════════════════════════════════════════════════════ */

const ERROR_LOG_KEY = 'pimapos_error_log';
const MAX_LOG_ENTRIES = 30;
let toastFn = null; // di-inject dari ui/toast.js supaya modul ini tidak circular-depend

export function setErrorToastHandler(fn) {
  toastFn = fn;
}

function logError(entry) {
  try {
    const raw = localStorage.getItem(ERROR_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push({ ...entry, at: new Date().toISOString() });
    while (list.length > MAX_LOG_ENTRIES) list.shift();
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(list));
  } catch {
    // Kalau logging error saja gagal (storage penuh dsb), diamkan —
    // jangan sampai error handler sendiri melempar error baru.
  }
}

export function getErrorLog() {
  try {
    return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearErrorLog() {
  try { localStorage.removeItem(ERROR_LOG_KEY); } catch {}
}

function notifyUser(message) {
  if (toastFn) {
    try { toastFn(message); return; } catch {}
  }
  // Fallback kalau toast module belum siap (error terjadi sangat awal saat boot)
  console.warn('[PIMAPOS]', message);
}

function showFatalRecoveryScreen(context) {
  if (document.getElementById('pimaposFatalRecovery')) return; // sudah tampil
  const el = document.createElement('div');
  el.id = 'pimaposFatalRecovery';
  el.setAttribute('role', 'alertdialog');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:999999',
    'background:rgba(2,8,23,.96)', 'color:#fff',
    'display:flex', 'flex-direction:column', 'align-items:center',
    'justify-content:center', 'gap:14px', 'padding:24px', 'text-align:center',
    'font-family:-apple-system,Inter,sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-size:20px;font-weight:800;';
  title.textContent = '⚠️ Terjadi kendala teknis';

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:13px;opacity:.7;max-width:340px;line-height:1.6;';
  desc.textContent = 'PIMAPOS mengalami error saat memuat. Data Anda aman tersimpan. Coba muat ulang, atau pulihkan dari cadangan otomatis terakhir.';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;margin-top:8px;';

  const reloadBtn = document.createElement('button');
  reloadBtn.textContent = 'Muat Ulang';
  reloadBtn.style.cssText = 'padding:12px 22px;border-radius:100px;border:none;background:#3b82f6;color:#fff;font-weight:700;font-size:13px;cursor:pointer;';
  reloadBtn.addEventListener('click', () => window.location.reload());

  const detailBtn = document.createElement('button');
  detailBtn.textContent = 'Detail Error';
  detailBtn.style.cssText = 'padding:12px 22px;border-radius:100px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;font-weight:600;font-size:13px;cursor:pointer;';
  detailBtn.addEventListener('click', () => {
    pre.style.display = pre.style.display === 'none' ? 'block' : 'none';
  });

  const pre = document.createElement('pre');
  pre.style.cssText = 'display:none;max-width:90vw;max-height:200px;overflow:auto;font-size:10px;text-align:left;background:rgba(255,255,255,.06);padding:10px;border-radius:8px;';
  pre.textContent = context ? String(context.message || context) : 'Tidak ada detail tambahan.';

  btnRow.append(reloadBtn, detailBtn);
  el.append(title, desc, btnRow, pre);
  document.body.appendChild(el);
}

let fatalDuringBoot = false;
export function markBootPhase(active) {
  fatalDuringBoot = active;
}

function handleCaughtError(message, source, error) {
  logError({ message: String(message), source: source || '', stack: error?.stack || '' });
  if (fatalDuringBoot) {
    showFatalRecoveryScreen({ message });
  } else {
    notifyUser('⚠️ Terjadi kendala kecil, tapi aplikasi tetap berjalan.');
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    // Abaikan error dari resource eksternal (script CDN gagal load dll) yang
    // tidak punya `error` object — biasanya sudah ditangani onerror lokal.
    handleCaughtError(event.message, event.filename, event.error);
    // Jangan mencegah default logging browser, tapi cegah "Uncaught" menutup UI.
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason);
    handleCaughtError(message, 'promise', reason instanceof Error ? reason : null);
  });
}

/**
 * Bungkus fungsi async apa pun supaya error-nya tertangkap rapi
 * dan tidak membuat proses lain berhenti diam-diam.
 */
export function safeAsync(fn, { fallback = undefined, label = 'operation' } = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      logError({ message: e?.message || String(e), source: label, stack: e?.stack || '' });
      notifyUser(`⚠️ Gagal menjalankan ${label}.`);
      return fallback;
    }
  };
}

/** Bungkus fungsi sync (mis. handler render) dengan try/catch + fallback UI. */
export function safeSync(fn, { label = 'operation' } = {}) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      logError({ message: e?.message || String(e), source: label, stack: e?.stack || '' });
      notifyUser(`⚠️ Gagal menjalankan ${label}.`);
      return undefined;
    }
  };
}
