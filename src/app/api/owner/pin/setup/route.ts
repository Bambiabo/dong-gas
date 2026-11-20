import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { hashPin } from '@/lib/owner-pin';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: Request) {
  const setupCode = process.env.OWNER_PIN_SETUP_CODE;
  if (!setupCode || setupCode.length < 32) {
    return NextResponse.json({ error: 'Owner PIN setup is not configured.' }, { status: 503, headers });
  }

  let setupCodeValue: unknown;
  let pin: unknown;
  let confirmPin: unknown;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    const data = body as Record<string, unknown>;
    setupCodeValue = data.setupCode;
    pin = data.pin;
    confirmPin = data.confirmPin;
  } catch {
    return NextResponse.json({ error: 'Send a JSON object with setupCode, pin, and confirmPin.' }, { status: 400, headers });
  }

  if (typeof setupCodeValue !== 'string' || setupCodeValue.length !== setupCode.length) {
    return NextResponse.json({ error: 'Invalid setup code.' }, { status: 403, headers });
  }

  const provided = Buffer.from(setupCodeValue);
  const expected = Buffer.from(setupCode);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Invalid setup code.' }, { status: 403, headers });
  }

  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Enter a 4-digit PIN.' }, { status: 400, headers });
  }
  if (pin !== confirmPin) {
    return NextResponse.json({ error: 'PINs do not match.' }, { status: 400, headers });
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from('owner_pin')
      .upsert({
        id: 1,
        pin_hash: hashPin(pin),
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      });
    if (error) return NextResponse.json({ error: 'Unable to save the owner PIN.' }, { status: 500, headers });
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}
