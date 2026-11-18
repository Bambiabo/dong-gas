"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  FormEvent,
  ReactNode,
} from "react";

import { supabase } from "@/lib/supabase";

import {
  createDraft,
  listReports,
  readDraft,
  saveCompletedDraft,
  saveDraft,
  updateStoredReport,
} from "@/lib/terminal-store";

import type {
  Draft,
  ShiftReport,
  StoredReport,
} from "@/lib/terminal-store";

import {
  STATION_NAME,
  buildPdf,
  dateTime,
  downloadBlob,
  ghs,
  litresText,
  reportFilename,
  reportSummary,
  shiftReference,
} from "@/lib/terminal-pdf";

const OWNER_WHATSAPP = (
  process.env.NEXT_PUBLIC_OWNER_WHATSAPP || ""
).replace(/\D/g, "");

type Notice = {
  type: "info" | "success" | "error";
  text: string;
};

type SaveStatus =
  | "saving"
  | "saved"
  | "error";

type OfflineStatus =
  | "unchecked"
  | "preparing"
  | "prepared"
  | "unavailable";

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-950/60 " +
  "px-4 py-3.5 text-base text-slate-100 outline-none transition " +
  "placeholder:text-slate-600 focus:border-amber-400/70 " +
  "focus:ring-4 focus:ring-amber-400/10 disabled:opacity-50";

const labelCls =
  "mb-2 block text-[10px] font-semibold uppercase " +
  "tracking-[0.15em] text-slate-400";

const primaryCls =
  "flex min-h-12 w-full items-center justify-center gap-2 " +
  "rounded-xl bg-amber-400 px-5 py-4 text-sm font-semibold " +
  "text-slate-950 transition hover:bg-amber-300 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const secondaryCls =
  "flex min-h-12 w-full items-center justify-center gap-2 " +
  "rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 " +
  "text-xs font-medium text-slate-300 transition " +
  "hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50";

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    return String(error.message);
  }

  return "An unexpected error occurred.";
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "rounded-2xl border border-slate-800 " +
        "bg-slate-900/75 p-5 " +
        className
      }
    >
      {children}
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-xs leading-5">
      <dt className="text-slate-400">{label}</dt>

      <dd className="max-w-[65%] break-words text-right font-medium">
        {value}
      </dd>
    </div>
  );
}

async function prepareOfflineFiles() {
  if (
    process.env.NODE_ENV !== "production" ||
    !("serviceWorker" in navigator)
  ) {
    throw new Error(
      "Offline reopening is prepared in the production build."
    );
  }

  await navigator.serviceWorker.register(
    "/terminal-sw.js",
    { scope: "/" }
  );

  const registration =
    await navigator.serviceWorker.ready;

  await import("jspdf");

  const worker = registration.active;

  if (!worker) {
    throw new Error(
      "The offline worker is not active yet."
    );
  }

  const assets = new Set<string>();

  performance
    .getEntriesByType("resource")
    .forEach((entry) => {
      const url = new URL(
        entry.name,
        window.location.origin
      );

      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/_next/static/")
      ) {
        assets.add(url.href);
      }
    });

  document
    .querySelectorAll<HTMLScriptElement>("script[src]")
    .forEach((element) => {
      const url = new URL(
        element.src,
        window.location.origin
      );

      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/_next/static/")
      ) {
        assets.add(url.href);
      }
    });

  document
    .querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"]'
    )
    .forEach((element) => {
      const url = new URL(
        element.href,
        window.location.origin
      );

      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/_next/static/")
      ) {
        assets.add(url.href);
      }
    });

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();

    const timeout = window.setTimeout(() => {
      channel.port1.close();

      reject(
        new Error(
          "Offline preparation timed out. Retry online."
        )
      );
    }, 60000);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();

      if (event.data?.ok) {
        resolve();
      } else {
        reject(
          new Error(
            event.data?.error ||
              "Offline preparation failed."
          )
        );
      }
    };

    worker.postMessage(
      {
        type: "PREPARE_TERMINAL_OFFLINE",
        path: window.location.pathname,
        assets: [...assets],
      },
      [channel.port2]
    );
  });
}

export default function SupervisorTerminal() {
  const [draft, setDraft] =
    useState<Draft | null>(null);

  const [records, setRecords] =
    useState<StoredReport[]>([]);

  const [loading, setLoading] = useState(true);

  const [recoveryError, setRecoveryError] =
    useState<string | null>(null);

  const [restored, setRestored] = useState(false);
  const [online, setOnline] = useState(true);

  const [saveStatus, setSaveStatus] =
    useState<SaveStatus>("saving");

  const [lastSavedAt, setLastSavedAt] =
    useState<string | null>(null);

  const [offlineStatus, setOfflineStatus] =
    useState<OfflineStatus>("unchecked");

  const [offlineDetail, setOfflineDetail] =
    useState("");

  const [notice, setNotice] =
    useState<Notice | null>(null);

  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingMeter, setSyncingMeter] =
    useState(false);

  const [exporting, setExporting] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [cameraActive, setCameraActive] =
    useState(false);

  const [cameraStarting, setCameraStarting] =
    useState(false);

  const [rearCamera, setRearCamera] = useState(true);
  const [scanning, setScanning] = useState(false);

  const [scannedValue, setScannedValue] =
    useState<string | null>(null);

  const videoRef =
    useRef<HTMLVideoElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);

  const cameraRequestRef = useRef(0);
  const scanRequestRef = useRef(0);
  const saveRevisionRef = useRef(0);

  const actionLockRef = useRef(false);
  const syncLockRef = useRef(false);
  const offlineLockRef = useRef(false);

  const notify = useCallback(
    (type: Notice["type"], text: string) => {
      setNotice({ type, text });
    },
    []
  );

  const patchDraft = (patch: Partial<Draft>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
        : current
    );
  };

  const persist = useCallback(
    async (value: Draft) => {
      const revision = ++saveRevisionRef.current;

      setSaveStatus("saving");

      try {
        await saveDraft(value);

        if (revision === saveRevisionRef.current) {
          setSaveStatus("saved");
          setLastSavedAt(value.updatedAt);
        }
      } catch (error) {
        if (revision === saveRevisionRef.current) {
          setSaveStatus("error");
        }

        throw error;
      }
    },
    []
  );

  const refreshRecords = useCallback(async () => {
    const saved = await listReports();
    setRecords(saved);
    return saved;
  }, []);

  const fetchBaseline = useCallback(async () => {
    const { data, error } =
      await supabase.rpc(
        "get_main_pump_opening"
      );

    if (error) throw error;

    const row = Array.isArray(data)
      ? data[0]
      : null;

    const meter =
      row?.opening_meter == null
        ? NaN
        : Number(row.opening_meter);

    if (!Number.isFinite(meter) || meter < 0) {
      throw new Error(
        "Configure the main pump baseline before opening the first shift."
      );
    }

    return {
      meter: String(meter),
      source: String(
        row.source || "Station baseline"
      ),
    };
  }, []);

  const syncPending = useCallback(
    async (manual = false) => {
      if (syncLockRef.current) return;

      if (!navigator.onLine) {
        if (manual) {
          notify(
            "info",
            "You are offline. Saved shifts remain on this device."
          );
        }
        return;
      }

      syncLockRef.current = true;
      setSyncing(true);

      let uploaded = 0;
      let failed = false;

      try {
        const pending = (await listReports())
          .filter(
            (record) =>
              record.status === "pending"
          )
          .sort((a, b) =>
            a.report.closedAt.localeCompare(
              b.report.closedAt
            )
          );

        for (const record of pending) {
          const report = record.report;
          const controller =
            new AbortController();

          const timeout = window.setTimeout(
            () => controller.abort(),
            30000
          );

          try {
            const payload = {
              client_shift_id: report.shiftId,
              supervisor_name: report.supervisor,
              fuel_price: report.price,
              opening_meter: report.openM,
              closing_meter: report.closeM,
              cash_collected: report.cash,
              momo_collected: report.momo,
              expenses: report.expenses,
              opening_proof_image:
                report.openingImage,
              proof_image: report.closingImage,
            };

            const { error } = await supabase
              .rpc(
                "submit_supervisor_shift",
                { p_payload: payload }
              )
              .abortSignal(controller.signal);

            if (error) throw error;

            await updateStoredReport(
              record.id,
              {
                status: "synced",
                syncedAt:
                  new Date().toISOString(),
                lastError: null,
              }
            );

            uploaded += 1;
          } catch (error) {
            failed = true;

            await updateStoredReport(
              record.id,
              {
                lastError: errorText(error),
              }
            );

            break;
          } finally {
            window.clearTimeout(timeout);
          }
        }

        await refreshRecords();

        if (manual) {
          notify(
            failed ? "error" : "success",
            failed
              ? "Some shifts remain pending. Open saved shifts to inspect the upload error."
              : uploaded
              ? `${uploaded} shift${
                  uploaded === 1 ? "" : "s"
                } synced.`
              : "No pending shifts to upload."
          );
        }
      } catch (error) {
        if (manual) {
          notify("error", errorText(error));
        }
      } finally {
        syncLockRef.current = false;
        setSyncing(false);
      }
    },
    [notify, refreshRecords]
  );

  const prepareOffline = useCallback(
    async (manual = false) => {
      if (offlineLockRef.current) return;

      offlineLockRef.current = true;
      setOfflineStatus("preparing");

      try {
        await prepareOfflineFiles();

        setOfflineStatus("prepared");

        setOfflineDetail(
          "App files cached. Test reopening once in airplane mode."
        );

        if (manual) {
          notify(
            "success",
            "Offline files prepared. Test once in airplane mode."
          );
        }
      } catch (error) {
        setOfflineStatus("unavailable");
        setOfflineDetail(errorText(error));

        if (manual) {
          notify("error", errorText(error));
        }
      } finally {
        offlineLockRef.current = false;
      }
    },
    [notify]
  );

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        setOnline(navigator.onLine);

        const saved = await readDraft();
        const localReports = await listReports();

        if (cancelled) return;

        let current = saved;

        if (!current) {
          current = createDraft();

          const latestLocal = [
            ...localReports,
          ].sort((a, b) =>
            b.report.closedAt.localeCompare(
              a.report.closedAt
            )
          )[0];

          if (latestLocal) {
            current.openingMeter =
              String(
                latestLocal.report.closeM
              );

            current.openingSource =
              "Previous shift on this device";

            current.baselineReady = true;

            current.fuelPrice =
              String(
                latestLocal.report.price
              );
          } else if (navigator.onLine) {
            try {
              const baseline =
                await fetchBaseline();

              current.openingMeter =
                baseline.meter;

              current.openingSource =
                baseline.source;

              current.baselineReady = true;
            } catch (error) {
              if (!cancelled) {
                notify(
                  "error",
                  errorText(error)
                );
              }
            }
          }

          if (cancelled) return;

          await saveDraft(current);
        }

        if (cancelled) return;

        setDraft(current);
        setRecords(localReports);
        setRestored(Boolean(saved));
        setLastSavedAt(current.updatedAt);
        setSaveStatus("saved");
        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        setRecoveryError(
          errorText(error)
        );

        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [fetchBaseline, notify]);

  useEffect(() => {
    if (
      !draft ||
      loading ||
      recoveryError
    ) {
      return;
    }

    void persist(draft).catch(
      console.error
    );
  }, [
    draft,
    loading,
    recoveryError,
    persist,
  ]);

  useEffect(() => {
    if (loading || recoveryError) return;

    const onOnline = () => {
      setOnline(true);
      void syncPending();
      void prepareOffline();
    };

    const onOffline = () => {
      setOnline(false);
    };

    const onFocus = () => {
      if (navigator.onLine) {
        void syncPending();
      }
    };

    window.addEventListener(
      "online",
      onOnline
    );

    window.addEventListener(
      "offline",
      onOffline
    );

    window.addEventListener(
      "focus",
      onFocus
    );

    if (navigator.onLine) {
      void syncPending();
      void prepareOffline();
    }

    const interval =
      window.setInterval(() => {
        if (navigator.onLine) {
          void syncPending();
        }
      }, 45000);

    return () => {
      window.removeEventListener(
        "online",
        onOnline
      );

      window.removeEventListener(
        "offline",
        onOffline
      );

      window.removeEventListener(
        "focus",
        onFocus
      );

      window.clearInterval(interval);
    };
  }, [
    loading,
    recoveryError,
    syncPending,
    prepareOffline,
  ]);

  useEffect(() => {
    if (
      !cameraActive ||
      !videoRef.current ||
      !streamRef.current
    ) {
      return;
    }

    videoRef.current.srcObject =
      streamRef.current;

    void videoRef.current
      .play()
      .catch(() => {});
  }, [cameraActive, cameraStarting]);

  useEffect(() => {
    return () => {
      cameraRequestRef.current += 1;
      scanRequestRef.current += 1;

      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        );
    };
  }, []);

  const stopCamera = () => {
    cameraRequestRef.current += 1;

    streamRef.current
      ?.getTracks()
      .forEach((track) =>
        track.stop()
      );

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setCameraStarting(false);
  };

  const startCamera = async (
    rear: boolean
  ) => {
    stopCamera();

    if (
      !navigator.mediaDevices
        ?.getUserMedia
    ) {
      notify(
        "error",
        "Camera unavailable. Use HTTPS or localhost and allow camera permission."
      );
      return;
    }

    const requestId =
      ++cameraRequestRef.current;

    setCameraActive(true);
    setCameraStarting(true);
    setScannedValue(null);

    try {
      let stream: MediaStream;

      try {
        stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: rear
                ? {
                    exact:
                      "environment",
                  }
                : "user",
            },
            audio: false,
          });
      } catch {
        if (
          requestId !==
          cameraRequestRef.current
        ) {
          return;
        }

        stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: rear
                ? "environment"
                : "user",
            },
            audio: false,
          });
      }

      if (
        requestId !==
        cameraRequestRef.current
      ) {
        stream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject =
          stream;

        await videoRef.current
          .play()
          .catch(() => {});
      }

      setCameraStarting(false);
    } catch (error) {
      if (
        requestId !==
        cameraRequestRef.current
      ) {
        return;
      }

      stopCamera();

      notify(
        "error",
        `Could not open camera: ${errorText(
          error
        )}`
      );
    }
  };

  const runOCR = async (
    image: string
  ) => {
    if (!navigator.onLine) {
      notify(
        "info",
        "Photo retained offline. Enter the closing reading manually."
      );
      return;
    }

    const requestId =
      ++scanRequestRef.current;

    const controller =
      new AbortController();

    const timeout = window.setTimeout(
      () => controller.abort(),
      25000
    );

    setScanning(true);

    try {
      const response = await fetch(
        "/api/ocr",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            image,
          }),

          signal:
            controller.signal,
        }
      );

      const data: {
        digits?: string | number;
      } = await response.json();

      if (
        requestId !==
        scanRequestRef.current
      ) {
        return;
      }

      const digits = String(
        data.digits ?? ""
      )
        .trim()
        .replace(/,/g, "");

      if (
        response.ok &&
        /^\d+(?:\.\d+)?$/.test(
          digits
        ) &&
        Number.isFinite(
          Number(digits)
        )
      ) {
        setScannedValue(digits);

        notify(
          "success",
          "Review the AI reading against the photo."
        );
      } else {
        notify(
          "info",
          "AI could not read the meter clearly. Enter the closing reading manually."
        );
      }
    } catch {
      if (
        requestId ===
        scanRequestRef.current
      ) {
        notify(
          "info",
          "AI is unavailable. Your photo is retained."
        );
      }
    } finally {
      window.clearTimeout(timeout);

      if (
        requestId ===
        scanRequestRef.current
      ) {
        setScanning(false);
      }
    }
  };

  const capturePhoto = async (
    opening: boolean
  ) => {
    const video = videoRef.current;

    if (
      !video ||
      video.readyState < 2 ||
      !video.videoWidth
    ) {
      notify(
        "info",
        "Wait for the camera preview."
      );
      return;
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    const scale = Math.min(
      1,
      1600 / video.videoWidth
    );

    canvas.width = Math.round(
      video.videoWidth * scale
    );

    canvas.height = Math.round(
      video.videoHeight * scale
    );

    const context =
      canvas.getContext("2d");

    if (!context) return;

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const image = canvas.toDataURL(
      "image/jpeg",
      0.85
    );

    patchDraft(
      opening
        ? {
            openingImage: image,
          }
        : {
            closingImage: image,
          }
    );

    stopCamera();
    await runOCR(image);
  };

  const resyncBaseline = async () => {
    if (
      !draft ||
      syncingMeter ||
      actionLockRef.current
    ) {
      return;
    }

    if (!navigator.onLine) {
      notify(
        "info",
        "Connect to resync the station baseline. A saved baseline remains usable offline."
      );
      return;
    }

    setSyncingMeter(true);

    try {
      const latest =
        await listReports();

      if (
        latest.some(
          (record) =>
            record.status ===
            "pending"
        )
      ) {
        notify(
          "info",
          "Upload pending shifts before resyncing. The local previous closing remains your baseline."
        );
        return;
      }

      const baseline =
        await fetchBaseline();

      patchDraft({
        openingMeter:
          baseline.meter,
        openingSource:
          baseline.source,
        baselineReady: true,
      });

      notify(
        "success",
        "Opening baseline synchronized."
      );
    } catch (error) {
      notify(
        "error",
        errorText(error)
      );
    } finally {
      setSyncingMeter(false);
    }
  };

  const openShift = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (
      !draft ||
      actionLockRef.current
    ) {
      return;
    }

    const price = Number(
      draft.fuelPrice
    );

    const meter = Number(
      draft.openingMeter
    );

    if (
      !draft.supervisorName.trim() ||
      !draft.openingImage ||
      !draft.baselineReady ||
      !draft.fuelPrice.trim() ||
      !draft.openingMeter.trim() ||
      !Number.isFinite(price) ||
      !Number.isFinite(meter) ||
      price <= 0 ||
      meter < 0
    ) {
      notify(
        "error",
        "Enter the supervisor name, opening photo, valid price and baseline."
      );
      return;
    }

    actionLockRef.current = true;
    setBusy(true);

    const next: Draft = {
      ...draft,
      supervisorName:
        draft.supervisorName.trim(),
      stage: "CLOSING",
      openedAt:
        new Date().toISOString(),
      updatedAt:
        new Date().toISOString(),
    };

    try {
      await persist(next);

      stopCamera();
      setScannedValue(null);
      setDraft(next);

      notify(
        "success",
        "Opening saved. Return here at shift end."
      );

      if (
        navigator.storage?.persist
      ) {
        void navigator.storage
          .persist()
          .catch(() => false);
      }
    } catch (error) {
      notify(
        "error",
        `Opening not saved: ${errorText(
          error
        )}`
      );
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const closeShift = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (
      !draft ||
      actionLockRef.current
    ) {
      return;
    }

    const openM = Number(
      draft.openingMeter
    );

    const closeM = Number(
      draft.closingMeter
    );

    const price = Number(
      draft.fuelPrice
    );

    const cash = Number(
      draft.cashCollected
    );

    const momo = Number(
      draft.momoCollected
    );

    const expenses = Number(
      draft.expenses || "0"
    );

    if (
      !draft.openedAt ||
      !draft.closingImage ||
      !draft.closingMeter.trim() ||
      !draft.cashCollected.trim() ||
      !draft.momoCollected.trim() ||
      ![
        openM,
        closeM,
        price,
        cash,
        momo,
        expenses,
      ].every(Number.isFinite) ||
      price <= 0 ||
      openM < 0 ||
      closeM <= openM ||
      cash < 0 ||
      momo < 0 ||
      expenses < 0
    ) {
      notify(
        "error",
        "Check the closing photo, meter and collection amounts. Closing must exceed opening. Use 0 where no money was collected."
      );
      return;
    }

    actionLockRef.current = true;
    setBusy(true);
    setSaveStatus("saving");

    const litres =
      closeM - openM;

    const expected =
      litres * price;

    const accounted =
      cash + momo + expenses;

    const report: ShiftReport = {
      shiftId: draft.shiftId,
      supervisor:
        draft.supervisorName,
      openedAt: draft.openedAt,
      closedAt:
        new Date().toISOString(),
      price,
      openM,
      closeM,
      litres,
      expected,
      cash,
      momo,
      expenses,
      accounted,
      variance:
        accounted - expected,
      openingImage:
        draft.openingImage,
      closingImage:
        draft.closingImage,
    };

    const next: Draft = {
      ...draft,
      stage: "REPORT",
      report,
      updatedAt:
        new Date().toISOString(),
    };

    try {
      await saveCompletedDraft(
        next
      );

      stopCamera();
      setDraft(next);

      setLastSavedAt(
        next.updatedAt
      );

      setSaveStatus("saved");

      await refreshRecords();

      notify(
        "success",
        navigator.onLine
          ? "Shift saved locally. Upload will be attempted automatically."
          : "Shift saved offline. It will upload when the app is open and internet returns."
      );

      void syncPending();
    } catch (error) {
      setSaveStatus("error");

      notify(
        "error",
        `Shift not saved: ${errorText(
          error
        )}`
      );
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const exportReport = async (
    report: ShiftReport,
    share: boolean
  ) => {
    if (exporting) return;

    setExporting(true);

    try {
      const latestRecords =
        await listReports();

      setRecords(latestRecords);

      const synced =
        latestRecords.find(
          (record) =>
            record.id ===
            report.shiftId
        )?.status === "synced";

      const blob = await buildPdf(
        report,
        synced
      );

      const filename =
        reportFilename(report);

      if (!share) {
        downloadBlob(
          blob,
          filename
        );
        return;
      }

      const file = new File(
        [blob],
        filename,
        {
          type:
            "application/pdf",
        }
      );

      const text =
        reportSummary(
          report,
          synced
        );

      if (
        typeof navigator.share ===
          "function" &&
        typeof navigator.canShare ===
          "function" &&
        navigator.canShare({
          files: [file],
        })
      ) {
        await navigator.share({
          title:
            `${STATION_NAME} Shift Report`,
          text,
          files: [file],
        });

        return;
      }

      downloadBlob(
        blob,
        filename
      );

      if (
        OWNER_WHATSAPP &&
        navigator.onLine
      ) {
        window.open(
          `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(
            text
          )}`,
          "_blank",
          "noopener,noreferrer"
        );
      }

      notify(
        "info",
        "PDF prepared for download. Attach it in WhatsApp."
      );
    } catch (error) {
      if (
        typeof error ===
          "object" &&
        error !== null &&
        "name" in error &&
        error.name ===
          "AbortError"
      ) {
        return;
      }

      notify(
        "error",
        `Could not export: ${errorText(
          error
        )}. If offline, reconnect once to prepare PDF files.`
      );
    } finally {
      setExporting(false);
    }
  };

  const newShift = async () => {
    if (
      !draft?.report ||
      actionLockRef.current
    ) {
      return;
    }

    actionLockRef.current = true;
    setBusy(true);

    const next = createDraft(
      String(draft.report.price)
    );

    next.openingMeter = String(
      draft.report.closeM
    );

    next.openingSource =
      "Previous shift on this device";

    next.baselineReady = true;

    try {
      await persist(next);

      setDraft(next);
      setConfirmNew(false);
      setRestored(false);
      setScannedValue(null);

      notify(
        "success",
        "Next shift ready. Previous reports and pending uploads are retained."
      );
    } catch (error) {
      notify(
        "error",
        errorText(error)
      );
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const renderScanner = (
    opening: boolean
  ) => {
    if (!draft) return null;

    const image = opening
      ? draft.openingImage
      : draft.closingImage;

    return (
      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {opening
                ? "Opening"
                : "Closing"}{" "}
              meter photo
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Keep all digits clear and visible.
            </p>
          </div>

          <span className="shrink-0 rounded-full border border-slate-700 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-400">
            {online
              ? "AI assisted"
              : "Offline capture"}
          </span>
        </div>

        {!image &&
          !cameraActive && (
            <button
              type="button"
              onClick={() =>
                void startCamera(
                  rearCamera
                )
              }
              className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 text-sm text-slate-300 hover:border-amber-400/60"
            >
              <span className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-amber-300">
                Capture evidence
              </span>

              Open camera
            </button>
          )}

        {cameraActive && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />

              <div className="pointer-events-none absolute inset-6 rounded-lg border border-amber-400/70" />

              {cameraStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">
                  Opening camera…
                </div>
              )}

              <button
                type="button"
                disabled={
                  cameraStarting
                }
                onClick={() => {
                  const next =
                    !rearCamera;

                  setRearCamera(
                    next
                  );

                  void startCamera(
                    next
                  );
                }}
                className="absolute right-3 top-3 rounded-lg bg-black/75 px-3 py-2.5 text-xs"
              >
                Switch camera
              </button>
            </div>

            <button
              type="button"
              disabled={
                cameraStarting
              }
              onClick={() =>
                void capturePhoto(
                  opening
                )
              }
              className={primaryCls}
            >
              Capture meter photo
            </button>

            <button
              type="button"
              onClick={stopCamera}
              className={secondaryCls}
            >
              Cancel
            </button>
          </div>
        )}

        {image &&
          !cameraActive && (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt={
                  `${
                    opening
                      ? "Opening"
                      : "Closing"
                  } meter evidence`
                }
                className="max-h-72 w-full rounded-xl border border-slate-800 bg-black object-contain"
              />

              <p className="text-xs text-emerald-300">
                Photo captured
              </p>

              {scanning && (
                <p className="rounded-xl bg-amber-400/5 p-3 text-xs text-amber-200">
                  Reading meter with AI…
                </p>
              )}

              {scannedValue &&
                !scanning && (
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                    <p
                      className={
                        labelCls
                      }
                    >
                      AI detected reading
                    </p>

                    <p className="break-all font-mono text-3xl text-amber-300">
                      {scannedValue}
                    </p>

                    {opening ? (
                      <p className="mt-2 text-[11px] leading-5 text-slate-400">
                        Reference only. Opening baseline remains locked.
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          patchDraft({
                            closingMeter:
                              scannedValue,
                          });

                          setScannedValue(
                            null
                          );
                        }}
                        className={
                          primaryCls +
                          " mt-3"
                        }
                      >
                        Accept reading
                      </button>
                    )}
                  </div>
                )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={
                    scanning
                  }
                  onClick={() => {
                    patchDraft(
                      opening
                        ? {
                            openingImage:
                              null,
                          }
                        : {
                            closingImage:
                              null,
                          }
                    );

                    setScannedValue(
                      null
                    );

                    void startCamera(
                      rearCamera
                    );
                  }}
                  className={
                    secondaryCls
                  }
                >
                  Retake
                </button>

                <button
                  type="button"
                  disabled={
                    scanning ||
                    !online
                  }
                  onClick={() =>
                    void runOCR(
                      image
                    )
                  }
                  className={
                    secondaryCls
                  }
                >
                  Retry AI
                </button>
              </div>
            </div>
          )}
      </Card>
    );
  };

  if (
    loading ||
    recoveryError ||
    !draft
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080d16] px-5 text-slate-100">
        <section className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-400/10 text-xl font-black tracking-wider text-amber-300">
            DG
          </div>

          <h1 className="mt-6 text-xl font-semibold">
            {recoveryError
              ? "Recovery needs attention"
              : "Opening workspace"}
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-400">
            {recoveryError ||
              "Restoring your shift and checking pending uploads."}
          </p>

          {recoveryError ? (
            <button
              onClick={() =>
                window.location.reload()
              }
              className={
                primaryCls +
                " mt-6"
              }
            >
              Retry recovery
            </button>
          ) : (
            <div className="mx-auto mt-6 h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
          )}
        </section>
      </main>
    );
  }

  const pendingCount =
    records.filter(
      (record) =>
        record.status ===
        "pending"
    ).length;

  const currentSynced =
    records.find(
      (record) =>
        record.id ===
        draft.shiftId
    )?.status === "synced";

  const steps = [
    "OPENING",
    "CLOSING",
    "REPORT",
  ];

  const stepIndex =
    steps.indexOf(draft.stage);

  return (
    <main className="min-h-screen bg-[#080d16] px-4 pb-12 pt-6 text-slate-100 sm:pt-10">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.08),transparent_70%)]" />

      <div className="relative mx-auto max-w-2xl">
        <header className="mb-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-sm font-black tracking-widest text-amber-300">
                DG
              </div>

              <div>
                <p className="text-[9px] uppercase tracking-[0.23em] text-slate-500">
                  Station operations
                </p>

                <h1 className="mt-1 text-xl font-semibold">
                  {STATION_NAME}
                </h1>
              </div>
            </div>

            <span
              className={
                "rounded-full border px-3 py-1.5 text-[10px] " +
                (online
                  ? "border-emerald-400/20 text-emerald-300"
                  : "border-amber-400/20 text-amber-300")
              }
            >
              {online
                ? "Online"
                : "Offline"}
            </span>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-amber-300">
                  {shiftReference(
                    draft.shiftId
                  )}
                </p>

                <h2 className="mt-2 text-lg font-semibold">
                  {draft.stage ===
                  "OPENING"
                    ? "Open your shift"
                    : draft.stage ===
                      "CLOSING"
                    ? "Shift workspace"
                    : "Shift report"}
                </h2>

                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {draft.stage ===
                  "OPENING"
                    ? "Verify the baseline and capture opening evidence."
                    : draft.stage ===
                      "CLOSING"
                    ? "Opening saved. Complete closing details at shift end."
                    : "Saved locally first. Upload status is shown separately."}
                </p>
              </div>

              <span className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-400">
                {stepIndex + 1} / 3
              </span>
            </div>

            <ol className="mt-5 grid grid-cols-3 gap-2">
              {[
                "Opening",
                "Closing",
                "Report",
              ].map(
                (label, index) => (
                  <li
                    key={label}
                    aria-current={
                      index ===
                      stepIndex
                        ? "step"
                        : undefined
                    }
                  >
                    <div
                      className={
                        "h-1 rounded-full " +
                        (index <
                        stepIndex
                          ? "bg-emerald-400"
                          : index ===
                            stepIndex
                          ? "bg-amber-400"
                          : "bg-slate-800")
                      }
                    />

                    <p className="mt-2 text-[10px] text-slate-400">
                      {label}
                    </p>
                  </li>
                )
              )}
            </ol>
          </div>
        </header>

        <Card className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p
                aria-live="polite"
                className={
                  "text-xs font-medium " +
                  (saveStatus ===
                  "error"
                    ? "text-red-300"
                    : saveStatus ===
                      "saved"
                    ? "text-emerald-300"
                    : "text-amber-200")
                }
              >
                {saveStatus ===
                "saved"
                  ? "Saved on this device"
                  : saveStatus ===
                    "error"
                  ? "Local save failed"
                  : "Saving progress…"}
              </p>

              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                {lastSavedAt
                  ? `Last saved ${new Date(
                      lastSavedAt
                    ).toLocaleTimeString(
                      "en-GB",
                      {
                        hour: "2-digit",
                        minute:
                          "2-digit",
                        second:
                          "2-digit",
                      }
                    )}`
                  : "Wait for saved confirmation before leaving."}
              </p>
            </div>

            {saveStatus ===
              "error" && (
              <button
                type="button"
                onClick={() =>
                  void persist(
                    draft
                  ).catch(
                    (error) =>
                      notify(
                        "error",
                        errorText(
                          error
                        )
                      )
                  )
                }
                className="min-h-10 rounded-lg border border-red-400/25 px-3 text-xs text-red-300"
              >
                Retry save
              </button>
            )}
          </div>

          {restored && (
            <div className="mt-3 flex items-start justify-between gap-3 border-t border-slate-800 pt-3">
              <p className="text-[11px] leading-5 text-slate-400">
                Your saved workspace has been restored.
              </p>

              <button
                onClick={() =>
                  setRestored(
                    false
                  )
                }
                className="text-[11px] text-amber-300"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
            <p className="text-[11px] text-slate-400">
              {syncing
                ? "Uploading shifts…"
                : `${pendingCount} pending upload${
                    pendingCount ===
                    1
                      ? ""
                      : "s"
                  }`}
            </p>

            <button
              type="button"
              disabled={
                !online ||
                syncing
              }
              onClick={() =>
                void syncPending(
                  true
                )
              }
              className="min-h-10 rounded-lg border border-slate-700 px-3 text-[11px] text-amber-300 disabled:opacity-40"
            >
              {syncing
                ? "Syncing…"
                : "Sync now"}
            </button>
          </div>
        </Card>

        {notice && (
          <div
            role={
              notice.type ===
              "error"
                ? "alert"
                : "status"
            }
            className={
              "mb-5 rounded-xl border p-4 text-xs leading-6 " +
              (notice.type ===
              "error"
                ? "border-red-400/20 bg-red-400/5 text-red-300"
                : notice.type ===
                  "success"
                ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
                : "border-slate-700 bg-slate-900 text-slate-300")
            }
          >
            <p>{notice.text}</p>

            <button
              onClick={() =>
                setNotice(null)
              }
              className="mt-2 text-[10px] opacity-70"
            >
              Dismiss
            </button>
          </div>
        )}

        {draft.stage ===
          "OPENING" && (
          <form
            onSubmit={openShift}
          >
            <fieldset
              disabled={busy}
              className="min-w-0 space-y-5"
            >
              <Card>
                <label
                  htmlFor="supervisor"
                  className={
                    labelCls
                  }
                >
                  Supervisor name
                </label>

                <input
                  id="supervisor"
                  autoComplete="name"
                  maxLength={120}
                  required
                  value={
                    draft.supervisorName
                  }
                  onChange={(
                    event
                  ) =>
                    patchDraft({
                      supervisorName:
                        event.target
                          .value,
                    })
                  }
                  placeholder="Enter your full name"
                  className={
                    inputCls
                  }
                />
              </Card>

              {renderScanner(
                true
              )}

              <Card>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="price"
                      className={
                        labelCls
                      }
                    >
                      Fuel price · GHS / L
                    </label>

                    <input
                      id="price"
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={
                        draft.fuelPrice
                      }
                      onChange={(
                        event
                      ) =>
                        patchDraft({
                          fuelPrice:
                            event
                              .target
                              .value,
                        })
                      }
                      className={
                        inputCls
                      }
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label
                        htmlFor="opening-meter"
                        className="text-[10px] uppercase tracking-wider text-slate-400"
                      >
                        Opening meter
                      </label>

                      <button
                        type="button"
                        disabled={
                          syncingMeter ||
                          !online
                        }
                        onClick={() =>
                          void resyncBaseline()
                        }
                        className="text-[10px] text-amber-300 disabled:opacity-40"
                      >
                        {syncingMeter
                          ? "Syncing…"
                          : "Resync"}
                      </button>
                    </div>

                    <input
                      id="opening-meter"
                      readOnly
                      value={
                        draft.openingMeter
                      }
                      className={
                        inputCls +
                        " text-slate-400"
                      }
                      placeholder="Baseline required"
                    />

                    <p className="mt-2 text-[10px] leading-5 text-slate-500">
                      {draft.openingSource ||
                        "Connect once to load the station baseline."}
                    </p>
                  </div>
                </div>
              </Card>

              <button
                type="submit"
                disabled={
                  busy ||
                  scanning ||
                  cameraActive ||
                  syncingMeter ||
                  !draft.baselineReady
                }
                className={
                  primaryCls
                }
              >
                {busy
                  ? "Saving opening…"
                  : "Lock opening & start shift"}
              </button>
            </fieldset>
          </form>
        )}

        {draft.stage ===
          "CLOSING" && (
          <form
            onSubmit={
              closeShift
            }
          >
            <fieldset
              disabled={busy}
              className="min-w-0 space-y-5"
            >
              <Card>
                <h3 className="text-sm font-semibold">
                  Shift active
                </h3>

                <dl className="mt-2 divide-y divide-slate-800">
                  <Row
                    label="Supervisor"
                    value={
                      draft.supervisorName
                    }
                  />

                  <Row
                    label="Opened"
                    value={
                      draft.openedAt
                        ? dateTime(
                            draft.openedAt
                          )
                        : "—"
                    }
                  />

                  <Row
                    label="Opening meter"
                    value={
                      `${draft.openingMeter} L`
                    }
                  />
                </dl>

                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  You can leave and return using this browser.
                  Complete the remaining fields at shift end.
                </p>
              </Card>

              {renderScanner(
                false
              )}

              <Card className="space-y-5">
                <div>
                  <label
                    htmlFor="closing-meter"
                    className={
                      labelCls
                    }
                  >
                    Closing meter · litres
                  </label>

                  <input
                    id="closing-meter"
                    type="number"
                    min="0"
                    max="1000000000000"
                    step="any"
                    inputMode="decimal"
                    required
                    value={
                      draft.closingMeter
                    }
                    onChange={(
                      event
                    ) =>
                      patchDraft({
                        closingMeter:
                          event
                            .target
                            .value,
                      })
                    }
                    placeholder="Enter closing reading"
                    className={
                      inputCls
                    }
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="cash"
                      className={
                        labelCls
                      }
                    >
                      Cash collected · GHS
                    </label>

                    <input
                      id="cash"
                      type="number"
                      min="0"
                      max="1000000000000"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={
                        draft.cashCollected
                      }
                      onChange={(
                        event
                      ) =>
                        patchDraft({
                          cashCollected:
                            event
                              .target
                              .value,
                        })
                      }
                      placeholder="0.00"
                      className={
                        inputCls
                      }
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="momo"
                      className={
                        labelCls
                      }
                    >
                      MoMo collected · GHS
                    </label>

                    <input
                      id="momo"
                      type="number"
                      min="0"
                      max="1000000000000"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={
                        draft.momoCollected
                      }
                      onChange={(
                        event
                      ) =>
                        patchDraft({
                          momoCollected:
                            event
                              .target
                              .value,
                        })
                      }
                      placeholder="0.00"
                      className={
                        inputCls
                      }
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="expenses"
                    className={
                      labelCls
                    }
                  >
                    Shift expenses · GHS
                  </label>

                  <input
                    id="expenses"
                    type="number"
                    min="0"
                    max="1000000000000"
                    step="0.01"
                    inputMode="decimal"
                    value={
                      draft.expenses
                    }
                    onChange={(
                      event
                    ) =>
                      patchDraft({
                        expenses:
                          event
                            .target
                            .value,
                      })
                    }
                    placeholder="0.00"
                    className={
                      inputCls
                    }
                  />

                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    Expenses must be paid from shift takings.
                    Cash means the amount remaining after those
                    expenses, excluding opening float and personal
                    money.
                  </p>
                </div>
              </Card>

              <button
                type="submit"
                disabled={
                  busy ||
                  scanning ||
                  cameraActive
                }
                className={
                  primaryCls
                }
              >
                {busy
                  ? "Saving shift…"
                  : online
                  ? "Close shift & queue upload"
                  : "Save completed shift offline"}
              </button>
            </fieldset>
          </form>
        )}

        {draft.stage ===
          "REPORT" &&
          draft.report && (
            <div className="space-y-5">
              <section className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-400/10 to-slate-900 p-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">
                    Shift completed
                  </p>

                  <span
                    className={
                      "rounded-full px-2.5 py-1 text-[9px] " +
                      (currentSynced
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-amber-400/10 text-amber-300")
                    }
                  >
                    {currentSynced
                      ? "Synced to Supabase"
                      : "Pending upload"}
                  </span>
                </div>

                <p className="mt-5 text-xs text-slate-400">
                  Litres sold
                </p>

                <p className="mt-1 break-all font-mono text-4xl text-amber-300 sm:text-5xl">
                  {litresText(
                    draft.report
                      .litres
                  )}

                  <span className="ml-2 text-lg text-slate-500">
                    L
                  </span>
                </p>

                <div className="mt-5 flex justify-between gap-3 border-t border-white/5 pt-4">
                  <span className="text-xs text-slate-400">
                    Expected sales
                  </span>

                  <span className="font-semibold">
                    {ghs(
                      draft.report
                        .expected
                    )}
                  </span>
                </div>
              </section>

              <Card>
                <h3 className="text-sm font-semibold">
                  Money breakdown and reconciliation
                </h3>

                <dl className="mt-3 divide-y divide-slate-800">
                  <Row
                    label="Supervisor"
                    value={
                      draft.report
                        .supervisor
                    }
                  />

                  <Row
                    label="Closed"
                    value={dateTime(
                      draft.report
                        .closedAt
                    )}
                  />

                  <Row
                    label="Meter readings"
                    value={
                      `${litresText(
                        draft.report
                          .openM
                      )} → ${litresText(
                        draft.report
                          .closeM
                      )} L`
                    }
                  />

                  <Row
                    label="Cash collected"
                    value={ghs(
                      draft.report
                        .cash
                    )}
                  />

                  <Row
                    label="MoMo collected"
                    value={ghs(
                      draft.report
                        .momo
                    )}
                  />

                  <Row
                    label="Cash + MoMo"
                    value={ghs(
                      draft.report
                        .cash +
                        draft.report
                          .momo
                    )}
                  />

                  <Row
                    label="Expenses"
                    value={ghs(
                      draft.report
                        .expenses
                    )}
                  />

                  <Row
                    label="Total accounted"
                    value={ghs(
                      draft.report
                        .accounted
                    )}
                  />
                </dl>
              </Card>

              <Card
                className={
                  draft.report
                    .variance <
                  -0.005
                    ? "border-red-400/25"
                    : draft.report
                        .variance >
                      0.005
                    ? "border-amber-400/25"
                    : "border-emerald-400/25"
                }
              >
                <p
                  className={
                    labelCls
                  }
                >
                  Variance
                </p>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-2xl">
                    {draft.report
                      .variance >= 0
                      ? "+"
                      : "-"}

                    {ghs(
                      Math.abs(
                        draft.report
                          .variance
                      )
                    )}
                  </p>

                  <span className="rounded-full bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-300">
                    {draft.report
                      .variance <
                    -0.005
                      ? "Shortage"
                      : draft.report
                          .variance >
                        0.005
                      ? "Overage"
                      : "Balanced"}
                  </span>
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={
                    exporting
                  }
                  onClick={() =>
                    void exportReport(
                      draft.report!,
                      false
                    )
                  }
                  className={
                    secondaryCls
                  }
                >
                  {exporting
                    ? "Preparing…"
                    : "Download PDF"}
                </button>

                <button
                  type="button"
                  disabled={
                    exporting
                  }
                  onClick={() =>
                    void exportReport(
                      draft.report!,
                      true
                    )
                  }
                  className="min-h-12 rounded-xl bg-[#25D366] px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  Share on WhatsApp
                </button>
              </div>

              {!confirmNew ? (
                <button
                  onClick={() =>
                    setConfirmNew(
                      true
                    )
                  }
                  className={
                    secondaryCls
                  }
                >
                  Start next shift
                </button>
              ) : (
                <Card>
                  <h3 className="text-sm font-semibold">
                    Start the next shift?
                  </h3>

                  <p className="mt-2 text-xs leading-6 text-slate-400">
                    This report and pending uploads remain saved.
                    The next opening uses this closing reading.
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      disabled={
                        busy
                      }
                      onClick={() =>
                        setConfirmNew(
                          false
                        )
                      }
                      className={
                        secondaryCls
                      }
                    >
                      Keep report
                    </button>

                    <button
                      disabled={
                        busy
                      }
                      onClick={() =>
                        void newShift()
                      }
                      className={
                        primaryCls
                      }
                    >
                      {busy
                        ? "Preparing…"
                        : "Start next"}
                    </button>
                  </div>
                </Card>
              )}
            </div>
          )}

        <section className="mt-6">
          <button
            type="button"
            onClick={() =>
              setHistoryOpen(
                !historyOpen
              )
            }
            className={
              secondaryCls
            }
          >
            {historyOpen
              ? "Hide saved shifts"
              : "View saved shifts"}

            {pendingCount > 0
              ? ` · ${pendingCount} pending`
              : ""}
          </button>

          {historyOpen && (
            <div className="mt-3 space-y-3">
              {!records.length && (
                <Card>
                  <p className="text-xs text-slate-400">
                    No completed shifts saved on this device.
                  </p>
                </Card>
              )}

              {records.map(
                (record) => (
                  <Card
                    key={
                      record.id
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">
                          {shiftReference(
                            record.id
                          )}
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          {
                            record
                              .report
                              .supervisor
                          }
                        </p>

                        <p className="mt-1 text-[10px] text-slate-500">
                          {dateTime(
                            record
                              .report
                              .closedAt
                          )}
                        </p>
                      </div>

                      <span
                        className={
                          "shrink-0 rounded-full px-2 py-1 text-[9px] " +
                          (record.status ===
                          "synced"
                            ? "bg-emerald-400/10 text-emerald-300"
                            : "bg-amber-400/10 text-amber-300")
                        }
                      >
                        {record.status ===
                        "synced"
                          ? "Synced"
                          : "Pending"}
                      </span>
                    </div>

                    {record.lastError &&
                      record.status ===
                        "pending" && (
                        <p className="mt-3 break-words rounded-lg bg-red-400/5 p-3 text-[11px] leading-5 text-red-300">
                          Upload error:{" "}
                          {
                            record.lastError
                          }
                        </p>
                      )}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        disabled={
                          exporting
                        }
                        onClick={() =>
                          void exportReport(
                            record.report,
                            false
                          )
                        }
                        className={
                          secondaryCls
                        }
                      >
                        Download PDF
                      </button>

                      <button
                        disabled={
                          exporting
                        }
                        onClick={() =>
                          void exportReport(
                            record.report,
                            true
                          )
                        }
                        className={
                          secondaryCls
                        }
                      >
                        Share
                      </button>
                    </div>
                  </Card>
                )
              )}
            </div>
          )}
        </section>

        <Card className="mt-5">
          <p className="text-xs font-medium">
            {offlineStatus ===
            "prepared"
              ? "Offline app files prepared"
              : offlineStatus ===
                "preparing"
              ? "Preparing offline files…"
              : "Offline setup"}
          </p>

          <p className="mt-1 text-[10px] leading-5 text-slate-500">
            {offlineDetail ||
              "Prepare online before relying on offline reopening. Existing cached files are not checked by this label."}
          </p>

          <button
            type="button"
            disabled={
              !online ||
              offlineStatus ===
                "preparing"
            }
            onClick={() =>
              void prepareOffline(
                true
              )
            }
            className={
              secondaryCls +
              " mt-3"
            }
          >
            {offlineStatus ===
            "preparing"
              ? "Preparing…"
              : "Prepare / refresh offline files"}
          </button>
        </Card>

        <footer className="mt-7 border-t border-slate-800 pt-5 text-center">
          <p className="text-[9px] uppercase tracking-[0.18em] text-slate-600">
            {STATION_NAME} · Supervisor terminal
          </p>

          <p className="mt-2 text-[10px] leading-5 text-slate-600">
            Saved locally first · Synced when connected
          </p>
        </footer>
      </div>
    </main>
  );
}