"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const OWNER_WHATSAPP = process.env.NEXT_PUBLIC_OWNER_WHATSAPP || "233000000000";
const STATION_NAME = "DONG GAS";

type Stage = "OPENING" | "CLOSING" | "REPORT";

type Report = {
  supervisor: string;
  date: string;
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

const ghs = (n: number) =>
  "GHS " + n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Crisp Industrial Icons
const Icons = {
  Pump: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16m-2-10h2a2 2 0 012 2v3a2 2 0 002 2h0a2 2 0 002-2V9.83a2 2 0 00-.59-1.42L18 6M8 7h4v4H8V7z" />
    </svg>
  ),
  Camera: () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Flip: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  Lock: () => (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  Check: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  WhatsApp: () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.274.072.376-.043c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.1.824z" />
    </svg>
  ),
  Scan: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
    </svg>
  ),
};

const inputCls =
  "w-full bg-[#0c1220] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition tabular-nums";
const labelCls = "block text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400 mb-2";
const panelCls =
  "bg-[#0b101d]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 shadow-2xl shadow-black/50";

export default function SupervisorTerminal() {
  const [shiftStage, setShiftStage] = useState<Stage>("OPENING");

  // Opening
  const [supervisorName, setSupervisorName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("10.40");
  const [openingMeter, setOpeningMeter] = useState("");
  const [openingImage, setOpeningImage] = useState<string | null>(null);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);

  // Closing
  const [closingMeter, setClosingMeter] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  const [momoCollected, setMomoCollected] = useState("");
  const [expenses, setExpenses] = useState("");
  const [closingImage, setClosingImage] = useState<string | null>(null);

  // Report
  const [report, setReport] = useState<Report | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  // UI / AI Vision state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedPreviewValue, setScannedPreviewValue] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);

  // Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [useRearCamera, setUseRearCamera] = useState(true);

  const showMessage = (type: "info" | "success" | "error", text: string) => setMessage({ type, text });

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const fetchPreviousClosingMeter = async () => {
    try {
      setIsLoadingPrevious(true);
      showMessage("info", "Syncing pump telemetry…");

      const { data: shiftData, error: shiftError } = await supabase
        .from("shifts")
        .select("closing_meter")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!shiftError && shiftData && shiftData.length > 0 && shiftData[0].closing_meter != null) {
        const prior = shiftData[0].closing_meter.toString();
        setOpeningMeter(prior);
        showMessage("success", `Synced previous closing: ${prior} L`);
        return;
      }

      const { data: baseData, error: baseError } = await supabase
        .from("station_baselines")
        .select("baseline_meter")
        .eq("pump_name", "main")
        .limit(1);

      if (!baseError && baseData && baseData.length > 0) {
        const baseline = baseData[0].baseline_meter.toString();
        setOpeningMeter(baseline);
        showMessage("info", `Owner baseline loaded: ${baseline} L`);
      } else {
        setOpeningMeter("1000");
        showMessage("info", "Default baseline set: 1000 L");
      }
    } catch (err) {
      console.error(err);
      setOpeningMeter("1000");
      showMessage("error", "Sync offline. Defaulted to 1000 L.");
    } finally {
      setIsLoadingPrevious(false);
    }
  };

  useEffect(() => {
    fetchPreviousClosingMeter();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async (rear: boolean) => {
    try {
      stopCamera();
      setCameraActive(true);
      setScannedPreviewValue(null);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: rear ? { exact: "environment" } : "user" },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: rear ? "environment" : "user" },
          audio: false,
        });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error(err);
      alert("Camera permission denied. Please enable camera access.");
      setCameraActive(false);
    }
  };

  const toggleCameraFacing = () => {
    const next = !useRearCamera;
    setUseRearCamera(next);
    startCamera(next);
  };

  // ── Cloud AI Vision OCR ──
  const runAIVisionOCR = async (dataUrl: string) => {
    try {
      setIsScanning(true);
      showMessage("info", "AI Vision analyzing dispenser digits…");

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();

      if (res.ok && data.digits && data.digits.length >= 3) {
        setScannedPreviewValue(data.digits);
        showMessage("success", "Dispenser digits extracted. Verify below.");
      } else {
        showMessage("error", "Glare or angle blocked OCR. Enter manually.");
      }
    } catch (err) {
      console.error(err);
      showMessage("error", "AI Vision connection failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    if (shiftStage === "OPENING") setOpeningImage(dataUrl);
    else setClosingImage(dataUrl);

    stopCamera();
    await runAIVisionOCR(dataUrl);
  };

  const confirmScannedValue = () => {
    if (!scannedPreviewValue) return;
    if (shiftStage === "CLOSING") setClosingMeter(scannedPreviewValue);
    setScannedPreviewValue(null);
    showMessage("success", "Meter value applied.");
  };

  const handleOpenShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supervisorName.trim()) return alert("Supervisor name is required.");
    if (!openingImage) return alert("Opening meter photo proof is required.");
    if (!openingMeter || isNaN(parseFloat(openingMeter))) return alert("Valid opening meter is required.");

    setShiftStage("CLOSING");
    showMessage("success", "Shift active. Meter baseline locked.");
  };

  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!closingImage) return alert("Closing meter photo proof is required.");

    const openM = parseFloat(openingMeter);
    const closeM = parseFloat(closingMeter);
    const price = parseFloat(fuelPrice);
    const cash = parseFloat(cashCollected || "0");
    const momo = parseFloat(momoCollected || "0");
    const exp = parseFloat(expenses || "0");

    if (isNaN(openM) || isNaN(closeM) || isNaN(price)) {
      return alert("Enter valid numeric values for meter and price.");
    }
    if (closeM <= openM) {
      return alert(`Closing meter (${closeM}) must exceed opening meter (${openM}).`);
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const payload = {
        supervisor_name: supervisorName.trim(),
        fuel_price: price,
        opening_meter: openM,
        closing_meter: closeM,
        cash_collected: cash,
        momo_collected: momo,
        expenses: exp,
        proof_image: closingImage,
      };

      const { error } = await supabase.from("shifts").insert([payload]);
      if (error) throw error;

      const litres = closeM - openM;
      const expected = litres * price;
      const accounted = cash + momo + exp;

      setReport({
        supervisor: supervisorName.trim(),
        date: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
        price,
        openM,
        closeM,
        litres,
        expected,
        cash,
        momo,
        expenses: exp,
        accounted,
        variance: accounted - expected,
        openingImage,
        closingImage,
      });

      setOpeningMeter(closeM.toString());
      setShiftStage("REPORT");
      showMessage("success", "Shift logged. Ready to transmit PDF.");
    } catch (err: any) {
      console.error(err);
      alert(`Database error: ${err.message}`);
      showMessage("error", "Failed to save shift.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Live Closing Reconciliation Preview ──
  const liveOpen = parseFloat(openingMeter) || 0;
  const liveClose = parseFloat(closingMeter) || 0;
  const livePrice = parseFloat(fuelPrice) || 0;
  const liveLitres = liveClose > liveOpen ? liveClose - liveOpen : 0;
  const liveExpected = liveLitres * livePrice;
  const liveAccounted =
    (parseFloat(cashCollected) || 0) + (parseFloat(momoCollected) || 0) + (parseFloat(expenses) || 0);
  const liveVariance = liveAccounted - liveExpected;

  // ── PDF Report Builder ──
  const buildPdf = async (r: Report): Promise<Blob> => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210;
    const M = 16;

    doc.setFillColor(11, 15, 25);
    doc.rect(0, 0, W, 38, "F");
    doc.setFillColor(251, 191, 36);
    doc.rect(0, 38, W, 1.6, "F");
    doc.setTextColor(251, 191, 36);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(STATION_NAME.toUpperCase(), M, 18);
    doc.setTextColor(200, 205, 215);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("SHIFT CLOSING REPORT", M, 26);
    doc.text(r.date, W - M, 18, { align: "right" });
    doc.text(`Supervisor: ${r.supervisor}`, W - M, 26, { align: "right" });

    let y = 52;
    doc.setTextColor(30, 30, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Meter & Sales", M, y);
    y += 4;

    const rows: [string, string][] = [
      ["Fuel price per litre", ghs(r.price)],
      ["Opening meter", `${r.openM.toLocaleString()} L`],
      ["Closing meter", `${r.closeM.toLocaleString()} L`],
      ["Litres sold", `${r.litres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L`],
      ["Expected sales", ghs(r.expected)],
    ];
    const money: [string, string][] = [
      ["Cash collected", ghs(r.cash)],
      ["MoMo collected", ghs(r.momo)],
      ["Shift expenses", ghs(r.expenses)],
      ["Total accounted (cash + MoMo + expenses)", ghs(r.accounted)],
    ];

    const drawRows = (list: [string, string][]) => {
      list.forEach(([k, v], i) => {
        if (i % 2 === 0) {
          doc.setFillColor(245, 246, 250);
          doc.rect(M, y, W - M * 2, 9, "F");
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(90, 95, 110);
        doc.text(k, M + 3, y + 6);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20, 22, 30);
        doc.text(v, W - M - 3, y + 6, { align: "right" });
        y += 9;
      });
    };

    drawRows(rows);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 40);
    doc.text("Collections", M, y);
    y += 4;
    drawRows(money);

    y += 8;
    const short = r.variance < -0.005;
    const over = r.variance > 0.005;
    if (short) doc.setFillColor(254, 226, 226);
    else if (over) doc.setFillColor(254, 243, 199);
    else doc.setFillColor(209, 250, 229);
    doc.roundedRect(M, y, W - M * 2, 18, 3, 3, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(70, 70, 80);
    doc.text("VARIANCE", M + 5, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(short ? 185 : over ? 180 : 4, short ? 28 : over ? 83 : 120, short ? 28 : over ? 9 : 87);
    doc.text(`${r.variance >= 0 ? "+" : "-"} ${ghs(Math.abs(r.variance))}`, M + 5, y + 14);
    doc.setFontSize(10);
    doc.text(short ? "SHORTAGE" : over ? "OVERAGE" : "BALANCED", W - M - 5, y + 11, { align: "right" });
    y += 28;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 40);
    doc.text("Meter Photo Proof", M, y);
    y += 5;
    const imgW = (W - M * 2 - 6) / 2;
    const imgH = imgW * 0.72;
    try {
      if (r.openingImage) doc.addImage(r.openingImage, "JPEG", M, y, imgW, imgH);
      if (r.closingImage) doc.addImage(r.closingImage, "JPEG", M + imgW + 6, y, imgW, imgH);
    } catch (e) {
      console.error(e);
    }
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 125, 140);
    doc.text("Opening meter", M, y + imgH + 5);
    doc.text("Closing meter", M + imgW + 6, y + imgH + 5);

    doc.setDrawColor(220, 222, 230);
    doc.line(M, 280, W - M, 280);
    doc.setFontSize(8);
    doc.text(`Generated by ${STATION_NAME} Supervisor Terminal`, M, 285);
    doc.text("Confidential — for station owner", W - M, 285, { align: "right" });

    return doc.output("blob");
  };

  const summaryText = (r: Report) =>
    `*${STATION_NAME} — Shift Report*\n` +
    `Supervisor: ${r.supervisor}\n${r.date}\n\n` +
    `Litres sold: ${r.litres.toFixed(2)} L\n` +
    `Expected sales: ${ghs(r.expected)}\n` +
    `Cash: ${ghs(r.cash)}\nMoMo: ${ghs(r.momo)}\nExpenses: ${ghs(r.expenses)}\n` +
    `Variance: ${r.variance >= 0 ? "+" : "-"}${ghs(Math.abs(r.variance))}\n\n` +
    `Full PDF report attached.`;

  const sendReportToOwner = async () => {
    if (!report) return;
    try {
      setIsSharing(true);
      const blob = await buildPdf(report);
      const fileName = `${STATION_NAME.replace(/\s+/g, "-")}-Shift-${new Date().toISOString().slice(0, 10)}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });
      const text = summaryText(report);

      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text, title: "Shift Report" });
        showMessage("success", "Select WhatsApp → Owner to send PDF.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      window.open(`https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(text)}`, "_blank");
      showMessage("info", "PDF downloaded. Attach it in the opened WhatsApp chat.");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error(err);
        showMessage("error", "Could not generate PDF report.");
      }
    } finally {
      setIsSharing(false);
    }
  };

  const startNewShift = () => {
    setReport(null);
    setSupervisorName("");
    setClosingMeter("");
    setCashCollected("");
    setMomoCollected("");
    setExpenses("");
    setOpeningImage(null);
    setClosingImage(null);
    setScannedPreviewValue(null);
    setShiftStage("OPENING");
    setMessage(null);
  };

  // ── Industrial Camera HUD Scanner ──
  const renderScanner = (stage: "OPENING" | "CLOSING") => {
    const image = stage === "OPENING" ? openingImage : closingImage;
    const setImage = stage === "OPENING" ? setOpeningImage : setClosingImage;

    return (
      <div className={panelCls}>
        <div className="flex items-center justify-between mb-3">
          <span className={labelCls + " !mb-0"}>
            {stage === "OPENING" ? "01 · Opening" : "02 · Closing"} Dispenser Proof
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-amber-400/10 text-amber-400 border border-amber-400/20">
            <Icons.Scan /> AI Vision
          </span>
        </div>

        {!cameraActive && !image && (
          <button
            type="button"
            onClick={() => startCamera(useRearCamera)}
            className="w-full py-9 border border-dashed border-slate-700 hover:border-amber-400 bg-[#080c16] hover:bg-amber-400/[0.03] rounded-xl text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-amber-300 transition flex flex-col items-center justify-center gap-2.5 group"
          >
            <div className="p-3 rounded-full bg-slate-900 border border-slate-800 group-hover:border-amber-400/40 group-hover:text-amber-400 transition">
              <Icons.Camera />
            </div>
            Activate Pump Camera
          </button>
        )}

        {cameraActive && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-black border border-slate-800">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full aspect-video object-cover"
              />
              {/* Precision Reticle Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                <div className="w-full h-24 border border-amber-400/40 rounded-lg relative">
                  <span className="absolute -top-0.5 -left-0.5 w-3 h-3 border-t-2 border-l-2 border-amber-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 border-t-2 border-r-2 border-amber-400" />
                  <span className="absolute -bottom-0.5 -left-0.5 w-3 h-3 border-b-2 border-l-2 border-amber-400" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 border-b-2 border-r-2 border-amber-400" />
                  <span className="absolute bottom-1.5 right-2 text-[9px] font-mono uppercase tracking-widest text-amber-400/80 bg-black/60 px-1.5 py-0.5 rounded">
                    Align Counter Digits
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={toggleCameraFacing}
                className="absolute top-3 right-3 bg-slate-950/80 backdrop-blur text-slate-200 hover:text-white px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-white/10 flex items-center gap-1.5"
              >
                <Icons.Flip /> Flip
              </button>
            </div>

            <button
              type="button"
              onClick={capturePhoto}
              disabled={isScanning}
              className="w-full py-3.5 bg-amber-400 hover:bg-amber-300 text-slate-950 disabled:opacity-50 font-extrabold uppercase tracking-wider rounded-xl text-xs shadow-lg shadow-amber-500/20 transition"
            >
              {isScanning ? "Processing Dispenser Image…" : "Capture & Scan Counter"}
            </button>
          </div>
        )}

        {image && (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden border border-slate-800">
              <img
                src={image}
                alt={`${stage} proof`}
                className="w-full max-h-44 object-cover"
              />
              <span className="absolute top-2.5 left-2.5 bg-emerald-500/90 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-md flex items-center gap-1">
                <Icons.Check /> Verified Proof
              </span>
            </div>

            {scannedPreviewValue && (
              <div className="bg-[#080d18] border border-amber-400/40 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    AI OCR Extraction
                  </p>
                  <p className="text-2xl font-mono font-black text-amber-400 tracking-wider tabular-nums mt-0.5">
                    {scannedPreviewValue}
                  </p>
                </div>

                {stage === "CLOSING" && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmScannedValue}
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider transition"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setScannedPreviewValue(null)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-semibold transition"
                    >
                      Ignore
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setImage(null);
                  setScannedPreviewValue(null);
                  startCamera(useRearCamera);
                }}
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-amber-400 transition"
              >
                ↻ Retake Photo
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const stages: { key: Stage; label: string }[] = [
    { key: "OPENING", label: "01 Open" },
    { key: "CLOSING", label: "02 Close" },
    { key: "REPORT", label: "03 Dispatch" },
  ];
  const stageIndex = stages.findIndex((s) => s.key === shiftStage);

  return (
    <main className="min-h-screen bg-[#060911] text-slate-100 px-4 pt-5 pb-12 selection:bg-amber-400 selection:text-slate-950">
      {/* Subtle Top Accent Bar */}
      <div className="fixed top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 z-50" />

      <div className="max-w-lg mx-auto">
        {/* Industrial Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Icons.Pump />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-black tracking-wider uppercase text-white">
                    {STATION_NAME}
                  </h1>
                  <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                    POS v2.4
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">Forecourt Shift Terminal</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono font-bold uppercase text-emerald-400">Online</span>
            </div>
          </div>

          {/* Segmented Progress Bar */}
          <div className="grid grid-cols-3 gap-2 mt-5 bg-[#0b101d] p-1.5 rounded-xl border border-slate-800/80">
            {stages.map((s, i) => {
              const active = i === stageIndex;
              const done = i < stageIndex;
              return (
                <div
                  key={s.key}
                  className={`py-2 px-2 rounded-lg text-center text-[11px] font-bold uppercase tracking-wider transition ${
                    active
                      ? "bg-amber-400 text-slate-950 shadow-sm"
                      : done
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-slate-500"
                  }`}
                >
                  {done ? `✓ ${s.label.slice(3)}` : s.label}
                </div>
              );
            })}
          </div>
        </header>

        {/* STAGE 1: OPENING */}
        {shiftStage === "OPENING" && (
          <form onSubmit={handleOpenShiftSubmit} className="space-y-4">
            <div className={panelCls}>
              <label className={labelCls}>Duty Supervisor Name</label>
              <input
                type="text"
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                required
                className={inputCls}
                placeholder="Enter full name"
              />
            </div>

            {renderScanner("OPENING")}

            <div className={panelCls}>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={labelCls}>Pump Rate (GHS/L)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={fuelPrice}
                    onChange={(e) => setFuelPrice(e.target.value)}
                    required
                    className={inputCls + " font-mono font-bold"}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400">
                      Opening (L)
                    </label>
                    <button
                      type="button"
                      onClick={fetchPreviousClosingMeter}
                      disabled={isLoadingPrevious}
                      className="text-[10px] font-bold text-amber-400 hover:underline disabled:opacity-50"
                    >
                      {isLoadingPrevious ? "Syncing…" : "↻ Sync"}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={openingMeter}
                      readOnly
                      className="w-full bg-[#070a12] border border-slate-800/80 rounded-xl px-3.5 py-3 text-sm font-mono font-bold text-slate-300 cursor-not-allowed focus:outline-none tabular-nums"
                    />
                    <span className="absolute right-3 top-3.5 text-slate-500">
                      <Icons.Lock />
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2.5 flex items-center gap-1.5">
                <Icons.Lock /> Baseline locked from prior closing telemetry.
              </p>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold uppercase tracking-wider rounded-xl text-xs shadow-lg shadow-amber-500/20 active:scale-[0.99] transition"
            >
              Lock Baseline & Start Shift →
            </button>
          </form>
        )}

        {/* STAGE 2: CLOSING */}
        {shiftStage === "CLOSING" && (
          <form onSubmit={handleCloseShiftSubmit} className="space-y-4">
            {renderScanner("CLOSING")}

            <div className={panelCls + " space-y-4"}>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className={labelCls + " !mb-0"}>Closing Meter Reading (L)</label>
                  <span className="text-[10px] font-mono text-slate-400">
                    Base: <strong className="text-slate-200">{openingMeter || "—"} L</strong>
                  </span>
                </div>
                <input
                  type="number"
                  value={closingMeter}
                  onChange={(e) => setClosingMeter(e.target.value)}
                  required
                  className={inputCls + " font-mono text-base font-bold"}
                  placeholder="000000"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Physical Cash (GHS)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={cashCollected}
                    onChange={(e) => setCashCollected(e.target.value)}
                    required
                    className={inputCls + " font-mono font-bold"}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className={labelCls}>MoMo Wallet (GHS)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={momoCollected}
                    onChange={(e) => setMomoCollected(e.target.value)}
                    required
                    className={inputCls + " font-mono font-bold"}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Approved Shift Expenses (GHS)</label>
                <input
                  type="number"
                  step="0.01"
                  value={expenses}
                  onChange={(e) => setExpenses(e.target.value)}
                  className={inputCls + " font-mono font-bold"}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Live Reconciliation Telemetry Strip */}
            {liveClose > liveOpen && (
              <div className="bg-[#0b101d] border border-slate-800 rounded-2xl p-4 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Volume</p>
                  <p className="text-sm font-mono font-extrabold text-white mt-0.5 tabular-nums">
                    {liveLitres.toFixed(1)} L
                  </p>
                </div>
                <div className="border-x border-slate-800">
                  <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Expected</p>
                  <p className="text-sm font-mono font-extrabold text-amber-400 mt-0.5 tabular-nums">
                    {liveExpected.toLocaleString("en-GH", { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Variance</p>
                  <p
                    className={`text-sm font-mono font-extrabold mt-0.5 tabular-nums ${
                      liveVariance < -0.01
                        ? "text-red-400"
                        : liveVariance > 0.01
                        ? "text-amber-300"
                        : "text-emerald-400"
                    }`}
                  >
                    {liveVariance >= 0 ? "+" : ""}
                    {liveVariance.toFixed(2)}
                  </p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50 font-extrabold uppercase tracking-wider rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition"
            >
              {isSubmitting ? "Committing Audit Record…" : "Submit & Finalize Shift"}
            </button>

            <button
              type="button"
              onClick={() => {
                stopCamera();
                setShiftStage("OPENING");
              }}
              className="w-full py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition"
            >
              ← Return to Opening Stage
            </button>
          </form>
        )}

        {/* STAGE 3: AUDIT RECEIPT & DISPATCH */}
        {shiftStage === "REPORT" && report && (
          <div className="space-y-4">
            {/* Digital Audit Ticket */}
            <div className="bg-[#0b101d] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-gradient-to-r from-amber-400 to-orange-500 p-4 text-slate-950 flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-80">
                    Official Shift Audit
                  </p>
                  <p className="text-lg font-black tracking-tight">{STATION_NAME}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase">{report.supervisor}</p>
                  <p className="text-[10px] font-mono opacity-85">{report.date}</p>
                </div>
              </div>

              {/* Hero Metric */}
              <div className="p-5 border-b border-dashed border-slate-800 flex items-baseline justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Total Dispensed</p>
                  <p className="text-3xl font-mono font-black text-white mt-1 tabular-nums">
                    {report.litres.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-sm text-amber-400 ml-1.5">L</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Expected Value</p>
                  <p className="text-lg font-mono font-bold text-amber-400 mt-1 tabular-nums">
                    {ghs(report.expected)}
                  </p>
                </div>
              </div>

              {/* Ledger Breakdown */}
              <div className="p-4 divide-y divide-slate-800/70 text-xs">
                {[
                  ["Meter Span", `${report.openM.toLocaleString()} → ${report.closeM.toLocaleString()} L`],
                  ["Pump Tariff", `${ghs(report.price)} / L`],
                  ["Cash Collected", ghs(report.cash)],
                  ["MoMo Collected", ghs(report.momo)],
                  ["Shift Expenses", ghs(report.expenses)],
                  ["Total Accounted", ghs(report.accounted)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2.5">
                    <span className="text-slate-400 font-medium">{k}</span>
                    <span className="font-mono font-bold text-slate-100 tabular-nums">{v}</span>
                  </div>
                ))}
              </div>

              {/* Variance Stamp */}
              {(() => {
                const short = report.variance < -0.005;
                const over = report.variance > 0.005;
                return (
                  <div
                    className={`p-4 border-t flex items-center justify-between ${
                      short
                        ? "bg-red-500/10 border-red-500/20"
                        : over
                        ? "bg-amber-500/10 border-amber-500/20"
                        : "bg-emerald-500/10 border-emerald-500/20"
                    }`}
                  >
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                        Net Reconciliation
                      </p>
                      <p
                        className={`text-lg font-mono font-black tabular-nums ${
                          short ? "text-red-400" : over ? "text-amber-300" : "text-emerald-400"
                        }`}
                      >
                        {report.variance >= 0 ? "+" : "-"}
                        {ghs(Math.abs(report.variance))}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md ${
                        short
                          ? "bg-red-500 text-white"
                          : over
                          ? "bg-amber-400 text-slate-950"
                          : "bg-emerald-500 text-slate-950"
                      }`}
                    >
                      {short ? "Shortage" : over ? "Overage" : "Balanced"}
                    </span>
                  </div>
                );
              })()}
            </div>

            <button
              onClick={sendReportToOwner}
              disabled={isSharing}
              className="w-full py-4 bg-[#25D366] hover:brightness-105 text-slate-950 disabled:opacity-60 font-extrabold uppercase tracking-wider rounded-xl text-xs shadow-lg shadow-green-500/20 transition flex items-center justify-center gap-2.5"
            >
              <Icons.WhatsApp />
              {isSharing ? "Generating Audit PDF…" : "Dispatch PDF Report via WhatsApp"}
            </button>

            <button
              onClick={startNewShift}
              className="w-full py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-white bg-[#0b101d] border border-slate-800 rounded-xl transition"
            >
              Initialize Next Shift
            </button>
          </div>
        )}

        {/* Telemetry Status Pill */}
        {message && (
          <div className="mt-6 flex justify-center">
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold border backdrop-blur ${
                message.type === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : message.type === "error"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : "bg-slate-900/90 border-slate-800 text-slate-300"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  message.type === "success"
                    ? "bg-emerald-400"
                    : message.type === "error"
                    ? "bg-red-400"
                    : "bg-amber-400"
                }`}
              />
              {message.text}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}