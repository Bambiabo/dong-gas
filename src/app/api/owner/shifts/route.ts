import { NextResponse } from 'next/server';
import { getAuthenticatedOwner } from '@/lib/owner-auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const { owner, error } = await getAuthenticatedOwner(request);

  if (!owner) {
    return NextResponse.json({ error }, { status: 401 });
  }

  const { data, error: databaseError } = await supabaseAdmin
    .from('shifts')
    .select('*')
    .order('created_at', { ascending: false });

  if (databaseError) {
    return NextResponse.json(
      { error: 'Unable to load shift records.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ shifts: data ?? [] });
}
