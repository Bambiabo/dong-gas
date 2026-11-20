import { NextResponse } from 'next/server';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST() {
  return NextResponse.json(
    { error: 'Baseline correction is temporarily disabled.' },
    { status: 403, headers },
  );
}
