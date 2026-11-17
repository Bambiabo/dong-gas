const DATABASE_NAME = "dong-gas-supervisor";
const DATABASE_VERSION = 1;
const STORE_NAME = "terminal-state";
const ACTIVE_SHIFT_KEY = "active-shift";

let databasePromise: Promise<IDBDatabase> | null = null;

// Serialize writes so an older save cannot overwrite a newer save.
let writeQueue: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support shift recovery."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
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

      reject(
        request.error || new Error("Could not open shift storage.")
      );
    };

    request.onblocked = () => {
      databasePromise = null;
      reject(
        new Error(
          "Shift storage is blocked. Close other tabs running this terminal and reload."
        )
      );
    };
  });

  return databasePromise;
}

export async function loadActiveShift<T>(): Promise<T | null> {
  await writeQueue.catch(() => {});

  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");

    const request = transaction
      .objectStore(STORE_NAME)
      .get(ACTIVE_SHIFT_KEY);

    request.onsuccess = () => {
      resolve((request.result as T | undefined) ?? null);
    };

    request.onerror = () => {
      reject(request.error || new Error("Could not restore the shift."));
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error("Shift recovery was interrupted."));
    };
  });
}

export function saveActiveShift<T>(value: T): Promise<void> {
  const operation = writeQueue
    .catch(() => {})
    .then(async () => {
      const database = await openDatabase();

      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          STORE_NAME,
          "readwrite"
        );

        transaction
          .objectStore(STORE_NAME)
          .put(value, ACTIVE_SHIFT_KEY);

        transaction.oncomplete = () => resolve();

        transaction.onerror = () => {
          reject(
            transaction.error || new Error("Could not save shift progress.")
          );
        };

        transaction.onabort = () => {
          reject(
            transaction.error || new Error("Saving shift progress was interrupted.")
          );
        };
      });
    });

  writeQueue = operation;
  return operation;
}