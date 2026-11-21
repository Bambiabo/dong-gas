"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createDraft, listReports, readDraft, saveDraft, saveCompletedDraft } from "@/lib/terminal-store";
import type { Draft, ShiftReport, StoredReport } from "@/lib/terminal-store";
import { fetchOpeningBaseline, supervisorError, uploadPendingShifts } from "@/lib/supervisor-service";
import { ghs, litresText, reportSummary, shiftReference } from "@/lib/terminal-pdf";

const input = "mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-base text-white focus:outline-2 focus:outline-amber-400";
const primary = "min-h-12 w-full rounded-xl bg-amber-400 px-5 py-3 text-base font-semibold text-slate-950 disabled:opacity-40";
const secondary = "min-h-11 w-full rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 disabled:opacity-40";

function amount(raw: string, label: string, positive = false): number {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < 0 || value > 1000000000000 || (positive && value <= 0)) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

export default function SupervisorWorkspace() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [records, setRecords] = useState<StoredReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraFor, setCameraFor] = useState<"opening" | "closing" | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [captured, setCaptured] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraFor(null);
    setCameraReady(false);
    setCaptured(false);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await readDraft();
        const reports = await listReports();
        const current = saved ?? createDraft();
        if (!saved) await saveDraft(current);
        if (active) {
          setDraft(current);
          setRecords(reports);
        }
      } catch (error) {
        if (active) setNotice(supervisorError(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    void saveDraft(draft).catch((error: unknown) => setNotice(supervisorError(error)));
  }, [draft]);

  useEffect(() => {
    if (!cameraFor || !videoRef.current) return;
    let active = true;
    let stream: MediaStream | null = null;

    const start = async () => {
      try {
        if (!window.isSecureContext) throw new Error("Camera access requires a secure HTTPS connection.");
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support live camera capture.");

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        await new Promise<void>((resolve, reject) => {
          if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("Camera preview could not start."));
          window.setTimeout(() => reject(new Error("Camera preview timed out.")), 10000);
        });

        if (active) setCameraReady(true);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Camera access is unavailable.");
        stopCamera();
      }
    };

    void start();
    return () => {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraFor, stopCamera]);

  function patch(change: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...change, updatedAt: new Date().toISOString() } : current));
  }

  function capture() {
    if (!draft || !cameraFor || !videoRef.current || !cameraReady) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setNotice("Wait for the camera preview, then try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setNotice("Camera is not ready.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.9);
    patch(cameraFor === "opening"
      ? { openingImage: image }
      : { closingImage: image });
    setCaptured(true);
    setNotice("Photo captured.");
    stopCamera();
  }

  async function openShift(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setNotice("");
    try {
      if (!draft.supervisorName.trim()) throw new Error("Enter the supervisor name.");
      if (!draft.openingImage) throw new Error("Capture the opening meter photo.");
      const price = amount(draft.fuelPrice, "Fuel price", true);
      const baseline = await fetchOpeningBaseline();
      if (Number(draft.openingMeter) !== Number(baseline.meter)) {
        patch({ openingMeter: baseline.meter, openingSource: baseline.source, baselineReady: true });
        throw new Error("Opening meter refreshed. Check it and start the shift again.");
      }
      const next: Draft = { ...draft, supervisorName: draft.supervisorName.trim(), stage: "CLOSING", openedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await saveDraft(next);
      setDraft(next);
      setNotice("Shift started.");
    } catch (error) {
      setNotice(supervisorError(error));
    } finally {
      setBusy(false);
    }
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setNotice("");
    try {
      if (!draft.openedAt || !draft.closingImage) throw new Error("Capture the closing meter photo.");
      const openM = amount(draft.openingMeter, "Opening meter");
      const closeM = amount(draft.closingMeter, "Closing meter");
      const price = amount(draft.fuelPrice, "Fuel price", true);
      const cash = amount(draft.cashCollected, "Cash collected");
      const momo = amount(draft.momoCollected, "MoMo collected");
      const expenses = amount(draft.expenses || "0", "Expenses");
      if (closeM <= openM) throw new Error("Closing meter must be higher than opening meter.");
      const litres = closeM - openM;
      const expected = litres * price;
      const accounted = cash + momo + expenses;
      const report: ShiftReport = {
        shiftId: draft.shiftId,
        supervisor: draft.supervisorName,
        openedAt: draft.openedAt,
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
        openingImage: draft.openingImage,
        closingImage: draft.closingImage,
      };
      const next: Draft = { ...draft, stage: "REPORT", report, updatedAt: new Date().toISOString() };
      await saveCompletedDraft(next);
      setDraft(next);
      setRecords(await listReports());
      setNotice("Shift completed. Upload it when you are connected.");
    } catch (error) {
      setNotice(supervisorError(error));
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    setBusy(true);
    setNotice("");
    try {
      const result = await uploadPendingShifts();
      setRecords(await listReports());
      setNotice(`${result.uploaded} shift uploaded. ${result.pending} still pending.`);
    } catch (error) {
      setNotice(supervisorError(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendWhatsApp(report: ShiftReport) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/whatsapp-contact", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Owner WhatsApp contact is not available.");
      const text = reportSummary(report, true);
      window.open(`https://wa.me/${result.phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open WhatsApp.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !draft) {
    return <main className="min-h-screen bg-slate-950 p-8 text-white"><p>Opening workspace…</p></main>;
  }

  const pending = records.filter((record) => record.status === "pending").length;
  const report = draft.report;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-md space-y-5">
        <header>
          <h1 className="text-2xl font-bold">Dong Gas</h1>
          <p className="text-sm text-slate-400">Supervisor shift</p>
        </header>

        {notice && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><p>{notice}</p></div>}

        {draft.stage === "OPENING" && (
          <form onSubmit={openShift} className="space-y-4">
            <label className="block text-sm">Supervisor name<input className={input} required value={draft.supervisorName} onChange={(event) => patch({ supervisorName: event.target.value })} /></label>
            <label className="block text-sm">Fuel price · GHS per litre<input className={input} inputMode="decimal" required value={draft.fuelPrice} onChange={(event) => patch({ fuelPrice: event.target.value })} /></label>
            <label className="block text-sm">Opening meter · litres<input className={input} inputMode="decimal" required value={draft.openingMeter} onChange={(event) => patch({ openingMeter: event.target.value })} /></label>
            <div className="rounded-xl border border-slate-700 p-4">
              <p className="text-sm">Opening meter photo</p>
              <button className={primary} type="button" onClick={() => { setCaptured(false); setCameraFor("opening"); }}>Open camera</button>
              {draft.openingImage && <p className="mt-2 text-sm text-emerald-300">Opening photo captured.</p>}
            </div>
            <button className={primary} disabled={busy}>Start shift</button>
          </form>
        )}

        {draft.stage === "CLOSING" && (
          <form onSubmit={closeShift} className="space-y-4">
            <div className="rounded-xl border border-slate-700 p-4">
              <p className="text-sm text-slate-400">Opening meter</p>
              <p className="text-2xl font-bold">{draft.openingMeter} L</p>
            </div>
            <label className="block text-sm">Closing meter · litres<input className={input} inputMode="decimal" required value={draft.closingMeter} onChange={(event) => patch({ closingMeter: event.target.value })} /></label>
            <div className="rounded-xl border border-slate-700 p-4">
              <p className="text-sm">Closing meter photo</p>
              <button className={primary} type="button" onClick={() => { setCaptured(false); setCameraFor("closing"); }}>Open camera</button>
              {draft.closingImage && <p className="mt-2 text-sm text-emerald-300">Closing photo captured.</p>}
            </div>
            <label className="block text-sm">Cash collected · GHS<input className={input} inputMode="decimal" required value={draft.cashCollected} onChange={(event) => patch({ cashCollected: event.target.value })} /></label>
            <label className="block text-sm">MoMo collected · GHS<input className={input} inputMode="decimal" required value={draft.momoCollected} onChange={(event) => patch({ momoCollected: event.target.value })} /></label>
            <label className="block text-sm">Expenses · GHS<input className={input} inputMode="decimal" value={draft.expenses} onChange={(event) => patch({ expenses: event.target.value })} /></label>
            <button className={primary} disabled={busy}>Complete shift</button>
          </form>
        )}

        {draft.stage === "REPORT" && report && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
              <p className="text-sm text-slate-300">Litres sold</p>
              <p className="text-4xl font-bold text-amber-300">{litresText(report.litres)}</p>
              <p className="mt-2 text-sm">Expected: {ghs(report.expected)} · Accounted: {ghs(report.accounted)}</p>
              <p className="mt-1 text-sm">Variance: {ghs(report.variance)}</p>
            </div>
            <button className={primary} type="button" disabled={busy} onClick={() => void sendWhatsApp(report)}>Send report to owner on WhatsApp</button>
            <button className={secondary} type="button" disabled={!pending || busy} onClick={() => void upload()}>{pending ? `Upload ${pending} pending shift` : "Shift uploaded"}</button>
            <button className={secondary} type="button" onClick={() => { const next = createDraft(String(report.price)); setDraft(next); }}>Start next shift</button>
          </div>
        )}

        {cameraFor && (
          <div className="fixed inset-0 z-50 bg-black p-4">
            <div className="mx-auto flex h-full max-w-md flex-col gap-3">
              <video ref={videoRef} autoPlay playsInline muted className="min-h-0 flex-1 rounded-xl object-cover" />
              <button className={primary} disabled={!cameraReady || captured} type="button" onClick={capture}>
                {cameraReady ? "Capture photo" : "Starting camera…"}
              </button>
              <button className={secondary} type="button" onClick={stopCamera}>Close camera</button>
            </div>
          </div>
        )}

        <p className="pb-6 text-center text-xs text-slate-500">{pending} pending upload{pending === 1 ? "" : "s"}</p>
      </div>
    </main>
  );
}
