'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

type Shift = { id: string; created_at: string; supervisor_name?: string; opening_meter?: number | string; closing_meter?: number | string; cash_collected?: number | string; momo_collected?: number | string; expenses?: number | string; variance?: number | string; opening_proof_image?: string; proof_image?: string };
const number = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const input = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-3';
const button = 'rounded-xl bg-cyan-700 px-4 py-3 disabled:opacity-50';

export default function OwnerDashboard() {
  const [authorized, setAuthorized] = useState(false);
  const [factor, setFactor] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('7');
  const [photo, setPhoto] = useState<string | null>(null);
  const [baseline, setBaseline] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const initializing = useRef(false);

  function clear() { setAuthorized(false); setShifts([]); setPhoto(null); setUpdated(''); setFactor(''); setQr(''); setSecret(''); setCode(''); }
  async function session() {
    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    if (!result.data.session) throw new Error('Sign in with your owner email again.');
    return result.data.session;
  }
  async function run(task: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Please retry.'); } finally { setBusy(false); }
  }
  async function initialize() {
    if (initializing.current) return;
    initializing.current = true;
    try {
      await session();
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;
      if (assurance.data.currentLevel === 'aal2') { setAuthorized(true); return; }
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const verified = factors.data.totp.find(item => item.status === 'verified');
      if (verified) { setFactor(verified.id); return; }
      if (factors.data.totp.some(item => item.status === 'unverified')) throw new Error('Authenticator setup is pending. Contact account support to recover the enrollment. No factors were deleted.');
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Dong Gas Owner' });
      if (result.error) throw result.error;
      setFactor(result.data.id); setQr(result.data.totp.qr_code); setSecret(result.data.totp.secret);
    } finally { initializing.current = false; }
  }
  useEffect(() => {
    void run(initialize);
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') clear(); });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    let pending = false;
    let controller: AbortController | null = null;
    async function refresh() {
      if (!active || pending || document.visibilityState === 'hidden') return;
      pending = true; setRefreshing(true);
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 20000);
      try {
        const current = await supabase.auth.getSession();
        if (!active) return;
        if (current.error) throw current.error;
        if (!current.data.session) { clear(); setError('Session expired. Sign in again.'); return; }
        const response = await fetch('/api/owner/shifts', { cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${current.data.session.access_token}` } });
        if (!active) return;
        if (response.status === 401 || response.status === 403) { clear(); setError('Owner verification is required. Sign out and sign in again.'); return; }
        if (!response.ok) throw new Error('Refresh failed');
        const result = await response.json();
        if (!Array.isArray(result.shifts)) throw new Error('Invalid response');
        if (active) { setShifts(result.shifts); setUpdated(new Date().toLocaleString()); setSyncError(''); }
      } catch { if (active) setSyncError('Latest reports could not be checked. Previously loaded reports are still shown. Retrying automatically.'); }
      finally { window.clearTimeout(timeout); pending = false; if (active) setRefreshing(false); }
    }
    const resume = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(resume, 15000);
    window.addEventListener('online', resume); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [authorized, refreshKey]);

  function verify(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!factor || !/^\d{6}$/.test(code)) throw new Error('Enter the six-digit authenticator code.');
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId: factor, code });
      if (result.error) throw result.error;
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== 'aal2') throw new Error('Verification failed. Please retry.');
      setCode(''); setQr(''); setSecret(''); setAuthorized(true);
    });
  }
  function signOut() { clear(); void run(async () => { const result = await supabase.auth.signOut({ scope: 'local' }); if (result.error) throw result.error; }); }
  function correctBaseline(event: FormEvent) {
    event.preventDefault();
    const value = Number(baseline);
    if (!baseline.trim() || !Number.isFinite(value) || value < 0) { setError('Enter a non-negative meter value.'); return; }
    if (!window.confirm(`Correct baseline to ${value}? Verify the meter and confirm no shift is active first.`)) return;
    void run(async () => {
      const current = await session();
      const response = await fetch('/api/owner/baseline', { method: 'POST', headers: { Authorization: `Bearer ${current.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baselineMeter: value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Correction failed.');
      setMessage(`Baseline updated to ${result.baselineMeter}.`); setBaseline('');
    });
  }
  const notices = <div aria-live="polite">{busy && <p role="status">Working…</p>}{error && <p role="alert">{error}</p>}{message && <p>{message}</p>}</div>;
  if (!authorized) return <main className="min-h-screen bg-slate-950 p-6 text-white"><section className="mx-auto max-w-md space-y-4"><h1>Owner verification</h1><p>Email sign-in is handled by the owner entry screen. Verify your authenticator to continue.</p>{factor && <form onSubmit={verify} className="space-y-4">{qr && <><p>Scan with your authenticator. Keep the setup key private.</p><img src={qr} alt="Private authenticator setup"/><details><summary>Manual setup key</summary><code>{secret}</code></details></>}<label>Authenticator code<input className={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/></label><button className={button} disabled={busy}>Verify</button></form>}{notices}<button className={button} disabled={busy} onClick={() => void run(initialize)}>Retry verification</button><button className={button} disabled={busy} onClick={signOut}>Sign out / start again</button></section></main>;
  const visible = shifts.filter(shift => (shift.supervisor_name || '').toLowerCase().includes(search.toLowerCase()) && (days === 'all' || new Date(shift.created_at).getTime() >= Date.now() - Number(days) * 86400000));
  const cash = visible.reduce((sum, shift) => sum + number(shift.cash_collected), 0);
  const momo = visible.reduce((sum, shift) => sum + number(shift.momo_collected), 0);
  const volume = visible.reduce((sum, shift) => sum + Math.max(0, number(shift.closing_meter) - number(shift.opening_meter)), 0);
  return <main className="min-h-screen bg-slate-950 p-5 text-white space-y-6 print:bg-white print:text-black"><header><h1 className="text-2xl font-bold">Owner Financial Audit</h1><p>Preview — deployment and end-to-end verification pending</p><div className="flex gap-3 print:hidden"><button className={button} disabled={refreshing} onClick={() => setRefreshKey(value => value + 1)}>Refresh reports</button><button className={button} onClick={() => window.print()}>Print report</button><button className={button} disabled={busy} onClick={signOut}>Sign out</button></div></header>{notices}<section aria-live="polite"><p>{refreshing ? 'Checking for supervisor reports…' : 'Checks for new reports every 15 seconds while this page is visible.'}</p><p>Last successful update: {updated || 'Not yet loaded'}</p>{syncError && <p role="alert">{syncError}</p>}</section><section className="flex gap-4 print:hidden"><label>Supervisor search<input className={input} value={search} onChange={event => setSearch(event.target.value)}/></label><label>Period<select className={input} value={days} onChange={event => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label></section><section className="grid gap-3 sm:grid-cols-4">{[['Total collected', cash + momo], ['Cash', cash], ['MoMo', momo], ['Meter volume', volume]].map(([label, value]) => <div className="rounded-xl border p-4" key={String(label)}><h2>{label}</h2><p>{number(value).toFixed(2)}</p></div>)}</section><section className="overflow-x-auto"><p>{visible.length} reports shown. Filters may hide other reports.</p><table className="w-full text-left"><thead><tr>{['Date', 'Supervisor', 'Opening meter', 'Closing meter', 'Volume', 'Cash GHS', 'MoMo GHS', 'Expenses GHS', 'Variance GHS', 'Proof'].map(title => <th className="p-3" key={title}>{title}</th>)}</tr></thead><tbody>{visible.map(shift => <tr key={shift.id} className="border-t"><td className="p-3">{new Date(shift.created_at).toLocaleString()}</td><td>{shift.supervisor_name || 'Supervisor'}</td>{[shift.opening_meter, shift.closing_meter, Math.max(0, number(shift.closing_meter) - number(shift.opening_meter)), shift.cash_collected, shift.momo_collected, shift.expenses].map((value, index) => <td className="p-3" key={index}>{value == null ? 'Not recorded' : number(value).toFixed(2)}</td>)}<td>{shift.variance == null ? 'Not recorded' : number(shift.variance).toFixed(2)}</td><td>{[shift.opening_proof_image, shift.proof_image].map((url, index) => url ? <button className="underline mr-3" key={index} onClick={() => setPhoto(url)}>{index ? 'Closing' : 'Opening'}</button> : null)}</td></tr>)}</tbody></table>{!visible.length && <p>{updated ? 'No records match these filters.' : 'Reports have not loaded yet.'}</p>}</section><details className="print:hidden"><summary>Verified baseline correction</summary><p>Do not use during an active shift. Audit and concurrency safeguards still require testing.</p><form onSubmit={correctBaseline}><label>New baseline<input className={input} type="number" min="0" step="any" required value={baseline} onChange={event => setBaseline(event.target.value)}/></label><button className={button} disabled={busy}>Review correction</button></form></details>{photo && <div role="dialog" aria-modal="true" aria-label="Meter proof" className="fixed inset-0 bg-slate-950 p-6 overflow-auto print:hidden"><button className={button} autoFocus onClick={() => setPhoto(null)}>Close photo</button><img src={photo} alt="Shift meter proof" className="mx-auto max-h-screen max-w-full mt-4"/></div>}</main>;
}
