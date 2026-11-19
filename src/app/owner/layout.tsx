'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

const ownerEmail = 'bambiabocletus@gmail.com';
const field = 'mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 p-3';
const button = 'rounded-xl bg-cyan-700 px-4 py-3 disabled:opacity-50';

export default function OwnerEmailGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(result => {
      if (!active) return;
      if (result.error) setError('Unable to restore sign-in. Please retry.');
      setSignedIn(!result.error && result.data.session?.user.email?.toLowerCase() === ownerEmail);
      setChecking(false);
    }).catch(() => { if (active) { setChecking(false); setError('Unable to restore sign-in.'); } });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setSignedIn(session?.user.email?.toLowerCase() === ownerEmail); setChecking(false); }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    const address = (sentTo || email).trim().toLowerCase();
    if (address !== ownerEmail) { setError('Use the approved owner email address.'); return; }
    if (Date.now() < resendAt) { setError('Please wait one minute between code requests.'); return; }
    setBusy(true);
    try {
      const { error: failure } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
      if (failure) throw failure;
      setSentTo(address); setCode(''); setResendAt(Date.now() + 60000);
      setNotice('Email requested. Enter the code from your latest email. If it contains only a link, the Supabase email template still needs configuration.');
    } catch { setError('Unable to send the email. Check email delivery configuration or wait before retrying.'); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    if (!sentTo || !/^\d{6}$/.test(code)) { setError('Enter the six-digit code from your email.'); return; }
    setBusy(true);
    try {
      const result = await supabase.auth.verifyOtp({ email: sentTo, token: code, type: 'email' });
      if (result.error || !result.data.session) throw new Error('Invalid code');
      setCode(''); setSignedIn(result.data.session.user.email?.toLowerCase() === ownerEmail);
    } catch { setError('The code is invalid or expired. Use the latest code or request another.'); }
    finally { setBusy(false); }
  }

  if (checking) return <main className="min-h-screen bg-slate-950 p-8 text-white"><p role="status">Checking owner sign-in…</p></main>;
  // The child page handles TOTP enrollment/challenge. Owner APIs independently enforce email and aal2.
  if (signedIn) return <>{children}</>;
  return <main className="min-h-screen bg-slate-950 p-5 text-white flex items-center justify-center"><section className="w-full max-w-md rounded-3xl border border-slate-700 p-6 space-y-5"><h1 className="text-2xl font-bold">Owner Portal</h1><p>Sign in with your email. No password required. Authenticator verification follows.</p>{!sentTo ? <form onSubmit={sendCode} className="space-y-4"><label className="block">Owner email<input className={field} type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></label><button className={button} disabled={busy}>Send sign-in code</button></form> : <><p className="break-all">Email sent to {sentTo}</p><form onSubmit={verifyCode} className="space-y-4"><label className="block">Email verification code<input className={field} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy}/></label><button className={button} disabled={busy}>Continue to authenticator</button></form><form onSubmit={sendCode}><button className={button} disabled={busy}>Resend code</button></form><button className="underline" disabled={busy} onClick={() => { setSentTo(''); setCode(''); setNotice(''); setError(''); }}>Change email</button></>}<div aria-live="polite">{busy && <p role="status">Working…</p>}{notice && <p>{notice}</p>}{error && <p role="alert" className="text-rose-300">{error}</p>}</div><p className="text-xs text-slate-400">Never share email codes, authenticator codes or setup keys. Email access alone does not authorize owner API access.</p></section></main>;
}
