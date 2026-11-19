import { supabase } from "./supabase";
import { listReports, updateStoredReport } from "./terminal-store";
import type { StoredReport } from "./terminal-store";

export type OpeningBaseline = { meter: string; source: string };
export type UploadSummary = { uploaded: number; pending: number };

export function supervisorError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "The operation failed. Your saved shift remains on this device.";
}

export async function fetchOpeningBaseline(): Promise<OpeningBaseline> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await supabase.rpc("get_main_pump_opening")
      .abortSignal(controller.signal);
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error("Configure exactly one main-pump opening baseline before starting a shift.");
    }
    const row = data[0] as { opening_meter?: unknown; source?: unknown };
    const raw = row.opening_meter;
    if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") {
      throw new Error("The server returned an invalid opening meter.");
    }
    const meter = Number(raw);
    if (!Number.isFinite(meter) || meter < 0 || meter > 1000000000000) {
      throw new Error("The server returned an invalid opening meter.");
    }
    return {
      meter: String(meter),
      source: typeof row.source === "string" ? row.source : "Station baseline",
    };
  } finally { clearTimeout(timeout); }
}

async function submitSavedReport(record: StoredReport): Promise<void> {
  const report = record.report;
  if (record.id !== report.shiftId) throw new Error("Saved shift reference mismatch. Upload stopped.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const { data, error } = await supabase.rpc("submit_supervisor_shift", {
      p_payload: {
        client_shift_id: report.shiftId,
        supervisor_name: report.supervisor,
        fuel_price: report.price,
        opening_meter: report.openM,
        closing_meter: report.closeM,
        cash_collected: report.cash,
        momo_collected: report.momo,
        expenses: report.expenses,
        opening_proof_image: report.openingImage,
        proof_image: report.closingImage,
      },
    }).abortSignal(controller.signal);
    if (error) throw error;
    if (typeof data !== "object" || data === null || Array.isArray(data) || data.accepted !== true) {
      throw new Error("The server did not confirm acceptance. The shift remains pending for retry.");
    }
    await updateStoredReport(record.id, {
      status: "synced", syncedAt: new Date().toISOString(), lastError: null,
    });
  } finally { clearTimeout(timeout); }
}

let activeUpload: Promise<UploadSummary> | null = null;

async function uploadQueue(): Promise<UploadSummary> {
  if (typeof navigator === "undefined" || !navigator.onLine) {
    throw new Error("Connect to upload. Saved shifts remain on this device.");
  }
  const pending = (await listReports())
    .filter((record) => record.status === "pending")
    .sort((a, b) => a.report.closedAt.localeCompare(b.report.closedAt) || a.id.localeCompare(b.id));
  let uploaded = 0;
  for (const record of pending) {
    try {
      await submitSavedReport(record);
      uploaded += 1;
    } catch (error) {
      try { await updateStoredReport(record.id, { lastError: supervisorError(error) }); }
      catch (storageError) {
        throw new Error(`${supervisorError(error)} Could not save upload status: ${supervisorError(storageError)}`);
      }
      throw new Error(`Upload stopped after ${uploaded} completed upload(s): ${supervisorError(error)}`);
    }
  }
  const remaining = (await listReports()).filter((record) => record.status === "pending").length;
  return { uploaded, pending: remaining };
}

export function uploadPendingShifts(): Promise<UploadSummary> {
  if (activeUpload) return activeUpload;
  activeUpload = uploadQueue().finally(() => { activeUpload = null; });
  return activeUpload;
}
