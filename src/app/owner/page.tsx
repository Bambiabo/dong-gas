'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import BaselineSettings from './baseline-settings';

type Shift = {
  id: string;
  created_at: string;
  supervisor_name?: string;
  opening_meter?: number | string;
  closing_meter?: number | string;
  cash_collected?: number | string;
  momo_collected?: number | string;
  expenses?: number | string;
  variance?: number | string;
};

const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const input = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-3';
const button = 'rounded-xl bg-cyan-700 px-4 py-3 disabled:opacity-50';

export default function OwnerDashboard() {
  const [mode, setMode] = useState<'verify' | 'setup'>('verify');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('7');
  const [updated, setUpdated] = useState('');
  const [syncError, setSyncError] = useState('');

  const loadReports = useCallback(async () => {
    setBusy(true);
    setSyncError('');
    try {
      const response = await fetch('/api/owner/shifts', { cache: 'no-store' });
      if (response.status === 401) {
        setShifts([]);
        setUpdated('');
        return;
      }
      if (!response.ok) throw new Error('Refresh failed');
      const result = await response.json();
      if (!Array.isArray(result.shifts)) throw new Error('Invalid response');
      setShifts(result.shifts);
      setUpdated(new Date().toLocaleString());
    } catch {
      setSyncError('Latest reports could not be checked. Previously loaded reports are still shown.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  async function submit(action: () => Promise<Response>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await action();
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed. Please retry.');
      setMessage('Owner PIN verified.');
      setPin('');
      setConfirmPin('');
      setSetupCode('');
      await loadReports();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void submit(async () => fetch('/api/owner/pin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }));
  }

  function setup(event: FormEvent) {
    event.preventDefault();
    void submit(async () => fetch('/api/owner/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupCode, pin, confirmPin }),
    }));
  }

  const notices = (
    <div aria-live="polite">
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
    </div>
  );

  if (!updated && !shifts.length) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <section className="mx-auto max-w-md space-y-4">
          <h1 className="text-2xl font-bold">Owner access</h1>
          <p>Enter your private 4-digit PIN to view reports.</p>
          <div className="flex gap-2">
            <button className={button} type="button" onClick={() => setMode('verify')} disabled={mode === 'verify'}>Enter PIN</button>
            <button className={button} type="button" onClick={() => setMode('setup')} disabled={mode === 'setup'}>Set PIN</button>
          </div>
          {mode === 'verify' ? (
            <form onSubmit={verify} className="space-y-4">
              <label className="block space-y-2">
                Owner PIN
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  required
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <button className={button} disabled={busy}>Unlock reports</button>
            </form>
          ) : (
            <form onSubmit={setup} className="space-y-4">
              <label className="block space-y-2">
                One-time setup code
                <input
                  className={input}
                  type="password"
                  autoComplete="off"
                  required
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                New 4-digit PIN
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  required
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label className="block space-y-2">
                Confirm PIN
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  required
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <button className={button} disabled={busy}>Save owner PIN</button>
            </form>
          )}
          {notices}
        </section>
      </main>
    );
  }

  const visible = shifts.filter(
    (shift) =>
      (shift.supervisor_name || '').toLowerCase().includes(search.toLowerCase()) &&
      (days === 'all' || new Date(shift.created_at).getTime() >= Date.now() - Number(days) * 86400000),
  );
  const cash = visible.reduce((sum, shift) => sum + number(shift.cash_collected), 0);
  const momo = visible.reduce((sum, shift) => sum + number(shift.momo_collected), 0);
  const volume = visible.reduce(
    (sum, shift) => sum + Math.max(0, number(shift.closing_meter) - number(shift.opening_meter)),
    0,
  );

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white space-y-6 print:bg-white print:text-black">
      <header>
        <h1 className="text-2xl font-bold">Owner Financial Audit</h1>
        <p>Preview — deployment and end-to-end verification pending</p>
        <div className="flex gap-3 print:hidden">
          <button className={button} disabled={busy} onClick={() => void loadReports()} type="button">Refresh reports</button>
          <button className={button} onClick={() => window.print()} type="button">Print report</button>
        </div>
      </header>
      {notices}
      <BaselineSettings />
      <section aria-live="polite">
        <p>Last successful update: {updated || 'Not yet loaded'}</p>
        {syncError && <p role="alert">{syncError}</p>}
      </section>
      <section className="flex gap-4 print:hidden">
        <label className="block space-y-2">
          Supervisor search
          <input className={input} value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="block space-y-2">
          Period
          <select className={input} value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </label>
      </section>
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ['Total collected', cash + momo],
          ['Cash', cash],
          ['MoMo', momo],
          ['Meter volume', volume],
        ].map(([label, value]) => (
          <div className="rounded-xl border p-4" key={String(label)}>
            <h2>{label}</h2>
            <p>{number(value).toFixed(2)}</p>
          </div>
        ))}
      </section>
      <section className="overflow-x-auto">
        <p>{visible.length} reports shown. Filters may hide other reports.</p>
        <table className="w-full text-left">
          <thead>
            <tr>
              {['Date', 'Supervisor', 'Opening meter', 'Closing meter', 'Volume', 'Cash GHS', 'MoMo GHS', 'Expenses GHS', 'Variance GHS'].map((title) => (
                <th className="p-3" key={title}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((shift) => (
              <tr className="border-t" key={shift.id}>
                <td className="p-3">{new Date(shift.created_at).toLocaleString()}</td>
                <td>{shift.supervisor_name || 'Supervisor'}</td>
                {[
                  shift.opening_meter,
                  shift.closing_meter,
                  Math.max(0, number(shift.closing_meter) - number(shift.opening_meter)),
                  shift.cash_collected,
                  shift.momo_collected,
                  shift.expenses,
                ].map((value, index) => (
                  <td className="p-3" key={index}>{value == null ? 'Not recorded' : number(value).toFixed(2)}</td>
                ))}
                <td>{shift.variance == null ? 'Not recorded' : number(shift.variance).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p>{updated ? 'No records match these filters.' : 'Reports have not loaded yet.'}</p>}
      </section>
    </main>
  );
}
