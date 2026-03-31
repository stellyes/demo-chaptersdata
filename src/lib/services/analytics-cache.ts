// ============================================
// ANALYTICS CACHE — CLIENT-SIDE INDEXEDDB
// Generic gzip-compressed cache for all analytics
// data except raw customer records.
// ============================================

const DB_NAME = 'chapters-analytics-v1';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

// TTL per cache type (milliseconds)
const TTL_MS: Record<string, number> = {
  main:            6 * 60 * 60 * 1000, // 6 h — sales/brands/products/budtenders bundle
  invoices:        8 * 60 * 60 * 1000, // 8 h — invoice line items
  customerSummary: 4 * 60 * 60 * 1000, // 4 h — pre-aggregated customer summary
};

interface CacheEntry {
  key: string;       // composite key: "<type>:<filter-key>"
  data: Uint8Array;  // gzip-compressed JSON
  cachedAt: number;  // epoch ms
  ttl: number;       // ms — stored so we can compare without knowing the type
}

const isBrowser =
  typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser) {
      reject(new Error('[analytics-cache] IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

// ── Compression (reuses native CompressionStream) ─────────────────────────

async function compress(json: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return new TextEncoder().encode(json);
  }
  const src = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(json));
      ctrl.close();
    },
  });
  const reader = src.pipeThrough(new CompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function decompress(compressed: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    return new TextDecoder().decode(compressed);
  }
  const src = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(compressed);
      ctrl.close();
    },
  });
  const reader = src.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Read a cached value. Returns null on miss, expiry, or any error.
 *
 * @param type  - Cache type key (must match a TTL_MS entry)
 * @param key   - Filter-based key built with makeCacheKey()
 */
export async function cacheGet<T>(type: string, key: string): Promise<T | null> {
  if (!isBrowser) return null;
  const fullKey = `${type}:${key}`;
  try {
    const db = await openDB();
    const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(fullKey);
      req.onerror = () => { db.close(); reject(req.error); };
      req.onsuccess = () => { db.close(); resolve(req.result as CacheEntry | undefined); };
    });
    if (!entry) return null;

    const ttl = TTL_MS[type] ?? 6 * 60 * 60 * 1000;
    if (Date.now() - entry.cachedAt > ttl) {
      cacheDelete(type, key).catch(() => {}); // async cleanup
      return null;
    }

    const json = await decompress(entry.data);
    console.log(`[analytics-cache] HIT ${fullKey}`);
    return JSON.parse(json) as T;
  } catch (err) {
    console.warn(`[analytics-cache] cacheGet error for ${fullKey}:`, err);
    return null;
  }
}

/**
 * Write a value to the cache.
 */
export async function cacheSet<T>(type: string, key: string, data: T): Promise<void> {
  if (!isBrowser) return;
  const fullKey = `${type}:${key}`;
  try {
    const compressed = await compress(JSON.stringify(data));
    const sizeMB = (compressed.length / 1024 / 1024).toFixed(2);
    const entry: CacheEntry = {
      key: fullKey,
      data: compressed,
      cachedAt: Date.now(),
      ttl: TTL_MS[type] ?? 6 * 60 * 60 * 1000,
    };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    console.log(`[analytics-cache] SET ${fullKey} (${sizeMB} MB compressed)`);
  } catch (err) {
    console.warn(`[analytics-cache] cacheSet error for ${fullKey}:`, err);
  }
}

/**
 * Delete a single cache entry.
 */
export async function cacheDelete(type: string, key: string): Promise<void> {
  if (!isBrowser) return;
  const fullKey = `${type}:${key}`;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(fullKey);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch { /* ignore */ }
}

/**
 * Wipe the entire analytics cache.
 * Must be called on logout to prevent stale data across sessions.
 */
export async function cacheWipe(): Promise<void> {
  if (!isBrowser) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    console.log('[analytics-cache] Wiped all entries');
  } catch (err) {
    console.warn('[analytics-cache] Wipe failed:', err);
  }
}

/**
 * Build a stable, URL-safe cache key from filter params.
 * Used as the `key` argument for cacheGet/cacheSet.
 */
export function makeCacheKey(
  start?: string | null,
  end?: string | null,
  storeId?: string | null
): string {
  return [start || 'all', end || 'all', storeId || 'combined'].join('_');
}
