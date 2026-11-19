export type Stage = "OPENING" | "CLOSING" | "REPORT";
export type ShiftReport = {
  shiftId: string; supervisor: string; openedAt: string; closedAt: string;
  price: number; openM: number; closeM: number; litres: number;
  expected: number; cash: number; momo: number; expenses: number;
  accounted: number; variance: number;
  openingImage: string | null; closingImage: string | null;
};
export type Draft = {
  version: number; shiftId: string; stage: Stage; updatedAt: string;
  supervisorName: string; fuelPrice: string; openingMeter: string;
  openingImage: string | null; openingSource: string; baselineReady: boolean;
  openedAt: string | null; closingMeter: string; closingImage: string | null;
  cashCollected: string; momoCollected: string; expenses: string;
  report: ShiftReport | null;
};
export type StoredReport = {
  id: string; status: "pending" | "synced"; report: ShiftReport;
  savedAt: string; syncedAt: string | null; lastError: string | null;
};
const DB_NAME = "dong-gas-v2";

export function dateTime(value: string | number | Date): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
export function litresText(value: number): string {
  return value.toLocaleString("en-GH", { maximumFractionDigits: 3 });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Device storage is unavailable. Your shift has not been saved."));
      return;
    }
    let abandoned = false;
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("workspace")) db.createObjectStore("workspace");
      if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "id" });
    };
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("Storage upgrade is blocked. Close other Dong Gas tabs and retry."));
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open device storage."));
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transact<T>(
  stores: string[], mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Device storage transaction was aborted."));
      tx.onerror = () => { failure ??= tx.error; };
      try { operation(tx, (result) => { value = result; }); }
      catch (error) {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      }
    });
  } finally { db.close(); }
}

export function createDraft(price = "10.40"): Draft {
  return {
    version: 3, shiftId: crypto.randomUUID(), stage: "OPENING",
    updatedAt: new Date().toISOString(), supervisorName: "", fuelPrice: price,
    openingMeter: "", openingImage: null, openingSource: "", baselineReady: false,
    openedAt: null, closingMeter: "", closingImage: null,
    cashCollected: "", momoCollected: "", expenses: "", report: null,
  };
}

export function readDraft(): Promise<Draft | null> {
  return transact<Draft | null>(["workspace"], "readonly", (tx, result) => {
    const request = tx.objectStore("workspace").get("active-shift");
    request.onsuccess = () => result((request.result as Draft | undefined) ?? null);
  });
}

export function saveDraft(draft: Draft): Promise<void> {
  return transact<void>(["workspace"], "readwrite", (tx, result) => {
    tx.objectStore("workspace").put(draft, "active-shift");
    result(undefined);
  });
}

export function saveCompletedDraft(
  draft: Draft, status: "pending" | "synced" = "pending",
): Promise<void> {
  if (!draft.report || draft.report.shiftId !== draft.shiftId) {
    return Promise.reject(new Error("A matching completed report is required before saving."));
  }
  const record: StoredReport = {
    id: draft.shiftId, status, report: draft.report,
    savedAt: new Date().toISOString(),
    syncedAt: status === "synced" ? new Date().toISOString() : null,
    lastError: null,
  };
  return transact<void>(["workspace", "reports"], "readwrite", (tx, result) => {
    tx.objectStore("workspace").put(draft, "active-shift");
    tx.objectStore("reports").put(record);
    result(undefined);
  });
}

export function listReports(): Promise<StoredReport[]> {
  return transact<StoredReport[]>(["reports"], "readonly", (tx, result) => {
    const request = tx.objectStore("reports").getAll();
    request.onsuccess = () => result(request.result as StoredReport[]);
  });
}

export function updateStoredReport(id: string, patch: Partial<StoredReport>): Promise<void> {
  return transact<void>(["reports"], "readwrite", (tx, result) => {
    const store = tx.objectStore("reports");
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as StoredReport | undefined;
      if (!current) { tx.abort(); return; }
      store.put({ ...current, ...patch, id: current.id, report: current.report });
      result(undefined);
    };
  });
}
