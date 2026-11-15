"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

export default function SupervisorTerminal() {
  const [supervisorName, setSupervisorName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("10.40");
  const [openingMeter, setOpeningMeter] = useState("");
  const [closingMeter, setClosingMeter] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  const [momoCollected, setMomoCollected] = useState("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [useRearCamera, setUseRearCamera] = useState(true);

  const startCamera = async (rear: boolean) => {
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: rear ? { exact: "environment" } : "user" },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: rear ? "environment" : "user" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          setCameraActive(true);
        }
      } catch (fallbackErr) {
        alert("Unable to access camera. Please check permissions.");
      }
    }
  };

  const toggleCameraFacing = () => {
    const nextState = !useRearCamera;
    setUseRearCamera(nextState);
    startCamera(nextState);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      setCapturedImage(canvas.toDataURL("image/jpeg"));
    }
  };

  const handleSubmitShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capturedImage) {
      alert("Live meter photo proof is required.");
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

      if (closeM <= openM) {
        alert("Closing meter must be greater than opening meter (Meter Continuity check).");
        setIsSubmitting(false);
        return;
      }

      const litersSold = closeM - openM;
      const expectedRevenue = litersSold * price;
      const totalCollected = cash + momo;
      const variance = totalCollected - expectedRevenue;

      const { error } = await supabase.from("shifts").insert([
        {
          supervisor_name: supervisorName,
          fuel_price: price,
          opening_meter: openM,
          closing_meter: closeM,
          liters_sold: litersSold,
          expected_revenue: expectedRevenue,
          cash_collected: cash,
          momo_collected: momo,
          total_collected: totalCollected,
          variance: variance,
          proof_image: capturedImage,
        },
      ]);

      if (error) throw error;

      setMessage("Shift successfully recorded and reconciled!");
      setOpeningMeter("");
      setClosingMeter("");
      setCashCollected("");
      setMomoCollected("");
      setCapturedImage(null);
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-1">Dong Gas — Shift Supervisor</h1>
      <p className="text-xs text-slate-400 mb-4">Secure Meter Reconciliation & Payment Logging</p>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4">
        {!cameraActive ? (
          <button
            type="button"
            onClick={() => startCamera(useRearCamera)}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-medium rounded-lg text-sm"
          >
            Turn On Secure Camera Proof
          </button>
        ) : (
          <div>
            <div className="relative mb-2">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg" />
              <button
                type="button"
                onClick={toggleCameraFacing}
                className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 shadow-md backdrop-blur-sm"
              >
                Switch to {useRearCamera ? "Front (Selfie)" : "Rear (Meter)"} 🔄
              </button>
            </div>
            <button
              type="button"
              onClick={capturePhoto}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 font-semibold rounded-lg text-sm"
            >
              Snap Meter Proof Photo
            </button>
          </div>
        )}
        {capturedImage && (
          <p className="text-xs text-emerald-400 mt-2 font-medium">✓ Photo proof captured successfully.</p>
        )}
      </div>

      <form onSubmit={handleSubmitShift} className="space-y-4">
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Fuel Price (GHS/L)</label>
            <input
              type="number"
              step="0.01"
              value={fuelPrice}
              onChange={(e) => setFuelPrice(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Opening Meter (L)</label>
            <input
              type="number"
              value={openingMeter}
              onChange={(e) => setOpeningMeter(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm"
              placeholder="e.g. 6552678"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Closing Meter (L)</label>
          <input
            type="number"
            value={closingMeter}
            onChange={(e) => setClosingMeter(e.target.value)}
            required
            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm"
            placeholder="e.g. 6554100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cash Collected (GHS)</label>
            <input
              type="number"
              step="0.01"
              value={cashCollected}
              onChange={(e) => setCashCollected(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Mobile Money / MoMo (GHS)</label>
            <input
              type="number"
              step="0.01"
              value={momoCollected}
              onChange={(e) => setMomoCollected(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm"
              placeholder="0.00"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-semibold rounded-xl text-sm shadow-lg"
        >
          {isSubmitting ? "Submitting Shift..." : "Submit Shift & Close"}
        </button>

        {message && <p className="text-center text-xs mt-2 text-cyan-300 font-medium">{message}</p>}
      </form>
    </main>
  );
}