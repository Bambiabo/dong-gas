"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ShiftRecord {
  id: string;
  created_at: string;
  attendant_name?: string;
  opening_meter?: number;
  closing_meter?: number;
  liters_sold?: number;
  total_sales?: number;
  cash_submitted?: number;
  variance?: number;
  meter_photo_url?: string;
}

export default function OwnerDashboard() {
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  useEffect(() => {
    async function fetchShifts() {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setShifts(data);
      }
      setLoading(false);
    }

    fetchShifts();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Dong Gas — Owner Dashboard</h1>
            <p className="text-slate-400 text-sm">Shift Closings & Totalizer Audit</p>
          </div>
        </div>

        <div className="bg-slate-900 rounded-2xl overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase">
                <th className="p-4">Date</th>
                <th className="p-4">Attendant</th>
                <th className="p-4">Opening</th>
                <th className="p-4">Closing</th>
                <th className="p-4">Total Sales (GHS)</th>
                <th className="p-4">Variance</th>
                <th className="p-4">Meter Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    Loading shift records...
                  </td>
                </tr>
              ) : shifts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    No shift records found yet.
                  </td>
                </tr>
              ) : (
                shifts.map((shift) => (
                  <tr key={shift.id} className="hover:bg-slate-800/50">
                    <td className="p-4">
                      {new Date(shift.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 font-medium">
                      {shift.attendant_name || "Attendant"}
                    </td>
                    <td className="p-4">{shift.opening_meter ?? "-"}</td>
                    <td className="p-4">{shift.closing_meter ?? "-"}</td>
                    <td className="p-4 font-semibold text-emerald-400">
                      {shift.total_sales?.toFixed(2) ?? "0.00"}
                    </td>
                    <td className="p-4">
                      {shift.variance !== undefined ? shift.variance.toFixed(2) : "0.00"}
                    </td>
                    <td className="p-4">
                      {shift.meter_photo_url ? (
                        <button
                          onClick={() => setSelectedPhoto(shift.meter_photo_url!)}
                          className="text-sky-400 hover:underline font-medium"
                        >
                          View Photo
                        </button>
                      ) : (
                        <span className="text-slate-500">No photo</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Photo Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-2xl w-full p-4 border border-slate-800">
            <h3 className="text-lg font-bold mb-3">Meter Photo Audit</h3>
            <img
              src={selectedPhoto}
              alt="Totalizer proof"
              className="w-full rounded-lg max-h-[70vh] object-contain"
            />
            <button
              onClick={() => setSelectedPhoto(null)}
              className="mt-4 w-full bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-center font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}