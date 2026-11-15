"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function SupervisorTerminal() {
  const [shiftStage, setShiftStage] = useState<"OPENING" | "CLOSING">("OPENING");

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

  // UI / OCR state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedPreviewValue, setScannedPreviewValue] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);

  // Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [useRearCamera, setUseRearCamera] = useState(true);

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────
  const showMessage = (type: "info" | "success" | "error", text: string) => {
    setMessage({ type, text });
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // ──────────────────────────────────────────────
  // Fetch previous closing meter (used on mount)
  // ──────────────────────────────────────────────
  const fetchPreviousClosingMeter = async () => {
    try {
      setIsLoadingPrevious(true);
      showMessage("info", "Syncing previous shift meter…");

      const { data, error } = await supabase
        .from("shifts")
        .select("closing_meter")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0 && data[0].closing_meter != null) {
        const prior = data[0].closing_meter.toString();
        setOpeningMeter(prior);
        showMessage("success", `Auto-loaded previous closing meter: ${prior} L`);
      } else {
        setOpeningMeter("1000");
        showMessage("info", "No previous shift found. Baseline set to 1000 L.");
      }
    } catch (err) {
      console.error(err);
      setOpeningMeter("1000");
      showMessage("error", "Could not sync previous meter. Defaulted to 1000 L.");
    } finally {
      setIsLoadingPrevious(false);
    }
  };

  useEffect(() => {
    fetchPreviousClosingMeter();

    // Cleanup camera on unmount
    return () => stopCamera();
  }, []);

  // ──────────────────────────────────────────────
  // Camera
  // ──────────────────────────────────────────────
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

  // ──────────────────────────────────────────────
  // High-accuracy OCR
  // ──────────────────────────────────────────────
  const runAdvancedOCR = async (dataUrl: string) => {
    try {
      setIsScanning(true);
      showMessage("info", "Running high-accuracy OCR…");

      const processedDataUrl = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = img.width * 2;
          canvas.height = img.height * 2;
          if (ctx) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 1.0));
          } else {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      });

      if (!(window as any).Tesseract) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const Tesseract = (window as any).Tesseract;
      const worker = await Tesseract.createWorker("eng");

      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
      });

      const result = await worker.recognize(processedDataUrl);
      await worker.terminate();

      const digits = (result.data.text || "").replace(/[^0-9]/g, "");

      if (digits.length >= 4) {
        setScannedPreviewValue(digits);
        showMessage("success", "OCR successful — please verify the reading.");
      } else {
        showMessage("error", "Could not reliably extract digits. Enter manually.");
      }
    } catch (err) {
      console.error(err);
      showMessage("error", "OCR failed. Please enter the meter value manually.");
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    if (shiftStage === "OPENING") {
      setOpeningImage(dataUrl);
    } else {
      setClosingImage(dataUrl);
    }

    stopCamera();
    await runAdvancedOCR(dataUrl);
  };

  const confirmScannedValue = () => {
    if (!scannedPreviewValue) return;
    if (shiftStage === "OPENING") {
      setOpeningMeter(scannedPreviewValue);
    } else {
      setClosingMeter(scannedPreviewValue);
    }
    setScannedPreviewValue(null);
    showMessage("success", "Meter value applied.");
  };

  // ──────────────────────────────────────────────
  // Form handlers
  // ──────────────────────────────────────────────
  const handleOpenShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!supervisorName.trim()) {
      alert("Please enter the Supervisor Name.");
      return;
    }
    if (!openingImage) {
      alert("Opening meter photo proof is required.");
      return;
    }
    if (!openingMeter || isNaN(parseFloat(openingMeter))) {
      alert("A valid Opening Meter reading is required.");
      return;
    }

    setShiftStage("CLOSING");
    showMessage("success", "Opening locked. Proceed to closing stage.");
  };

  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!closingImage) {
      alert("Closing meter photo proof is required.");
      return;
    }

    const openM = parseFloat(openingMeter);
    const closeM = parseFloat(closingMeter);
    const price = parseFloat(fuelPrice);
    const cash = parseFloat(cashCollected || "0");
    const momo = parseFloat(momoCollected || "0");
    const exp = parseFloat(expenses || "0");

    if (isNaN(openM) || isNaN(closeM) || isNaN(price)) {
      alert("Please enter valid numbers for meters and fuel price.");
      return;
    }

    if (closeM <= openM) {
      alert(`Closing meter (${closeM}) must be greater than opening meter (${openM}).`);
      return;
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

      // Carry the just-closed meter forward
      setOpeningMeter(closeM.toString());

      // Reset for next shift
      setShiftStage("OPENING");
      setSupervisorName("");
      setClosingMeter("");
      setCashCollected("");
      setMomoCollected("");
      setExpenses("");
      setOpeningImage(null);
      setClosingImage(null);
      setScannedPreviewValue(null);

      showMessage("success", `Shift closed successfully. Next opening meter set to ${closeM} L`);
    } catch (err: any) {
      console.error(err);
      alert(`Error saving shift: ${err.message}`);
      showMessage("error", "Failed to save shift. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Dong Gas — Shift Supervisor</h1>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              shiftStage === "OPENING"
                ? "bg-blue-500/20 text-blue-300"
                : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            {shiftStage === "OPENING" ? "Stage 1 · Opening" : "Stage 2 · Closing"}
          </span>
        </div>
      </div>

      {/* ───────── OPENING STAGE ───────── */}
      {shiftStage === "OPENING" ? (
        <form onSubmit={handleOpenShiftSubmit} className="space-y-5">
          {/* Supervisor */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Supervisor Name
            </label>
            <input
              type="text"
              value={supervisorName}
              onChange={(e) => setSupervisorName(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="Enter your full name"
            />
          </div>

          {/* Camera + OCR */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <label className="block text-xs font-medium text-slate-400 mb-3">
              Opening Meter · Photo Proof + OCR
            </label>

            {!cameraActive && !openingImage && (
              <button
                type="button"
                onClick={() => startCamera(useRearCamera)}
                className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold rounded-xl text-sm transition"
              >
                Turn On Camera
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
                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    className="absolute top-2.5 right-2.5 bg-black/70 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20"
                  >
                    Switch 🔄
                  </button>
                </div>
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={isScanning}
                  className="w-full py-3.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 font-semibold rounded-xl text-sm transition"
                >
                  {isScanning ? "Processing OCR…" : "Snap & Scan Meter 📸"}
                </button>
              </div>
            )}

            {openingImage && (
              <div className="mt-3 text-center space-y-3">
                <p className="text-xs text-emerald-400 font-medium">✓ Opening photo captured</p>
                <img
                  src={openingImage}
                  alt="Opening proof"
                  className="w-32 h-32 object-cover mx-auto rounded-xl border border-slate-700"
                />

                {scannedPreviewValue && (
                  <div className="bg-slate-800/80 border border-cyan-500/40 rounded-xl p-3.5">
                    <p className="text-xs text-slate-400 mb-1">Detected reading</p>
                    <p className="text-xl font-mono font-bold text-cyan-400 mb-3">
                      {scannedPreviewValue}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={confirmScannedValue}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2 rounded-lg text-xs font-semibold"
                      >
                        Accept ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setScannedPreviewValue(null)}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-semibold"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setOpeningImage(null);
                    setScannedPreviewValue(null);
                    startCamera(useRearCamera);
                  }}
                  className="text-xs text-cyan-400 hover:underline"
                >
                  Retake photo
                </button>
              </div>
            )}
          </div>

          {/* Price + Opening Meter */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Fuel Price (GHS/L)
              </label>
              <input
                type="number"
                step="0.01"
                value={fuelPrice}
                onChange={(e) => setFuelPrice(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-400">
                  Opening Meter (L)
                </label>
                <button
                  type="button"
                  onClick={fetchPreviousClosingMeter}
                  disabled={isLoadingPrevious}
                  className="text-[10px] text-cyan-400 hover:underline disabled:opacity-50"
                >
                  {isLoadingPrevious ? "Syncing…" : "↻ Resync"}
                </button>
              </div>
              <input
                type="number"
                value={openingMeter}
                onChange={(e) => setOpeningMeter(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                placeholder="Auto-synced"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Auto-carried from previous closing
              </p>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-semibold rounded-xl text-sm shadow-lg transition"
          >
            Lock Opening & Start Shift
          </button>
        </form>
      ) : (
        /* ───────── CLOSING STAGE ───────── */
        <form onSubmit={handleCloseShiftSubmit} className="space-y-5">
          {/* Camera + OCR */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <label className="block text-xs font-medium text-slate-400 mb-3">
              Closing Meter · Photo Proof + OCR
            </label>

            {!cameraActive && !closingImage && (
              <button
                type="button"
                onClick={() => startCamera(useRearCamera)}
                className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold rounded-xl text-sm transition"
              >
                Turn On Camera
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
                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    className="absolute top-2.5 right-2.5 bg-black/70 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20"
                  >
                    Switch 🔄
                  </button>
                </div>
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={isScanning}
                  className="w-full py-3.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 font-semibold rounded-xl text-sm transition"
                >
                  {isScanning ? "Processing OCR…" : "Snap & Scan Meter 📸"}
                </button>
              </div>
            )}

            {closingImage && (
              <div className="mt-3 text-center space-y-3">
                <p className="text-xs text-emerald-400 font-medium">✓ Closing photo captured</p>
                <img
                  src={closingImage}
                  alt="Closing proof"
                  className="w-32 h-32 object-cover mx-auto rounded-xl border border-slate-700"
                />

                {scannedPreviewValue && (
                  <div className="bg-slate-800/80 border border-cyan-500/40 rounded-xl p-3.5">
                    <p className="text-xs text-slate-400 mb-1">Detected reading</p>
                    <p className="text-xl font-mono font-bold text-cyan-400 mb-3">
                      {scannedPreviewValue}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={confirmScannedValue}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2 rounded-lg text-xs font-semibold"
                      >
                        Accept ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setScannedPreviewValue(null)}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-semibold"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setClosingImage(null);
                    setScannedPreviewValue(null);
                    startCamera(useRearCamera);
                  }}
                  className="text-xs text-cyan-400 hover:underline"
                >
                  Retake photo
                </button>
              </div>
            )}
          </div>

          {/* Closing Meter */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Closing Meter (L)
            </label>
            <input
              type="number"
              value={closingMeter}
              onChange={(e) => setClosingMeter(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="Must be greater than opening"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Opening baseline: <span className="text-slate-300">{openingMeter || "—"} L</span>
            </p>
          </div>

          {/* Cash & MoMo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Cash Collected (GHS)
              </label>
              <input
                type="number"
                step="0.01"
                value={cashCollected}
                onChange={(e) => setCashCollected(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                MoMo Collected (GHS)
              </label>
              <input
                type="number"
                step="0.01"
                value={momoCollected}
                onChange={(e) => setMomoCollected(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Expenses */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Shift Expenses (GHS)
            </label>
            <input
              type="number"
              step="0.01"
              value={expenses}
              onChange={(e) => setExpenses(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="0.00"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 font-semibold rounded-xl text-sm shadow-lg transition"
          >
            {isSubmitting ? "Saving Shift…" : "Submit & Close Shift"}
          </button>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              setShiftStage("OPENING");
            }}
            className="w-full py-2.5 text-xs text-slate-400 hover:text-white transition"
          >
            ← Back to Opening
          </button>
        </form>
      )}

      {/* Status message */}
      {message && (
        <p
          className={`text-center text-xs mt-5 font-medium ${
            message.type === "success"
              ? "text-emerald-400"
              : message.type === "error"
              ? "text-amber-400"
              : "text-cyan-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </main>
  );
}