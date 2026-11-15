"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function SupervisorTerminal() {
  const [shiftStage, setShiftStage] = useState<"OPENING" | "CLOSING">("OPENING");
  
  const [supervisorName, setSupervisorName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("10.40");
  const [openingMeter, setOpeningMeter] = useState("");
  const [openingImage, setOpeningImage] = useState<string | null>(null);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);

  const [closingMeter, setClosingMeter] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  const [momoCollected, setMomoCollected] = useState("");
  const [expenses, setExpenses] = useState("");
  const [closingImage, setClosingImage] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedPreviewValue, setScannedPreviewValue] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [useRearCamera, setUseRearCamera] = useState(true);

  useEffect(() => {
    async function fetchPreviousClosing() {
      try {
        setIsLoadingPrevious(true);
        const { data, error } = await supabase
          .from("shifts")
          .select("closing_meter")
          .order("created_at", { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0 && data[0].closing_meter) {
          setOpeningMeter(data[0].closing_meter.toString());
        }
      } catch (err) {
        console.error("Could not fetch previous meter:", err);
      } finally {
        setIsLoadingPrevious(false);
      }
    }
    fetchPreviousClosing();
  }, []);

  const startCamera = async (rear: boolean) => {
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const oldStream = videoRef.current.srcObject as MediaStream;
        oldStream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }

      setCameraActive(true);
      setScannedPreviewValue(null);

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: rear ? { exact: "environment" } : "user" },
          audio: false,
        });
      } catch (e) {
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
      console.error("Camera error:", err);
      alert("Could not open camera.");
      setCameraActive(false);
    }
  };

  const toggleCameraFacing = () => {
    const nextState = !useRearCamera;
    setUseRearCamera(nextState);
    startCamera(nextState);
  };

  const runOCRScan = async (dataUrl: string) => {
    try {
      setIsScanning(true);
      setMessage("Scanning meter digits...");

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
      const result = await Tesseract.recognize(dataUrl, "eng");
      const numbersOnly = (result.data.text || "").replace(/[^0-9]/g, "");

      if (numbersOnly.length > 0) {
        setScannedPreviewValue(numbersOnly);
        setMessage("✓ OCR scan complete.");
      } else {
        setMessage("⚠️ Enter meter value manually.");
      }
    } catch (err) {
      console.error("OCR Error:", err);
      setMessage("OCR failed. Enter manually.");
    } finally {
      setIsScanning(false);
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg");

      if (shiftStage === "OPENING") {
        setOpeningImage(dataUrl);
      } else {
        setClosingImage(dataUrl);
      }

      const stream = videoRef.current.srcObject as MediaStream;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraActive(false);

      await runOCRScan(dataUrl);
    }
  };

  const confirmScannedValue = () => {
    if (!scannedPreviewValue) return;
    if (shiftStage === "OPENING") {
      setOpeningMeter(scannedPreviewValue);
    } else {
      setClosingMeter(scannedPreviewValue);
    }
    setScannedPreviewValue(null);
    setMessage("✓ Scanned value applied.");
  };

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
    setShiftStage("CLOSING");
    setMessage("Opening saved. Proceed to closing shift.");
  };

  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingImage) {
      alert("Closing meter photo proof is required.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const openM = parseFloat(openingMeter);
      const closeM = parseFloat(closingMeter);
      const price = parseFloat(fuelPrice);
      const cash = parseFloat(cashCollected || "0");
      const momo = parseFloat(momoCollected || "0");
      const exp = parseFloat(expenses || "0");

      if (closeM <= openM) {
        alert("Closing meter must be greater than opening meter.");
        setIsSubmitting(false);
        return;
      }

      // Send both supervisor_name and supervisor to ensure compatibility
      const payload = {
        supervisor_name: supervisorName.trim(),
        supervisor: supervisorName.trim(),
        fuel_price: price,
        opening_meter: openM,
        closing_meter: closeM,
        cash_collected: cash,
        momo_collected: momo,
        proof_image: closingImage,
      };

      const { error } = await supabase.from("shifts").insert([payload]);

      if (error) throw error;

      setMessage("Shift successfully submitted and closed!");
      setShiftStage("OPENING");
      setSupervisorName("");
      setOpeningMeter("");
      setClosingMeter("");
      setCashCollected("");
      setMomoCollected("");
      setExpenses("");
      setOpeningImage(null);
      setClosingImage(null);
    } catch (err: any) {
      console.error("Supabase insert error:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-1">Dong Gas — Shift Supervisor</h1>
      <p className="text-xs text-slate-400 mb-4">
        {shiftStage === "OPENING" ? "Stage 1: Opening Meter & Start Shift" : "Stage 2: Closing Meter & Reconciliation"}
      </p>

      {shiftStage === "OPENING" ? (
        <form onSubmit={handleOpenShiftSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Supervisor Name</label>
            <input
              type="text"
              value={supervisorName}
              onChange={(e) => setSupervisorName(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm"
              placeholder="Enter your name"
            />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4">
            <label className="block text-xs text-slate-400 mb-2">Opening Meter Camera Proof & OCR</label>
            {!cameraActive && !openingImage && (
              <button
                type="button"
                onClick={() => startCamera(useRearCamera)}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold rounded-lg text-sm shadow"
              >
                Turn On Secure Camera Proof
              </button>
            )}

            {cameraActive && (
              <div>
                <div className="relative mb-3">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-black" />
                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    className="absolute top-2 right-2 bg-slate-950/90 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 shadow-md"
                  >
                    Switch 🔄
                  </button>
                </div>
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={isScanning}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 font-semibold rounded-lg text-sm"
                >
                  {isScanning ? "Scanning..." : "Snap & Read Meter Photo 📸"}
                </button>
              </div>
            )}

            {openingImage && (
              <div className="mt-2 text-center">
                <p className="text-xs text-emerald-400 font-medium mb-2">✓ Opening photo captured.</p>
                <img src={openingImage} alt="Opening Proof" className="w-28 h-28 object-cover mx-auto rounded-lg border border-slate-700 mb-2" />
                {scannedPreviewValue && (
                  <div className="bg-slate-800 border border-cyan-500/50 p-3 rounded-lg mb-2">
                    <p className="text-xs text-slate-300 mb-1">Scanned Result:</p>
                    <p className="text-lg font-mono font-bold text-cyan-400 mb-2">{scannedPreviewValue}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={confirmScannedValue} className="flex-1 bg-emerald-600 py-1.5 rounded text-xs font-semibold">Accept ✓</button>
                      <button type="button" onClick={() => setScannedPreviewValue(null)} className="flex-1 bg-slate-700 py-1.5 rounded text-xs font-semibold">Dismiss</button>
                    </div>
                  </div>
                )}
                <button type="button" onClick={() => { setOpeningImage(null); setScannedPreviewValue(null); startCamera(useRearCamera); }} className="text-xs text-cyan-400 underline">
                  Retake Photo
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Fuel Price (GHS/L)</label>
              <input type="number" step="0.01" value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} required className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Opening Meter (L)</label>
              <input type="number" value={openingMeter} onChange={(e) => setOpeningMeter(e.target.value)} required className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm" placeholder="e.g. 6552678" />
            </div>
          </div>

          <button type="submit" className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold rounded-xl text-sm shadow-lg">
            Start Shift & Lock Opening
          </button>
        </form>
      ) : (
        <form onSubmit={handleCloseShiftSubmit} className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4">
            <label className="block text-xs text-slate-400 mb-2">Closing Meter Camera Proof & OCR</label>
            {!cameraActive && !closingImage && (
              <button type="button" onClick={() => startCamera(useRearCamera)} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold rounded-lg text-sm shadow">
                Turn On Secure Camera Proof
              </button>
            )}

            {cameraActive && (
              <div>
                <div className="relative mb-3">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-black" />
                  <button type="button" onClick={toggleCameraFacing} className="absolute top-2 right-2 bg-slate-950/90 text-white px-3 py-1.5 rounded-lg text-xs">Switch 🔄</button>
                </div>
                <button type="button" onClick={capturePhoto} disabled={isScanning} className="w-full py-3 bg-cyan-600 font-semibold rounded-lg text-sm">
                  {isScanning ? "Scanning..." : "Snap & Read Meter Photo 📸"}
                </button>
              </div>
            )}

            {closingImage && (
              <div className="mt-2 text-center">
                <p className="text-xs text-emerald-400 font-medium mb-2">✓ Closing photo captured.</p>
                <img src={closingImage} alt="Closing Proof" className="w-28 h-28 object-cover mx-auto rounded-lg border border-slate-700 mb-2" />
                {scannedPreviewValue && (
                  <div className="bg-slate-800 border border-cyan-500/50 p-3 rounded-lg mb-2">
                    <p className="text-xs text-slate-300 mb-1">Scanned Result:</p>
                    <p className="text-lg font-mono font-bold text-cyan-400 mb-2">{scannedPreviewValue}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={confirmScannedValue} className="flex-1 bg-emerald-600 py-1.5 rounded text-xs font-semibold">Accept ✓</button>
                      <button type="button" onClick={() => setScannedPreviewValue(null)} className="flex-1 bg-slate-700 py-1.5 rounded text-xs font-semibold">Dismiss</button>
                    </div>
                  </div>
                )}
                <button type="button" onClick={() => { setClosingImage(null); setScannedPreviewValue(null); startCamera(useRearCamera); }} className="text-xs text-cyan-400 underline">
                  Retake Photo
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Closing Meter (L)</label>
            <input type="number" value={closingMeter} onChange={(e) => setClosingMeter(e.target.value)} required className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm" placeholder="e.g. 6554100" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cash Collected (GHS)</label>
              <input type="number" step="0.01" value={cashCollected} onChange={(e) => setCashCollected(e.target.value)} required className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">MoMo (GHS)</label>
              <input type="number" step="0.01" value={momoCollected} onChange={(e) => setMomoCollected(e.target.value)} required className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm" placeholder="0.00" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Shift Expenses (GHS)</label>
            <input type="number" step="0.01" value={expenses} onChange={(e) => setExpenses(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm" placeholder="0.00" />
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 font-semibold rounded-xl text-sm shadow-lg">
            {isSubmitting ? "Submitting Shift..." : "Submit Shift & Close"}
          </button>
          
          <button type="button" onClick={() => setShiftStage("OPENING")} className="w-full py-2 text-xs text-slate-400 hover:text-white">
            ← Back to Opening Details
          </button>
        </form>
      )}

      {message && <p className="text-center text-xs mt-3 text-cyan-300 font-medium">{message}</p>}
    </main>
  );
}