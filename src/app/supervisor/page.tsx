"use client";

import { useState } from "react";
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
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage("");

    const open = parseFloat(openingMeter) || 0;
    const close = parseFloat(closingMeter) || 0;
    const litersSold = Math.max(0, close - open);
    const cash = parseFloat(cashSubmitted) || 0;

    const { error } = await supabase.from("shifts").insert([
      {
        attendant_name: attendantName,
        opening_meter: open,
        closing_meter: close,
        liters_sold: litersSold,
        total_sales: cash,
        cash_submitted: cash,
        variance: 0,
      },
    ]);

    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage("Shift closed and saved successfully!");
      setAttendantName("");
      setOpeningMeter("");
      setClosingMeter("");
      setCashSubmitted("");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Supervisor — Close Shift</h1>
          <p className="text-slate-400 text-sm">Enter totalizer readings & cash submitted</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Attendant Name</label>
            <input
              type="text"
              required
              value={attendantName}
              onChange={(e) => setAttendantName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              placeholder="e.g. Kwame Mensah"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Opening Meter</label>
              <input
                type="number"
                step="any"
                required
                value={openingMeter}
                onChange={(e) => setOpeningMeter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Closing Meter</label>
              <input
                type="number"
                step="any"
                required
                value={closingMeter}
                onChange={(e) => setClosingMeter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Cash Submitted (GHS)</label>
            <input
              type="number"
              step="any"
              required
              value={cashSubmitted}
              onChange={(e) => setCashSubmitted(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-3 rounded-xl font-semibold transition-colors"
          >
            {submitting ? "Submitting..." : "Submit Shift Close"}
          </button>

          {message && (
            <p className="text-sm text-center text-emerald-400 pt-2">{message}</p>
          )}
        </form>
      </div>
    </div>
  );
}