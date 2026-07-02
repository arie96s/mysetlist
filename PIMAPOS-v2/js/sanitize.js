/* ════════════════════════════════════════════════════
   SANITIZE / SAFE RENDER
   Semua data yang berasal dari input pengguna (nama produk,
   nama pelanggan, nama toko, catatan, dll) WAJIB lewat esc()
   sebelum masuk ke template innerHTML. Untuk kasus yang lebih
   aman lagi, pakai html`` tagged template di bawah — otomatis
   meng-escape setiap ${...} interpolation.
════════════════════════════════════════════════════ */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Escape sebuah string agar aman dimasukkan ke dalam innerHTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (ch) => ESCAPE_MAP[ch]);
}

/** Escape khusus untuk dipakai di dalam atribut HTML (mis. data-cat="..."). */
export function escAttr(value) {
  return esc(value);
}

/**
 * Tagged template literal: setiap ${...} otomatis di-escape,
 * kecuali dibungkus raw(...) secara eksplisit (dipakai HANYA
 * untuk markup yang benar-benar sudah dipercaya / statis).
 *
 * Contoh:
 *   el.innerHTML = html`<div>${untrustedName}</div>`;
 */
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    const val = values[i - 1];
    return out + (i > 0 ? stringifyValue(val) : '') + str;
  });
}

function stringifyValue(val) {
  if (val instanceof RawHTML) return val.value;
  if (Array.isArray(val)) return val.map(stringifyValue).join('');
  return esc(val);
}

class RawHTML {
  constructor(value) { this.value = String(value ?? ''); }
}

/** Tandai markup sebagai "sudah aman" (mis. hasil dari html`` lain). Gunakan hati-hati. */
export function raw(value) {
  return new RawHTML(value);
}

/** Render node teks murni (paling aman) — pengganti innerHTML untuk teks tunggal. */
export function setText(el, value) {
  if (!el) return;
  el.textContent = value ?? '';
}

/**
 * Render list of items ke container menggunakan DocumentFragment
 * (menghindari reflow berulang dari innerHTML += / rebuild penuh).
 * renderItem(item, index) harus mengembalikan sebuah Element.
 */
export function renderList(container, items, renderItem) {
  if (!container) return;
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const node = renderItem(item, i);
    if (node) frag.appendChild(node);
  });
  container.replaceChildren(frag);
}

/** Buat Element dari HTML string yang SUDAH di-escape dengan aman (via html``). */
export function elFromHTML(safeHtmlString) {
  const tpl = document.createElement('template');
  tpl.innerHTML = safeHtmlString.trim();
  return tpl.content.firstElementChild;
}
