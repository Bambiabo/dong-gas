"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const STATION_NAME = "Dong Gas";

const OWNER_WHATSAPP = (
  process.env.NEXT_PUBLIC_OWNER_WHATSAPP || ""
).replace(/\D/g, "");

const DATABASE_NAME = "dong-gas-supervisor-v2";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspace";
const WORKSPACE_KEY = "active-shift";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Stage = "OPENING" | "BLIND_DROP" | "CLOSING" | "REPORT";
type MeterStage = "OPENING" | "CLOSING";
type SaveStatus = "loading" | "saving" | "saved" | "error";

type Message = {
  type: "info" | "success" | "error";
  text: string;
};

type Report = {
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
  blindDropReference: string;
  blindDropSubmittedAt: string;
};

type Workspace = {
  version: 2;
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

  cashCollected: string;
  momoCollected: string;
  expenses: string;
  dropReference: string;
  dropSubmittedAt: string | null;

  closingMeter: string;
  closingImage: string | null;

  // A report can exist while stage is CLOSING.
  // This means the final submission has been frozen and can be retried.
  report: Report | null;
};

type IconName =
  | "camera"
  | "lock"
  | "check"
  | "arrow"
  | "refresh"
  | "file"
  | "shield"
  | "clock"
  | "close"
  | "download";

/* -------------------------------------------------------------------------- */
/* Browser storage                                                            */
/* -------------------------------------------------------------------------- */

let databasePromise: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support workspace recovery."));
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
      reject(request.error || new Error("Could not open workspace storage."));
    };

    request.onblocked = () => {
      databasePromise = null;
      reject(
        new Error(
          "Workspace storage is blocked. Close other terminal tabs and reload."
        )
      );
    };
  });

  return databasePromise;
}

async function readWorkspace(): Promise<Workspace | null> {
  await writeQueue.catch(() => {});

  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve((request.result as Workspace | undefined) ?? null);
    };

    request.onerror = () => {
      reject(request.error || new Error("Could not restore your workspace."));
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error("Workspace recovery was interrupted."));
    };
  });
}

function writeWorkspace(workspace: Workspace): Promise<void> {
  const operation = writeQueue
    .catch(() => {})
    .then(async () => {
      const database = await openDatabase();

      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");

        transaction.objectStore(STORE_NAME).put(workspace, WORKSPACE_KEY);

        transaction.oncomplete = () => resolve();

        transaction.onerror = () => {
          reject(
            transaction.error || new Error("Could not save workspace progress.")
          );
        };

        transaction.onabort = () => {
          reject(
            transaction.error || new Error("Saving workspace was interrupted.")
          );
        };
      });
    });

  writeQueue = operation;
  return operation;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function createWorkspace(): Workspace {
  return {
    version: 2,
    shiftId: crypto.randomUUID(),
    stage: "OPENING",
    updatedAt: new Date().toISOString(),

    supervisorName: "",
    fuelPrice: "10.40",

    openingMeter: "",
    openingImage: null,
    openingSource: "",
    baselineReady: false,
    openedAt: null,

    cashCollected: "",
    momoCollected: "",
    expenses: "",
    dropReference: "",
    dropSubmittedAt: null,

    closingMeter: "",
    closingImage: null,

    report: null,
  };
}

function isValidWorkspace(value: Workspace): boolean {
  const stages: Stage[] = ["OPENING", "BLIND_DROP", "CLOSING", "REPORT"];

  return (
    value.version === 2 &&
    typeof value.shiftId === "string" &&
    stages.includes(value.stage) &&
    typeof value.supervisorName === "string" &&
    typeof value.openingMeter === "string" &&
    (value.stage !== "REPORT" || Boolean(value.report)) &&
    (value.stage !== "CLOSING" || Boolean(value.dropSubmittedAt))
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }

  return "An unexpected error occurred.";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function ghs(value: number): string {
  return (
    "GHS " +
    value.toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function litresText(value: number): string {
  return value.toLocaleString("en-GH", {
    maximumFractionDigits: 3,
  });
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortReference(id: string): string {
  return `DG-${id.slice(0, 8).toUpperCase()}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function reportFilename(report: Report): string {
  return `${STATION_NAME.replace(/\s+/g, "-")}-${shortReference(
    report.shiftId
  )}.pdf`;
}

function reportSummary(report: Report): string {
  return (
    `*${STATION_NAME} — Shift Report*\n` +
    `Reference: ${shortReference(report.shiftId)}\n` +
    `Supervisor: ${report.supervisor}\n` +
    `Closed: ${dateTime(report.closedAt)}\n\n` +
    `Blind drop: ${dateTime(report.blindDropSubmittedAt)}\n` +
    `Deposit reference: ${report.blindDropReference || "Not provided"}\n\n` +
    `Litres sold: ${report.litres.toFixed(3)} L\n` +
    `Fuel price: ${ghs(report.price)} / L\n` +
    `Expected sales: ${ghs(report.expected)}\n` +
    `Cash: ${ghs(report.cash)}\n` +
    `MoMo: ${ghs(report.momo)}\n` +
    `Expenses: ${ghs(report.expenses)}\n` +
    `Total accounted: ${ghs(report.accounted)}\n` +
    `Variance: ${report.variance >= 0 ? "+" : "-"}${ghs(
      Math.abs(report.variance)
    )}\n\n` +
    `PDF report prepared for sharing.`
  );
}

/* -------------------------------------------------------------------------- */
/* Shared UI                                                                  */
/* -------------------------------------------------------------------------- */

const inputCls =
  "w-full rounded-xl border border-slate-700/70 bg-slate-950/60 " +
  "px-4 py-3.5 text-sm text-slate-100 outline-none transition " +
  "placeholder:text-slate-600 focus:border-amber-400/70 " +
  "focus:ring-4 focus:ring-amber-400/10 disabled:cursor-not-allowed " +
  "disabled:opacity-60";

const labelCls =
  "mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400";

const primaryBtnCls =
  "flex w-full items-center justify-center gap-2 rounded-xl " +
  "bg-amber-400 px-5 py-4 text-sm font-semibold text-slate-950 " +
  "shadow-lg shadow-amber-500/10 transition hover:bg-amber-300 " +
  "active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtnCls =
  "flex w-full items-center justify-center gap-2 rounded-xl " +
  "border border-slate-700 bg-slate-900 px-5 py-3.5 text-xs " +
  "font-medium text-slate-300 transition hover:border-slate-500 " +
  "hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {name === "camera" && (
        <>
          <path d="M14.5 4h-5L8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-1.5-3Z" />
          <circle cx="12" cy="13" r="4" />
        </>
      )}

      {name === "lock" && (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </>
      )}

      {name === "check" && <path d="m5 12 4 4L19 6" />}

      {name === "arrow" && <path d="M5 12h14m-5-5 5 5-5 5" />}

      {name === "refresh" && (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6 8a7 7 0 0 1 12-2l2 3M4 15l2 3a7 7 0 0 0 12-2" />
        </>
      )}

      {name === "file" && (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M8 13h8M8 17h6" />
        </>
      )}

      {name === "shield" && (
        <>
          <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}

      {name === "clock" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}

      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}

      {name === "download" && (
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" />
      )}
    </svg>
  );
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
        "rounded-2xl border border-slate-800 bg-slate-900/75 p-5 " +
        "shadow-[0_12px_40px_rgba(0,0,0,0.15)] " +
        className
      }
    >
      {children}
    </section>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-xs leading-5 text-slate-400">{label}</dt>

      <dd className="max-w-[65%] break-words text-right text-xs font-medium leading-5 text-slate-100">
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

async function buildPdf(report: Report): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  const contentW = W - M * 2;

  let y = 0;

  const header = (subtitle: string) => {
    doc.setFillColor(11, 15, 25);
    doc.rect(0, 0, W, 37, "F");

    doc.setFillColor(251, 191, 36);
    doc.rect(0, 37, W, 1.4, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.setTextColor(251, 191, 36);
    doc.text(STATION_NAME.toUpperCase(), M, 17);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(205, 210, 220);
    doc.text(subtitle, M, 26);

    doc.text(shortReference(report.shiftId), W - M, 17, {
      align: "right",
    });
  };

  const sectionTitle = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(25, 30, 40);
    doc.text(title, M, y);
    y += 5;
  };

  const rows = (items: [string, string][]) => {
    items.forEach(([label, value], index) => {
      doc.setFontSize(9);

      const labelLines = doc.splitTextToSize(label, 88);
      const valueLines = doc.splitTextToSize(value, 74);
      const height =
        Math.max(labelLines.length, valueLines.length) * 4.2 + 5;

      if (y + height > 263) {
        doc.addPage();
        header("SHIFT REPORT — CONTINUED");
        y = 50;
      }

      if (index % 2 === 0) {
        doc.setFillColor(245, 246, 250);
        doc.rect(M, y, contentW, height, "F");
      }

      doc.setFont("helvetica", "normal");
      doc.setTextColor(95, 100, 115);
      doc.text(labelLines, M + 3, y + 6);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(25, 30, 40);
      doc.text(valueLines, W - M - 3, y + 6, {
        align: "right",
      });

      y += height;
    });
  };

  header("SHIFT CLOSING REPORT");

  y = 50;
  sectionTitle("Shift details");

  rows([
    ["Supervisor", report.supervisor],
    ["Opened", dateTime(report.openedAt)],
    ["Closed", dateTime(report.closedAt)],
    ["Fuel price per litre", ghs(report.price)],
    ["Opening meter", `${litresText(report.openM)} L`],
    ["Closing meter", `${litresText(report.closeM)} L`],
    ["Litres sold", `${litresText(report.litres)} L`],
    ["Expected sales", ghs(report.expected)],
  ]);

  y += 10;
  sectionTitle("Collections");

  rows([
    ["Cash collected", ghs(report.cash)],
    ["MoMo collected", ghs(report.momo)],
    ["Shift expenses", ghs(report.expenses)],
    ["Total accounted: cash + MoMo + expenses", ghs(report.accounted)],
  ]);

  y += 10;

  if (y + 24 > 263) {
    doc.addPage();
    header("SHIFT RECONCILIATION");
    y = 50;
  }

  const short = report.variance < -0.005;
  const over = report.variance > 0.005;

  if (short) doc.setFillColor(254, 226, 226);
  else if (over) doc.setFillColor(254, 243, 199);
  else doc.setFillColor(209, 250, 229);

  doc.roundedRect(M, y, contentW, 23, 3, 3, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(75, 80, 90);
  doc.text("VARIANCE", M + 5, y + 7);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);

  if (short) doc.setTextColor(185, 28, 28);
  else if (over) doc.setTextColor(180, 83, 9);
  else doc.setTextColor(4, 120, 87);

  doc.text(
    `${report.variance >= 0 ? "+" : "-"} ${ghs(
      Math.abs(report.variance)
    )}`,
    M + 5,
    y + 17
  );

  doc.setFontSize(10);
  doc.text(
    short ? "SHORTAGE" : over ? "OVERAGE" : "BALANCED",
    W - M - 5,
    y + 13,
    { align: "right" }
  );

  doc.addPage();
  header("BLIND DROP & METER EVIDENCE");

  y = 50;
  sectionTitle("Blind-drop declaration");

  rows([
    ["Declared at", dateTime(report.blindDropSubmittedAt)],
    ["Deposit / handover reference", report.blindDropReference || "Not provided"],
    ["Physical cash declared", ghs(report.cash)],
    ["MoMo declared", ghs(report.momo)],
    ["Expenses declared", ghs(report.expenses)],
  ]);

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110, 115, 125);

  const note = doc.splitTextToSize(
    "Collections were declared before closing-meter reconciliation. " +
      "This records the submitted declaration and does not independently verify a physical deposit.",
    contentW
  );

  doc.text(note, M, y);
  y += note.length * 4 + 12;

  if (y + 85 > 263) {
    doc.addPage();
    header("METER EVIDENCE");
    y = 50;
  }

  sectionTitle("Meter photo proof");
  y += 2;

  const gap = 6;
  const imageW = (contentW - gap) / 2;
  const imageH = 65;

  const drawPhoto = (
    image: string | null,
    x: number,
    title: string
  ) => {
    doc.setFillColor(245, 246, 250);
    doc.roundedRect(x, y, imageW, imageH, 2, 2, "F");

    if (image) {
      try {
        const properties = doc.getImageProperties(image);

        const scale = Math.min(
          imageW / properties.width,
          imageH / properties.height
        );

        const width = properties.width * scale;
        const height = properties.height * scale;

        doc.addImage(
          image,
          "JPEG",
          x + (imageW - width) / 2,
          y + (imageH - height) / 2,
          width,
          height
        );
      } catch (error) {
        console.error(error);
        doc.setFontSize(8);
        doc.setTextColor(120, 125, 135);
        doc.text("Photo unavailable", x + 4, y + 12);
      }
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 105, 115);
    doc.text(title, x, y + imageH + 6);
  };

  drawPhoto(report.openingImage, M, "Opening meter");
  drawPhoto(report.closingImage, M + imageW + gap, "Closing meter");

  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    doc.setDrawColor(220, 222, 230);
    doc.line(M, 280, W - M, 280);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 125, 140);

    doc.text(`${STATION_NAME} Supervisor Terminal`, M, 285);

    doc.text(
      `Confidential | ${page} / ${pageCount}`,
      W - M,
      285,
      { align: "right" }
    );
  }

  return doc.output("blob");
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function SupervisorTerminal() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  const [isRestoring, setIsRestoring] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [wasRecovered, setWasRecovered] = useState(false);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const [message, setMessage] = useState<Message | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmNewShift, setConfirmNewShift] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scannedReading, setScannedReading] = useState<string | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [rearCamera, setRearCamera] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cameraRequestRef = useRef(0);
  const scanRequestRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const actionLockRef = useRef(false);

  const showMessage = (type: Message["type"], text: string) => {
    setMessage({ type, text });
  };

  const updateWorkspace = (patch: Partial<Workspace>) => {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
        : current
    );
  };

  const saveSnapshot = async (snapshot: Workspace) => {
    const revision = ++saveRevisionRef.current;

    setSaveStatus("saving");

    try {
      await writeWorkspace(snapshot);

      if (revision === saveRevisionRef.current) {
        setLastSavedAt(snapshot.updatedAt);
        setSaveStatus("saved");
      }
    } catch (error) {
      if (revision === saveRevisionRef.current) {
        setSaveStatus("error");
      }

      throw error;
    }
  };

  const stopCamera = () => {
    cameraRequestRef.current += 1;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setCameraStarting(false);
  };

  const getPreviousMeter = async (): Promise<{
    meter: string;
    source: string;
  }> => {
    const { data: shifts, error: shiftError } = await supabase
      .from("shifts")
      .select("closing_meter")
      .not("closing_meter", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (shiftError) throw shiftError;

    if (shifts?.length && shifts[0].closing_meter != null) {
      const value = Number(shifts[0].closing_meter);

      if (!Number.isFinite(value) || value < 0) {
        throw new Error("The previous closing meter is invalid.");
      }

      return {
        meter: String(value),
        source: "Previous completed shift",
      };
    }

    const { data: baselines, error: baselineError } = await supabase
      .from("station_baselines")
      .select("baseline_meter")
      .eq("pump_name", "main")
      .limit(1);

    if (baselineError) throw baselineError;

    if (baselines?.length && baselines[0].baseline_meter != null) {
      const value = Number(baselines[0].baseline_meter);

      if (!Number.isFinite(value) || value < 0) {
        throw new Error("The owner-configured baseline is invalid.");
      }

      return {
        meter: String(value),
        source: "Owner-configured baseline",
      };
    }

    throw new Error(
      "No previous shift or owner baseline was found. Configure the main pump baseline before starting."
    );
  };

  /* Restore the workspace before showing editable forms. */
  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const saved = await readWorkspace();

        if (cancelled) return;

        if (saved) {
          if (!isValidWorkspace(saved)) {
            throw new Error(
              "The saved workspace could not be safely restored. Do not clear browser data; contact your administrator."
            );
          }

          setWorkspace(saved);
          setLastSavedAt(saved.updatedAt);
          setSaveStatus("saved");
          setWasRecovered(true);
        } else {
          let initial = createWorkspace();

          try {
            const previous = await getPreviousMeter();

            initial = {
              ...initial,
              openingMeter: previous.meter,
              openingSource: previous.source,
              baselineReady: true,
            };
          } catch (error) {
            if (!cancelled) {
              setMessage({
                type: "error",
                text: getErrorMessage(error),
              });
            }
          }

          if (cancelled) return;

          await writeWorkspace(initial);

          if (cancelled) return;

          setWorkspace(initial);
          setLastSavedAt(initial.updatedAt);
          setSaveStatus("saved");
        }

        if (!cancelled) {
          setIsRestoring(false);
        }
      } catch (error) {
        if (cancelled) return;

        console.error(error);
        setRecoveryError(getErrorMessage(error));
        setSaveStatus("error");
        setIsRestoring(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Save every workspace change, including photos and stage changes. */
  useEffect(() => {
    if (!workspace || isRestoring || recoveryError) return;

    void saveSnapshot(workspace).catch((error) => {
      console.error(error);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, isRestoring, recoveryError]);

  /* Attach the camera stream after the preview element mounts. */
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !streamRef.current) return;

    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => {});
  }, [cameraActive, cameraStarting]);

  /* Release camera resources. */
  useEffect(() => {
    return () => {
      cameraRequestRef.current += 1;
      scanRequestRef.current += 1;

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const resyncOpeningMeter = async () => {
    if (!workspace || workspace.stage !== "OPENING" || actionLockRef.current) {
      return;
    }

    setIsLoadingPrevious(true);

    try {
      const previous = await getPreviousMeter();

      updateWorkspace({
        openingMeter: previous.meter,
        openingSource: previous.source,
        baselineReady: true,
      });

      showMessage(
        "success",
        `Opening meter synchronized: ${previous.meter} L`
      );
    } catch (error) {
      updateWorkspace({ baselineReady: false });
      showMessage("error", getErrorMessage(error));
    } finally {
      setIsLoadingPrevious(false);
    }
  };

  const startCamera = async (rear: boolean) => {
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage(
        "error",
        "Camera access is unavailable. Open the terminal over HTTPS or localhost."
      );
      return;
    }

    const requestId = ++cameraRequestRef.current;

    setCameraActive(true);
    setCameraStarting(true);
    setScannedReading(null);
    setMessage(null);

    try {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: rear ? { exact: "environment" } : "user",
          },
          audio: false,
        });
      } catch {
        if (requestId !== cameraRequestRef.current) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: rear ? "environment" : "user",
          },
          audio: false,
        });
      }

      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setCameraStarting(false);
    } catch (error) {
      if (requestId !== cameraRequestRef.current) return;

      console.error(error);
      stopCamera();

      showMessage(
        "error",
        "Could not open the camera. Allow camera permission and try again."
      );
    }
  };

  const runOCR = async (image: string) => {
    const requestId = ++scanRequestRef.current;

    setIsScanning(true);
    showMessage("info", "AI Vision is reading the meter photo…");

    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });

      const data: { digits?: string | number } = await response.json();

      if (requestId !== scanRequestRef.current) return;

      const digits = String(data.digits ?? "")
        .trim()
        .replace(/,/g, "");

      if (
        response.ok &&
        /^\d+(?:\.\d+)?$/.test(digits) &&
        Number.isFinite(Number(digits))
      ) {
        setScannedReading(digits);

        showMessage(
          "success",
          "AI detected a reading. Compare it with the photo before accepting."
        );
      } else {
        showMessage(
          "error",
          "The meter could not be read clearly. Retake the photo or enter the closing reading manually."
        );
      }
    } catch (error) {
      if (requestId !== scanRequestRef.current) return;

      console.error(error);
      showMessage(
        "error",
        "AI reading failed. The captured photo is still available."
      );
    } finally {
      if (requestId === scanRequestRef.current) {
        setIsScanning(false);
      }
    }
  };

  const capturePhoto = async (stage: MeterStage) => {
    const video = videoRef.current;

    if (!video || video.readyState < 2 || !video.videoWidth) {
      showMessage("info", "Wait for the camera preview before capturing.");
      return;
    }

    const canvas = document.createElement("canvas");

    // Limit very large camera frames while keeping meter detail.
    const scale = Math.min(1, 1600 / video.videoWidth);

    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = canvas.toDataURL("image/jpeg", 0.85);

    updateWorkspace(
      stage === "OPENING"
        ? { openingImage: image }
        : { closingImage: image }
    );

    stopCamera();
    await runOCR(image);
  };

  const handleOpening = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!workspace || actionLockRef.current) return;

    if (!workspace.supervisorName.trim()) {
      showMessage("error", "Enter the supervisor name.");
      return;
    }

    if (!workspace.baselineReady || isLoadingPrevious) {
      showMessage("error", "Synchronize the opening meter before continuing.");
      return;
    }

    if (!workspace.openingImage) {
      showMessage("error", "Capture the opening meter photo.");
      return;
    }

    const price = Number(workspace.fuelPrice);
    const meter = Number(workspace.openingMeter);

    if (
      !workspace.fuelPrice.trim() ||
      !workspace.openingMeter.trim() ||
      !Number.isFinite(price) ||
      !Number.isFinite(meter) ||
      price <= 0 ||
      meter < 0
    ) {
      showMessage("error", "Check the fuel price and opening meter.");
      return;
    }

    actionLockRef.current = true;
    setIsBusy(true);

    const next: Workspace = {
      ...workspace,
      supervisorName: workspace.supervisorName.trim(),
      stage: "BLIND_DROP",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveSnapshot(next);

      stopCamera();
      setScannedReading(null);
      setWorkspace(next);

      showMessage(
        "success",
        "Shift opened and saved on this device. Return here at shift end to declare collections."
      );
    } catch (error) {
      showMessage(
        "error",
        `The opening could not be saved: ${getErrorMessage(error)}`
      );
    } finally {
      actionLockRef.current = false;
      setIsBusy(false);
    }
  };

  const handleBlindDrop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!workspace || actionLockRef.current) return;

    const cash = Number(workspace.cashCollected);
    const momo = Number(workspace.momoCollected);
    const expenses = Number(workspace.expenses || "0");

    if (
      !workspace.cashCollected.trim() ||
      !workspace.momoCollected.trim() ||
      ![cash, momo, expenses].every(Number.isFinite) ||
      cash < 0 ||
      momo < 0 ||
      expenses < 0
    ) {
      showMessage(
        "error",
        "Enter valid non-negative cash, MoMo, and expense amounts. Use 0 if none."
      );
      return;
    }

    actionLockRef.current = true;
    setIsBusy(true);

    const now = new Date().toISOString();

    const next: Workspace = {
      ...workspace,
      stage: "CLOSING",
      dropReference: workspace.dropReference.trim(),
      dropSubmittedAt: now,
      updatedAt: now,
    };

    try {
      await saveSnapshot(next);

      stopCamera();
      setScannedReading(null);
      setWorkspace(next);

      showMessage(
        "success",
        "Blind drop saved. Declared collections are now locked in this workspace."
      );
    } catch (error) {
      showMessage(
        "error",
        `The blind drop could not be saved: ${getErrorMessage(error)}`
      );
    } finally {
      actionLockRef.current = false;
      setIsBusy(false);
    }
  };

  const handleClosing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!workspace || actionLockRef.current) return;

    if (!workspace.dropSubmittedAt || !workspace.openedAt) {
      showMessage("error", "The opening or blind-drop declaration is missing.");
      return;
    }

    let finalReport = workspace.report;

    if (!finalReport) {
      if (!workspace.closingImage || !workspace.closingMeter.trim()) {
        showMessage("error", "Capture the closing photo and enter the meter.");
        return;
      }

      const openM = Number(workspace.openingMeter);
      const closeM = Number(workspace.closingMeter);
      const price = Number(workspace.fuelPrice);
      const cash = Number(workspace.cashCollected);
      const momo = Number(workspace.momoCollected);
      const expenses = Number(workspace.expenses || "0");

      if (
        ![openM, closeM, price, cash, momo, expenses].every(Number.isFinite) ||
        openM < 0 ||
        price <= 0 ||
        cash < 0 ||
        momo < 0 ||
        expenses < 0
      ) {
        showMessage("error", "Check all meter and collection amounts.");
        return;
      }

      if (closeM <= openM) {
        showMessage(
          "error",
          `Closing meter must be greater than the opening meter of ${openM} L.`
        );
        return;
      }

      const litres = closeM - openM;
      const expected = litres * price;
      const accounted = cash + momo + expenses;

      finalReport = {
        shiftId: workspace.shiftId,
        supervisor: workspace.supervisorName.trim(),
        openedAt: workspace.openedAt,
        closedAt: new Date().toISOString(),
        price,
        openM,
        closeM,
        litres,
        expected,
        cash,
        momo,
        expenses,
        accounted,
        variance: accounted - expected,
        openingImage: workspace.openingImage,
        closingImage: workspace.closingImage,
        blindDropReference: workspace.dropReference,
        blindDropSubmittedAt: workspace.dropSubmittedAt,
      };
    }

    actionLockRef.current = true;
    setIsBusy(true);
    setMessage(null);

    try {
      // Persist the exact submission before contacting Supabase.
      // Retries use this frozen report and the same unique shift ID.
      const pending: Workspace = {
        ...workspace,
        report: finalReport,
        updatedAt: new Date().toISOString(),
      };

      await saveSnapshot(pending);
      setWorkspace(pending);

      const payload = {
        client_shift_id: finalReport.shiftId,
        supervisor_name: finalReport.supervisor,
        fuel_price: finalReport.price,
        opening_meter: finalReport.openM,
        closing_meter: finalReport.closeM,
        cash_collected: finalReport.cash,
        momo_collected: finalReport.momo,
        expenses: finalReport.expenses,
        opening_proof_image: finalReport.openingImage,
        proof_image: finalReport.closingImage,
        blind_drop_reference: finalReport.blindDropReference || null,
        blind_drop_submitted_at: finalReport.blindDropSubmittedAt,
      };

      const { error } = await supabase.from("shifts").upsert([payload], {
        onConflict: "client_shift_id",
        ignoreDuplicates: true,
      });

      if (error) throw error;

      const complete: Workspace = {
        ...pending,
        stage: "REPORT",
        updatedAt: new Date().toISOString(),
      };

      stopCamera();
      setWorkspace(complete);

      try {
        await saveSnapshot(complete);

        showMessage(
          "success",
          "Shift saved to Supabase. The report is ready to download or share."
        );
      } catch (storageError) {
        console.error(storageError);

        showMessage(
          "error",
          "The shift was saved to Supabase, but local report recovery failed. Download the PDF before leaving."
        );
      }
    } catch (error) {
      console.error(error);

      showMessage(
        "error",
        `Submission not confirmed: ${getErrorMessage(error)} Your prepared submission is retained. Retry when ready.`
      );
    } finally {
      actionLockRef.current = false;
      setIsBusy(false);
    }
  };

  const downloadReport = async () => {
    if (!workspace?.report || isDownloading) return;

    setIsDownloading(true);

    try {
      const blob = await buildPdf(workspace.report);
      downloadBlob(blob, reportFilename(workspace.report));
      showMessage("success", "PDF prepared for download.");
    } catch (error) {
      console.error(error);
      showMessage("error", "Could not create the PDF report.");
    } finally {
      setIsDownloading(false);
    }
  };

  const shareReport = async () => {
    if (!workspace?.report || isSharing) return;

    setIsSharing(true);

    try {
      const report = workspace.report;
      const blob = await buildPdf(report);
      const filename = reportFilename(report);

      const file = new File([blob], filename, {
        type: "application/pdf",
      });

      const text = reportSummary(report);

      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: `${STATION_NAME} Shift Report`,
          text,
          files: [file],
        });

        showMessage(
          "success",
          "Report handed to your device's sharing service."
        );

        return;
      }

      downloadBlob(blob, filename);

      if (!OWNER_WHATSAPP) {
        showMessage(
          "info",
          "PDF downloaded. Configure the owner's WhatsApp number to open their chat automatically."
        );
        return;
      }

      window.open(
        `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener,noreferrer"
      );

      showMessage(
        "info",
        "PDF downloaded. Attach it in the owner's WhatsApp chat. If no chat opened, allow pop-ups or open WhatsApp manually."
      );
    } catch (error) {
      if (isAbortError(error)) return;

      console.error(error);

      showMessage(
        "error",
        "Sharing was unavailable. Use Download PDF, then attach the file in WhatsApp."
      );
    } finally {
      setIsSharing(false);
    }
  };

  const startNewShift = async () => {
    if (!workspace || workspace.stage !== "REPORT" || actionLockRef.current) {
      return;
    }

    actionLockRef.current = true;
    setIsBusy(true);

    try {
      const next = createWorkspace();

      // Carry forward the just-completed closing reading.
      if (workspace.report) {
        next.openingMeter = String(workspace.report.closeM);
        next.openingSource = "Previous completed shift";
        next.baselineReady = true;
        next.fuelPrice = String(workspace.report.price);
      }

      await saveSnapshot(next);

      stopCamera();
      scanRequestRef.current += 1;

      setIsScanning(false);
      setScannedReading(null);
      setWasRecovered(false);
      setConfirmNewShift(false);
      setWorkspace(next);

      showMessage("success", "New workspace ready. Enter the next supervisor.");
    } catch (error) {
      showMessage(
        "error",
        `Could not start a new shift: ${getErrorMessage(error)}`
      );
    } finally {
      actionLockRef.current = false;
      setIsBusy(false);
    }
  };

  const retryLocalSave = async () => {
    if (!workspace) return;

    try {
      await saveSnapshot(workspace);
      showMessage("success", "Workspace saved on this device.");
    } catch (error) {
      showMessage("error", getErrorMessage(error));
    }
  };

  const renderScanner = (stage: MeterStage) => {
    if (!workspace) return null;

    const image =
      stage === "OPENING"
        ? workspace.openingImage
        : workspace.closingImage;

    const frozen = Boolean(workspace.report);

    return (
      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {stage === "OPENING" ? "Opening" : "Closing"} meter evidence
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Keep the meter digits sharp and fully visible.
            </p>
          </div>

          <span className="shrink-0 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
            AI Vision
          </span>
        </div>

        {!image && !cameraActive && (
          <button
            type="button"
            disabled={isBusy || frozen}
            onClick={() => void startCamera(rearCamera)}
            className="flex w-full flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 px-4 py-9 text-sm text-slate-300 transition hover:border-amber-400/60 hover:bg-amber-400/5 disabled:opacity-50"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-amber-300">
              <Icon name="camera" className="h-6 w-6" />
            </span>

            <span>Open camera</span>

            <span className="text-[11px] text-slate-600">
              Photo evidence required
            </span>
          </button>
        )}

        {cameraActive && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />

              <div className="pointer-events-none absolute inset-6 rounded-lg border border-amber-400/70" />

              {cameraStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
                  Opening camera…
                </div>
              )}

              <button
                type="button"
                disabled={cameraStarting}
                onClick={() => {
                  const next = !rearCamera;
                  setRearCamera(next);
                  void startCamera(next);
                }}
                className="absolute right-3 top-3 rounded-lg border border-white/20 bg-black/70 px-3 py-2 text-[11px] text-white disabled:opacity-50"
              >
                Switch camera
              </button>
            </div>

            <button
              type="button"
              disabled={cameraStarting || isScanning}
              onClick={() => void capturePhoto(stage)}
              className={primaryBtnCls}
            >
              <Icon name="camera" className="h-4 w-4" />
              Capture & read meter
            </button>

            <button
              type="button"
              onClick={stopCamera}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-200"
            >
              Cancel camera
            </button>
          </div>
        )}

        {image && !cameraActive && (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={`${stage === "OPENING" ? "Opening" : "Closing"} meter evidence`}
              className="max-h-72 w-full rounded-xl border border-slate-800 bg-black object-contain"
            />

            <p className="flex items-center gap-2 text-xs text-emerald-300">
              <Icon name="check" className="h-4 w-4" />
              Photo captured
            </p>

            {isScanning && (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs text-amber-200">
                AI Vision is analyzing the meter…
              </div>
            )}

            {scannedReading && !isScanning && (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
                <p className={labelCls}>Detected reading</p>

                <p className="break-all font-mono text-3xl font-semibold text-amber-300">
                  {scannedReading}
                  <span className="ml-2 text-sm text-slate-500">L</span>
                </p>

                {stage === "CLOSING" && !frozen ? (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        updateWorkspace({ closingMeter: scannedReading });
                        setScannedReading(null);
                        showMessage("success", "Closing reading applied.");
                      }}
                      className="rounded-lg bg-emerald-400 px-3 py-2.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
                    >
                      Accept reading
                    </button>

                    <button
                      type="button"
                      onClick={() => setScannedReading(null)}
                      className="rounded-lg bg-white/5 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/10"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] leading-5 text-slate-400">
                    Reference only. The opening baseline remains locked to
                    the previous closing or owner configuration.
                  </p>
                )}
              </div>
            )}

            {!frozen && (
              <button
                type="button"
                disabled={isScanning || isBusy}
                onClick={() => {
                  updateWorkspace(
                    stage === "OPENING"
                      ? { openingImage: null }
                      : { closingImage: null }
                  );

                  setScannedReading(null);
                  void startCamera(rearCamera);
                }}
                className="text-xs font-medium text-amber-300 hover:text-amber-200 disabled:opacity-50"
              >
                Retake photo
              </button>
            )}
          </div>
        )}
      </Card>
    );
  };

  /* Loading and recovery screen */
  if (isRestoring || recoveryError || !workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080d16] px-5 text-slate-100">
        <section className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-lg font-black tracking-widest text-amber-300">
            DG
          </div>

          <p className="mt-6 text-[10px] uppercase tracking-[0.24em] text-slate-500">
            {STATION_NAME}
          </p>

          <h1 className="mt-2 text-xl font-semibold tracking-tight">
            {recoveryError
              ? "Recovery needs attention"
              : "Restoring your workspace"}
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-400">
            {recoveryError ||
              "Checking for your active shift and restoring saved progress."}
          </p>

          {recoveryError ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={primaryBtnCls + " mt-6"}
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

  const stages: { key: Stage; label: string }[] = [
    { key: "OPENING", label: "Opening" },
    { key: "BLIND_DROP", label: "Blind drop" },
    { key: "CLOSING", label: "Closing" },
    { key: "REPORT", label: "Report" },
  ];

  const stageIndex = stages.findIndex(
    (stage) => stage.key === workspace.stage
  );

  const descriptions: Record<Stage, string> = {
    OPENING: "Verify the opening meter and prepare the shift.",
    BLIND_DROP: "Shift active. At closing time, declare actual collections.",
    CLOSING: "Record closing evidence and submit your completed shift.",
    REPORT: "Review the saved reconciliation and share the owner's report.",
  };

  const finalSubmissionLocked =
    workspace.stage === "CLOSING" && Boolean(workspace.report);

  return (
    <main className="min-h-screen bg-[#080d16] px-4 pb-12 pt-6 text-slate-100 sm:pt-10">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.08),transparent_70%)]" />

      <div className="relative mx-auto max-w-2xl">
        {/* Header */}
        <header className="mb-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-400/10 text-sm font-black tracking-widest text-amber-300">
                DG
              </div>

              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Station operations
                </p>

                <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">
                  {STATION_NAME}
                </h1>
              </div>
            </div>

            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-300">
              Supervisor
            </span>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-amber-400">
                  {shortReference(workspace.shiftId)}
                </p>

                <h2 className="mt-2 text-lg font-semibold tracking-tight">
                  {stages[stageIndex].label}
                </h2>

                <p className="mt-1 max-w-md text-xs leading-5 text-slate-400">
                  {descriptions[workspace.stage]}
                </p>
              </div>

              <span className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs tabular-nums text-slate-400">
                {stageIndex + 1} / {stages.length}
              </span>
            </div>

            <ol className="mt-6 grid grid-cols-4 gap-2">
              {stages.map((stage, index) => (
                <li
                  key={stage.key}
                  aria-current={
                    index === stageIndex ? "step" : undefined
                  }
                >
                  <div
                    className={`h-1 rounded-full ${
                      index < stageIndex
                        ? "bg-emerald-400"
                        : index === stageIndex
                        ? "bg-amber-400"
                        : "bg-slate-800"
                    }`}
                  />

                  <p
                    className={`mt-2 text-[10px] font-medium sm:text-xs ${
                      index === stageIndex
                        ? "text-amber-300"
                        : index < stageIndex
                        ? "text-slate-300"
                        : "text-slate-600"
                    }`}
                  >
                    {stage.label}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </header>

        {/* Save status */}
        <section
          className="mb-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  saveStatus === "saved"
                    ? "bg-emerald-400"
                    : saveStatus === "error"
                    ? "bg-red-400"
                    : "animate-pulse bg-amber-400"
                }`}
              />

              <div>
                <p className="text-xs font-medium text-slate-200">
                  {saveStatus === "saved"
                    ? "Workspace saved on this device"
                    : saveStatus === "error"
                    ? "Workspace not saved"
                    : "Saving workspace…"}
                </p>

                <p className="mt-0.5 text-[10px] text-slate-500">
                  {saveStatus === "saved" && lastSavedAt
                    ? `Last saved ${new Date(
                        lastSavedAt
                      ).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}`
                    : saveStatus === "error"
                    ? "Keep this page open and retry saving."
                    : "Wait for the saved confirmation before leaving."}
                </p>
              </div>
            </div>

            {saveStatus === "error" ? (
              <button
                type="button"
                onClick={() => void retryLocalSave()}
                className="shrink-0 rounded-lg border border-red-400/25 px-2.5 py-1.5 text-[10px] text-red-300"
              >
                Retry save
              </button>
            ) : (
              <span className="shrink-0 rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-500">
                Auto-save
              </span>
            )}
          </div>

          {wasRecovered && (
            <div className="flex items-start justify-between gap-3 border-t border-emerald-400/10 bg-emerald-400/5 px-4 py-3">
              <p className="text-[11px] leading-5 text-emerald-300">
                Your saved workspace has been restored. Continue from
                where you stopped.
              </p>

              <button
                type="button"
                onClick={() => setWasRecovered(false)}
                aria-label="Dismiss recovery message"
                className="shrink-0 text-emerald-300 hover:text-emerald-100"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>

        {/* Messages */}
        {message && (
          <div
            role={message.type === "error" ? "alert" : "status"}
            className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs leading-5 ${
              message.type === "success"
                ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
                : message.type === "error"
                ? "border-red-400/20 bg-red-400/5 text-red-300"
                : "border-slate-700 bg-slate-900 text-slate-300"
            }`}
          >
            <p>{message.text}</p>

            <button
              type="button"
              onClick={() => setMessage(null)}
              aria-label="Dismiss message"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* OPENING */}
        {workspace.stage === "OPENING" && (
          <form onSubmit={handleOpening}>
            <fieldset
              disabled={isBusy}
              className="min-w-0 space-y-5"
            >
              <Card>
                <label htmlFor="supervisor-name" className={labelCls}>
                  Supervisor name
                </label>

                <input
                  id="supervisor-name"
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  value={workspace.supervisorName}
                  onChange={(event) =>
                    updateWorkspace({
                      supervisorName: event.target.value,
                    })
                  }
                  required
                  className={inputCls}
                  placeholder="Enter your full name"
                />
              </Card>

              {renderScanner("OPENING")}

              <Card>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="fuel-price" className={labelCls}>
                      Fuel price · GHS / L
                    </label>

                    <input
                      id="fuel-price"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={workspace.fuelPrice}
                      onChange={(event) =>
                        updateWorkspace({
                          fuelPrice: event.target.value,
                        })
                      }
                      required
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label
                        htmlFor="opening-meter"
                        className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400"
                      >
                        Opening meter
                      </label>

                      <button
                        type="button"
                        disabled={isLoadingPrevious}
                        onClick={() => void resyncOpeningMeter()}
                        className="flex items-center gap-1 text-[10px] text-amber-300 disabled:opacity-50"
                      >
                        <Icon
                          name="refresh"
                          className={`h-3 w-3 ${
                            isLoadingPrevious ? "animate-spin" : ""
                          }`}
                        />
                        {isLoadingPrevious ? "Syncing" : "Resync"}
                      </button>
                    </div>

                    <input
                      id="opening-meter"
                      type="number"
                      step="any"
                      value={workspace.openingMeter}
                      readOnly
                      className="w-full cursor-not-allowed rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3.5 text-sm text-slate-400 outline-none"
                    />

                    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <Icon name="lock" className="h-3 w-3" />
                      {workspace.openingSource || "Baseline not loaded"}
                    </p>
                  </div>
                </div>
              </Card>

              <button
                type="submit"
                disabled={
                  isBusy ||
                  isScanning ||
                  cameraActive ||
                  isLoadingPrevious ||
                  !workspace.baselineReady
                }
                className={primaryBtnCls}
              >
                {isBusy ? "Saving opening…" : "Lock opening & start shift"}
                <Icon name="arrow" className="h-4 w-4" />
              </button>
            </fieldset>
          </form>
        )}

        {/* BLIND DROP */}
        {workspace.stage === "BLIND_DROP" && (
          <form onSubmit={handleBlindDrop}>
            <fieldset
              disabled={isBusy}
              className="min-w-0 space-y-5"
            >
              <Card>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <Icon name="clock" />
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">
                      Shift in progress
                    </h3>

                    <p className="mt-1 text-xs leading-6 text-slate-400">
                      Your opening is saved. You can leave and return
                      using this browser. Complete the declaration
                      below when the shift ends.
                    </p>
                  </div>
                </div>

                <dl className="mt-4 divide-y divide-slate-800 border-t border-slate-800">
                  <DetailRow
                    label="Supervisor"
                    value={workspace.supervisorName}
                  />

                  <DetailRow
                    label="Opened"
                    value={
                      workspace.openedAt
                        ? dateTime(workspace.openedAt)
                        : "—"
                    }
                  />
                </dl>
              </Card>

              <Card className="space-y-5">
                <div className="flex items-start gap-3">
                  <Icon
                    name="lock"
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-300"
                  />

                  <div>
                    <h3 className="text-sm font-semibold">
                      Blind collection declaration
                    </h3>

                    <p className="mt-1 text-xs leading-6 text-slate-400">
                      Count actual cash and confirm MoMo collections.
                      Expected sales and variance are hidden. Submitted
                      amounts will be locked.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="blind-cash" className={labelCls}>
                      Physical cash · GHS
                    </label>

                    <input
                      id="blind-cash"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={workspace.cashCollected}
                      onChange={(event) =>
                        updateWorkspace({
                          cashCollected: event.target.value,
                        })
                      }
                      required
                      className={inputCls}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label htmlFor="blind-momo" className={labelCls}>
                      MoMo confirmed · GHS
                    </label>

                    <input
                      id="blind-momo"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={workspace.momoCollected}
                      onChange={(event) =>
                        updateWorkspace({
                          momoCollected: event.target.value,
                        })
                      }
                      required
                      className={inputCls}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="blind-expenses" className={labelCls}>
                    Shift expenses · GHS
                  </label>

                  <input
                    id="blind-expenses"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={workspace.expenses}
                    onChange={(event) =>
                      updateWorkspace({
                        expenses: event.target.value,
                      })
                    }
                    className={inputCls}
                    placeholder="0.00"
                  />

                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    Expenses must be paid from shift takings. Enter
                    physical cash after these payments, excluding any
                    opening float or personal money.
                  </p>
                </div>

                <div>
                  <label htmlFor="drop-reference" className={labelCls}>
                    Deposit bag / handover reference · optional
                  </label>

                  <input
                    id="drop-reference"
                    type="text"
                    maxLength={100}
                    value={workspace.dropReference}
                    onChange={(event) =>
                      updateWorkspace({
                        dropReference: event.target.value,
                      })
                    }
                    className={inputCls}
                    placeholder="Example: BAG-001"
                  />
                </div>
              </Card>

              <button
                type="submit"
                disabled={isBusy}
                className={primaryBtnCls}
              >
                <Icon name="lock" className="h-4 w-4" />
                {isBusy
                  ? "Saving declaration…"
                  : "Lock blind drop & continue"}
              </button>
            </fieldset>
          </form>
        )}

        {/* CLOSING */}
        {workspace.stage === "CLOSING" && (
          <form onSubmit={handleClosing}>
            <fieldset
              disabled={isBusy}
              className="min-w-0 space-y-5"
            >
              {finalSubmissionLocked && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-6 text-amber-200">
                  A final submission has been prepared. Readings and
                  amounts are frozen so a retry sends the same shift,
                  not a new record.
                </div>
              )}

              {renderScanner("CLOSING")}

              <Card>
                <label htmlFor="closing-meter" className={labelCls}>
                  Closing meter · litres
                </label>

                <input
                  id="closing-meter"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={workspace.closingMeter}
                  onChange={(event) =>
                    updateWorkspace({
                      closingMeter: event.target.value,
                    })
                  }
                  disabled={finalSubmissionLocked}
                  required
                  className={inputCls}
                  placeholder="Enter the closing meter reading"
                />

                <p className="mt-2 text-[11px] text-slate-500">
                  Opening baseline:{" "}
                  <span className="font-medium text-slate-300">
                    {workspace.openingMeter} L
                  </span>
                </p>
              </Card>

              <Card>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Declared collections
                  </h3>

                  <span className="flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                    <Icon name="lock" className="h-3 w-3" />
                    Locked
                  </span>
                </div>

                <dl className="mt-3 divide-y divide-slate-800">
                  <DetailRow
                    label="Physical cash"
                    value={ghs(Number(workspace.cashCollected || "0"))}
                  />

                  <DetailRow
                    label="MoMo"
                    value={ghs(Number(workspace.momoCollected || "0"))}
                  />

                  <DetailRow
                    label="Expenses"
                    value={ghs(Number(workspace.expenses || "0"))}
                  />

                  <DetailRow
                    label="Drop reference"
                    value={workspace.dropReference || "Not provided"}
                  />

                  <DetailRow
                    label="Declared"
                    value={
                      workspace.dropSubmittedAt
                        ? dateTime(workspace.dropSubmittedAt)
                        : "—"
                    }
                  />
                </dl>

                <p className="mt-3 border-t border-slate-800 pt-4 text-[11px] leading-5 text-slate-500">
                  Expected sales and variance appear after the shift
                  submission is confirmed.
                </p>
              </Card>

              <button
                type="submit"
                disabled={isBusy || isScanning || cameraActive}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-4 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="check" className="h-4 w-4" />

                {isBusy
                  ? "Submitting shift…"
                  : finalSubmissionLocked
                  ? "Retry saved submission"
                  : "Submit & close shift"}
              </button>
            </fieldset>
          </form>
        )}

        {/* REPORT */}
        {workspace.stage === "REPORT" && workspace.report && (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-400/10 via-slate-900 to-slate-900 p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Shift completed
                </p>

                <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                  <Icon name="check" className="h-3.5 w-3.5" />
                  Saved to Supabase
                </span>
              </div>

              <p className="mt-5 text-xs text-slate-400">
                Total litres sold
              </p>

              <p className="mt-1 break-all font-mono text-4xl font-semibold tracking-tight text-amber-300 sm:text-5xl">
                {litresText(workspace.report.litres)}
                <span className="ml-2 text-lg text-slate-500">L</span>
              </p>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/5 pt-4">
                <span className="text-xs text-slate-400">
                  Expected sales
                </span>

                <span className="text-lg font-semibold text-white">
                  {ghs(workspace.report.expected)}
                </span>
              </div>
            </section>

            <Card>
              <h3 className="text-sm font-semibold">
                Shift reconciliation
              </h3>

              <dl className="mt-3 divide-y divide-slate-800">
                <DetailRow
                  label="Reference"
                  value={shortReference(workspace.report.shiftId)}
                />

                <DetailRow
                  label="Supervisor"
                  value={workspace.report.supervisor}
                />

                <DetailRow
                  label="Opened"
                  value={dateTime(workspace.report.openedAt)}
                />

                <DetailRow
                  label="Closed"
                  value={dateTime(workspace.report.closedAt)}
                />

                <DetailRow
                  label="Fuel price"
                  value={`${ghs(workspace.report.price)} / L`}
                />

                <DetailRow
                  label="Meter readings"
                  value={`${litresText(
                    workspace.report.openM
                  )} → ${litresText(workspace.report.closeM)} L`}
                />

                <DetailRow
                  label="Cash"
                  value={ghs(workspace.report.cash)}
                />

                <DetailRow
                  label="MoMo"
                  value={ghs(workspace.report.momo)}
                />

                <DetailRow
                  label="Expenses"
                  value={ghs(workspace.report.expenses)}
                />

                <DetailRow
                  label="Total accounted"
                  value={ghs(workspace.report.accounted)}
                />
              </dl>
            </Card>

            {(() => {
              const variance = workspace.report.variance;
              const short = variance < -0.005;
              const over = variance > 0.005;

              return (
                <section
                  className={`flex items-center justify-between gap-4 rounded-2xl border p-5 ${
                    short
                      ? "border-red-400/25 bg-red-400/5"
                      : over
                      ? "border-amber-400/25 bg-amber-400/5"
                      : "border-emerald-400/25 bg-emerald-400/5"
                  }`}
                >
                  <div>
                    <p className={labelCls}>Variance</p>

                    <p
                      className={`font-mono text-xl font-semibold ${
                        short
                          ? "text-red-300"
                          : over
                          ? "text-amber-300"
                          : "text-emerald-300"
                      }`}
                    >
                      {variance >= 0 ? "+" : "-"}
                      {ghs(Math.abs(variance))}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider ${
                      short
                        ? "bg-red-400/10 text-red-300"
                        : over
                        ? "bg-amber-400/10 text-amber-300"
                        : "bg-emerald-400/10 text-emerald-300"
                    }`}
                  >
                    {short ? "Shortage" : over ? "Overage" : "Balanced"}
                  </span>
                </section>
              );
            })()}

            <Card>
              <div className="flex items-center gap-2">
                <Icon
                  name="shield"
                  className="h-4 w-4 text-amber-300"
                />

                <h3 className="text-sm font-semibold">
                  Blind-drop record
                </h3>
              </div>

              <dl className="mt-3 divide-y divide-slate-800">
                <DetailRow
                  label="Declared"
                  value={dateTime(
                    workspace.report.blindDropSubmittedAt
                  )}
                />

                <DetailRow
                  label="Deposit / handover reference"
                  value={
                    workspace.report.blindDropReference ||
                    "Not provided"
                  }
                />
              </dl>
            </Card>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void downloadReport()}
                disabled={isDownloading || isSharing}
                className={secondaryBtnCls}
              >
                <Icon name="download" className="h-4 w-4" />

                {isDownloading ? "Creating PDF…" : "Download PDF"}
              </button>

              <button
                type="button"
                onClick={() => void shareReport()}
                disabled={isSharing || isDownloading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3.5 text-xs font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
              >
                <Icon name="file" className="h-4 w-4" />

                {isSharing ? "Preparing report…" : "Share on WhatsApp"}
              </button>
            </div>

            <p className="text-center text-[10px] leading-5 text-slate-500">
              On supported phones, choose WhatsApp and then the
              owner’s chat from the share menu.
            </p>

            {!confirmNewShift ? (
              <button
                type="button"
                disabled={isSharing || isDownloading}
                onClick={() => setConfirmNewShift(true)}
                className={secondaryBtnCls}
              >
                Start new shift
                <Icon name="arrow" className="h-4 w-4" />
              </button>
            ) : (
              <Card>
                <h3 className="text-sm font-semibold">
                  Start the next shift?
                </h3>

                <p className="mt-2 text-xs leading-6 text-slate-400">
                  This replaces the local workspace. The completed
                  shift remains in Supabase. Download or share this
                  report first if you need a copy now.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setConfirmNewShift(false)}
                    className={secondaryBtnCls}
                  >
                    Keep report
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void startNewShift()}
                    className={primaryBtnCls}
                  >
                    {isBusy ? "Preparing…" : "Start next shift"}
                  </button>
                </div>
              </Card>
            )}
          </div>
        )}

        <footer className="mt-8 border-t border-slate-800/70 pt-5 text-center">
          <p className="text-[9px] uppercase tracking-[0.18em] text-slate-600">
            {STATION_NAME} · Supervisor terminal
          </p>

          <p className="mt-2 text-[10px] leading-5 text-slate-600">
            Workspace recovery on this browser · Completed shifts in
            Supabase
          </p>
        </footer>
      </div>
    </main>
  );
}