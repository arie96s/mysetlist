/* ════════════════════════════════════════════════════
   STORAGE LAYER — IndexedDB dengan fallback ke localStorage
   ────────────────────────────────────────────────────
   - Versioning + migration schema (DB_VERSION, MIGRATIONS)
   - Auto-backup snapshot (disimpan di object store terpisah,
     rolling window agar tidak membengkak tanpa batas)
   - Semua API bersifat async (Promise) supaya caller tidak
     perlu tahu apakah backend-nya IndexedDB atau localStorage
   - Jika IndexedDB gagal/tidak tersedia (mis. Safari private
     mode, storage penuh, browser lama), otomatis fallback ke
     localStorage tanpa mengubah kontrak API.
════════════════════════════════════════════════════ */

const DB_NAME = 'pimapos_db';
const DB_VERSION = 1;
const STORE_STATE = 'state';
const STORE_BACKUPS = 'backups';
const STATE_KEY = 'app_state';
const MAX_BACKUPS = 10;
const LS_FALLBACK_KEY = 'pimapos_v1'; // sama dgn key lama, untuk kompatibilitas & fallback

let _dbPromise = null;
let _forceFallback = false;

/* ── Migration steps: tambahkan step baru di sini setiap kali
   DB_VERSION dinaikkan. Setiap step menerima (db, tx, oldVersion). ── */
const MIGRATIONS = [
  {
    version: 1,
    run(db) {
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
        const bStore = db.createObjectStore(STORE_BACKUPS, { keyPath: 'ts' });
        bStore.createIndex('ts', 'ts', { unique: true });
      }
    },
  },
];

function isIndexedDBAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDB() {
  if (_forceFallback || !isIndexedDBAvailable()) return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      _forceFallback = true;
      resolve(null);
      return;
    }

    request.onupgradeneeded = (ev) => {
      const db = request.result;
      MIGRATIONS
        .filter((m) => m.version > ev.oldVersion)
        .sort((a, b) => a.version - b.version)
        .forEach((m) => m.run(db, request.transaction, ev.oldVersion));
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      console.error('[PIMAPOS][db] Gagal membuka IndexedDB, fallback ke localStorage:', request.error);
      _forceFallback = true;
      resolve(null);
    };

    request.onblocked = () => {
      console.warn('[PIMAPOS][db] IndexedDB upgrade diblokir oleh koneksi lain.');
    };
  });

  return _dbPromise;
}

function tx(db, storeName, mode) {
  const t = db.transaction(storeName, mode);
  return t.objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ════════════════════════════════════════════════════
   localStorage FALLBACK (API-compatible, sync wrapped as async)
════════════════════════════════════════════════════ */
const lsFallback = {
  async getState() {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('[PIMAPOS][db] localStorage getState gagal:', e);
      return null;
    }
  },
  async setState(state) {
    try {
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('[PIMAPOS][db] localStorage setState gagal (mungkin kuota penuh):', e);
      return false;
    }
  },
  async addBackup(state) {
    try {
      const key = 'pimapos_backups';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.push({ ts: Date.now(), state });
      while (list.length > MAX_BACKUPS) list.shift();
      localStorage.setItem(key, JSON.stringify(list));
      return true;
    } catch (e) {
      console.error('[PIMAPOS][db] localStorage addBackup gagal:', e);
      return false;
    }
  },
  async listBackups() {
    try {
      const key = 'pimapos_backups';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      return list.map((b) => ({ ts: b.ts })).sort((a, b) => b.ts - a.ts);
    } catch {
      return [];
    }
  },
  async restoreBackup(ts) {
    try {
      const key = 'pimapos_backups';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      const found = list.find((b) => b.ts === ts);
      return found ? found.state : null;
    } catch {
      return null;
    }
  },
};

/* ════════════════════════════════════════════════════
   PUBLIC API
════════════════════════════════════════════════════ */

export async function getState() {
  const db = await openDB();
  if (!db) return lsFallback.getState();
  try {
    const store = tx(db, STORE_STATE, 'readonly');
    const rec = await reqToPromise(store.get(STATE_KEY));
    return rec ? rec.value : null;
  } catch (e) {
    console.error('[PIMAPOS][db] getState gagal, fallback localStorage:', e);
    return lsFallback.getState();
  }
}

export async function setState(state) {
  const db = await openDB();
  if (!db) return lsFallback.setState(state);
  try {
    const store = tx(db, STORE_STATE, 'readwrite');
    await reqToPromise(store.put({ key: STATE_KEY, value: state, updatedAt: Date.now() }));
    return true;
  } catch (e) {
    console.error('[PIMAPOS][db] setState gagal, fallback localStorage:', e);
    return lsFallback.setState(state);
  }
}

export async function addBackup(state) {
  const db = await openDB();
  if (!db) return lsFallback.addBackup(state);
  try {
    const store = tx(db, STORE_BACKUPS, 'readwrite');
    await reqToPromise(store.put({ ts: Date.now(), value: state }));
    // Rolling window: hapus backup tertua kalau melebihi batas
    const allKeys = await reqToPromise(store.getAllKeys());
    if (allKeys.length > MAX_BACKUPS) {
      const sorted = [...allKeys].sort((a, b) => a - b);
      const excess = sorted.slice(0, sorted.length - MAX_BACKUPS);
      const delStore = tx(db, STORE_BACKUPS, 'readwrite');
      excess.forEach((k) => delStore.delete(k));
    }
    return true;
  } catch (e) {
    console.error('[PIMAPOS][db] addBackup gagal:', e);
    return false;
  }
}

export async function listBackups() {
  const db = await openDB();
  if (!db) return lsFallback.listBackups();
  try {
    const store = tx(db, STORE_BACKUPS, 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.map((b) => ({ ts: b.ts })).sort((a, b) => b.ts - a.ts);
  } catch (e) {
    console.error('[PIMAPOS][db] listBackups gagal:', e);
    return [];
  }
}

export async function restoreBackup(ts) {
  const db = await openDB();
  if (!db) return lsFallback.restoreBackup(ts);
  try {
    const store = tx(db, STORE_BACKUPS, 'readonly');
    const rec = await reqToPromise(store.get(ts));
    return rec ? rec.value : null;
  } catch (e) {
    console.error('[PIMAPOS][db] restoreBackup gagal:', e);
    return null;
  }
}

/**
 * Migrasi satu kali dari localStorage lama (key 'pimapos_v1') ke IndexedDB,
 * dipanggil saat startup. Aman dipanggil berkali-kali (idempotent) — hanya
 * jalan kalau IndexedDB masih kosong tapi localStorage lama ada isinya.
 */
export async function migrateFromLocalStorageIfNeeded() {
  const db = await openDB();
  if (!db) return; // sudah pakai localStorage, tidak perlu migrasi
  try {
    const existing = await getState();
    if (existing) return; // IndexedDB sudah punya data, skip
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    await setState(parsed);
    console.info('[PIMAPOS][db] Migrasi data dari localStorage ke IndexedDB berhasil.');
  } catch (e) {
    console.error('[PIMAPOS][db] Migrasi dari localStorage gagal (data lama tetap aman di localStorage):', e);
  }
}

/** Dipakai oleh test/diagnostic untuk memaksa mode fallback. */
export function _forceLocalStorageFallback(force = true) {
  _forceFallback = force;
  _dbPromise = null;
}

export function isUsingFallback() {
  return _forceFallback || !isIndexedDBAvailable();
}
