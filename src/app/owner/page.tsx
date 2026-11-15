"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function OwnerDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === "7788") {
      setIsAuthenticated(true);
      fetchShifts();
    } else {
      alert("Invalid Owner PIN");
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

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm space-y-4">
          <h1 className="text-lg font-bold text-center">Owner Dashboard Gate</h1>
          <p className="text-xs text-slate-400 text-center">Enter your secure PIN to access financial audits.</p>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-center tracking-widest text-lg"
            required
          />
          <button type="submit" className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 font-semibold rounded-lg text-sm">
            Access Dashboard
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Owner Financial Audit</h1>
          <p className="text-xs text-slate-400">Real-time breakdown of cash drops, MoMo collections, and shift metrics.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchShifts}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-xs rounded-lg font-medium text-white shadow"
          >
            {loading ? "Refreshing..." : "Refresh Records 🔄"}
          </button>
          <button
            onClick={() => setIsAuthenticated(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg font-medium text-slate-300"
          >
            Lock Gate
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-10">Loading financial records...</p>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="p-4">Date & Time</th>
                <th className="p-4">Supervisor / Record</th>
                <th className="p-4">Liters Sold</th>
                <th className="p-4">Cash (GHS)</th>
                <th className="p-4">MoMo (GHS)</th>
                <th className="p-4">Total Collected</th>
                <th className="p-4">Variance</th>
                <th className="p-4">Proof</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const openM = shift.opening_meter || 0;
                const closeM = shift.closing_meter || 0;
                const price = shift.fuel_price || 10.40;
                const litersSold = Math.max(0, closeM - openM);
                const expectedRevenue = litersSold * price;
                const cash = shift.cash_collected || 0;
                const momo = shift.momo_collected || 0;
                const totalCollected = cash + momo;
                const variance = totalCollected - expectedRevenue;

                // Format timestamp to include date and exact time (e.g., 11/15/2026, 10:45 AM)
                const formattedDateTime = shift.created_at
                  ? new Date(shift.created_at).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : "N/A";

                return (
                  <tr key={shift.id || shift.created_at} className="border-b border-slate-800 hover:bg-slate-850">
                    <td className="p-4 text-xs font-mono text-cyan-300">{formattedDateTime}</td>
                    <td className="p-4 font-medium text-white">{shift.supervisor_name || "Shift Operator"}</td>
                    <td className="p-4">{litersSold.toLocaleString()} L</td>
                    <td className="p-4 text-emerald-400">₵{cash.toFixed(2)}</td>
                    <td className="p-4 text-cyan-400">₵{momo.toFixed(2)}</td>
                    <td className="p-4 font-bold text-white">₵{totalCollected.toFixed(2)}</td>
                    <td className={`p-4 font-semibold ${variance < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      ₵{variance.toFixed(2)}
                    </td>
                    <td className="p-4">
                      {shift.proof_image ? (
                        <a
                          href={shift.proof_image}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-cyan-400 underline hover:text-cyan-300"
                        >
                          View Photo
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">No Photo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-500">No shift records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}