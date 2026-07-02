/* ════════════════════════════════════════════════════
   MODAL MANAGER
   Menggantikan pola lama (classList.add/remove('open') tersebar
   di 121 tempat + document.querySelectorAll('.modal-ov.open')
   yang menutup SEMUA modal sekaligus saat Escape). Sekarang:
   - activeModalStack: urutan modal yang sedang terbuka
   - z-index dihitung otomatis per level stack (tidak saling tabrak)
   - body scroll dikunci selama ada modal terbuka, dan posisi
     scroll dikembalikan persis saat modal terakhir ditutup
   - Escape / tap backdrop hanya menutup modal PALING ATAS
   - onClose callback per modal (dipakai a.l. utk stop kamera)
════════════════════════════════════════════════════ */

const BASE_Z = 1000;
const Z_STEP = 10;

const activeModalStack = []; // array of { id, el, onClose, skipBackdropClose }
const closeCallbacks = new Map(); // id -> Set(fn)

let savedScrollY = 0;
let scrollLocked = false;

function lockBodyScroll() {
  if (scrollLocked) return;
  scrollLocked = true;
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}

function unlockBodyScroll() {
  if (!scrollLocked) return;
  scrollLocked = false;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScrollY);
}

function elFor(idOrEl) {
  return typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
}

/** Daftarkan callback yang dijalankan setiap kali modal ini ditutup (mis. stop kamera). */
export function onModalClose(id, fn) {
  if (!closeCallbacks.has(id)) closeCallbacks.set(id, new Set());
  closeCallbacks.get(id).add(fn);
  return () => closeCallbacks.get(id)?.delete(fn);
}

export function isModalOpen(id) {
  return activeModalStack.some((m) => m.id === id);
}

export function topModalId() {
  return activeModalStack.length ? activeModalStack[activeModalStack.length - 1].id : null;
}

/**
 * Buka modal dengan id elemen tertentu. Aman dipanggil berkali-kali
 * (idempotent — modal yang sudah terbuka hanya dinaikkan ke top stack).
 */
export function openModal(id, opts = {}) {
  const el = elFor(id);
  if (!el) {
    console.warn(`[PIMAPOS][modal] Elemen modal #${id} tidak ditemukan.`);
    return;
  }
  // Kalau sudah ada di stack, jangan duplikat — cukup pastikan di top.
  const existingIdx = activeModalStack.findIndex((m) => m.id === id);
  if (existingIdx !== -1) activeModalStack.splice(existingIdx, 1);

  activeModalStack.push({ id, el, skipBackdropClose: !!opts.skipBackdropClose });
  lockBodyScroll();
  reflowStack();

  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

/** Tutup modal tertentu (default: modal paling atas jika id tidak diberikan). */
export function closeModal(id) {
  const targetId = id || topModalId();
  if (!targetId) return;
  const idx = activeModalStack.findIndex((m) => m.id === targetId);
  if (idx === -1) return;

  const [entry] = activeModalStack.splice(idx, 1);
  entry.el.classList.remove('open');
  entry.el.setAttribute('aria-hidden', 'true');
  entry.el.style.zIndex = '';

  const cbs = closeCallbacks.get(targetId);
  if (cbs) cbs.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  reflowStack();
  if (activeModalStack.length === 0) unlockBodyScroll();
}

/** Tutup semua modal (dipakai mis. saat reset total / logout). */
export function closeAllModals() {
  [...activeModalStack].reverse().forEach((m) => closeModal(m.id));
}

function reflowStack() {
  activeModalStack.forEach((m, i) => {
    m.el.style.zIndex = String(BASE_Z + i * Z_STEP);
  });
}

/* ── Global listeners: dipasang sekali saat modul di-init ── */
let initialized = false;
export function initModalManager() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeModalStack.length) {
      closeModal(topModalId());
    }
  });

  // Delegasi klik backdrop: tutup hanya modal paling atas, dan hanya
  // kalau modal itu sendiri yang di-tap (bukan konten di dalamnya).
  document.addEventListener('click', (e) => {
    const top = activeModalStack[activeModalStack.length - 1];
    if (!top || top.skipBackdropClose) return;
    if (e.target === top.el) closeModal(top.id);
  });
}
