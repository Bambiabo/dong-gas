"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function SupervisorPage() {
  const [attendantName, setAttendantName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [openingMeter, setOpeningMeter] = useState("");
  const [closingMeter, setClosingMeter] = useState("");

  // Photo states for Opening & Closing
  const [stepType, setStepType] = useState<"opening" | "closing">("opening");
  const [cameraActive, setCameraActive] = useState(false);
  
  const [openingImage, setOpeningImage] = useState<string | null>(null);
  const [openingBlob, setOpeningBlob] = useState<Blob | null>(null);

  const [closingImage, setClosingImage] = useState<string | null>(null);
  const [closingBlob, setClosingBlob] = useState<Blob | null>(null);

  const [cameraError, setCameraError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = (type: "opening" | "closing") => {
    setStepType(type);
    setCameraError("");
    try {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        })
        .then((stream) => {
          streamRef.current = stream;
          setCameraActive(true);
          setTimeout(() => {
            if (videoRef.current) videoRef.current.srcObject = stream;
          }, 50);
        })
        .catch(() => {
          setCameraError("Camera access denied or unavailable.");
        });
    } catch {
      setCameraError("Unable to access camera.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const timestamp = new Date().toLocaleString();
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(10, canvas.height - 42, 280, 32);
    ctx.fillStyle = stepType === "opening" ? "#38bdf8" : "#10b981";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(`${stepType.toUpperCase()} - ${timestamp}`, 18, canvas.height - 20);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (stepType === "opening") {
          setOpeningImage(dataUrl);
          setOpeningBlob(blob);
        } else {
          setClosingImage(dataUrl);
          setClosingBlob(blob);
        }
      },
      "image/jpeg",
      0.85
    );

    stopCamera();
  };

  // Calculations
  const openVal = parseFloat(openingMeter) || 0;
  const closeVal = parseFloat(closingMeter) || 0;
  const priceVal = parseFloat(fuelPrice) || 0;
  const litersSold = Math.max(0, closeVal - openVal);
  const totalSales = litersSold * priceVal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openingBlob || !closingBlob) {
      setMessage("Error: Both opening and closing live meter photos are required.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      // 1. Upload Opening Photo
      const openFileName = `opening_${Date.now()}.jpg`;
      const { error: openUploadErr } = await supabase.storage
        .from("meter-photos")
        .upload(openFileName, openingBlob, { contentType: "image/jpeg" });

      if (openUploadErr) throw new Error(openUploadErr.message);
      const { data: openUrlData } = supabase.storage.from("meter-photos").getPublicUrl(openFileName);

      // 2. Upload Closing Photo
      const closeFileName = `closing_${Date.now()}.jpg`;
      const { error: closeUploadErr } = await supabase.storage
        .from("meter-photos")
        .upload(closeFileName, closingBlob, { contentType: "image/jpeg" });

      if (closeUploadErr) throw new Error(closeUploadErr.message);
      const { data: closeUrlData } = supabase.storage.from("meter-photos").getPublicUrl(closeFileName);

      // 3. Save Shift Data to DB
      const { error: insertErr } = await supabase.from("shifts").insert([
        {
          attendant_name: attendantName,
          fuel_price: priceVal,
          opening_meter: openVal,
          closing_meter: closeVal,
          liters_sold: litersSold,
          total_sales: totalSales,
          cash_submitted: totalSales,
          variance: 0,
          opening_photo_url: openUrlData.publicUrl,
          meter_photo_url: closeUrlData.publicUrl,
        },
      ]);

      if (insertErr) throw new Error(insertErr.message);

      setMessage("Shift successfully closed, calculated, and saved!");
      
      // Reset form
      setAttendantName("");
      setFuelPrice("");
      setOpeningMeter("");
      setClosingMeter("");
      setOpeningImage(null);
      setOpeningBlob(null);
      setClosingImage(null);
      setClosingBlob(null);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Submission failed";
      setMessage(`Error: ${errorMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Dong Gas — Shift Manager</h1>
          <p className="text-slate-400 text-sm">Capture opening/closing proofs & auto-calculate sales</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Supervisor / Attendant Name</label>
            <input
              type="text"
              required
              value={attendantName}
              onChange={(e) => setAttendantName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="Enter name"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Current Fuel Price per Liter (GHS)</label>
            <input
              type="number"
              step="any"
              required
              value={fuelPrice}
              onChange={(e) => setFuelPrice(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="0.00"
            />
          </div>

          {/* OPENING METER SECTION */}
          <div className="space-y-2 p-3 bg-slate-950/50 rounded-xl border border-slate-800">
            <label className="block text-sm font-semibold text-sky-400">1. Opening Meter (Start of Work)</label>
            <input
              type="number"
              step="any"
              required
              value={openingMeter}
              onChange={(e) => setOpeningMeter(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="Opening value"
            />
            {!openingImage ? (
              <button
                type="button"
                onClick={() => startCamera("opening")}
                className="w-full py-2 bg-sky-600 hover:bg-sky-500 rounded-xl text-sm font-medium"
              >
                Capture Opening Live Photo
              </button>
            ) : (
              <div className="space-y-2">
                <img src={openingImage} alt="Opening meter" className="w-full rounded-lg max-h-40 object-cover border border-sky-500" />
                <button
                  type="button"
                  onClick={() => startCamera("opening")}
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
                >
                  Retake Opening Photo
                </button>
              </div>
            )}
          </div>

          {/* CLOSING METER SECTION */}
          <div className="space-y-2 p-3 bg-slate-950/50 rounded-xl border border-slate-800">
            <label className="block text-sm font-semibold text-emerald-400">2. Closing Meter (End of Work)</label>
            <input
              type="number"
              step="any"
              required
              value={closingMeter}
              onChange={(e) => setClosingMeter(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="Closing value"
            />
            {!closingImage ? (
              <button
                type="button"
                onClick={() => startCamera("closing")}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-medium"
              >
                Capture Closing Live Photo
              </button>
            ) : (
              <div className="space-y-2">
                <img src={closingImage} alt="Closing meter" className="w-full rounded-lg max-h-40 object-cover border border-emerald-500" />
                <button
                  type="button"
                  onClick={() => startCamera("closing")}
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
                >
                  Retake Closing Photo
                </button>
              </div>
            )}
          </div>

          {/* AUTO-CALCULATION SUMMARY */}
          {(openVal > 0 || closeVal > 0) && (
            <div className="p-3 bg-slate-800/80 rounded-xl space-y-1 text-sm border border-slate-700">
              <div className="flex justify-between text-slate-300">
                <span>Liters Sold:</span>
                <span className="font-bold text-white">{litersSold.toFixed(2)} L</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Total Expected Sales:</span>
                <span className="font-bold text-emerald-400">GHS {totalSales.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* CAMERA MODAL / PREVIEW */}
          {cameraActive && (
            <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4">
              <div className="relative max-w-md w-full bg-slate-900 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-medium text-center text-slate-300">
                  Take Live Photo for {stepType.toUpperCase()} Meter
                </p>
                <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl object-cover max-h-72" />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold"
                  >
                    Capture
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          <button
            type="submit"
            disabled={submitting || !openingBlob || !closingBlob}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 py-3 rounded-xl font-semibold transition-colors"
          >
            {submitting ? "Processing Shift..." : "Submit & Notify Owner"}
          </button>

          {message && (
            <p className={`text-sm text-center pt-2 ${message.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}