"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Shift = {
  id: string;
  created_at: string;
  supervisor_name?: string | null;
  opening_meter?: number | null;
  closing_meter?: number | null;
  fuel_price?: number | null;
  cash_collected?: number | null;
  momo_collected?: number | null;
  expenses?: number | null;
  proof_image?: string | null;
};

export default function OwnerDashboard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadDashboard(activeSession: any) {
    setLoading(true);
    setError('');

    const response = await fetch('/api/owner/shifts', {
      headers: {
        Authorization: `Bearer ${activeSession.access_token}`,
      },
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(result.error || 'Unable to load owner data.');
      setSession(null);
      setLoading(false);
      return;
    }

    const result = await response.json();
    setShifts(result.shifts || []);
    setSession(activeSession);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        await loadDashboard(data.session);
      } else {
        setLoading(false);
      }
    });
  }, []);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.session) {
      setError(signInError?.message || 'Unable to sign in.');
      setLoading(false);
      return;
    }

    const { data: factorData } = await supabase.auth.mfa.listFactors();
    const verifiedFactor = factorData?.all?.find((factor) => factor.status === 'verified');

    if (verifiedFactor) {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedFactor.id,
      });

      if (challengeError || !challengeData) {
        setError(challengeError?.message || 'Unable to start verification.');
        setLoading(false);
        return;
      }

      setFactorId(challengeData.id);
      setLoading(false);
      return;
    }

    const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    });

    if (enrollError || !enrollData) {
      setError(enrollError?.message || 'Unable to start authenticator setup.');
      setLoading(false);
      return;
    }

    setFactorId(enrollData.id);
    setQrCode(enrollData.totp?.qr_code || null);
    setLoading(false);
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!factorId) {
      setError('No verification challenge is active.');
      return;
    }

    const { data, error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      code: verificationCode,
    });

    if (verifyError || !data) {
      setError(verifyError?.message || 'Invalid verification code.');
      return;
    }

    setVerificationCode('');
    setFactorId(null);
    setQrCode(null);
    await loadDashboard(data.session ?? (await supabase.auth.getSession()).data.session);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
    setShifts([]);
  }

  async function updateBaseline(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');

    const response = await fetch('/api/owner/baseline', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ baselineMeter: baseline }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(result.error || 'Unable to update baseline.');
      return;
    }

    setMessage(`Baseline updated to ${result.baselineMeter} L.`);
    setBaseline('');
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p>Loading owner portal…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <h1 className="text-center text-xl font-bold">Owner Portal</h1>

          {!factorId ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Owner email"
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3.5"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3.5"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-cyan-600 py-3.5 font-semibold"
              >
                Sign in
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              {qrCode && (
                <div className="space-y-2 text-center">
                  <p className="text-sm text-slate-300">
                    Scan this QR code with your authenticator app.
                  </p>
                  <img src={qrCode} alt="Authenticator QR code" className="mx-auto rounded-xl bg-white p-2" />
                </div>
              )}
              <input
                inputMode="numeric"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="6-digit authenticator code"
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-center tracking-widest"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-cyan-600 py-3.5 font-semibold"
              >
                Verify
              </button>
            </form>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}
          {message && <p className="text-sm text-emerald-400">{message}</p>}
        </div>
      </main>
    );
  }

  const totalCash = shifts.reduce((total, shift) => total + (shift.cash_collected || 0), 0);
  const totalMomo = shifts.reduce((total, shift) => total + (shift.momo_collected || 0), 0);

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 bg-slate-950 p-6 text-white md:p-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl font-extrabold md:text-3xl">Owner Financial Audit</h1>
          <p className="text-sm text-slate-400">Secure operational oversight and shift reconciliations.</p>
        </div>
        <button
          onClick={handleSignOut}
          className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-400"
        >
          Sign out
        </button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-400">Cash collected</p>
          <p className="mt-1 text-2xl font-black text-emerald-400">
            ₵{totalCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-400">MoMo collected</p>
          <p className="mt-1 text-2xl font-black text-blue-400">
            ₵{totalMomo.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-bold text-cyan-400">Reset pump baseline</h2>
        <p className="mt-1 text-xs text-slate-400">
          Use only when a verified correction is required. This is protected by owner sign-in and MFA.
        </p>
        <form onSubmit={updateBaseline} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="number"
            value={baseline}
            onChange={(event) => setBaseline(event.target.value)}
            placeholder="New baseline meter"
            required
            className="flex-1 rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-cyan-300"
          />
          <button type="submit" className="rounded-xl bg-cyan-600 px-5 py-3 font-semibold">
            Update baseline
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950 text-xs uppercase text-slate-400">
            <tr>
              <th className="p-4">Date</th>
              <th className="p-4">Supervisor</th>
              <th className="p-4">Litres</th>
              <th className="p-4">Cash</th>
              <th className="p-4">MoMo</th>
              <th className="p-4">Proof</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id} className="border-b border-slate-800/60">
                <td className="p-4 text-xs text-cyan-400">
                  {new Date(shift.created_at).toLocaleString()}
                </td>
                <td className="p-4">{shift.supervisor_name || 'Supervisor'}</td>
                <td className="p-4">
                  {Math.max(0, (shift.closing_meter || 0) - (shift.opening_meter || 0)).toLocaleString()} L
                </td>
                <td className="p-4">₵{(shift.cash_collected || 0).toFixed(2)}</td>
                <td className="p-4">₵{(shift.momo_collected || 0).toFixed(2)}</td>
                <td className="p-4">
                  {shift.proof_image ? 'Available' : 'None'}
                </td>
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-slate-500">
                  No shift records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}
    </main>
  );
}
