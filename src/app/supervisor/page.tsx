"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function SupervisorPage() {
  const [attendantName, setAttendantName] = useState("");
  const [openingMeter, setOpeningMeter] = useState("");
  const [closingMeter, setClosingMeter] = useState("");
  const [cashSubmitted, setCashSubmitted] = useState("");

  // Live Camera States
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [cameraError, setCameraError] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop camera stream cleanly on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError("");
    setCapturedImage(null);
    setCapturedBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      setCameraError(
        "Camera access denied or unavailable. Please allow camera permissions in your browser settings."
      );
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

    // Stamp current date/time directly onto the proof photo
    const timestamp = new Date().toLocaleString();
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(10, canvas.height - 42, 260, 32);
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(`LIVE: ${timestamp}`, 18, canvas.height - 20);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(dataUrl);

    canvas.toBlob(
      (blob) => {
        if (blob) setCapturedBlob(blob);
      },
      "image/jpeg",
      0.85
    );

    stopCamera();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capturedBlob) {
      setMessage("Error: You must capture a live photo of the closing meter.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      // 1. Upload live photo to Supabase Storage bucket "meter-photos"
      const fileName = `meter_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("meter-photos")
        .upload(fileName, capturedBlob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Photo upload failed: ${uploadError.message}`);
      }

      const { data: publicUrlData } = supabase.storage
        .from("meter-photos")
        .getPublicUrl(fileName);

      // 2. Save shift record with the live photo URL
      const open = parseFloat(openingMeter) || 0;
      const close = parseFloat(closingMeter) || 0;
      const litersSold = Math.max(0, close - open);
      const cash = parseFloat(cashSubmitted) || 0;

      const { error: insertError } = await supabase.from("shifts").insert([
        {
          attendant_name: attendantName,
          opening_meter: open,
          closing_meter: close,
          liters_sold: litersSold,
          total_sales: cash,
          cash_submitted: cash,
          variance: 0,
          meter_photo_url: publicUrlData.publicUrl,
        },
      ]);

      if (insertError) {
        throw new Error(`Database error: ${insertError.message}`);
      }

      setMessage("Shift closed and live meter proof saved!");
      setAttendantName("");
      setOpeningMeter("");
      setClosingMeter("");
      setCashSubmitted("");
      setCapturedImage(null);
      setCapturedBlob(null);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to submit shift.";
      setMessage(`Error: ${errorMessage}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Supervisor — Close Shift</h1>
          <p className="text-slate-400 text-sm">
            Enter opening & closing meter values with live camera proof
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Supervisor / Attendant Name
            </label>
            <input
              type="text"
              required
              value={attendantName}
              onChange={(e) => setAttendantName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="Enter name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Opening Value
              </label>
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
            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Closing Value
              </label>
              <input
                type="number"
                step="any"
                required
                value={closingMeter}
                onChange={(e) => setClosingMeter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Cash Submitted (GHS)
            </label>
            <input
              type="number"
              step="any"
              required
              value={cashSubmitted}
              onChange={(e) => setCashSubmitted(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="0.00"
            />
          </div>

          {/* Live Camera Capture Section (Gallery Upload Disabled) */}
          <div className="space-y-2 pt-1">
            <label className="block text-sm text-slate-300">
              Closing Meter Proof (Live Camera Only)
            </label>

            {cameraError && (
              <p className="text-xs text-red-400 bg-red-950/50 border border-red-800 rounded-lg p-2.5">
                {cameraError}
              </p>
            )}

            {!cameraActive && !capturedImage && (
              <button
                type="button"
                onClick={startCamera}
                className="w-full py-3 px-4 bg-sky-600 hover:bg-sky-500 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                Open Live Camera
              </button>
            )}

            {cameraActive && (
              <div className="space-y-2">
                <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full max-h-64 object-cover"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold"
                  >
                    Capture Photo
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {capturedImage && (
              <div className="space-y-2">
                <img
                  src={capturedImage}
                  alt="Captured meter reading"
                  className="w-full rounded-xl border border-emerald-600 max-h-64 object-cover"
                />
                <button
                  type="button"
                  onClick={startCamera}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-medium"
                >
                  Retake Live Photo
                </button>
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />
          </div>

          <button
            type="submit"
            disabled={submitting || !capturedBlob}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 py-3 rounded-xl font-semibold transition-colors"
          >
            {submitting ? "Uploading & Saving..." : "Submit Shift Close"}
          </button>

          {message && (
            <p
              className={`text-sm text-center pt-2 ${
                message.startsWith("Error") ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}