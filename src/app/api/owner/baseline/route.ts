import { NextResponse } from 'next/server';
import { getAuthenticatedOwner } from '@/lib/owner-auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const { owner, error } = await getAuthenticatedOwner(request);

  if (!owner) {
    return NextResponse.json({ error }, { status: 401 });
  }

  let baselineMeter: unknown;

  try {
    const body = await request.json();
    baselineMeter = body?.baselineMeter;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const value = Number(baselineMeter);

  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json(
      { error: 'Enter a valid non-negative baseline meter value.' },
      { status: 400 },
    );
  }

  const { error: databaseError } = await supabaseAdmin
    .from('station_baselines')
    .upsert({
      id: 1,
      pump_name: 'main',
      baseline_meter: value,
      updated_at: new Date().toISOString(),
    });

  if (databaseError) {
    return NextResponse.json(
      { error: 'Unable to update the station baseline.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ baselineMeter: value });
}
