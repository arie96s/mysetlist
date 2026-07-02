/* ════════════════════════════════════════════════════
   DOM / TIMING UTILITIES
════════════════════════════════════════════════════ */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, wait = 200) {
  let t = null;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(t);
  debounced.flush = (...args) => { clearTimeout(t); fn(...args); };
  return debounced;
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => { last = Date.now(); fn(...args); }, remaining);
    }
  };
}

/** requestAnimationFrame yang di-batch: hanya menjalankan fn 1x per frame walau dipanggil berkali-kali. */
export function rafBatch(fn) {
  let scheduled = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...lastArgs);
    });
  };
}

/** Cek apakah elemen benar-benar terlihat di viewport (dipakai untuk lazy render). */
export function isInViewport(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom >= 0 && r.top <= (window.innerHeight || document.documentElement.clientHeight);
}
