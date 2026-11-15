"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function SupervisorPage() {
  const [attendantName, setAttendantName] = useState("");
  const [fuelPrice, setFuelPrice] = useState("10.40");
  const [openingMeter, setOpeningMeter] = useState("");
  const [closingMeter, setClosingMeter] = useState("");
  const [expenses, setExpenses] = useState("0");
  const [cashDeclared, setCashDeclared] = useState("");
  
  const [openingPhoto, setOpeningPhoto] = useState<string | null>(null);
  const [closingPhoto, setClosingPhoto] = useState<string | null>(null);
  
  const [activeShift, setActiveShift] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Start live camera stream
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error("Camera access error:", err);
        setErrorMsg("Could not access camera. Please allow camera permissions.");
      });
  }, []);

  // Check if there is already an open shift in Supabase
  useEffect(() => {
    async function checkActiveShift() {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        setActiveShift(data[0]);
        setAttendantName(data[0].attendant_name || "");
        setFuelPrice(data[0].fuel_price?.toString() || "10.40");
        setOpeningMeter(data[0].opening_meter?.toString() || "");
      }
    }
    checkActiveShift();
  }, []);

  const capturePhoto = (isOpening: boolean) => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg");
      if (isOpening) {
        setOpeningPhoto(dataUrl);
      } else {
        setClosingPhoto(dataUrl);
      }
    }
  };

  const uploadBase64Image = async (base64Str: string, pathPrefix: string) => {
    try {
      const res = await fetch(base64Str);
      const blob = await res.blob();
      const fileName = `${pathPrefix}_${Date.now()}.jpg`;
      const { data, error } = await supabase.storage
        .from("shift-photos")
        .upload(fileName, blob, { contentType: "image/jpeg" });

      if (error) throw error;

      const { data: publicUrlData } = supabase.storage
        .from("shift-photos")
        .getPublicUrl(data.path);

      return publicUrlData.publicUrl;
    } catch (err: any) {
      console.error("Photo upload error:", err);
      throw new Error("Failed to upload photo proof to storage.");
    }
  };

  // -------------------------------------------------------------
  // PHASE 1: START SHIFT
  // -------------------------------------------------------------
  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!attendantName.trim()) {
      setErrorMsg("Please enter supervisor/attendant name.");
      return;
    }
    if (!openingMeter) {
      setErrorMsg("Please enter the opening meter reading.");
      return;
    }
    if (!openingPhoto) {
      setErrorMsg("Live opening meter photo proof is required.");
      return;
    }

    setLoading(true);
    try {
      const photoUrl = await uploadBase64Image(openingPhoto, "opening");

      const { data, error } = await supabase
        .from("shifts")
        .insert([
          {
            attendant_name: attendantName,
            fuel_price: parseFloat(fuelPrice) || 0,
            opening_meter: parseFloat(openingMeter),
            opening_photo_url: photoUrl,
            status: "open",
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setActiveShift(data);
      setSuccessMsg("Shift started successfully! Opening proof logged.");
    } catch (err: any) {
      setErrorMsg(err.message || "Error starting shift.");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------
  // PHASE 2: CLOSE SHIFT (BLIND DROP & EXPENSES)
  // -------------------------------------------------------------
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!closingMeter) {
      setErrorMsg("Please enter the closing meter reading.");
      return;
    }
    if (!cashDeclared) {
      setErrorMsg("Please enter physical cash counted in hand.");
      return;
    }
    if (!closingPhoto) {
      setErrorMsg("Live closing meter photo proof is required.");
      return;
    }

    const oMeter = parseFloat(activeShift.opening_meter);
    const cMeter = parseFloat(closingMeter);

    if (cMeter < oMeter) {
      setErrorMsg("Closing meter cannot be less than Opening meter.");
      return;
    }

    setLoading(true);
    try {
      const photoUrl = await uploadBase64Image(closingPhoto, "closing");

      const fPrice = parseFloat(activeShift.fuel_price || fuelPrice);
      const litersSold = cMeter - oMeter;
      const totalSales = litersSold * fPrice;
      const declaredCash = parseFloat(cashDeclared);
      const shiftExpenses = parseFloat(expenses) || 0;

      // Formula: Expected Net Cash = Total Sales - Expenses
      // Variance = Cash Declared - Expected Net Cash
      const expectedNetCash = totalSales - shiftExpenses;
      const variance = declaredCash - expectedNetCash;

      const { error } = await supabase
        .from("shifts")
        .update({
          closing_meter: cMeter,
          liters_sold: litersSold,
          total_sales: totalSales,
          expenses: shiftExpenses,
          cash_declared: declaredCash,
          variance: variance,
          meter_photo_url: photoUrl,
          status: "closed",
          closed_at: new Date().toISOString(),
        })
        .eq("id", activeShift.id);

      if (error) throw error;

      setSuccessMsg("Shift closed and reconciled securely with owner!");
      setActiveShift(null);
      setClosingMeter("");
      setCashDeclared("");
      setExpenses("0");
      setClosingPhoto(null);
    } catch (err: any) {
      setErrorMsg(err.message || "Error closing shift.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight text-white">
            Dong Gas — Shift Supervisor Terminal
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Real-time verification, anti-fraud photo proofing, and blind drop reconciliation.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-950/80 border border-red-900 text-red-400 rounded-xl text-xs">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-900 text-emerald-400 rounded-xl text-xs">
            {successMsg}
          </div>
        )}

        {/* Hidden Video Canvas for Snapping Photos */}
        <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] text-sky-400 font-mono uppercase tracking-wider">
            Live Secure Cam
          </div>
        </div>

        {!activeShift ? (
          /* ================= PHASE 1: START SHIFT FORM ================= */
          <form onSubmit={handleStartShift} className="space-y-4">
            <div className="text-xs font-bold text-sky-400 uppercase tracking-wide">
              Phase 1: Shift Opening & Initial Proof
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Supervisor Name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={attendantName}
                onChange={(e) => setAttendantName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-sky-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Fuel Price (GHS / L)</label>
                <input
                  type="number"
                  step="0.01"
                  value={fuelPrice}
                  onChange={(e) => setFuelPrice(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Opening Meter (L)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 6552678"
                  value={openingMeter}
                  onChange={(e) => setOpeningMeter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Opening Meter Photo (Live Only)</label>
              {openingPhoto ? (
                <div className="space-y-2">
                  <img src={openingPhoto} alt="Opening Proof" className="w-full h-40 object-cover rounded-xl border border-sky-500/50" />
                  <button
                    type="button"
                    onClick={() => setOpeningPhoto(null)}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-300 transition-colors"
                  >
                    Retake Opening Photo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => capturePhoto(true)}
                  className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-sky-600/20"
                >
                  Snap Opening Meter Proof
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold rounded-xl text-sm transition-all shadow-xl shadow-sky-600/30 disabled:opacity-50"
            >
              {loading ? "Initializing Shift..." : "Start Shift & Send Opening Proof"}
            </button>
          </form>
        ) : (
          /* ================= PHASE 2: CLOSE SHIFT FORM ================= */
          <form onSubmit={handleCloseShift} className="space-y-4">
            <div className="p-3 bg-sky-950/40 border border-sky-900/60 rounded-xl flex justify-between items-center text-xs">
              <div>
                <span className="text-slate-400 block">Active Supervisor:</span>
                <span className="font-bold text-white">{activeShift.attendant_name}</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block">Opening Meter:</span>
                <span className="font-mono text-sky-400 font-bold">{activeShift.opening_meter} L</span>
              </div>
            </div>

            <div className="text-xs font-bold text-emerald-400 uppercase tracking-wide pt-2">
              Phase 2: Blind Drop Closure & Expense Audit
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Closing Meter (L)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Enter current meter reading"
                value={closingMeter}
                onChange={(e) => setClosingMeter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Station Expenses / Cash Withdrawn (GHS)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">E.g., Owner withdrawals, errand money, or station runs.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Physical Cash Counted in Hand (GHS)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Blind Drop: Enter actual cash amount"
                value={cashDeclared}
                onChange={(e) => setCashDeclared(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">Blind drop enabled: Revenue is calculated and reconciled privately with Owner.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Closing Meter Photo (Live Only)</label>
              {closingPhoto ? (
                <div className="space-y-2">
                  <img src={closingPhoto} alt="Closing Proof" className="w-full h-40 object-cover rounded-xl border border-emerald-500/50" />
                  <button
                    type="button"
                    onClick={() => setClosingPhoto(null)}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-300 transition-colors"
                  >
                    Retake Closing Photo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => capturePhoto(false)}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-emerald-600/20"
                >
                  Snap Closing Meter Proof
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-sm transition-all shadow-xl shadow-emerald-600/30 disabled:opacity-50"
            >
              {loading ? "Reconciling Shift..." : "Close Shift & Send Report to Owner"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}