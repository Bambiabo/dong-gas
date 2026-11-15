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
  cash_declared: number;
  variance: number;
  opening_photo_url: string;
  meter_photo_url: string;
  created_at: string;
  closed_at: string;
}

export default function OwnerDashboard() {
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);

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
    fetchShifts();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Dong Gas — Owner Dashboard</h1>
            <p className="text-slate-400 text-xs mt-1">
              Live anti-fraud shift audits, blind drop cash reconciliation, and photo proofs.
            </p>
          </div>
          <button
            onClick={fetchShifts}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
          >
            Refresh Data
          </button>
        </div>

        {/* Shifts Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <th className="p-4">Date / Time</th>
                  <th className="p-4">Supervisor</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Opening (L)</th>
                  <th className="p-4">Closing (L)</th>
                  <th className="p-4">Sold (L)</th>
                  <th className="p-4">Expected Sales</th>
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
                        <td className="p-4 text-slate-300">
                          {new Date(shift.created_at).toLocaleString([], {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
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
                        <td className="p-4 text-sky-400 font-mono">{shift.opening_meter ?? "—"}</td>
                        <td className="p-4 text-emerald-400 font-mono">{shift.closing_meter ?? "—"}</td>
                        <td className="p-4 font-mono">{shift.liters_sold ?? "—"}</td>
                        <td className="p-4 font-mono text-slate-200">
                          GHS {(shift.total_sales || 0).toFixed(2)}
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

        {/* PHOTO AUDIT MODAL */}
        {selectedShift && (
          <div className="fixed inset-0 bg-black/9ountains z-50 flex items-center justify-center p-4">
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
                {/* Opening Photo Card */}
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
                  <p className="text-[11px] text-slate-400">
                    Captured: {new Date(selectedShift.created_at).toLocaleString()}
                  </p>
                </div>

                {/* Closing Photo Card */}
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
                    <p className="text-xs text-slate-500 py-12 text-center">Shift still open / No closing photo yet</p>
                  )}
                  <p className="text-[11px] text-slate-400">
                    Closed: {selectedShift.closed_at ? new Date(selectedShift.closed_at).toLocaleString() : "Pending"}
                  </p>
                </div>
              </div>

              {/* Summary Financial Breakdown */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 grid grid-cols-3 gap-4 text-center text-xs">
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Liters Sold</span>
                  <span className="font-mono text-sm text-white font-bold">{selectedShift.liters_sold || 0} L</span>
                </div>
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Expected Sales</span>
                  <span className="font-mono text-sm text-sky-400 font-bold">GHS {(selectedShift.total_sales || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-slate-500 text-[10px] uppercase">Cash Declared</span>
                  <span className="font-mono text-sm text-emerald-400 font-bold">GHS {(selectedShift.cash_declared || 0).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}