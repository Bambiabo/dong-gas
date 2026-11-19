'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type Shift = { id: string; created_at: string; supervisor_name?: string; opening_meter?: number | string; closing_meter?: number | string; cash_collected?: number | string; momo_collected?: number | string; expenses?: number | string; variance?: number | string; proof_image?: string; opening_proof_image?: string };
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const input = 'w-full rounded-xl border border-slate-700 bg-slate-950 p-3';
const button = 'rounded-xl bg-cyan-700 px-4 py-3 disabled:opacity-50';

export default function OwnerDashboard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('7');
  const [photo, setPhoto] = useState<string | null>(null);
  const [baseline, setBaseline] = useState('');

  async function run(task: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Please retry.'); }
    finally { setBusy(false); }
  }

  async function freshSession() {
    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    if (!result.data.session) throw new Error('Session expired. Please sign in again.');
    return result.data.session;
  }

  async function loadDashboard(active: Session) {
    const response = await fetch('/api/owner/shifts', { cache: 'no-store', headers: { Authorization: `Bearer ${active.access_token}` } });
    const result = await response.json();
    if (!response.ok) { setSession(null); setShifts([]); throw new Error(result.error || 'Unable to load owner records.'); }
    setShifts(result.shifts ?? []); setSession(active);
    setFactor(null); setQr(''); setSecret(''); setCode('');
  }

  async function continueSession(active: Session) {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw assurance.error;
    if (assurance.data.currentLevel === 'aal2') { await loadDashboard(active); return; }
    setSession(null); setShifts([]);
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    const verified = factors.data.totp.find(item => item.status === 'verified');
    if (verified) { setFactor(verified.id); setQr(''); setSecret(''); return; }
    const pending = factors.data.totp.filter(item => item.status === 'unverified');
    if (pending.length) throw new Error('Authenticator setup was interrupted. Complete or remove the pending enrollment through Supabase account support before retrying. No factors were deleted.');
    const enrollment = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Dong Gas Owner' });
    if (enrollment.error) throw enrollment.error;
    setFactor(enrollment.data.id); setQr(enrollment.data.totp.qr_code); setSecret(enrollment.data.totp.secret);
  }

  useEffect(() => {
    void run(async () => {
      const result = await supabase.auth.getSession();
      if (result.error) throw result.error;
      if (result.data.session) await continueSession(result.data.session);
    });
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { setSession(null); setShifts([]); setFactor(null); setQr(''); setSecret(''); setPhoto(null); }
    });
    return () => data.subscription.unsubscribe();
    // Initialization runs once; authorization is independently checked by each API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setPassword('');
      if (result.error) throw result.error;
      await continueSession(result.data.session);
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!factor || !/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code from your authenticator.');
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId: factor, code });
      if (result.error) throw result.error;
      const active = await freshSession();
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== 'aal2') throw new Error('Verification was not completed. Please retry.');
      await loadDashboard(active);
    });
  }

  function signOut() {
    setSession(null); setShifts([]); setFactor(null); setQr(''); setSecret(''); setPhoto(null); setCode(''); setPassword('');
    void run(async () => { const result = await supabase.auth.signOut({ scope: 'local' }); if (result.error) throw result.error; });
  }

  function updateBaseline(event: FormEvent) {
    event.preventDefault();
    if (!baseline.trim() || !Number.isFinite(Number(baseline)) || Number(baseline) < 0) { setError('Enter a non-negative meter value.'); return; }
    if (!window.confirm(`Request baseline correction to ${baseline}? Only continue after verifying the meter and checking for active shifts.`)) return;
    void run(async () => {
      const active = await freshSession();
      const response = await fetch('/api/owner/baseline', { method: 'POST', headers: { Authorization: `Bearer ${active.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baselineMeter: Number(baseline) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Baseline update failed.');
      setMessage(`Baseline updated to ${result.baselineMeter}.`); setBaseline('');
    });
  }

  const visible = shifts.filter(shift => (shift.supervisor_name || '').toLowerCase().includes(search.toLowerCase()) && (days === 'all' || new Date(shift.created_at).getTime() >= Date.now() - Number(days) * 86400000));
  const cash = visible.reduce((sum, shift) => sum + number(shift.cash_collected), 0);
  const momo = visible.reduce((sum, shift) => sum + number(shift.momo_collected), 0);
  const volume = visible.reduce((sum, shift) => sum + Math.max(0, number(shift.closing_meter) - number(shift.opening_meter)), 0);
  const notices = <div aria-live="polite">{busy && <p role="status">Working…</p>}{error && <p role="alert" className="text-rose-300">{error}</p>}{message && <p className="text-emerald-300">{message}</p>}</div>;

  if (!session) return <main className="min-h-screen bg-slate-950 p-5 text-white flex items-center justify-center"><section className="w-full max-w-md space-y-5 rounded-3xl border border-slate-700 p-6"><h1 className="text-2xl font-bold">Owner Portal</h1><p className="text-sm text-slate-300">Security preview · Email, password and authenticator</p>{factor ? <form onSubmit={verify} className="space-y-4">{qr && <><p>Scan with your authenticator, or enter the setup key manually. Keep this key private.</p><img src={qr} alt="Private authenticator setup QR code" className="mx-auto bg-white p-2"/><details><summary>Manual setup key</summary><code className="break-all">{secret}</code></details></>}<label className="block">Authenticator code<input className={input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required/></label><button className={button} disabled={busy}>Verify and continue</button></form> : <form onSubmit={signIn} className="space-y-4"><label className="block">Email<input className={input} type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required/></label><label className="block">Password<input className={input} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/></label><button className={button} disabled={busy}>Sign in</button></form>}{notices}<div className="flex gap-3"><button className={button} disabled={busy} onClick={() => void run(async () => continueSession(await freshSession()))}>Retry session</button><button className={button} disabled={busy} onClick={signOut}>Sign out / start again</button></div></section></main>;

  return <main className="min-h-screen bg-slate-950 p-5 text-white space-y-6 print:bg-white print:text-black"><header><h1 className="text-2xl font-bold">Owner Financial Audit</h1><p>Security preview — not approved for production</p><div className="flex flex-wrap gap-3 mt-4 print:hidden"><button className={button} disabled={busy} onClick={() => void run(async () => continueSession(await freshSession()))}>Refresh</button><button className={button} onClick={() => window.print()}>Print report</button><button className={button} disabled={busy} onClick={signOut}>Sign out</button></div></header>{notices}<section className="flex flex-wrap gap-4 print:hidden"><label>Supervisor search<input className={input} value={search} onChange={event => setSearch(event.target.value)}/></label><label>Period<select className={input} value={days} onChange={event => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label></section><section className="grid gap-3 sm:grid-cols-4">{[['Total collected', cash + momo], ['Cash', cash], ['MoMo', momo], ['Meter volume', volume]].map(([label, value]) => <div className="rounded-xl border p-4" key={String(label)}><h2>{label}</h2><p className="text-xl">{number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>)}</section><section className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Date', 'Supervisor', 'Meter volume', 'Cash GHS', 'MoMo GHS', 'Expenses GHS', 'Recorded variance GHS', 'Proof'].map(title => <th className="p-3" key={title}>{title}</th>)}</tr></thead><tbody>{visible.map(shift => <tr key={shift.id} className="border-t"><td className="p-3">{new Date(shift.created_at).toLocaleString()}</td><td className="p-3">{shift.supervisor_name || 'Supervisor'}</td><td className="p-3">{Math.max(0, number(shift.closing_meter) - number(shift.opening_meter)).toFixed(2)}</td>{[shift.cash_collected, shift.momo_collected, shift.expenses].map((value, index) => <td className="p-3" key={index}>{number(value).toFixed(2)}</td>)}<td className="p-3">{shift.variance == null ? 'Not recorded' : number(shift.variance).toFixed(2)}</td><td className="p-3">{[shift.opening_proof_image, shift.proof_image].map((url, index) => url ? <button key={index} className="underline mr-3" onClick={() => setPhoto(url)}>{index === 0 ? 'Opening' : 'Closing'}</button> : null)}</td></tr>)}</tbody></table>{!visible.length && <p className="p-5">No records match these filters.</p>}</section><details className="print:hidden"><summary>Verified baseline correction</summary><p>Do not use during an active shift. Audit and concurrency safeguards still need testing.</p><form onSubmit={updateBaseline} className="space-y-3 mt-3"><label>New meter baseline<input className={input} type="number" min="0" step="any" value={baseline} onChange={event => setBaseline(event.target.value)} required/></label><button className={button} disabled={busy}>Review correction</button></form></details>{photo && <div role="dialog" aria-modal="true" aria-label="Meter proof" className="fixed inset-0 bg-slate-950 p-6 overflow-auto print:hidden"><button className={button} autoFocus onClick={() => setPhoto(null)}>Close photo</button><img src={photo} alt="Shift meter proof" className="mx-auto max-h-screen max-w-full mt-4"/></div>}</main>;
}
