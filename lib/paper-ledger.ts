export type PaperDecision = {
  id: string;
  market: string;
  tickEpoch: number;
  tickQuote: number;
  decision: "TRADE" | "WAIT" | "NO TRADE";
  triggerDigit: number | null;
  proposedDigit: number | null;
  approvedDigit: number | null;
  confidence: number;
  holdoutAccuracy: number;
  holdoutSamples: number;
  outcomeDigit: number | null;
  hit: boolean | null;
};

const DB_NAME = "digitlab-research";
const STORE = "paper-decisions";
const VERSION = 2;

function openLedger(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("ticks")) {
        const ticks = db.createObjectStore("ticks", { keyPath: ["symbol", "epoch", "quote"] });
        ticks.createIndex("by_symbol_epoch", ["symbol", "epoch"], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const ledger = db.createObjectStore(STORE, { keyPath: "id" });
        ledger.createIndex("by_market_epoch", ["market", "tickEpoch"], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open paper ledger"));
  });
}

export async function loadPaperLedger(market: string): Promise<PaperDecision[]> {
  const db = await openLedger();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index("by_market_epoch");
      const req = index.getAll(IDBKeyRange.bound([market, 0], [market, Number.MAX_SAFE_INTEGER]));
      req.onsuccess = () => resolve((req.result as PaperDecision[]).sort((a, b) => a.tickEpoch - b.tickEpoch));
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function recordPaperDecision(market: string, decision: PaperDecision): Promise<PaperDecision[]> {
  const db = await openLedger();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const index = store.index("by_market_epoch");
      const req = index.getAll(IDBKeyRange.bound([market, 0], [market, Number.MAX_SAFE_INTEGER]));
      req.onsuccess = () => {
        const rows = req.result as PaperDecision[];
        const exists = rows.some((row) => row.id === decision.id);
        if (!exists) store.put(decision);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return await loadPaperLedger(market);
  } finally { db.close(); }
}

export async function settlePaperDecision(market: string, id: string, outcomeDigit: number): Promise<PaperDecision[]> {
  const db = await openLedger();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(id);
      get.onsuccess = () => {
        const row = get.result as PaperDecision | undefined;
        if (row && row.market === market && row.outcomeDigit === null) {
          row.outcomeDigit = outcomeDigit;
          row.hit = row.decision === "TRADE" && row.approvedDigit !== null ? row.approvedDigit === outcomeDigit : null;
          store.put(row);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return await loadPaperLedger(market);
  } finally { db.close(); }
}
