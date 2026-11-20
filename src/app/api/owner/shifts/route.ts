import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { OWNER_PIN_COOKIE, verifySessionToken } from '@/lib/owner-pin';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };

export async function GET(request: Request) {
  const token = request.cookies.get(OWNER_PIN_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Owner PIN verification required.' }, { status: 401, headers });
  }

  try {
    const { data, error: failure } = await getSupabaseAdmin()
      .from('shifts')
      .select('*')
      .order('created_at', { ascending: false });
    if (failure) return NextResponse.json({ error: 'Unable to load shift records.' }, { status: 500, headers });
    return NextResponse.json({ shifts: data ?? [] }, { headers });
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}
