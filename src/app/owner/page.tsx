'use client';
import { useState, useEffect } from 'react';

interface ShiftSummary {
  id: string;
  station_name: string;
  shift_type: string;
  shift_date: string;
  total_expected: number;
  total_actual: number;
  variance: number;
  is_flagged: boolean;
  liters_pms: number;
  liters_ago: number;
  liters_lpg: number;
  closed_by: string;
}

export default function OwnerDashboard() {
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Replace with real fetch from /api/owner/dashboard
    // Demo data for Accra / Kumasi
    setShifts([
      {
        id: '1',
        station_name: 'Dong Gas East Legon',
        shift_type: 'Morning',
        shift_date: '2026-11-12',
        total_expected: 18450.75,
        total_actual: 18320.00,
        variance: 130.75,
        is_flagged: true,
        liters_pms: 980.5,
        liters_ago: 420.0,
        liters_lpg: 85.0,
        closed_by: 'Kofi Boateng',
      },
      {
        id: '2',
        station_name: 'Dong Gas Kumasi Central',
        shift_type: 'Night',
        shift_date: '2026-11-11',
        total_expected: 22100.00,
        total_actual: 22115.50,
        variance: -15.50,
        is_flagged: false,
        liters_pms: 1120.0,
        liters_ago: 510.0,
        liters_lpg: 120.0,
        closed_by: 'Ama Serwaa',
      },
    ]);
    setLoading(false);
  }, []);

  const totalRevenue = shifts.reduce((s, x) => s + x.total_actual, 0);
  const totalLiters = shifts.reduce((s, x) => s + x.liters_pms + x.liters_ago + x.liters_lpg, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-amber-400">Dong Gas Control Tower</h1>
        <p className="text-slate-400">Owner Executive View • Ghana</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 rounded-2xl p-5">
          <div className="text-slate-400 text-sm">Today’s Revenue</div>
          <div className="text-2xl font-bold text-green-400">GH₵{totalRevenue.toLocaleString('en-GH', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-slate-900 rounded-2xl p-5">
          <div className="text-slate-400 text-sm">Total Liters</div>
          <div className="text-2xl font-bold">{totalLiters.toLocaleString()} L</div>
        </div>
        <div className="bg-slate-900 rounded-2xl p-5">
          <div className="text-slate-400 text-sm">PMS / AGO / LPG</div>
          <div className="text-lg font-semibold">
            {shifts.reduce((s,x)=>s+x.liters_pms,0).toFixed(0)} / {shifts.reduce((s,x)=>s+x.liters_ago,0).toFixed(0)} / {shifts.reduce((s,x)=>s+x.liters_lpg,0).toFixed(0)}
          </div>
        </div>
        <div className="bg-slate-900 rounded-2xl p-5">
          <div className="text-slate-400 text-sm">Flagged Shifts</div>
          <div className="text-2xl font-bold text-red-400">{shifts.filter(s => s.is_flagged).length}</div>
        </div>
      </div>

      {/* Shift Table */}
      <div className="bg-slate-900 rounded-2xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-800 text-slate-300 text-sm">
            <tr>
              <th className="p-4">Station / Shift</th>
              <th className="p-4">Expected</th>
              <th className="p-4">Actual</th>
              <th className="p-4">Variance</th>
              <th className="p-4">Status</th>
              <th className="p-4">Photo Audit</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map(s => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="p-4">
                  <div className="font-medium">{s.station_name}</div>
                  <div className="text-sm text-slate-400">{s.shift_type} • {s.shift_date}</div>
                  <div className="text-xs text-slate-500">by {s.closed_by}</div>
                </td>
                <td className="p-4 font-mono">GH₵{s.total_expected.toFixed(2)}</td>
                <td className="p-4 font-mono">GH₵{s.total_actual.toFixed(2)}</td>
                <td className={`p-4 font-mono font-bold ${s.variance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {s.variance > 0 ? '+' : ''}{s.variance.toFixed(2)}
                </td>
                <td className="p-4">
                  {s.is_flagged ? (
                    <span className="px-2 py-1 bg-red-900 text-red-300 rounded text-xs">FLAGGED</span>
                  ) : (
                    <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs">CLEAN</span>
                  )}
                </td>
                <td className="p-4">
                  <button
                    onClick={() => setSelectedPhoto('https://placehold.co/600x400?text=Totalizer+Photo')}
                    className="text-amber-400 underline text-sm"
                  >
                    View Photos
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Photo Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setSelectedPhoto(null)}>
          <div className="bg-slate-900 rounded-2xl max-w-2xl w-full p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3">Meter Photo Audit</h3>
            <img src={selectedPhoto} alt="Totalizer proof" className="w-full rounded-xl" />
            <button onClick={() => setSelectedPhoto(null)} className="mt-4 w-full py-3 bg-slate-700 rounded-xl">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}