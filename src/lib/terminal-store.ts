export type Stage = "OPENING" | "CLOSING" | "REPORT";

export type ShiftReport = {
  shiftId: string;
  supervisor: string;
  openedAt: string;
  closedAt: string;
  price: number;
  openM: number;
  closeM: number;
  litres: number;
  expected: number;
  cash: number;
  momo: number;
  expenses: number;
  accounted: number;
  variance: number;
  openingImage: string | null;
  closingImage: string | null;
};

export type Draft = {
  version: number;
  shiftId: string;
  stage: Stage;
  updatedAt: string;
  supervisorName: string;
  fuelPrice: string;
  openingMeter: string;
  openingImage: string | null;
  openingSource: string;
  baselineReady: boolean;
  openedAt: string | null;
  closingMeter: string;
  closingImage: string | null;
  cashCollected: string;
  momoCollected: string;
  expenses: string;
  report: ShiftReport | null;
};

export type StoredReport = {
  id: string;
  status: "pending" | "synced";
  report: ShiftReport;
  savedAt: string;
  syncedAt: string | null;
  lastError: string | null;
};

// Keep the existing database, version, store names and record key.
// No existing workspace or report is deleted or migrated.
const DB_NAME = "dong-gas-v2";
const DB_VERSION = 2;
const ACTIVE_SHIFT_KEY = "active-shift";

export function dateTime(value: string | number | Date): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function litresText(value: number): string {
  return value.toLocaleString("en-GH", { maximumFractionDigits: 3 });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser storage is unavailable. Do not continue until local recovery is working."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("workspace")) db.createObjectStore("workspace");
      if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error("Could not open saved shift storage."));
    request.onblocked = () => {
      reject(new Error("Another tab is blocking storage access. Finish any save, close other terminal tabs, and retry. Do not clear site data."));
    };
  });
}

async function transact<T>(
  names: string[],
  mode: IDBTransactionMode,
  initial: T,
  work: (tx: IDBTransaction, setResult: (value: T) => void, fail: (error: Error) => void) => void
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      let result = initial;
      let failure: Error | null = null;
      const tx = db.transaction(names, mode);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error("Local save was aborted. Your operation is not confirmed."));
      tx.onerror = () => {
        failure = failure || tx.error || new Error("Local storage failed. Check browser storage capacity.");
      };
      const fail = (error: Error) => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      };
      try {
        work(tx, (value) => { result = value; }, fail);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Local storage operation failed."));
      }
    });
  } finally {
    db.close();
  }
}

function assertDraft(value: unknown): asserts value is Draft {
  if (!value || typeof value !== "object") throw new Error("Saved workspace needs recovery. It has not been replaced.");
  const candidate = value as Partial<Draft>;
  if (typeof candidate.shiftId !== "string" || !candidate.shiftId ||
      !["OPENING", "CLOSING", "REPORT"].includes(String(candidate.stage))) {
    throw new Error("Saved workspace has an unsupported format. It has not been replaced or deleted.");
  }
}

function sameReport(a: ShiftReport, b: ShiftReport): boolean {
  const keys: (keyof ShiftReport)[] = [
    "shiftId", "supervisor", "openedAt", "closedAt", "price", "openM", "closeM",
    "litres", "expected", "cash", "momo", "expenses", "accounted", "variance",
    "openingImage", "closingImage",
  ];
  return keys.every((key) => a[key] === b[key]);
}

export function createDraft(price = "10.40"): Draft {
  return {
    version: 3,
    shiftId: crypto.randomUUID(),
    stage: "OPENING",
    updatedAt: new Date().toISOString(),
    supervisorName: "",
    fuelPrice: price,
    openingMeter: "",
    openingImage: null,
    openingSource: "",
    baselineReady: false,
    openedAt: null,
    closingMeter: "",
    closingImage: null,
    cashCollected: "",
    momoCollected: "",
    expenses: "",
    report: null,
  };
}

export async function readDraft(): Promise<Draft | null> {
  return transact<Draft | null>(["workspace"], "readonly", null, (tx, setResult, fail) => {
    const request = tx.objectStore("workspace").get(ACTIVE_SHIFT_KEY);
    request.onsuccess = () => {
      if (request.result === undefined || request.result === null) return;
      try {
        assertDraft(request.result);
        setResult(request.result);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Saved workspace needs recovery."));
      }
    };
  });
}

export async function saveDraft(draft: Draft): Promise<void> {
  assertDraft(draft);
  await transact<void>(["workspace"], "readwrite", undefined, (tx) => {
    tx.objectStore("workspace").put(draft, ACTIVE_SHIFT_KEY);
  });
}

export async function saveCompletedDraft(
  draft: Draft,
  status: "pending" | "synced" = "pending"
): Promise<void> {
  assertDraft(draft);
  const report = draft.report;
  if (!report || report.shiftId !== draft.shiftId || draft.stage !== "REPORT") {
    throw new Error("The completed report is missing or does not match this shift. Nothing was marked saved.");
  }
  await transact<void>(["workspace", "reports"], "readwrite", undefined, (tx, _setResult, fail) => {
    const reports = tx.objectStore("reports");
    const request = reports.get(draft.shiftId);
    request.onsuccess = () => {
      try {
        const previous = request.result as StoredReport | undefined;
        if (previous && !sameReport(previous.report, report)) {
          fail(new Error("A different report already uses this local shift reference. Existing data is retained."));
          return;
        }
        const finalStatus = previous?.status === "synced" || status === "synced" ? "synced" : "pending";
        const record: StoredReport = {
          id: draft.shiftId,
          status: finalStatus,
          report,
          savedAt: previous?.savedAt || new Date().toISOString(),
          syncedAt: finalStatus === "synced" ? previous?.syncedAt || new Date().toISOString() : null,
          lastError: finalStatus === "synced" ? null : previous?.lastError || null,
        };
        tx.objectStore("workspace").put(draft, ACTIVE_SHIFT_KEY);
        reports.put(record);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Could not save the completed report."));
      }
    };
  });
}

export async function listReports(): Promise<StoredReport[]> {
  return transact<StoredReport[]>(["reports"], "readonly", [], (tx, setResult, fail) => {
    const request = tx.objectStore("reports").getAll();
    request.onsuccess = () => {
      const rows = request.result as StoredReport[];
      if (rows.some((row) => !row || typeof row.id !== "string" || !row.report ||
          (row.status !== "pending" && row.status !== "synced"))) {
        fail(new Error("Saved reports need recovery. Existing storage has not been cleared."));
        return;
      }
      setResult(rows);
    };
  });
}

export async function updateStoredReport(id: string, patch: Partial<StoredReport>): Promise<void> {
  if (patch.id !== undefined && patch.id !== id) throw new Error("A report reference cannot be changed.");
  await transact<void>(["reports"], "readwrite", undefined, (tx, _setResult, fail) => {
    const store = tx.objectStore("reports");
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const existing = request.result as StoredReport | undefined;
        if (!existing) {
          fail(new Error("The local report could not be found. Upload status was not confirmed."));
          return;
        }
        if (patch.report && !sameReport(existing.report, patch.report)) {
          fail(new Error("A saved report cannot be silently replaced during status updates."));
          return;
        }
        const next: StoredReport = { ...existing, ...patch, id, report: existing.report };
        if (existing.status === "synced") {
          next.status = "synced";
          next.syncedAt = existing.syncedAt;
          next.lastError = null;
        }
        store.put(next);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Could not update local upload status."));
      }
    };
  });
}