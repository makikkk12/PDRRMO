// ===== OFFLINE DATA STORE (IndexedDB) =====
// Keeps a copy of the last data loaded from Supabase so the app can still
// show personnel, entries and history when there is no internet.
// IndexedDB is used instead of localStorage because staff photos are large.

const OfflineStore = (() => {
  const DB_NAME = 'pdrrmo-monitoring';
  const STORE = 'kv';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB not supported'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function get(key) {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('OfflineStore.get failed', e);
      return undefined;
    }
  }

  async function set(key, value) {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('OfflineStore.set failed', e);
    }
  }

  return { get, set };
})();
