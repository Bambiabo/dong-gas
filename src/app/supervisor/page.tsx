"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function SupervisorTerminal() {
  const [shiftStage, setShiftStage] = useState<"OPENING" | "CLOSING">("OPENING");
  
  // Opening fields
  const [supervisorName, setSupervisorName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("10.40");
  const [openingMeter, setOpeningMeter] = useState("");
  const [openingImage, setOpeningImage] = useState<string | null>(null);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);

  // Closing fields
  const [closingMeter, setClosingMeter] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  const [momoCollected, setMomoCollected] = useState("");
  const [closingImage, setClosingImage] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [useRearCamera, setUseRearCamera] = useState(true);

  // Automatically fetch previous shift's closing meter on load to continue seamlessly
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
      alert("Could not open camera. Please ensure permissions are allowed in your browser settings.");
      setCameraActive(false);
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
      const dataUrl = canvas.toDataURL("image/jpeg");

      if (shiftStage === "OPENING") {
        setOpeningImage(dataUrl);
      } else {
        setClosingImage(dataUrl);
      }

      const stream = videoRef.current.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraActive(false);
    }
  };

  const handleOpenShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!openingImage) {
      alert("Opening meter live photo proof is required.");
      return;
    }
    if (!openingMeter || !supervisorName) {
      alert("Please fill in all opening details.");
      return;
    }
    setShiftStage("CLOSING");
    setMessage("Opening recorded successfully. Proceed to close shift when ready.");
  };

  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingImage) {
      alert("Closing meter live photo proof is required.");
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
          proof_image: closingImage,
        },
      ]);

      if (error) throw error;

      setMessage("Shift successfully closed and reconciled!");
      setShiftStage("OPENING");
      setSupervisorName("");
      setOpeningMeter("");
      setClosingMeter("");
      setCashCollected("");
      setMomoCollected("");
      setOpeningImage(null);
      setClosingImage(null);
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4">
            <label className="block text-xs text-slate-400 mb-2">Opening Meter Live Camera Proof</label>
            
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
                    className="absolute top-2 right-2 bg-slate-950/90 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 shadow-md backdrop-blur-sm"
                  >
                    Switch to {useRearCamera ? "Front" : "Rear"} 🔄
                  </button>
                </div>
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 font-semibold rounded-lg text-sm shadow"
                >
                  Snap Opening Meter Photo 📸
                </button>
              </div>
            )}

            {openingImage && (
              <div className="mt-2 text-center">
                <p className="text-xs text-emerald-400 font-medium mb-2">✓ Opening photo captured successfully.</p>
                <img src={openingImage} alt="Opening Proof" className="w-28 h-28 object-cover mx-auto rounded-lg border border-slate-700 mb-2" />
                <button
                  type="button"
                  onClick={() => {
                    setOpeningImage(null);
                    startCamera(useRearCamera);
                  }}
                  className="text-xs text-cyan-400 underline font-medium"
                >
                  Retake Photo
                </button>
              </div>
            )}
          </div>

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
              <label className="block text-xs text-slate-400 mb-1">
                Opening Meter (L) {isLoadingPrevious && <span className="text-[10px] text-cyan-400">(Loading previous...)</span>}
              </label>
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

          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-semibold rounded-xl text-sm shadow-lg"
          >
            Start Shift & Lock Opening
          </button>
        </form>
      ) : (
        <form onSubmit={handleCloseShiftSubmit} className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4">
            <label className="block text-xs text-slate-400 mb-2">Closing Meter Live Camera Proof</label>
            
            {!cameraActive && !closingImage && (
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
                    className="absolute top-2 right-2 bg-slate-950/90 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 shadow-md backdrop-blur-sm"
                  >
                    Switch to {useRearCamera ? "Front" : "Rear"} 🔄
                  </button>
                </div>
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 font-semibold rounded-lg text-sm shadow"
                >
                  Snap Closing Meter Photo 📸
                </button>
              </div>
            )}

            {closingImage && (
              <div className="mt-2 text-center">
                <p className="text-xs text-emerald-400 font-medium mb-2">✓ Closing photo captured successfully.</p>
                <img src={closingImage} alt="Closing Proof" className="w-28 h-28 object-cover mx-auto rounded-lg border border-slate-700 mb-2" />
                <button
                  type="button"
                  onClick={() => {
                    setClosingImage(null);
                    startCamera(useRearCamera);
                  }}
                  className="text-xs text-cyan-400 underline font-medium"
                >
                  Retake Photo
                </button>
              </div>
            )}
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
              <label className="path block text-xs text-slate-400 mb-1">Mobile Money / MoMo (GHS)</label>
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
            className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 font-semibold rounded-xl text-sm shadow-lg"
          >
            {isSubmitting ? "Submitting Shift..." : "Submit Shift & Close"}
          </button>
          
          <button
            type="button"
            onClick={() => setShiftStage("OPENING")}
            className="w-full py-2 text-xs text-slate-400 hover:text-white"
          >
            ← Back to Opening Details
          </button>
        </form>
      )}

      {message && <p className="text-center text-xs mt-3 text-cyan-300 font-medium">{message}</p>}
    </main>
  );
}