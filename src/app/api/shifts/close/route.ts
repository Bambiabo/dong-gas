import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize privileged Supabase client for atomic shift reconciliation
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type FuelGrade = 'PMS' | 'AGO' | 'LPG';

interface PumpReadingPayload {
  pumpId: string;
  pumpLabel: string;
  grade: FuelGrade;
  openingTotalizer: number;
  closingTotalizer: number;
  rttLiters: number; // Return-To-Tank pump calibration liters
  photoUrl: string;  // Mandatory live photo proof URL in Supabase Storage
  photoCapturedAt?: string;
  photoGpsCoords?: string;
  segmentTimestamp?: string; // Used to fetch exact NPA historical price active at dispense time
}

interface TankDipPayload {
  tankCode: string;
  grade: FuelGrade;
  openingDipLiters: number;
  waybillDeliveryLiters: number;
  closingDipLiters: number;
  closingDipPhotoUrl: string;
}

interface CloseShiftRequest {
  stationId: string;
  shiftId?: string; // Optional if creating & closing an offline-originated shift
  offlineSyncId: string; // Idempotency key generated on the Android device
  shiftLabel: string;
  supervisorName: string;
  attendantNames: string[];
  openedAt: string;
  closedAt: string;
  pumpReadings: PumpReadingPayload[];
  tankDips?: TankDipPayload[];
  collections: {
    physicalCashGhs: number;
    momoGhs: number; // MTN MoMo + Telecel Cash
    posCardGhs: number;
    corporateCreditLpoGhs: number;
    lpoReferenceNumbers?: string[];
  };
  notes?: string;
}

/**
 * Formats currency cleanly in Ghana Cedis (GH₵)
 */
function formatGHS(amount: number): string {
  const absFormatted = Math.abs(amount).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-GH₵ ${absFormatted}` : `GH₵ ${absFormatted}`;
}

/**
 * Normalizes Ghanaian phone numbers to 233XXXXXXXXX format required by Arkesel
 */
function normalizeGhanaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

/**
 * Dispatches instant Shift Reconciliation SMS via Arkesel V2 API
 */
async function sendOwnerArkeselAlert(
  ownerPhone: string,
  message: string
): Promise<{ success: boolean; raw: unknown }> {
  const apiKey = process.env.ARKESEL_API_KEY;
  const senderId = process.env.ARKESEL_SENDER_ID || 'DongGas';

  if (!apiKey) {
    console.error('[DongGas Alert] Missing ARKESEL_API_KEY in environment.');
    return { success: false, raw: { error: 'Missing ARKESEL_API_KEY' } };
  }

  try {
    const response = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: senderId,
        message,
        recipients: [normalizeGhanaPhone(ownerPhone)],
      }),
    });

    const data = await response.json();
    return {
      success: response.ok && data?.status === 'success',
      raw: data,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown network error';
    console.error('[DongGas Alert] Arkesel SMS dispatch failed:', errorMessage);
    return { success: false, raw: { error: errorMessage } };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CloseShiftRequest;

    // 1. BASIC PAYLOAD VALIDATION
    if (!body.stationId || !body.offlineSyncId || !body.pumpReadings?.length) {
      return NextResponse.json(
        { error: 'Missing required stationId, offlineSyncId, or pumpReadings.' },
        { status: 400 }
      );
    }

    // 2. IDEMPOTENCY CHECK (Protects against double-sync when MTN/Telecel data reconnects)
    const { data: existingShift } = await supabaseAdmin
      .from('shifts')
      .select('id, status')
      .eq('offline_sync_id', body.offlineSyncId)
      .maybeSingle();

    if (existingShift && existingShift.status === 'CLOSED') {
      const { data: existingCol } = await supabaseAdmin
        .from('shift_collections')
        .select('*')
        .eq('shift_id', existingShift.id)
        .single();

      return NextResponse.json({
        message: 'Shift already reconciled (idempotent replay).',
        shiftId: existingShift.id,
        reconciliation: existingCol,
      });
    }

    // 3. FETCH STATION CONFIGURATION & OWNER CONTACT
    const { data: station, error: stationErr } = await supabaseAdmin
      .from('stations')
      .select('*')
      .eq('id', body.stationId)
      .single();

    if (stationErr || !station) {
      return NextResponse.json({ error: 'Station not found.' }, { status: 404 });
    }

    // 4. VALIDATE ALL PUMP READINGS & PHOTO PROOFS BEFORE WRITING
    for (const reading of body.pumpReadings) {
      if (!reading.photoUrl || reading.photoUrl.trim().length < 10) {
        return NextResponse.json(
          {
            error: `PHOTO PROOF REJECTED: Missing mandatory totalizer photo for ${reading.pumpLabel}.`,
          },
          { status: 422 }
        );
      }

      if (Number(reading.closingTotalizer) < Number(reading.openingTotalizer)) {
        return NextResponse.json(
          {
            error: `METER TAMPER ALERT: Closing reading (${reading.closingTotalizer}) cannot be less than Opening reading (${reading.openingTotalizer}) on ${reading.pumpLabel}.`,
          },
          { status: 422 }
        );
      }

      const grossLiters = reading.closingTotalizer - reading.openingTotalizer;
      if (reading.rttLiters < 0 || reading.rttLiters > grossLiters) {
        return NextResponse.json(
          {
            error: `INVALID RTT: Return-To-Tank liters (${reading.rttLiters}L) cannot exceed gross dispensed liters (${grossLiters.toFixed(2)}L) on ${reading.pumpLabel}.`,
          },
          { status: 422 }
        );
      }
    }

    // 5. RESOLVE HISTORICAL NPA FUEL PRICES & COMPUTE EXPECTED REVENUE
    let totalExpectedGhs = 0;
    const volumeByGrade: Record<FuelGrade, number> = { PMS: 0, AGO: 0, LPG: 0 };
    const enrichedReadings = [];

    for (const reading of body.pumpReadings) {
      const lookupTime = reading.segmentTimestamp || body.closedAt || new Date().toISOString();

      // Fetch the exact NPA price effective at the time of dispensing
      const { data: priceRow, error: priceErr } = await supabaseAdmin
        .from('fuel_prices')
        .select('price_per_liter_ghs')
        .eq('station_id', body.stationId)
        .eq('grade', reading.grade)
        .lte('effective_from', lookupTime)
        .or(`effective_to.is.null,effective_to.gt.${lookupTime}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single();

      if (priceErr || !priceRow) {
        return NextResponse.json(
          { error: `No active NPA fuel price configured for grade ${reading.grade}.` },
          { status: 400 }
        );
      }

      const appliedPrice = Number(priceRow.price_per_liter_ghs);
      const netLiters = Number(
        (reading.closingTotalizer - reading.openingTotalizer - reading.rttLiters).toFixed(3)
      );
      const expectedGhs = Number((netLiters * appliedPrice).toFixed(2));

      totalExpectedGhs = Number((totalExpectedGhs + expectedGhs).toFixed(2));
      volumeByGrade[reading.grade] = Number((volumeByGrade[reading.grade] + netLiters).toFixed(2));

      enrichedReadings.push({
        ...reading,
        appliedPrice,
        netLiters,
        expectedGhs,
      });
    }

    // 6. RECONCILE GHANA PAYMENT CHANNELS & CHECK VARIANCE THRESHOLD
    const cash = Number(body.collections.physicalCashGhs || 0);
    const momo = Number(body.collections.momoGhs || 0);
    const card = Number(body.collections.posCardGhs || 0);
    const lpo = Number(body.collections.corporateCreditLpoGhs || 0);

    const totalCollectedGhs = Number((cash + momo + card + lpo).toFixed(2));
    // Positive variance = SHORTAGE; Negative variance = OVERAGE
    const varianceGhs = Number((totalExpectedGhs - totalCollectedGhs).toFixed(2));
    const thresholdGhs = Number(station.shortage_threshold_ghs ?? 20.0);
    const isFlagged = varianceGhs > thresholdGhs;

    // 7. PERSIST SHIFT, READINGS, COLLECTIONS & UPDATE PUMP TOTALIZERS
    const { data: shiftRecord, error: shiftInsertErr } = await supabaseAdmin
      .from('shifts')
      .upsert(
        {
          id: body.shiftId,
          station_id: body.stationId,
          shift_label: body.shiftLabel,
          supervisor_name: body.supervisorName,
          attendant_names: body.attendantNames,
          status: 'CLOSED',
          opened_at: body.openedAt,
          closed_at: body.closedAt || new Date().toISOString(),
          offline_sync_id: body.offlineSyncId,
          notes: body.notes || null,
        },
        { onConflict: 'offline_sync_id' }
      )
      .select()
      .single();

    if (shiftInsertErr || !shiftRecord) {
      throw new Error(`Failed to persist shift record: ${shiftInsertErr?.message}`);
    }

    // Insert pump readings with mandatory photo proofs
    const readingRows = enrichedReadings.map((r) => ({
      shift_id: shiftRecord.id,
      pump_id: r.pumpId,
      grade: r.grade,
      opening_totalizer: r.openingTotalizer,
      closing_totalizer: r.closingTotalizer,
      rtt_liters: r.rttLiters,
      applied_price_ghs: r.appliedPrice,
      closing_photo_url: r.photoUrl,
      photo_captured_at: r.photoCapturedAt || new Date().toISOString(),
      photo_gps_coords: r.photoGpsCoords || null,
    }));

    const { error: readingsErr } = await supabaseAdmin.from('pump_readings').insert(readingRows);
    if (readingsErr) {
      throw new Error(`Failed to save pump readings: ${readingsErr.message}`);
    }

    // Advance pump master totalizers
    for (const r of enrichedReadings) {
      await supabaseAdmin
        .from('pumps')
        .update({ current_totalizer: r.closingTotalizer })
        .eq('id', r.pumpId);
    }

    // Save tank dips if submitted
    if (body.tankDips && body.tankDips.length > 0) {
      const dipRows = body.tankDips.map((d) => ({
        shift_id: shiftRecord.id,
        station_id: body.stationId,
        tank_code: d.tankCode,
        grade: d.grade,
        opening_dip_liters: d.openingDipLiters,
        waybill_delivery_liters: d.waybillDeliveryLiters,
        closing_dip_liters: d.closingDipLiters,
        closing_dip_photo_url: d.closingDipPhotoUrl,
      }));
      await supabaseAdmin.from('tank_dips').insert(dipRows);
    }

    // 8. COMPOSE & SEND INSTANT OWNER SMS ALERT (ARKESEL)
    const statusHeader = isFlagged
      ? `🚨 SHORTAGE ALERT (${station.code})`
      : `✅ SHIFT CLOSED (${station.code})`;

    const varianceLine =
      varianceGhs > 0
        ? `SHORTAGE: ${formatGHS(varianceGhs)} ${isFlagged ? '[FLAGGED]' : '[WITHIN LIMIT]'}`
        : varianceGhs < 0
        ? `OVERAGE: ${formatGHS(Math.abs(varianceGhs))}`
        : `VARIANCE: GH₵ 0.00 (EXACT)`;

    const smsBody = [
      statusHeader,
      `Station: ${station.name}`,
      `Shift: ${body.shiftLabel} | Sup: ${body.supervisorName}`,
      `Vol: PMS ${volumeByGrade.PMS}L | AGO ${volumeByGrade.AGO}L | LPG ${volumeByGrade.LPG}kg`,
      `Expected: ${formatGHS(totalExpectedGhs)}`,
      `Collected: ${formatGHS(totalCollectedGhs)} (Cash ${formatGHS(cash)}, MoMo ${formatGHS(momo)}, POS ${formatGHS(card)}, LPO ${formatGHS(lpo)})`,
      varianceLine,
    ].join('\n');

    const smsResult = await sendOwnerArkeselAlert(station.owner_phone, smsBody);

    // 9. SAVE RECONCILIATION LEDGER
    const { data: collectionRecord, error: colErr } = await supabaseAdmin
      .from('shift_collections')
      .insert({
        shift_id: shiftRecord.id,
        station_id: body.stationId,
        physical_cash_ghs: cash,
        momo_ghs: momo,
        pos_card_ghs: card,
        corporate_credit_lpo_ghs: lpo,
        lpo_reference_numbers: body.collections.lpoReferenceNumbers || [],
        total_expected_ghs: totalExpectedGhs,
        threshold_applied_ghs: thresholdGhs,
        is_flagged: isFlagged,
        sms_alert_sent: smsResult.success,
        sms_provider_response: smsResult.raw,
      })
      .select()
      .single();

    if (colErr) {
      throw new Error(`Failed to record shift collections: ${colErr.message}`);
    }

    return NextResponse.json({
      success: true,
      shiftId: shiftRecord.id,
      reconciliation: {
        totalExpectedGhs,
        totalCollectedGhs,
        varianceGhs,
        isFlagged,
        thresholdGhs,
        volumeByGrade,
        smsAlertSent: smsResult.success,
        record: collectionRecord,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[POST /api/shifts/close] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}