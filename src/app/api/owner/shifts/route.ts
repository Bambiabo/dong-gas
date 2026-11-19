import { NextResponse } from 'next/server';
import { getAuthenticatedOwner } from '@/lib/owner-auth';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization' };

export async function GET(request: Request) {
  const { owner, error } = await getAuthenticatedOwner(request);
  if (!owner) return NextResponse.json({ error }, { status: 401, headers });
  try {
    const { data, error: failure } = await getSupabaseAdmin().from('shifts').select('*').order('created_at', { ascending: false });
    if (failure) return NextResponse.json({ error: 'Unable to load shift records.' }, { status: 500, headers });
    return NextResponse.json({ shifts: data ?? [] }, { headers });
  } catch {
    return NextResponse.json({ error: 'Owner data service is temporarily unavailable.' }, { status: 503, headers });
  }
}
