import { NextResponse } from 'next/server';
import { getAuthenticatedOwner } from '@/lib/owner-auth';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization' };

export async function POST(request: Request) {
  const { owner, error } = await getAuthenticatedOwner(request);
  if (!owner) return NextResponse.json({ error }, { status: 401, headers });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
  let value: unknown;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    value = (body as Record<string, unknown>).baselineMeter;
  } catch {
    return NextResponse.json({ error: 'Send a JSON object containing baselineMeter.' }, { status: 400, headers });
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000000) {
    return NextResponse.json({ error: 'baselineMeter must be a number between 0 and 1000000000000.' }, { status: 400, headers });
  }
  try {
    const { data, error: failure } = await getSupabaseAdmin().from('station_baselines').update({ baseline_meter: value, updated_at: new Date().toISOString() }).eq('id', 1).eq('pump_name', 'main').select('baseline_meter').maybeSingle();
    if (failure) return NextResponse.json({ error: 'Unable to update the station baseline.' }, { status: 500, headers });
    if (!data) return NextResponse.json({ error: 'Main pump baseline was not found. No baseline was created.' }, { status: 409, headers });
    return NextResponse.json({ baselineMeter: data.baseline_meter }, { headers });
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}
