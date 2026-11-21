import { NextResponse } from 'next/server';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET() {
  const phone = process.env.OWNER_WHATSAPP?.replace(/[^0-9]/g, '');

  if (!phone) {
    return NextResponse.json({ error: 'Owner WhatsApp contact is not configured.' }, { status: 503, headers });
  }

  return NextResponse.json({ phone }, { headers });
}
