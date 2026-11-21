'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

const input = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-3';
const button = 'rounded-xl bg-cyan-700 px-4 py-3 disabled:opacity-50';

export default function BaselineSettings() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string>('');
  const [meter, setMeter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/owner/baseline', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load the baseline.');
      setCurrent(result.baseline == null ? '' : String(result.baseline));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the baseline.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/owner/baseline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meter }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save the baseline.');
      setMessage('Baseline updated. The next supervisor shift will use this opening reading.');
      setMeter('');
      setCurrent(String(result.baseline));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the baseline.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-700 p-4 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Main pump baseline</h2>
        <button className={button} onClick={() => setOpen(!open)} type="button">
          {open ? 'Close' : 'Change baseline'}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Current baseline: {current ? `${current} L` : 'Not configured'}
      </p>
      {open && (
        <form className="mt-4 space-y-4" onSubmit={save}>
          <label className="block space-y-2">
            Current meter reading (L)
            <input
              className={input}
              inputMode="decimal"
              min="0"
              required
              value={meter}
              onChange={(event) => setMeter(event.target.value.replace(/[^0-9.]/g, ''))}
            />
          </label>
          <button className={button} disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save baseline'}
          </button>
          <p className="text-xs text-slate-400">
            Use the live meter reading after a shift closes. This becomes the opening reading for the next supervisor shift.
          </p>
        </form>
      )}
      <div aria-live="polite" className="mt-3 space-y-2">
        {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
        {message && <p className="text-sm text-emerald-300">{message}</p>}
      </div>
    </section>
  );
}
