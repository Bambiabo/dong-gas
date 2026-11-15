"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ShiftRecord {
  id: number;
  attendant_name: string;
  status: string;
  fuel_price: number;
  opening_meter: number;
  closing_meter: number;
  liters_sold: number;
  total_sales: number;
  expenses: number;
  cash_declared: number;
  variance: number;
  opening_photo_url: string;
  meter_photo_url: string;
  created_at: string;
  closed_at: string;
}

export default function OwnerDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [authError, setAuthError] = useState("");

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);

  // Change PIN state
  const [showPinModal, setShowPinModal] = useState(false);
  const [currentPinInput, setCurrentPinInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");
  const [pinMsg, setPinMsg] = useState("");

  // Check if authenticated in session
  useEffect(() => {
    const sessionAuth = sessionStorage.getItem("owner_auth");
    if (sessionAuth === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");

    // Fetch active PIN from Supabase database
    const { data, error } = await supabase
      .from("owner_settings")
      .select("pin_code")
      .eq("id", 1)
      .single();

    const activePin = data?.pin_code || "7788"; // Fallback default

    if (passcode === activePin) {
      setIsAuthenticated(true);
      sessionStorage.setItem("owner_auth", "true");
    } else {
      setAuthError("Invalid Owner PIN Code. Access Denied.");
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinMsg("");

    // Verify current PIN first
    const { data } = await supabase
      .from("owner_settings")
      .select("pin_code")
      .eq("id", 1)
      .single();

    const activePin = data?.pin_code || "7788";

    if (currentPinInput !== activePin) {
      setPinMsg("Current PIN is incorrect.");
      return;
    }

    if (newPinInput.length < 4) {
      setPinMsg("New PIN must be at least 4 digits.");
      return;
    }

    // Update PIN in Supabase
    const { error } = await supabase
      .from("owner_settings")
      .update({ pin_code: newPinInput })
      .eq("id", 1);

    if (error) {
      setPinMsg("Error updating PIN in database.");
    } else {
      setPinMsg("PIN updated successfully!");
      setCurrentPinInput("");
      setNewPinInput("");
      setTimeout(() => setShowPinModal(false), 1500);
    }
  };

  const fetchShifts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setShifts(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchShifts();
    }
  }, [isAuthenticated]);

  // ==========================================
  // LOCK SCREEN / PIN GATE
  // ==========================================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-sky-600/20 border border-sky-500/40 text-sky-400 rounded-xl mx-auto flex items-center justify-center font-bold text-xl">
              🔒
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">Owner Authorization Required</h1>
            <p className="text-slate-400 text-xs">
              This dashboard contains blind drop reconciliations, expenses, and anti-fraud financial audits.
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-red-950/80 border border-red-900 text-red-400 rounded-xl text-xs text-center">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Enter Owner PIN Code</label>
              <input
                type="password"
                placeholder="••••"
                maxLength={8}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-center font-mono tracking-widest text-lg focus:outline-none focus:border-sky-500"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold rounded-xl text-sm transition-all shadow-xl shadow-sky-600/30"
            >
              Unlock Owner Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // SECURED OWNER DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Dong Gas — Owner Dashboard</h1>
            <p className="text-slate-400 text-xs mt-1">
              Live anti-fraud shift audits, blind drop cash reconciliation, and expense tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowPinModal(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              Change PIN
            </button>
            <button
              onClick={fetchShifts}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              Refresh Data
            </button>
            <button
              onClick={() => {
                sessionStorage.removeItem("owner_auth");
                setIsAuthenticated(false);
              }}
              className="px-4 py-2 bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-900 text-xs font-semibold rounded-xl transition-colors"
            >
              Lock Dashboard
            </button>
          </div>
        </div>

        {/* Shifts Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <th className="p-4">Opening Time</th>
                  <th className="p-4">Closing Time</th>
                  <th className="p-4">Supervisor</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Sold (L)</th>
                  <th className="p-4">Expected Sales</th>
                  <th className="p-4">Expenses</th>
                  <th className="p-4">Cash Declared</th>
                  <th className="p-4">Variance</th>
                  <th className="p-4 text-center">Photo Proofs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-500 animate-pulse">
                      Loading shift records...
                    </td>
                  </tr>
                ) : shifts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-500">
                      No shift records found yet.
                    </td>
                  </tr>
                ) : (
                  shifts.map((shift) => {
                    const variance = shift.variance || 0;
                    const isBalanced = variance === 0;
                    const isShortage = variance < 0;

                    return (
                      <tr key={shift.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-4 text-slate-300 font-mono text-xs">
                          {new Date(shift.created_at).toLocaleString([], {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="p-4 text-slate-300 font-mono text-xs">
                          {shift.closed_at ? (
                            new Date(shift.closed_at).toLocaleString([], {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          ) : (
                            <span className="text-amber-400/80 italic">Shift Open</span>
                          )}
                        </td>
                        <td className="p-4 font-semibold text-white">{shift.attendant_name || "—"}</td>
                        <td className="p-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                              shift.status === "open"
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                                : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                            }`}
                          >
                            {shift.status}
                          </span>
                        </td>
                        <td className="p-4 font-mono">{shift.liters_sold ?? "—"}</td>
                        <td className="p-4 font-mono text-slate-200">
                          GHS {(shift.total_sales || 0).toFixed(2)}
                        </td>
                        <td className="p-4 font-mono text-amber-400 font-semibold">
                          {shift.status === "open" ? "—" : `GHS ${(shift.expenses || 0).toFixed(2)}`}
                        </td>
                        <td className="p-4 font-mono text-white font-semibold">
                          GHS {(shift.cash_declared || 0).toFixed(2)}
                        </td>
                        <td className="p-4 font-mono">
                          {shift.status === "open" ? (
                            <span className="text-slate-500">—</span>
                          ) : (
                            <span
                              className={`px-2 py-1 rounded-lg font-bold text-xs ${
                                isBalanced
                                  ? "bg-slate-800 text-slate-300"
                                  : isShortage
                                  ? "bg-red-950/60 text-red-400 border border-red-900"
                                  : "bg-emerald-950/60 text-emerald-400 border border-emerald-900"
                              }`}
                            >
                              {isBalanced
                                ? "GHS 0.00"
                                : isShortage
                                ? `-GHS ${Math.abs(variance).toFixed(2)}`
                                : `+GHS ${variance.toFixed(2)}`}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => setSelectedShift(shift)}
                            className="px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/40 rounded-xl text-xs font-semibold transition-colors"
                          >
                            View Photos
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* CHANGE PIN MODAL */}
        {showPinModal && (
          <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white">Change Owner PIN Code</h3>
                <button
                  onClick={() => setShowPinModal(false)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-semibold"
                >
                  Close
                </button>
              </div>

              {pinMsg && (
                <div
                  className={`p-3 rounded-xl text-xs text-center ${
                    pinMsg.includes("successfully")
                      ? "bg-emerald-950/80 border border-emerald-900 text-emerald-400"
                      : "bg-red-950/80 border border-red-900 text-red-400"
                  }`}
                >
                  {pinMsg}
                </div>
              )}

              <form onSubmit={handleUpdatePin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Current PIN</label>
                  <input
                    type="password"
                    placeholder="••••"
                    value={currentPinInput}
                    onChange={(e) => setCurrentPinInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">New PIN (4+ digits)</label>
                  <input
                    type="password"
                    placeholder="••••"
                    value={newPinInput}
                    onChange={(e) => setNewPinInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-sky-600/20"
                >
                  Save New PIN
                </button>
              </form>
            </div>
          </div>
        )}

        {/* PHOTO AUDIT MODAL */}
        {selectedShift && (
          <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
            <div className="max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold">Shift Audit & Photo Proofs</h2>
                  <p className="text-xs text-slate-400">
                    Supervisor: <span className="text-white font-semibold">{selectedShift.attendant_name}</span> | Rate: GHS {selectedShift.fuel_price}/L
                  </p>
                </div>
                <button
                  onClick={() => setSelectedShift(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Opening Photo */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-sky-400">
                    <span>Opening Meter Proof</span>
                    <span>{selectedShift.opening_meter} Liters</span>
                  </div>
                  {selectedShift.opening_photo_url ? (
                    <a href={selectedShift.opening_photo_url} target="_blank" rel="noreferrer">
                      <img
                        src={selectedShift.opening_photo_url}
                        alt="Opening meter proof"
                        className="w-full rounded-lg max-h-64 object-cover border border-sky-500/40 hover:opacity-95 transition-opacity"
                      />
                    </a>
                  ) : (
                    <p className="text-xs text-slate-500 py-12 text-center">No opening photo uploaded</p>
                  )}
                  <p className="text-[11px] text-slate-400 font-mono">
                    Opened at: {new Date(selectedShift.created_at).toLocaleString()}
                  </p>
                </div>

                {/* Closing Photo */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-emerald-400">
                    <span>Closing Meter Proof</span>
                    <span>{selectedShift.closing_meter ?? "—"} Liters</span>
                  </div>
                  {selectedShift.meter_photo_url ? (
                    <a href={selectedShift.meter_photo_url} target="_blank" rel="noreferrer">
                      <img
                        src={selectedShift.meter_photo_url}
                        alt="Closing meter proof"
                        className="w-full rounded-lg max-h-64 object-cover border border-emerald-500/40 hover:opacity-95 transition-opacity"
                      />
                    </a>
                  ) : (
                    <p className="text-xs text-slate-500 py-12 text-center">Shift still open</p>
                  )}
                  <p className="text-[11px] text-slate-400 font-mono">
                    Closed at: {selectedShift.closed_at ? new Date(selectedShift.closed_at).toLocaleString() : "Pending"}
                  </p>
                </div>
              </div>

              {/* Summary Financial Breakdown */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 grid grid-cols-4 gap-4 text-center text-xs">
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Expected Sales</span>
                  <span className="font-mono text-sm text-sky-400 font-bold">GHS {(selectedShift.total_sales || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Expenses</span>
                  <span className="font-mono text-sm text-amber-400 font-bold">GHS {(selectedShift.expenses || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Cash Declared</span>
                  <span className="font-mono text-sm text-emerald-400 font-bold">GHS {(selectedShift.cash_declared || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Variance</span>
                  <span className="font-mono text-sm text-white font-bold">GHS {(selectedShift.variance || 0).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}