/* ════════════════════════════════════════════════════
   STATE STORE
   Pengganti pola lama `let S=load()` (sync localStorage) dengan
   store async berbasis IndexedDB, plus:
   - debounced save (tidak nulis storage di setiap keystroke)
   - auto-backup snapshot berkala (recovery kalau data korup)
   - validasi minimal saat load; kalau gagal → coba backup
     terakhir → kalau tetap gagal, baru defState() bersih
════════════════════════════════════════════════════ */

import * as db from './db.js';
import { debounce } from './dom.js';

const SAVE_DEBOUNCE_MS = 400;
const BACKUP_EVERY_N_SAVES = 20;
const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000; // minimal 5 menit antar backup otomatis

let saveCounter = 0;
let lastBackupAt = 0;
let _state = null;
let _firstRun = false;
let _listeners = new Set();

export function defState() {
  return {
    storeName: 'Toko Saya',
    storeAddr: '',
    storeCategory: 'F&B',
    storeLogo: '',
    security: { pinEnabled: false, pinHash: '' },
    notif: { enabled: false },
    socials: { whatsapp: '', instagram: '', tiktok: '', facebook: '', shopee: '', tokopedia: '', website: '' },
    theme: 'dark',
    categories: ['Makanan', 'Minuman', 'Snack', 'Lainnya'],
    products: [
      { id: 'p1', name: 'Nasi Goreng', emoji: '🍛', cat: 'Makanan', price: 18000, stock: 30 },
      { id: 'p2', name: 'Es Teh Manis', emoji: '🧋', cat: 'Minuman', price: 5000, stock: 60 },
      { id: 'p3', name: 'Ayam Geprek', emoji: '🍗', cat: 'Makanan', price: 20000, stock: 25 },
      { id: 'p4', name: 'Kopi Susu', emoji: '☕', cat: 'Minuman', price: 12000, stock: 40 },
      { id: 'p5', name: 'Kerupuk', emoji: '🍘', cat: 'Snack', price: 3000, stock: 80 },
      { id: 'p6', name: 'Air Mineral', emoji: '💧', cat: 'Minuman', price: 4000, stock: 100 },
    ],
    transactions: [],
    customers: [],
    holds: [],
    tax: { enabled: false, pct: 10, label: 'PPN' },
    shifts: [],
    activeShift: null,
  };
}

/** Merge state hasil load dengan default, supaya field baru dari update app tidak hilang/undefined. */
function mergeWithDefaults(parsed) {
  const def = defState();
  if (!parsed || typeof parsed !== 'object') return def;
  return {
    ...def,
    ...parsed,
    socials: { ...def.socials, ...(parsed.socials || {}) },
    security: { ...def.security, ...(parsed.security || {}) },
    notif: { ...def.notif, ...(parsed.notif || {}) },
    tax: { ...def.tax, ...(parsed.tax || {}) },
  };
}

/** Validasi struktur minimal supaya data korup tidak lolos jadi state aktif. */
function isValidState(state) {
  return !!state
    && Array.isArray(state.products)
    && Array.isArray(state.transactions)
    && Array.isArray(state.categories);
}

async function recoverFromBackup() {
  try {
    const backups = await db.listBackups();
    if (!backups.length) return null;
    const latest = backups[0]; // sudah di-sort terbaru dulu
    const state = await db.restoreBackup(latest.ts);
    if (isValidState(state)) {
      console.warn('[PIMAPOS][store] State utama korup, dipulihkan dari backup', new Date(latest.ts).toISOString());
      return state;
    }
  } catch (e) {
    console.error('[PIMAPOS][store] Gagal memulihkan dari backup:', e);
  }
  return null;
}

/**
 * Inisialisasi store — WAJIB dipanggil sekali (await) sebelum render
 * pertama kali dijalankan. Melakukan migrasi dari localStorage lama
 * jika perlu, lalu memuat state (dengan recovery kalau korup).
 */
export async function init() {
  await db.migrateFromLocalStorageIfNeeded();
  const raw = await db.getState();
  _firstRun = !raw;

  let candidate = mergeWithDefaults(raw);
  if (!isValidState(candidate)) {
    const recovered = await recoverFromBackup();
    candidate = recovered ? mergeWithDefaults(recovered) : defState();
  }
  _state = candidate;
  return _state;
}

export function isFirstRun() {
  return _firstRun;
}

/** Ambil referensi state aktif (mutable — komponen lama boleh mutate langsung lalu panggil save()). */
export function getState() {
  if (!_state) throw new Error('Store belum di-init(). Panggil await Store.init() saat boot.');
  return _state;
}

/** Ganti seluruh state (dipakai saat import JSON / reset total). */
export function replaceState(newState) {
  _state = mergeWithDefaults(newState);
  notifyListeners();
  return _state;
}

export function onStateReplaced(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function notifyListeners() {
  _listeners.forEach((fn) => { try { fn(_state); } catch (e) { console.error(e); } });
}

const _debouncedPersist = debounce(async () => {
  const ok = await db.setState(_state);
  if (!ok) {
    console.error('[PIMAPOS][store] Gagal menyimpan state ke storage.');
  }
  maybeAutoBackup();
}, SAVE_DEBOUNCE_MS);

/** Simpan state saat ini (debounced — aman dipanggil berkali-kali beruntun). */
export function save() {
  saveCounter += 1;
  _debouncedPersist();
}

/** Simpan segera tanpa debounce (dipakai sebelum aksi kritis, mis. sebelum export/close tab). */
export async function saveNow() {
  _debouncedPersist.cancel();
  const ok = await db.setState(_state);
  maybeAutoBackup(true);
  return ok;
}

function maybeAutoBackup(force = false) {
  const now = Date.now();
  const dueByCount = saveCounter % BACKUP_EVERY_N_SAVES === 0;
  const dueByTime = now - lastBackupAt > BACKUP_MIN_INTERVAL_MS;
  if (force || (dueByCount && dueByTime)) {
    lastBackupAt = now;
    db.addBackup(_state).catch((e) => console.error('[PIMAPOS][store] Auto-backup gagal:', e));
  }
}

export async function listBackups() {
  return db.listBackups();
}

export async function restoreFromBackup(ts) {
  const backupState = await db.restoreBackup(ts);
  if (!isValidState(backupState)) return false;
  replaceState(backupState);
  await saveNow();
  return true;
}

export function isUsingFallbackStorage() {
  return db.isUsingFallback();
}
