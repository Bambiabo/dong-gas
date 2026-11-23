import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase service configuration.");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "weekly";
  const search = (url.searchParams.get("search") ?? "").trim();

  let query = admin
    .from("shifts")
    .select(
      "id,client_shift_id,supervisor_name,created_at,opening_meter,closing_meter,fuel_price,cash_collected,momo_collected,expenses",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  if (period === "weekly") {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", since);
  } else if (period === "monthly") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", since);
  }

  if (search) query = query.ilike("supervisor_name", `%${search}%`);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    truncated: Boolean(count && count > 5000),
    fetchedAt: new Date().toISOString(),
  });
}
