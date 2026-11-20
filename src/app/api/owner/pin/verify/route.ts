import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  OWNER_PIN_COOKIE,
  createSessionToken,
  isLocked,
  nextLock,
  sessionCookieOptions,
  verifyPin,
} from '@/lib/owner-pin';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: Request) {
  let pin: unknown;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    pin = (body as Record<string, unknown>).pin;
  } catch {
    return NextResponse.json({ error: 'Send a JSON object containing pin.' }, { status: 400, headers });
  }

  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Enter a 4-digit PIN.' }, { status: 400, headers });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('owner_pin')
      .select('pin_hash,failed_attempts,locked_until')
      .eq('id', 1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: 'Unable to verify the owner PIN.' }, { status: 500, headers });
    if (!data) return NextResponse.json({ error: 'Owner PIN has not been set up.' }, { status: 403, headers });

    if (isLocked(data.locked_until)) {
      return NextResponse.json({ error: 'Too many incorrect attempts. Try again later.' }, { status: 429, headers });
    }

    if (!verifyPin(pin, data.pin_hash)) {
      const attempts = Number(data.failed_attempts || 0) + 1;
      const lockedUntil = nextLock(attempts);
      await getSupabaseAdmin()
        .from('owner_pin')
        .update({ failed_attempts: attempts, locked_until: lockedUntil, updated_at: new Date().toISOString() })
        .eq('id', 1);
      return NextResponse.json(
        { error: lockedUntil ? 'Too many incorrect attempts. Try again later.' : 'Incorrect PIN.' },
        { status: lockedUntil ? 429 : 401, headers },
      );
    }

    await getSupabaseAdmin()
      .from('owner_pin')
      .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
      .eq('id', 1);

    const response = NextResponse.json({ ok: true }, { headers });
    response.cookies.set(OWNER_PIN_COOKIE, createSessionToken(), sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}
