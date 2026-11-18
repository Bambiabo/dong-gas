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

const DB_NAME = "dong-gas-v2";

export function dateTime(value: string | number | Date): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function litresText(value: number): string {
  return value.toLocaleString("en-GH", {
    maximumFractionDigits: 3,
  });
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("workspace")) db.createObjectStore("workspace");
      if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function createDraft(price = "10.40"): Promise<Draft> {
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
  const db = await openDb();
  return new Promise((res) => {
    const tx = db.transaction("workspace", "readonly");
    const req = tx.objectStore("workspace").get("active-shift");
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => res(null);
  });
}

export async function saveDraft(draft: Draft): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(draft, "active-shift");
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function saveCompletedDraft(draft: Draft, status: "pending" | "synced" = "pending"): Promise<void> {
  if (!draft.report) return;
  const db = await openDb();
  const record: StoredReport = {
    id: draft.shiftId,
    status,
    report: draft.report,
    savedAt: new Date().toISOString(),
    syncedAt: status === "synced" ? new Date().toISOString() : null,
    lastError: null,
  };
  return new Promise((res, rej) => {
    const tx = db.transaction(["workspace", "reports"], "readwrite");
    tx.objectStore("workspace").put(draft, "active-shift");
    tx.objectStore("reports").put(record);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function listReports(): Promise<StoredReport[]> {
  const db = await openDb();
  return new Promise((res) => {
    const tx = db.transaction("reports", "readonly");
    const req = tx.objectStore("reports").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => res([]);
  });
}

export async function updateStoredReport(id: string, patch: Partial<StoredReport>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("reports", "readwrite");
  const store = tx.objectStore("reports");
  const req = store.get(id);
  req.onsuccess = () => {
    if (req.result) store.put({ ...req.result, ...patch });
  };
}