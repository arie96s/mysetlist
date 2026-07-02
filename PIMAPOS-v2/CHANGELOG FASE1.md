# PIMAPOS v2 — Audit & Refactor: Catatan Fase 1

Karena GitHub Pages tidak pakai build tool, semua file di sini di-*serve* apa
adanya lewat `<script type="module">` — tinggal upload folder ini (isi
`index.html` + `js/`) ke repo, tidak perlu langkah build apa pun.

## Cara pakai
Upload seluruh isi folder ini (bukan cuma `index.html`) ke root/branch GitHub
Pages kamu, dengan struktur folder tetap seperti ini:
```
index.html
js/
  legacy-app.js
  core/{db,errors,modal-manager}.js
  services/camera.js
  state/store.js
  utils/{sanitize,dom}.js
```

## ✅ Selesai di Fase 1

**1. Security & Stability**
- 18 titik render dengan risiko XSS tertinggi (nama produk, varian, nama &
  no. HP pelanggan, nama toko/alamat, catatan transaksi, item struk, kolom
  pencarian yang di-*reflect* ke DOM) sekarang lewat `esc()` (`js/utils/sanitize.js`).
- Pola `onclick="showReceipt(${JSON.stringify(trx)...})"` yang menyisipkan
  seluruh objek transaksi ke atribut HTML diganti `showReceiptById(id)` yang
  lebih aman & simpel.
- `window.onerror` + `window.onunhandledrejection` global (`js/core/errors.js`),
  dengan fallback recovery screen (bukan blank screen) kalau error terjadi
  saat boot, dan toast non-blocking untuk error ringan saat runtime.

**2. Storage Architecture**
- Migrasi `localStorage` → **IndexedDB** (`js/core/db.js`): versioning +
  migration-step system, auto-migrasi satu kali dari data `localStorage` lama
  supaya tidak ada yang hilang.
- Auto-backup snapshot berkala (rolling window 10 backup) + fungsi restore.
- Fallback otomatis ke `localStorage` kalau IndexedDB tidak tersedia (mis.
  Safari private mode) — app tetap jalan, bukan crash.
- Kalau state utama korup saat load, otomatis coba pulihkan dari backup
  terakhir sebelum jatuh ke default bersih.
- Save di-*debounce* (400ms) supaya tidak menulis storage di tiap keystroke.

**3. Camera & Scanner Stability**
- `js/services/camera.js`: satu sumber kebenaran untuk lifecycle kamera.
  Stream dijamin `stop()` saat modal ditutup (lewat hook Modal Manager),
  tab disembunyikan (`visibilitychange`), atau halaman di-unload — plus
  race-condition lama (user tutup modal *sebelum* `getUserMedia` selesai)
  sudah ditambal.

**4. Modal & Navigation System**
- `js/core/modal-manager.js`: `activeModalStack`, z-index otomatis per
  level, body-scroll lock (dengan restore posisi scroll persis), dan
  Escape/tap-backdrop sekarang hanya menutup modal **paling atas** —
  bukan menutup semua modal sekaligus seperti sebelumnya.
- Onboarding modal dikecualikan dari backdrop-close (tetap wajib pilih).

**5. Production Quality (sebagian)**
- Boot sequence dibungkus try/catch dengan fatal-recovery screen.
- Semua 45 titik `classList.add/remove('open')` untuk modal sudah lewat
  Modal Manager (konsisten, tidak ada lagi modal yang bisa "nyangkut").

## 🔜 Belum dikerjakan (scope Fase 2–5, menunggu konfirmasi lanjut)

Supaya jujur soal cakupan — bagian ini **belum** disentuh di Fase 1:

- **Performance**: partial rendering/DocumentFragment untuk grid produk,
  cart, riwayat; audit `backdrop-filter`/shadow berlebih; debounce search.
- **Event system**: 121 `onclick="..."` inline masih ada (baru pola modal
  yang dibereskan). Konversi ke `addEventListener` + delegasi event.
- **XSS**: 18 titik tertinggi sudah aman, tapi masih ada ~27 `innerHTML`
  lain (kebanyakan markup statis/aman, tapi perlu diaudit satu-satu).
- **Modularisasi lanjutan**: bisnis logic (produk, kasir, laporan, shift,
  BOD/EOD, dst.) masih dalam satu `legacy-app.js` (~2.300 baris) — belum
  dipecah ke `ui/`, `components/`, `services/` sesuai target akhir.
- **Mobile UX**: keyboard resize, bottom-nav jumping, iOS viewport bug,
  overflow, modal height — belum diaudit di fase ini.
- **Loading/empty state, async try/catch menyeluruh** di semua operasi
  (baru boot sequence & error global yang dibungkus).

Kabari kalau mau lanjut ke Fase 2 (Performance + Event System) atau urutan
lain — saya kerjakan bertahap lagi biar setiap hasil tetap bisa dites.
