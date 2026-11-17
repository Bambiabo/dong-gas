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
  version: 3;
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

// Reuses the database name from the previous full component.
const DATABASE_NAME = "dong-gas-supervisor-v2";
const DATABASE_VERSION = 2;
const WORKSPACE_STORE = "workspace";
const REPORT_STORE = "reports";
const WORKSPACE_KEY = "active-shift";

let databasePromise: Promise<IDBDatabase> | null = null;
let writes: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support offline storage."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE);
      }

      if (!database.objectStoreNames.contains(REPORT_STORE)) {
        database.createObjectStore(REPORT_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };

      resolve(database);
    };

    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Could not open offline storage."));
    };

    request.onblocked = () => {
      databasePromise = null;
      reject(
        new Error(
          "Storage upgrade is blocked. Close other terminal tabs, then reload."
        )
      );
    };
  });

  return databasePromise;
}

function serialize(operation: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => {}).then(operation);
  writes = next;
  return next;
}

async function transactionWrite(
  stores: string[],
  operation: (transaction: IDBTransaction) => void
): Promise<void> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, "readwrite");

    transaction.oncomplete = () => resolve();

    transaction.onerror = () => {
      reject(transaction.error || new Error("Offline save failed."));
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error("Offline save was interrupted."));
    };

    try {
      operation(transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
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
  await writes.catch(() => {});

  const database = await openDatabase();

  const raw = await new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, "readonly");

    const request = transaction
      .objectStore(WORKSPACE_STORE)
      .get(WORKSPACE_KEY);

    request.onsuccess = () => resolve(request.result ?? null);

    request.onerror = () => {
      reject(request.error || new Error("Could not restore the workspace."));
    };
  });

  if (!raw) return null;

  const value = raw as Record<string, unknown>;

  if (
    (value.version !== 2 && value.version !== 3) ||
    typeof value.shiftId !== "string" ||
    typeof value.supervisorName !== "string" ||
    typeof value.openingMeter !== "string"
  ) {
    throw new Error(
      "The saved workspace could not be safely restored. Do not clear browser data."
    );
  }

  const validStages = ["OPENING", "CLOSING", "REPORT", "BLIND_DROP"];

  if (!validStages.includes(String(value.stage))) {
    throw new Error("The saved shift has an invalid stage.");
  }

  // Migrate the previous Blind Drop screen into the normal Closing screen.
  const draft = {
    ...value,
    version: 3,
    stage: value.stage === "BLIND_DROP" ? "CLOSING" : value.stage,
  } as unknown as Draft;

  if (draft.stage === "REPORT" && !draft.report) {
    throw new Error("The saved report is missing.");
  }

  if (value.version === 2) {
    if (draft.report) {
      // Previous REPORT records had already been saved to Supabase.
      // A previous CLOSING record with a report was a frozen retry.
      const wasSynced = value.stage === "REPORT";

      draft.stage = "REPORT";

      await saveCompletedDraft(draft, wasSynced ? "synced" : "pending");
    } else {
      await saveDraft(draft);
    }
  }

  return draft;
}

export function saveDraft(draft: Draft): Promise<void> {
  return serialize(() =>
    transactionWrite([WORKSPACE_STORE], (transaction) => {
      transaction
        .objectStore(WORKSPACE_STORE)
        .put(draft, WORKSPACE_KEY);
    })
  );
}

export function saveCompletedDraft(
  draft: Draft,
  status: "pending" | "synced" = "pending"
): Promise<void> {
  if (!draft.report) {
    return Promise.reject(new Error("The completed report is missing."));
  }

  const record: StoredReport = {
    id: draft.shiftId,
    status,
    report: draft.report,
    savedAt: new Date().toISOString(),
    syncedAt: status === "synced" ? new Date().toISOString() : null,
    lastError: null,
  };

  // The report and workspace are committed together.
  return serialize(() =>
    transactionWrite(
      [WORKSPACE_STORE, REPORT_STORE],
      (transaction) => {
        transaction
          .objectStore(WORKSPACE_STORE)
          .put(draft, WORKSPACE_KEY);

        transaction.objectStore(REPORT_STORE).put(record);
      }
    )
  );
}

export async function listReports(): Promise<StoredReport[]> {
  await writes.catch(() => {});

  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_STORE, "readonly");
    const request = transaction.objectStore(REPORT_STORE).getAll();

    request.onsuccess = () => {
      const records = request.result as StoredReport[];

      resolve(
        records.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      );
    };

    request.onerror = () => {
      reject(request.error || new Error("Could not load saved reports."));
    };
  });
}

export function updateStoredReport(
  id: string,
  patch: Partial<Pick<StoredReport, "status" | "syncedAt" | "lastError">>
): Promise<void> {
  return serialize(() =>
    transactionWrite([REPORT_STORE], (transaction) => {
      const store = transaction.objectStore(REPORT_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        if (!request.result) return;

        store.put({
          ...(request.result as StoredReport),
          ...patch,
        });
      };
    })
  );
}