// ============================================
// CLIENT-SIDE CUSTOMER DATA CACHE
// Uses IndexedDB with compression for efficient storage
// ============================================

import { CustomerRecord } from '@/types';

const DB_NAME = 'chapters-customer-cache';
const DB_VERSION = 1;
const STORE_NAME = 'customers';
const METADATA_STORE = 'metadata';

interface CacheMetadata {
  id: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  recordCount: number;
  compressedSize: number;
  cachedAt: string;
  serverHash?: string;
}

interface CacheEntry {
  id: string;
  data: Uint8Array; // Compressed data
}

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

// Open IndexedDB connection
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store for compressed customer data
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }

      // Create object store for metadata
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
      }
    };
  });
}

// Compress data using CompressionStream API (native browser API)
async function compressData(data: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    // Fallback: store uncompressed if CompressionStream not available
    return new TextEncoder().encode(data);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });

  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const reader = compressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks into single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

// Decompress data using DecompressionStream API
async function decompressData(compressed: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    // Fallback: assume uncompressed if DecompressionStream not available
    return new TextDecoder().decode(compressed);
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });

  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine and decode
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

// Get cache metadata
export async function getCacheMetadata(): Promise<CacheMetadata | null> {
  if (!isBrowser) return null;

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const store = tx.objectStore(METADATA_STORE);
      const request = store.get('customer-cache-metadata');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);

      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('Error getting cache metadata:', error);
    return null;
  }
}

// Check if cached data covers the requested date range
export async function isCacheValid(
  requestedStart: string,
  requestedEnd: string
): Promise<{ valid: boolean; metadata: CacheMetadata | null }> {
  const metadata = await getCacheMetadata();

  if (!metadata) {
    return { valid: false, metadata: null };
  }

  // Check if cache is older than 1 hour
  const cacheAge = Date.now() - new Date(metadata.cachedAt).getTime();
  const ONE_HOUR = 60 * 60 * 1000;
  if (cacheAge > ONE_HOUR) {
    console.log('Customer cache expired (older than 1 hour)');
    return { valid: false, metadata };
  }

  // Check if requested range is within cached range
  const cachedStart = new Date(metadata.dateRangeStart);
  const cachedEnd = new Date(metadata.dateRangeEnd);
  const reqStart = new Date(requestedStart);
  const reqEnd = new Date(requestedEnd);

  // Cache is valid if it covers the entire requested range
  const isValid = reqStart >= cachedStart && reqEnd <= cachedEnd;

  if (!isValid) {
    console.log(`Cache range mismatch: cached ${metadata.dateRangeStart} to ${metadata.dateRangeEnd}, requested ${requestedStart} to ${requestedEnd}`);
  }

  return { valid: isValid, metadata };
}

// Save customer data to cache
export async function saveToCache(
  customers: CustomerRecord[],
  dateRangeStart: string,
  dateRangeEnd: string,
  serverHash?: string
): Promise<void> {
  if (!isBrowser) return;

  try {
    const db = await openDB();
    const jsonData = JSON.stringify(customers);
    const compressed = await compressData(jsonData);

    const compressionRatio = jsonData.length / compressed.length;
    console.log(`Customer cache: ${customers.length} records, ${(jsonData.length / 1024 / 1024).toFixed(2)}MB -> ${(compressed.length / 1024 / 1024).toFixed(2)}MB (${compressionRatio.toFixed(1)}x compression)`);

    // Save compressed data
    const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');

    const dataStore = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(METADATA_STORE);

    const cacheEntry: CacheEntry = {
      id: 'customer-data',
      data: compressed,
    };

    const metadata: CacheMetadata = {
      id: 'customer-cache-metadata',
      dateRangeStart,
      dateRangeEnd,
      recordCount: customers.length,
      compressedSize: compressed.length,
      cachedAt: new Date().toISOString(),
      serverHash,
    };

    dataStore.put(cacheEntry);
    metaStore.put(metadata);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        console.log(`Customer cache saved: ${metadata.recordCount} records for ${dateRangeStart} to ${dateRangeEnd}`);
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error('Error saving to customer cache:', error);
  }
}

// Load customer data from cache
export async function loadFromCache(): Promise<CustomerRecord[] | null> {
  if (!isBrowser) return null;

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('customer-data');

      request.onerror = () => {
        db.close();
        reject(request.error);
      };

      request.onsuccess = async () => {
        db.close();
        const entry = request.result as CacheEntry | undefined;

        if (!entry || !entry.data) {
          resolve(null);
          return;
        }

        try {
          const jsonData = await decompressData(entry.data);
          const customers = JSON.parse(jsonData) as CustomerRecord[];
          console.log(`Loaded ${customers.length} customers from cache`);
          resolve(customers);
        } catch (err) {
          console.error('Error decompressing cache:', err);
          resolve(null);
        }
      };
    });
  } catch (error) {
    console.error('Error loading from customer cache:', error);
    return null;
  }
}

// Clear the customer cache
export async function clearCache(): Promise<void> {
  if (!isBrowser) return;

  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');

    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(METADATA_STORE).clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        console.log('Customer cache cleared');
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error('Error clearing customer cache:', error);
  }
}

// Get cache size info for display
export async function getCacheInfo(): Promise<{
  hasCache: boolean;
  recordCount: number;
  compressedSizeMB: number;
  dateRange: { start: string; end: string } | null;
  cachedAt: string | null;
} | null> {
  const metadata = await getCacheMetadata();

  if (!metadata) {
    return {
      hasCache: false,
      recordCount: 0,
      compressedSizeMB: 0,
      dateRange: null,
      cachedAt: null,
    };
  }

  return {
    hasCache: true,
    recordCount: metadata.recordCount,
    compressedSizeMB: metadata.compressedSize / 1024 / 1024,
    dateRange: {
      start: metadata.dateRangeStart,
      end: metadata.dateRangeEnd,
    },
    cachedAt: metadata.cachedAt,
  };
}
