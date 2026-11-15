import type { TickPoint } from "@/lib/digits";

const DB_NAME = "digitlab-research";
const STORE_NAME = "ticks";
const DB_VERSION = 1;

export type StoredTick = TickPoint & { symbol: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser storage is unavailable."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ["symbol", "epoch", "quote"] });
        store.createIndex("by_symbol_epoch", ["symbol", "epoch"], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local research storage."));
  });
}

export async function saveTicks(symbol: string, points: TickPoint[]): Promise<void> {
  if (!points.length) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const point of points) store.put({ ...point, symbol } satisfies StoredTick);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save research ticks."));
      tx.onabort = () => reject(tx.error ?? new Error("Research tick save was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function loadTicks(symbol: string, limit = 5000): Promise<TickPoint[]> {
  const db = await openDatabase();
  try {
    return await new Promise<TickPoint[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("by_symbol_epoch");
      const range = IDBKeyRange.bound([symbol, 0], [symbol, Number.MAX_SAFE_INTEGER]);
      const request = index.getAll(range, limit);
      request.onsuccess = () => {
        const rows = request.result as StoredTick[];
        resolve(rows.map(({ quote, epoch, pipSize }) => ({ quote, epoch, pipSize })));
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read saved research ticks."));
    });
  } finally {
    db.close();
  }
}

export async function countTicks(symbol: string): Promise<number> {
  const db = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("by_symbol_epoch");
      const range = IDBKeyRange.bound([symbol, 0], [symbol, Number.MAX_SAFE_INTEGER]);
      const request = index.count(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not count saved research ticks."));
    });
  } finally {
    db.close();
  }
}
