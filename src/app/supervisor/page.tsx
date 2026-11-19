"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { createDraft, listReports, readDraft, saveDraft, saveCompletedDraft } from "@/lib/terminal-store";
import type { Draft, ShiftReport, StoredReport } from "@/lib/terminal-store";
import { fetchOpeningBaseline, supervisorError, uploadPendingShifts } from "@/lib/supervisor-service";
import { buildPdf, dateTime, downloadBlob, ghs, reportFilename, reportSummary, shiftReference } from "@/lib/terminal-pdf";

const input = "mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-base text-white focus:outline-2 focus:outline-amber-400";
const button = "min-h-12 rounded-xl border border-slate-600 px-5 py-3 text-sm font-semibold transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40";
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-7"><h2 className="mb-5 text-lg font-semibold">{title}</h2>{children}</section>;
}
function amount(raw: string, name: string, positive = false): number {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < 0 || value > 1000000000000 || (positive && value <= 0)) throw new Error(`${name} is missing or invalid.`);
  return value;
}
async function photo(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 15000000) throw new Error("Choose an image smaller than 15 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally { bitmap.close(); }
}
async function clearLocalTests(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("dong-gas-v2", 2);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Dong Gas tabs before resetting."));
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(["workspace", "reports"], "readwrite");
        tx.objectStore("workspace").clear();
        tx.objectStore("reports").clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Reset aborted.")); };
        tx.onerror = () => { /* The abort event reports the failure. */ };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

export default function SupervisorWorkspace() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [records, setRecords] = useState<StoredReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [saveState, setSaveState] = useState("Loading storage");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const action = useRef(false);
  const persist = useCallback((value: Draft) => {
    const current = ++revision.current;
    setSaveState("Saving on this device");
    const task = queue.current.catch(() => undefined).then(() => saveDraft(value));
    queue.current = task;
    return task.then(() => { if (current === revision.current) setSaveState("Saved on this device"); }, (error: unknown) => {
      if (current === revision.current) setSaveState("Save failed — do not leave this page");
      throw error;
    });
  }, []);
  useEffect(() => {
    let cancelled = false;
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    void (async () => {
      try {
        const saved = await readDraft();
        const reports = await listReports();
        const current = saved ?? createDraft();
        if (!saved) await saveDraft(current);
        if (!cancelled) { setDraft(current); setRecords(reports); setSaveState("Saved on this device"); }
      } catch (error) { if (!cancelled) setRecoveryError(supervisorError(error)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);
  useEffect(() => {
    if (draft && !busy && !recoveryError) void persist(draft).catch((error: unknown) => setNotice(supervisorError(error)));
  }, [draft, busy, recoveryError, persist]);
  function patch(change: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...change, updatedAt: new Date().toISOString() } : current);
  }
  async function run(work: () => Promise<void>) {
    if (action.current) return;
    action.current = true; setBusy(true); setNotice("");
    try { await work(); }
    catch (error) { setNotice(supervisorError(error)); }
    finally { action.current = false; setBusy(false); }
  }
  async function baseline() {
    if (!navigator.onLine) throw new Error("Connect to verify the opening meter before starting a new shift.");
    if ((await listReports()).some((record) => record.status === "pending")) throw new Error("Review pending reports first. Reset old test data or upload genuine reports before opening another shift.");
    return fetchOpeningBaseline();
  }
  function resync() { void run(async () => { const next = await baseline(); patch({ openingMeter: next.meter, openingSource: next.source, baselineReady: true }); setNotice("Opening meter verified with the station."); }); }
  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    void run(async () => {
      if (!draft.supervisorName.trim() || draft.supervisorName.trim().length > 120 || !draft.openingImage) throw new Error("Enter your name and capture the opening meter photo.");
      const price = amount(draft.fuelPrice, "Fuel price", true);
      if (price > 1000000) throw new Error("Fuel price exceeds the allowed limit.");
      const verified = await baseline();
      if (!draft.baselineReady || Number(draft.openingMeter) !== Number(verified.meter)) {
        patch({ openingMeter: verified.meter, openingSource: verified.source, baselineReady: true });
        throw new Error("Opening meter refreshed. Check it against the pump, then select Start shift again.");
      }
      const next: Draft = { ...draft, supervisorName: draft.supervisorName.trim(), stage: "CLOSING", openedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await persist(next); setDraft(next); setNotice("Shift opened and saved on this device.");
    });
  }
  function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    void run(async () => {
      if (!draft.openedAt || !draft.openingImage || !draft.closingImage) throw new Error("Both meter photos and an opened shift are required.");
      const openM = amount(draft.openingMeter, "Opening meter");
      const closeM = amount(draft.closingMeter, "Closing meter");
      const price = amount(draft.fuelPrice, "Fuel price", true);
      const cash = amount(draft.cashCollected, "Cash");
      const momo = amount(draft.momoCollected, "MoMo");
      const expenses = amount(draft.expenses || "0", "Expenses");
      if (closeM <= openM || price > 1000000) throw new Error("Closing must exceed opening and fuel price must be valid.");
      const litres = closeM - openM; const expected = litres * price; const accounted = cash + momo + expenses;
      const report: ShiftReport = { shiftId: draft.shiftId, supervisor: draft.supervisorName, openedAt: draft.openedAt, closedAt: new Date().toISOString(), price, openM, closeM, litres, expected, cash, momo, expenses, accounted, variance: accounted - expected, openingImage: draft.openingImage, closingImage: draft.closingImage };
      const next: Draft = { ...draft, stage: "REPORT", report, updatedAt: new Date().toISOString() };
      await queue.current.catch(() => undefined);
      await saveCompletedDraft(next); setDraft(next); setRecords(await listReports()); setNotice("Report saved locally. Review it, then upload when connected.");
    });
  }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>, opening: boolean) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (file) void run(async () => { const image = await photo(file); patch(opening ? { openingImage: image } : { closingImage: image }); });
  }
  function exportPdf(report: ShiftReport, share: boolean) {
    void run(async () => {
      const latest = await listReports(); setRecords(latest);
      const synced = latest.some((record) => record.id === report.shiftId && record.status === "synced");
      const blob = await buildPdf(report, synced);
      const file = new File([blob], reportFilename(report), { type: "application/pdf" });
      if (share && navigator.canShare?.({ files: [file] }) && navigator.share) {
        try { await navigator.share({ title: "Dong Gas shift report", text: reportSummary(report, synced), files: [file] }); }
        catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) throw error; }
      } else { downloadBlob(blob, reportFilename(report)); setNotice(share ? "PDF downloaded. Attach it to your WhatsApp message." : "PDF downloaded."); }
    });
  }
  function resetTests() {
    if (window.prompt("This permanently clears this browser's Dong Gas draft, saved reports and pending uploads. It does not change Supabase or accounts. Close all other Dong Gas tabs first. Type CLEAR TEST DATA to continue.") !== "CLEAR TEST DATA") return;
    void run(async () => {
      await queue.current.catch(() => undefined); await clearLocalTests();
      const next = createDraft(); await persist(next); setRecords([]); setDraft(next); setNotice("Device test data cleared. Verify the station baseline before starting.");
    });
  }
  if (loading || recoveryError || !draft) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><h1 className="text-2xl">{recoveryError ? "Storage recovery needs attention" : "Opening workspace"}</h1><p className="my-5">{recoveryError || "Reading saved shifts. Nothing is being uploaded automatically."}</p>{recoveryError && <button className={button} onClick={() => window.location.reload()}>Retry without clearing data</button>}</main>;
  const report = draft.report;
  const pending = records.filter((record) => record.status === "pending").length;
  const stage = draft.stage === "OPENING" ? 0 : draft.stage === "CLOSING" ? 1 : 2;
  const numericField = (label: string, key: "fuelPrice" | "closingMeter" | "cashCollected" | "momoCollected" | "expenses", required = true) => <label className="block text-sm text-slate-300">{label}<input className={input} type="number" min="0" max={key === "fuelPrice" ? "1000000" : "1000000000000"} step="any" inputMode="decimal" required={required} value={draft[key]} onChange={(event) => patch({ [key]: event.target.value })} /></label>;
  const evidence = (opening: boolean) => <div className="space-y-3"><label className="block text-sm text-slate-300">{opening ? "Opening" : "Closing"} meter photo<input className={input} type="file" accept="image/*" capture="environment" onChange={(event) => choosePhoto(event, opening)} /></label>{(opening ? draft.openingImage : draft.closingImage) && <div><p className="text-sm text-emerald-300">Photo attached — verify the digits are readable.</p>{/* eslint-disable-next-line @next/next/no-img-element */}<img className="mt-3 max-h-64 w-full rounded-xl object-contain" src={(opening ? draft.openingImage : draft.closingImage) ?? ""} alt={opening ? "Opening meter evidence" : "Closing meter evidence"} /></div>}</div>;
  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100"><div className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-5 border-b border-slate-700 pb-6"><div><p className="text-xs uppercase tracking-widest text-amber-300">Dong Gas · Station operations</p><h1 className="mt-2 text-3xl font-semibold">Supervisor workspace</h1><p className="mt-2 text-sm text-slate-400">Rebuild preview · v1 · Not cleared for production</p></div><a href="/" className={button}>Home</a></header>
    <div className="grid gap-3 sm:grid-cols-3">{[online ? "Internet connected" : "Offline — local saving only", saveState, `${pending} pending upload${pending === 1 ? "" : "s"}`].map((text, index) => <p key={index} className="rounded-xl border border-slate-700 p-4 text-sm" aria-live="polite">{text}</p>)}</div>
    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">Transition mode: uploads are manual. Review or clear old device test reports before uploading. New shifts require internet; an active shift can be completed offline. Offline reopening is not enabled in this preview.</p>
    {notice && <div role="status" aria-live="polite" className="rounded-xl border border-amber-400/50 bg-slate-900 p-5"><p>{notice}</p><button className="mt-3 text-sm text-amber-300" onClick={() => setNotice("")}>Dismiss</button></div>}
    <ol className="grid grid-cols-3 gap-3" aria-label="Shift progress">{["Opening", "Active shift", "Report"].map((label, index) => <li key={label} aria-current={index === stage ? "step" : undefined} className={`rounded-xl border p-4 text-sm ${index === stage ? "border-amber-400 text-amber-200" : "border-slate-700 text-slate-400"}`}>{index + 1}. {label}</li>)}</ol>
    <fieldset disabled={busy} className="min-w-0 space-y-6">
    {draft.stage === "OPENING" && <form onSubmit={open} className="space-y-6"><Panel title="Prepare your shift"><div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm text-slate-300">Supervisor name<input className={input} autoComplete="name" maxLength={120} required value={draft.supervisorName} onChange={(event) => patch({ supervisorName: event.target.value })} /></label>{numericField("Fuel price · GHS per litre", "fuelPrice")}<div className="sm:col-span-2"><p className="text-sm text-slate-400">Opening meter · litres</p><p className="my-2 font-mono text-4xl text-amber-300">{draft.baselineReady ? draft.openingMeter : "Not verified"}</p><p className="mb-4 text-sm text-slate-400">{draft.openingSource || "Fetch the station baseline and compare it with the pump."}</p><button type="button" className={button} disabled={!online} onClick={resync}>Verify station baseline</button></div></div></Panel><Panel title="Opening evidence">{evidence(true)}</Panel><button className={`${button} w-full bg-amber-400 text-slate-950`} disabled={!online} type="submit">{busy ? "Saving…" : "Start shift"}</button></form>}
    {draft.stage === "CLOSING" && <form onSubmit={close} className="space-y-6"><Panel title="Shift in progress"><dl className="grid gap-5 sm:grid-cols-3">{[["Supervisor", draft.supervisorName], ["Opened", draft.openedAt ? dateTime(draft.openedAt) : "Not recorded"], ["Opening meter", `${draft.openingMeter} L`]].map(([label, value]) => <div key={label}><dt className="text-sm text-slate-400">{label}</dt><dd className="mt-2 font-medium">{value}</dd></div>)}</dl></Panel><Panel title="Closing evidence">{evidence(false)}</Panel><Panel title="Readings and collections"><div className="grid gap-5 sm:grid-cols-2">{numericField("Closing meter · litres", "closingMeter")}{numericField("Cash remaining · GHS", "cashCollected")}{numericField("MoMo collected · GHS", "momoCollected")}{numericField("Expenses paid from shift takings · GHS", "expenses", false)}</div><p className="mt-5 text-sm leading-6 text-slate-400">Enter 0 where there were no collections. Cash excludes opening float and personal funds. Accounted money = remaining cash + MoMo + expenses paid from takings.</p></Panel><button className={`${button} w-full bg-amber-400 text-slate-950`} type="submit">Save completed shift on this device</button></form>}
    {draft.stage === "REPORT" && report && <Panel title={`Shift report · ${shiftReference(report.shiftId)}`}><div className="grid gap-4 sm:grid-cols-3">{[["Litres sold", report.litres.toLocaleString("en-GH", { maximumFractionDigits: 3 })], ["Expected sales", ghs(report.expected)], ["Total accounted", ghs(report.accounted)], ["Cash", ghs(report.cash)], ["MoMo", ghs(report.momo)], ["Expenses", ghs(report.expenses)], ["Variance · accounted − expected", ghs(report.variance)]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}</div><div className="mt-5 flex flex-wrap gap-3"><button type="button" className={button} onClick={() => exportPdf(report, false)}>Download PDF</button><button type="button" className={button} onClick={() => exportPdf(report, true)}>Share PDF</button><button type="button" className={button} onClick={() => { if (window.confirm("Start another shift? This report will remain saved.")) void run(async () => { const next = createDraft(String(report.price)); await persist(next); setDraft(next); }); }}>Prepare next shift</button></div></Panel>}
    <Panel title="Saved reports and uploads"><p className="mb-5 text-sm text-slate-400">Records stay on this browser until explicitly cleared. A PDF is not proof of server upload.</p><button type="button" disabled={!online || pending === 0} className={button} onClick={() => { if (window.confirm(`Upload ${pending} pending report(s) to Supabase? Do not upload old test records.`)) void run(async () => { try { const result = await uploadPendingShifts(); setNotice(`${result.uploaded} uploaded; ${result.pending} pending.`); } finally { setRecords(await listReports()); } }); }}>Upload reviewed pending reports</button><div className="mt-5 space-y-3">{records.length === 0 && <p className="text-sm text-slate-400">No reports saved on this browser.</p>}{[...records].sort((a, b) => b.report.closedAt.localeCompare(a.report.closedAt)).map((record) => <article key={record.id} className="rounded-xl border border-slate-700 p-4"><div className="flex flex-wrap justify-between gap-3"><h3>{shiftReference(record.id)} · {record.report.supervisor}</h3><p className={record.status === "synced" ? "text-emerald-300" : "text-amber-300"}>{record.status === "synced" ? "Server upload confirmed" : "Pending upload"}</p></div><p className="my-2 text-sm text-slate-400">{dateTime(record.report.closedAt)} · {record.report.openM} → {record.report.closeM} L</p>{record.lastError && <p className="my-3 break-words text-sm text-red-300">{record.lastError}</p>}<button className={button} type="button" onClick={() => exportPdf(record.report, false)}>Download saved PDF</button></article>)}</div></Panel>
    <details className="rounded-xl border border-slate-700 p-5"><summary className="cursor-pointer text-sm text-slate-400">Device test-data cleanup</summary><p className="my-4 text-sm text-slate-400">Only for the agreed test reset. Clears this browser's draft, reports and pending uploads; not Supabase, accounts, passwords or station settings. Repeat separately on each device and browser. Close other Dong Gas tabs first.</p><button type="button" className={`${button} text-red-300`} onClick={resetTests}>Clear this browser's test shift data</button></details>
    </fieldset><footer className="pb-8 text-center text-xs text-slate-500">Dong Gas · Rebuild preview · No automatic uploads · Verify build and device tests before release</footer>
  </div></main>;
}
