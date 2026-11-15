"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ActiveShift {
  id: number;
  attendant_name: string;
  fuel_price: number;
  opening_meter: number;
  opening_photo_url: string;
  created_at: string;
}

export default function SupervisorPage() {
  const [loadingShift, setLoadingShift] = useState(true);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);

  // Phase 1: Start Shift States
  const [attendantName, setAttendantName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [openingMeter, setOpeningMeter] = useState("");
  const [openingImage, setOpeningImage] = useState<string | null>(null);
  const [openingBlob, setOpeningBlob] = useState<Blob | null>(null);

  // Phase 2: Close Shift States
  const [closingMeter, setClosingMeter] = useState("");
  const [cashDeclared, setCashDeclared] = useState("");
  const [closingImage, setClosingImage] = useState<string | null>(null);
  const [closingBlob, setClosingBlob] = useState<Blob | null>(null);

  // Camera & UI States
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [smsSummary, setSmsSummary] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const fetchActiveShift = async () => {
    setLoadingShift(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setActiveShift(data);
    } else {
      setActiveShift(null);
    }
    setLoadingShift(false);
  };

  useEffect(() => {
    fetchActiveShift();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 50);
    } catch {
      setCameraError("Camera access denied. Enable camera permissions to continue.");
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

    const modeLabel = activeShift ? "CLOSING LITERS" : "OPENING LITERS";
    const timestamp = new Date().toLocaleString();
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(10, canvas.height - 46, 310, 36);
    ctx.fillStyle = activeShift ? "#10b981" : "#38bdf8";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(`${modeLabel} | ${timestamp}`, 18, canvas.height - 22);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (!activeShift) {
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

  // PHASE 1: START SHIFT
  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openingBlob) {
      setMessage("Error: Live opening meter photo is required.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const fileName = `opening_${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("meter-photos")
        .upload(fileName, openingBlob, { contentType: "image/jpeg" });

      if (uploadErr) throw new Error(uploadErr.message);

      const { data: urlData } = supabase.storage
        .from("meter-photos")
        .getPublicUrl(fileName);

      const openVal = parseFloat(openingMeter) || 0;
      const priceVal = parseFloat(fuelPrice) || 0;

      const { error: insertErr } = await supabase.from("shifts").insert([
        {
          status: "open",
          attendant_name: attendantName.trim(),
          fuel_price: priceVal,
          opening_meter: openVal,
          opening_photo_url: urlData.publicUrl,
        },
      ]);

      if (insertErr) throw new Error(insertErr.message);

      const smsText = `DONG GAS SHIFT STARTED\nSupervisor: ${attendantName}\nOpening Meter: ${openVal} L\nRate: GHS ${priceVal}/L\nTime: ${new Date().toLocaleTimeString()}`;
      await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: smsText }),
      }).catch(() => null);

      setSmsSummary(smsText);
      setMessage("Opening meter locked & sent to Owner!");
      setOpeningImage(null);
      setOpeningBlob(null);
      await fetchActiveShift();
    } catch (err: unknown) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Failed to start shift"}`);
    } finally {
      setSubmitting(false);
    }
  };

  // PHASE 2: CLOSE SHIFT (BLIND DROP)
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !closingBlob) {
      setMessage("Error: Live closing meter photo is required.");
      return;
    }

    const closeVal = parseFloat(closingMeter) || 0;
    if (closeVal < activeShift.opening_meter) {
      setMessage("Error: Closing meter cannot be less than Opening meter.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const fileName = `closing_${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("meter-photos")
        .upload(fileName, closingBlob, { contentType: "image/jpeg" });

      if (uploadErr) throw new Error(uploadErr.message);

      const { data: urlData } = supabase.storage
        .from("meter-photos")
        .getPublicUrl(fileName);

      const litersSold = closeVal - activeShift.opening_meter;
      const expectedSales = litersSold * activeShift.fuel_price;
      const cashVal = parseFloat(cashDeclared) || 0;
      const variance = cashVal - expectedSales;

      const { error: updateErr } = await supabase
        .from("shifts")
        .update({
          status: "closed",
          closing_meter: closeVal,
          liters_sold: litersSold,
          total_sales: expectedSales,
          cash_declared: cashVal,
          cash_submitted: cashVal,
          variance: variance,
          meter_photo_url: urlData.publicUrl,
          closed_at: new Date().toISOString(),
        })
        .eq("id", activeShift.id);

      if (updateErr) throw new Error(updateErr.message);

      const varianceLabel =
        variance === 0
          ? "BALANCED (GHS 0.00)"
          : variance < 0
          ? `SHORTAGE: -GHS ${Math.abs(variance).toFixed(2)}`
          : `SURPLUS: +GHS ${variance.toFixed(2)}`;

      const smsText = `DONG GAS SHIFT CLOSED\nSupervisor: ${activeShift.attendant_name}\nOpen: ${activeShift.opening_meter} L | Close: ${closeVal} L\nSold: ${litersSold.toFixed(2)} L @ GHS ${activeShift.fuel_price}/L\nExpected: GHS ${expectedSales.toFixed(2)}\nCash Declared: GHS ${cashVal.toFixed(2)}\nStatus: ${varianceLabel}`;

      await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: smsText }),
      }).catch(() => null);

      setSmsSummary(smsText);
      setMessage("Shift closed & reconciled report sent to Owner!");
      setClosingMeter("");
      setCashDeclared("");
      setClosingImage(null);
      setClosingBlob(null);
      await fetchActiveShift();
    } catch (err: unknown) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Failed to close shift"}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingShift) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Checking active shift...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Dong Gas — Terminal</h1>
            <p className="text-slate-400 text-xs">
              {activeShift ? "Active shift in progress" : "Ready to start work"}
            </p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
              activeShift
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                : "bg-sky-500/20 text-sky-400 border border-sky-500/40"
            }`}
          >
            {activeShift ? "Shift Active" : "Ready to Open"}
          </span>
        </div>

        {!activeShift ? (
          <form onSubmit={handleStartShift} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Supervisor Name</label>
              <input
                type="text"
                required
                value={attendantName}
                onChange={(e) => setAttendantName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                placeholder="Enter your full name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Fuel Price (GHS / L)</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={fuelPrice}
                  onChange={(e) => setFuelPrice(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                  placeholder="e.g. 14.50"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">Opening Meter (L)</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={openingMeter}
                  onChange={(e) => setOpeningMeter(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <label className="block text-sm font-medium text-sky-400">
                Opening Meter Photo (Live Only)
              </label>
              {!openingImage ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="w-full py-3 bg-sky-600 hover:bg-sky-500 rounded-xl text-sm font-semibold transition-colors"
                >
                  Open Camera for Opening Reading
                </button>
              ) : (
                <div className="space-y-2">
                  <img
                    src={openingImage}
                    alt="Opening meter"
                    className="w-full rounded-lg max-h-48 object-cover border border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={startCamera}
                    className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
                  >
                    Retake Opening Photo
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !openingBlob}
              className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 py-3 rounded-xl font-semibold transition-colors"
            >
              {submitting ? "Locking Opening Meter..." : "Start Shift & Send Opening Proof"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCloseShift} className="space-y-4">
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Supervisor on Duty:</span>
                <span className="text-white font-semibold">{activeShift.attendant_name}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Locked Opening Meter:</span>
                <span className="text-sky-400 font-bold">{activeShift.opening_meter} Liters</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Locked Fuel Price:</span>
                <span className="text-white font-semibold">GHS {activeShift.fuel_price} / Liter</span>
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">Closing Meter Reading (Liters)</label>
              <input
                type="number"
                step="any"
                required
                value={closingMeter}
                onChange={(e) => setClosingMeter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                placeholder={`Must be >= ${activeShift.opening_meter}`}
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Physical Cash Counted in Hand (GHS)
              </label>
              <input
                type="number"
                step="any"
                required
                value={cashDeclared}
                onChange={(e) => setCashDeclared(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                placeholder="Enter exact cash counted"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Blind drop enabled: Revenue is calculated and reconciled privately with Owner.
              </p>
            </div>

            <div className="space-y-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <label className="block text-sm font-medium text-emerald-400">
                Closing Meter Photo (Live Only)
              </label>
              {!closingImage ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-semibold transition-colors"
                >
                  Open Camera for Closing Reading
                </button>
              ) : (
                <div className="space-y-2">
                  <img
                    src={closingImage}
                    alt="Closing meter"
                    className="w-full rounded-lg max-h-48 object-cover border border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={startCamera}
                    className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
                  >
                    Retake Closing Photo
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !closingBlob}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 py-3 rounded-xl font-semibold transition-colors"
            >
              {submitting ? "Closing & Sending Report..." : "Close Shift & Send Report to Owner"}
            </button>
          </form>
        )}

        {cameraError && (
          <p className="text-xs text-red-400 bg-red-950/50 border border-red-800 rounded-lg p-2.5">
            {cameraError}
          </p>
        )}

        {message && (
          <p
            className={`text-sm text-center font-medium ${
              message.startsWith("Error") ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {message}
          </p>
        )}

        {smsSummary && (
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 whitespace-pre-line">
            <span className="block text-[10px] uppercase tracking-wider text-emerald-400 font-bold mb-1">
              Owner Alert Dispatched:
            </span>
            {smsSummary}
          </div>
        )}

        {cameraActive && (
          <div className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900 rounded-2xl p-4 space-y-3 border border-slate-800">
              <p className="text-sm font-semibold text-center text-white">
                {activeShift ? "Capture CLOSING Meter (Liters)" : "Capture OPENING Meter (Liters)"}
              </p>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-xl object-cover max-h-72 bg-black"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold"
                >
                  Capture Live
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="py-3 bg-slate-800 hover:bg-slate-700 rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}