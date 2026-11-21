import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { OWNER_PIN_COOKIE, verifySessionToken } from '@/lib/owner-pin';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

function authorized(request: NextRequest) {
  return verifySessionToken(request.cookies.get(OWNER_PIN_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Owner PIN verification required.' }, { status: 401, headers });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('station_baselines')
      .select('baseline_meter,updated_at')
      .eq('pump_name', 'main')
      .maybeSingle();

    if (error) return NextResponse.json({ error: 'Unable to load the current baseline.' }, { status: 500, headers });
    return NextResponse.json({ baseline: data?.baseline_meter ?? null, updatedAt: data?.updated_at ?? null }, { headers });
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Owner PIN verification required.' }, { status: 401, headers });
  }

  let meter: unknown;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    meter = (body as Record<string, unknown>).meter;
  } catch {
    return NextResponse.json({ error: 'Send a JSON object containing meter.' }, { status: 400, headers });
  }

  const value = Number(meter);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) {
    return NextResponse.json({ error: 'Enter a valid current meter reading.' }, { status: 400, headers });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: current, error: currentError } = await supabase
      .from('station_baselines')
      .select('baseline_meter')
      .eq('pump_name', 'main')
      .maybeSingle();

    if (currentError) return NextResponse.json({ error: 'Unable to load the current baseline.' }, { status: 500, headers });

    const previous = current?.baseline_meter ?? null;
    const { error } = await supabase
      .from('station_baselines')
      .update({ baseline_meter: value, updated_at: new Date().toISOString() })
      .eq('pump_name', 'main');

    if (error) return NextResponse.json({ error: 'Unable to save the baseline.' }, { status: 500, headers });

    await supabase.from('owner_dashboard_audit').insert({
      action: 'baseline_correction',
      old_value: { baseline_meter: previous },
      new_value: { baseline_meter: value },
      reason: 'Owner PIN baseline correction.',
    });

    return NextResponse.json({ ok: true, baseline: value }, { headers });
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}
