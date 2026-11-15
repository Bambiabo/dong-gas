"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function OwnerDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState("");
  
  // UI filters & modal states
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const getStoredPin = () => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("owner_pin") || "7788";
    }
    return "7788";
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === getStoredPin()) {
      setIsAuthenticated(true);
      fetchShifts();
    } else {
      alert("Invalid Owner PIN");
    }
  };

  const handleChangePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 4) {
      alert("PIN must be at least 4 digits.");
      return;
    }
    localStorage.setItem("owner_pin", newPin);
    alert("Owner PIN updated successfully!");
    setNewPin("");
    setShowChangePin(false);
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

  // Export financial data as CSV
  const exportToCSV = () => {
    if (shifts.length === 0) return alert("No data to export.");
    const headers = ["Date", "Supervisor", "Liters Sold", "Fuel Price", "Cash (GHS)", "MoMo (GHS)", "Expenses (GHS)", "Total Collected", "Variance"];
    const rows = shifts.map(shift => {
      const openM = shift.opening_meter || 0;
      const closeM = shift.closing_meter || 0;
      const price = shift.fuel_price || 10.40;
      const liters = Math.max(0, closeM - openM);
      const rev = liters * price;
      const cash = shift.cash_collected || 0;
      const momo = shift.momo_collected || 0;
      const exp = shift.expenses || 0;
      const total = cash + momo;
      const variance = total - rev - exp;
      return [
        shift.created_at ? new Date(shift.created_at).toLocaleString() : "",
        shift.supervisor_name || shift.supervisor || "Supervisor",
        liters,
        price,
        cash,
        momo,
        exp,
        total,
        variance
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `dong_gas_audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Computed metrics for KPI overview cards
  const totalRevenue = shifts.reduce((acc, s) => acc + (s.cash_collected || 0) + (s.momo_collected || 0), 0);
  const totalLitres = shifts.reduce((acc, s) => acc + Math.max(0, (s.closing_meter || 0) - (s.opening_meter || 0)), 0);
  const totalCash = shifts.reduce((acc, s) => acc + (s.cash_collected || 0), 0);
  const totalMomo = shifts.reduce((acc, s) => acc + (s.momo_collected || 0), 0);

  const filteredShifts = shifts.filter(s => {
    const name = (s.supervisor_name || s.supervisor || "").toLowerCase();
    return name.includes(searchTerm.toLowerCase());
  });

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-slate-900 border border-slate-800 p-8 rounded-3xl w-full max-w-sm shadow-2xl space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl flex items-center justify-center mx-auto text-cyan-400 font-bold text-xl mb-3">
              🔒
            </div>
            <h1 className="text-xl font-bold tracking-tight">Owner Portal Gate</h1>
            <p className="text-xs text-slate-400">Restricted financial audit clearance.</p>
          </div>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            maxLength={6}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-center tracking-widest text-2xl text-cyan-400 focus:outline-none focus:border-cyan-500 transition"
            required
            autoFocus
          />
          <button type="submit" className="w-full py-3.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 font-semibold rounded-xl text-sm shadow-lg shadow-cyan-950/50 transition">
            Unlock Dashboard
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">Dong Gas Enterprise</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">Owner Financial Audit</h1>
          <p className="text-xs md:text-sm text-slate-400">Live operational oversight, shift reconciliations, and audit metrics.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={exportToCSV}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs rounded-xl font-medium text-slate-300 transition flex items-center gap-1.5"
          >
            📥 Export CSV
          </button>
          <button
            onClick={() => setShowChangePin(!showChangePin)}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs rounded-xl font-medium text-slate-300 transition"
          >
            {showChangePin ? "Cancel" : "Change PIN ⚙️"}
          </button>
          <button
            onClick={fetchShifts}
            className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-xs rounded-xl font-semibold text-white shadow-lg shadow-cyan-950 transition flex items-center gap-1.5"
          >
            {loading ? "Syncing..." : "Refresh 🔄"}
          </button>
          <button
            onClick={() => setIsAuthenticated(false)}
            className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs rounded-xl font-medium transition"
          >
            Lock Portal
          </button>
        </div>
      </div>

      {/* Change PIN Card */}
      {showChangePin && (
        <form onSubmit={handleChangePin} className="bg-slate-900 border border-slate-800 p-5 rounded-2xl max-w-sm space-y-3 shadow-xl">
          <h2 className="text-sm font-bold text-cyan-400">Update Security PIN</h2>
          <input
            type="password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="Enter new 4+ digit PIN"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:outline-none focus:border-cyan-500"
            required
          />
          <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold rounded-xl transition">
            Save New PIN
          </button>
        </form>
      )}

      {/* KPI Financial Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Gross Revenue</p>
          <p className="text-2xl font-black text-white mt-1 font-mono">₵{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <span className="text-[10px] text-emerald-400 font-medium mt-1 inline-block">● Verified Collections</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Volume Dispensed</p>
          <p className="text-2xl font-black text-cyan-400 mt-1 font-mono">{totalLitres.toLocaleString()} <span className="text-sm font-normal text-slate-400">Liters</span></p>
          <span className="text-[10px] text-cyan-400 font-medium mt-1 inline-block">● Meter Differential</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Cash Drops Total</p>
          <p className="text-2xl font-black text-emerald-400 mt-1 font-mono">₵{totalCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <span className="text-[10px] text-slate-400 font-medium mt-1 inline-block">Physical cash drawer</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Mobile Money Total</p>
          <p className="text-2xl font-black text-blue-400 mt-1 font-mono">₵{totalMomo.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <span className="text-[10px] text-slate-400 font-medium mt-1 inline-block">MoMo merchant receipts</span>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900/40 p-3 rounded-2xl border border-slate-800">
        <div className="w-full sm:w-72">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="🔍 Search supervisor name..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
          />
        </div>
        <div className="text-xs text-slate-400 px-2">
          Showing <span className="font-bold text-white">{filteredShifts.length}</span> recorded shifts
        </div>
      </div>

      {/* Shifts Audit Table */}
      {loading ? (
        <div className="text-center py-20 space-y-3">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-slate-400 font-medium">Loading secure financial records...</p>
        </div>
      ) : (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[11px] font-mono tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-4.5">Date & Time</th>
                  <th className="p-4.5">Supervisor</th>
                  <th className="p-4.5">Liters Sold</th>
                  <th className="p-4.5">Cash (GHS)</th>
                  <th className="p-4.5">MoMo (GHS)</th>
                  <th className="p-4.5">Expenses</th>
                  <th className="p-4.5">Total Collected</th>
                  <th className="p-4.5">Variance</th>
                  <th className="p-4.5 text-center">Meter Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredShifts.map((shift) => {
                  const openM = shift.opening_meter || 0;
                  const closeM = shift.closing_meter || 0;
                  const price = shift.fuel_price || 10.40;
                  const litersSold = Math.max(0, closeM - openM);
                  const expectedRevenue = litersSold * price;
                  const cash = shift.cash_collected || 0;
                  const momo = shift.momo_collected || 0;
                  const exp = shift.expenses || 0;
                  const totalCollected = cash + momo;
                  const variance = totalCollected - expectedRevenue - exp;

                  const formattedDateTime = shift.created_at
                    ? new Date(shift.created_at).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "N/A";

                  const supName = 
                    shift.supervisor_name || 
                    shift.supervisor || 
                    shift.name || 
                    shift.operator || 
                    "Shift Supervisor";

                  const proofUrl = 
                    shift.proof_image || 
                    shift.image || 
                    shift.photo || 
                    shift.proof || 
                    null;

                  return (
                    <tr key={shift.id || shift.created_at} className="hover:bg-slate-850/60 transition">
                      <td className="p-4.5 text-xs font-mono text-cyan-400 whitespace-nowrap">{formattedDateTime}</td>
                      <td className="p-4.5 font-semibold text-white">{supName}</td>
                      <td className="p-4.5 font-mono text-slate-300">{litersSold.toLocaleString()} L</td>
                      <td className="p-4.5 font-mono text-emerald-400">₵{cash.toFixed(2)}</td>
                      <td className="p-4.5 font-mono text-blue-400">₵{momo.toFixed(2)}</td>
                      <td className="p-4.5 font-mono text-slate-400">₵{exp.toFixed(2)}</td>
                      <td className="p-4.5 font-mono font-bold text-white">₵{totalCollected.toFixed(2)}</td>
                      <td className="p-4.5 font-mono">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                          Math.abs(variance) < 1 
                            ? 'bg-emerald-500/10 text-emerald-400' 
                            : variance > 0 
                            ? 'bg-cyan-500/10 text-cyan-400' 
                            : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {variance >= 0 ? "+" : ""}₵{variance.toFixed(2)}
                        </span>
                      </td>
                      <td className="p-4.5 text-center">
                        {proofUrl ? (
                          <button
                            onClick={() => setSelectedImage(proofUrl)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 rounded-lg text-xs font-medium transition"
                          >
                            📷 View
                          </button>
                        ) : (
                          <span className="text-xs text-slate-600">No Photo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredShifts.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-500 text-xs">
                      No shift records found matching your search criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {selectedImage && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Meter Photo Proof Verification</h3>
              <button
                onClick={() => setSelectedImage(null)}
                className="w-8 h-8 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-300 flex items-center justify-center text-xs font-bold transition"
              >
                ✕
              </button>
            </div>
            <div className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center">
              <img src={selectedImage} alt="Meter Proof" className="max-h-[70vh] object-contain w-full" />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setSelectedImage(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-200 transition"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}