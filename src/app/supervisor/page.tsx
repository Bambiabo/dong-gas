"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// Owner WhatsApp number in international format, digits only (e.g. 233241234567).
// Set NEXT_PUBLIC_OWNER_WHATSAPP in .env.local
const OWNER_WHATSAPP = process.env.NEXT_PUBLIC_OWNER_WHATSAPP || "233000000000";
const STATION_NAME = "Dong Gas";

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

const inputCls =
  "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400/70 focus:ring-4 focus:ring-amber-400/10 transition";
const labelCls = "block text-[11px] uppercase tracking-widest font-semibold text-zinc-400 mb-2";
const cardCls =
  "bg-white/[0.04] backdrop-blur border border-white/10 rounded-2xl p-4 shadow-xl shadow-black/30";

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
      showMessage("info", "Syncing previous shift meter…");

      const { data: shiftData, error: shiftError } = await supabase
        .from("shifts")
        .select("closing_meter")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!shiftError && shiftData && shiftData.length > 0 && shiftData[0].closing_meter != null) {
        const prior = shiftData[0].closing_meter.toString();
        setOpeningMeter(prior);
        showMessage("success", `Auto-loaded previous closing meter: ${prior} L`);
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
        showMessage("info", `Baseline loaded from Owner config: ${baseline} L`);
      } else {
        setOpeningMeter("1000");
        showMessage("info", "No prior shift or baseline found. Set to 1000 L.");
      }
    } catch (err) {
      console.error(err);
      setOpeningMeter("1000");
      showMessage("error", "Could not sync meter. Defaulted to 1000 L.");
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
      alert("Could not open camera. Please allow camera permission.");
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
      showMessage("info", "Analyzing meter photo with AI Vision…");

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();

      if (res.ok && data.digits && data.digits.length >= 3) {
        setScannedPreviewValue(data.digits);
        showMessage("success", "AI read the meter. Review and accept.");
      } else {
        showMessage("error", "AI could not read digits clearly. Enter manually.");
      }
    } catch (err) {
      console.error(err);
      showMessage("error", "AI Vision processing failed.");
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
    showMessage("success", "AI meter reading applied.");
  };

  const handleOpenShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supervisorName.trim()) return alert("Please enter the Supervisor Name.");
    if (!openingImage) return alert("Opening meter photo proof is required.");
    if (!openingMeter || isNaN(parseFloat(openingMeter))) return alert("A valid Opening Meter reading is required.");

    setShiftStage("CLOSING");
    showMessage("success", "Opening locked. Proceed to closing stage.");
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
      return alert("Please enter valid numbers for meters and fuel price.");
    }
    if (closeM <= openM) {
      return alert(`Closing meter (${closeM}) must be greater than opening meter (${openM}).`);
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
      showMessage("success", "Shift saved. Send the report to the owner.");
    } catch (err: any) {
      console.error(err);
      alert(`Error saving shift: ${err.message}`);
      showMessage("error", "Failed to save shift.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── PDF report ──
  const buildPdf = async (r: Report): Promise<Blob> => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210;
    const M = 16;

    // Header band
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

    // Summary line
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

    // Variance box
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

    // Photo proof
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

    // Footer
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

      // 1) Phone: share the PDF straight into WhatsApp (pick the owner's chat)
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text, title: "Shift Report" });
        showMessage("success", "Choose WhatsApp → Owner to send the PDF.");
        return;
      }

      // 2) Fallback: download PDF + open owner's chat with the summary
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      window.open(`https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(text)}`, "_blank");
      showMessage("info", "PDF downloaded. Attach it in the WhatsApp chat that opened.");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error(err);
        showMessage("error", "Could not prepare the PDF report.");
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

  // ── Reusable scanner block ──
  const renderScanner = (stage: "OPENING" | "CLOSING") => {
    const image = stage === "OPENING" ? openingImage : closingImage;
    const setImage = stage === "OPENING" ? setOpeningImage : setClosingImage;

    return (
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <span className={labelCls + " !mb-0"}>{stage === "OPENING" ? "Opening" : "Closing"} meter · AI scan</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/20">
            AI Vision
          </span>
        </div>

        {!cameraActive && !image && (
          <button
            type="button"
            onClick={() => startCamera(useRearCamera)}
            className="w-full py-8 border-2 border-dashed border-white/15 hover:border-amber-400/60 rounded-xl text-sm text-zinc-300 hover:text-amber-300 transition flex flex-col items-center gap-2"
          >
            <span className="text-2xl">📷</span>
            Tap to open camera
          </button>
        )}

        {cameraActive && (
          <div className="space-y-3">
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-xl bg-black aspect-video object-cover"
              />
              <div className="absolute inset-6 border-2 border-amber-400/70 rounded-lg pointer-events-none" />
              <button
                type="button"
                onClick={toggleCameraFacing}
                className="absolute top-2.5 right-2.5 bg-black/70 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20"
              >
                Flip 🔄
              </button>
            </div>
            <button
              type="button"
              onClick={capturePhoto}
              disabled={isScanning}
              className="w-full py-3.5 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 disabled:opacity-60 font-bold rounded-xl text-sm shadow-lg shadow-amber-500/20 transition"
            >
              {isScanning ? "Reading meter…" : "Capture & read with AI"}
            </button>
          </div>
        )}

        {image && (
          <div className="text-center space-y-3">
            <p className="text-xs text-emerald-400 font-medium">✓ Photo captured</p>
            <img
              src={image}
              alt={`${stage} proof`}
              className="w-full max-h-44 object-cover rounded-xl border border-white/10"
            />

            {scannedPreviewValue && (
              <div className="bg-amber-400/5 border border-amber-400/30 rounded-xl p-3.5 space-y-3">
                <p className="text-[11px] uppercase tracking-widest text-zinc-400">AI detected reading</p>
                <p className="text-3xl font-mono font-bold text-amber-300">{scannedPreviewValue}</p>
                {stage === "CLOSING" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmScannedValue}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-2.5 rounded-lg text-xs font-bold transition"
                    >
                      Accept ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setScannedPreviewValue(null)}
                      className="flex-1 bg-white/10 hover:bg-white/15 py-2.5 rounded-lg text-xs font-semibold transition"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setImage(null);
                setScannedPreviewValue(null);
                startCamera(useRearCamera);
              }}
              className="text-xs text-amber-300 hover:underline"
            >
              Retake photo
            </button>
          </div>
        )}
      </div>
    );
  };

  const stages: { key: Stage; label: string }[] = [
    { key: "OPENING", label: "Open" },
    { key: "CLOSING", label: "Close" },
    { key: "REPORT", label: "Report" },
  ];
  const stageIndex = stages.findIndex((s) => s.key === shiftStage);

  return (
    <main className="min-h-screen bg-[#070b14] bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.10),transparent_55%)] text-white px-4 pt-6 pb-10">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center text-slate-950 text-xl font-black shadow-lg shadow-amber-500/30">
              ⛽
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight leading-tight">
                {STATION_NAME} <span className="text-amber-400">Supervisor</span>
              </h1>
              <p className="text-[11px] text-zinc-500 tracking-wide">Shift control terminal</p>
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center mt-5">
            {stages.map((s, i) => (
              <div key={s.key} className="flex items-center flex-1 last:flex-none">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center transition ${
                      i < stageIndex
                        ? "bg-emerald-500 text-slate-950"
                        : i === stageIndex
                        ? "bg-amber-400 text-slate-950 ring-4 ring-amber-400/20"
                        : "bg-white/10 text-zinc-500"
                    }`}
                  >
                    {i < stageIndex ? "✓" : i + 1}
                  </span>
                  <span className={`text-xs font-medium ${i === stageIndex ? "text-white" : "text-zinc-500"}`}>
                    {s.label}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${i < stageIndex ? "bg-emerald-500/60" : "bg-white/10"}`} />
                )}
              </div>
            ))}
          </div>
        </header>

        {/* OPENING */}
        {shiftStage === "OPENING" && (
          <form onSubmit={handleOpenShiftSubmit} className="space-y-5">
            <div>
              <label className={labelCls}>Supervisor name</label>
              <input
                type="text"
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                required
                className={inputCls}
                placeholder="Enter your full name"
              />
            </div>

            {renderScanner("OPENING")}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Fuel price (GHS/L)</label>
                <input
                  type="number"
                  step="0.01"
                  value={fuelPrice}
                  onChange={(e) => setFuelPrice(e.target.value)}
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[11px] uppercase tracking-widest font-semibold text-zinc-400">
                    Opening meter
                  </label>
                  <button
                    type="button"
                    onClick={fetchPreviousClosingMeter}
                    disabled={isLoadingPrevious}
                    className="text-[10px] text-amber-300 hover:underline disabled:opacity-50"
                  >
                    {isLoadingPrevious ? "Syncing…" : "↻ Resync"}
                  </button>
                </div>
                <input
                  type="number"
                  value={openingMeter}
                  readOnly
                  className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3 text-sm text-zinc-400 cursor-not-allowed focus:outline-none"
                />
                <p className="text-[10px] text-zinc-600 mt-1">🔒 Locked from previous closing</p>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-amber-500/25 hover:brightness-110 active:scale-[0.99] transition"
            >
              Lock opening & start shift →
            </button>
          </form>
        )}

        {/* CLOSING */}
        {shiftStage === "CLOSING" && (
          <form onSubmit={handleCloseShiftSubmit} className="space-y-5">
            {renderScanner("CLOSING")}

            <div>
              <label className={labelCls}>Closing meter (L)</label>
              <input
                type="number"
                value={closingMeter}
                onChange={(e) => setClosingMeter(e.target.value)}
                required
                className={inputCls}
                placeholder="Must be greater than opening"
              />
              <p className="text-[10px] text-zinc-500 mt-1.5">
                Opening baseline: <span className="text-zinc-300">{openingMeter || "—"} L</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Cash (GHS)</label>
                <input
                  type="number"
                  step="0.01"
                  value={cashCollected}
                  onChange={(e) => setCashCollected(e.target.value)}
                  required
                  className={inputCls}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className={labelCls}>MoMo (GHS)</label>
                <input
                  type="number"
                  step="0.01"
                  value={momoCollected}
                  onChange={(e) => setMomoCollected(e.target.value)}
                  required
                  className={inputCls}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Shift expenses (GHS)</label>
              <input
                type="number"
                step="0.01"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
                className={inputCls}
                placeholder="0.00"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 disabled:opacity-60 font-bold rounded-xl text-sm shadow-lg shadow-emerald-500/20 hover:brightness-110 transition"
            >
              {isSubmitting ? "Saving shift…" : "Submit & close shift"}
            </button>

            <button
              type="button"
              onClick={() => {
                stopCamera();
                setShiftStage("OPENING");
              }}
              className="w-full py-2.5 text-xs text-zinc-500 hover:text-white transition"
            >
              ← Back to opening
            </button>
          </form>
        )}

        {/* REPORT */}
        {shiftStage === "REPORT" && report && (
          <div className="space-y-5">
            <div className="relative overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-400/10 via-white/[0.03] to-transparent p-5">
              <p className="text-[11px] uppercase tracking-widest text-zinc-400">Litres sold</p>
              <p className="text-4xl font-black font-mono text-amber-300 mt-1">
                {report.litres.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <span className="text-lg text-zinc-400 ml-1">L</span>
              </p>
              <p className="text-xs text-zinc-400 mt-2">
                Expected sales <span className="text-white font-semibold">{ghs(report.expected)}</span>
              </p>
            </div>

            <div className={cardCls + " divide-y divide-white/5"}>
              {[
                ["Supervisor", report.supervisor],
                ["Meter", `${report.openM} → ${report.closeM} L`],
                ["Cash", ghs(report.cash)],
                ["MoMo", ghs(report.momo)],
                ["Expenses", ghs(report.expenses)],
                ["Total accounted", ghs(report.accounted)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5 text-sm">
                  <span className="text-zinc-400">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>

            {(() => {
              const short = report.variance < -0.005;
              const over = report.variance > 0.005;
              return (
                <div
                  className={`rounded-2xl p-4 border flex items-center justify-between ${
                    short
                      ? "bg-red-500/10 border-red-500/30"
                      : over
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-emerald-500/10 border-emerald-500/30"
                  }`}
                >
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-zinc-400">Variance</p>
                    <p
                      className={`text-xl font-bold font-mono ${
                        short ? "text-red-400" : over ? "text-amber-300" : "text-emerald-400"
                      }`}
                    >
                      {report.variance >= 0 ? "+" : "-"}
                      {ghs(Math.abs(report.variance))}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full ${
                      short
                        ? "bg-red-500/20 text-red-300"
                        : over
                        ? "bg-amber-500/20 text-amber-200"
                        : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {short ? "SHORTAGE" : over ? "OVERAGE" : "BALANCED"}
                  </span>
                </div>
              );
            })()}

            <button
              onClick={sendReportToOwner}
              disabled={isSharing}
              className="w-full py-4 bg-[#25D366] hover:brightness-110 text-slate-950 disabled:opacity-60 font-bold rounded-xl text-sm shadow-lg shadow-green-500/25 transition flex items-center justify-center gap-2"
            >
              <span className="text-lg">💬</span>
              {isSharing ? "Preparing PDF…" : "Send PDF report to owner on WhatsApp"}
            </button>

            <button
              onClick={startNewShift}
              className="w-full py-3 text-xs text-zinc-400 hover:text-white border border-white/10 rounded-xl transition"
            >
              Start new shift
            </button>
          </div>
        )}

        {message && (
          <p
            className={`text-center text-xs mt-6 font-medium ${
              message.type === "success"
                ? "text-emerald-400"
                : message.type === "error"
                ? "text-amber-400"
                : "text-zinc-400"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </main>
  );
}
