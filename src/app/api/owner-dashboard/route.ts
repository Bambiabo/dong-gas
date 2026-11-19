import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createClient } from "@supabase/supabase-js";



const MAX_ROWS = 5000;

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};

class OwnerAccessError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

type VerifiedClaims = {
  aal?: string;
  amr?: {
    method?: string;
    timestamp?: number;
  }[];
};

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new OwnerAccessError(
      "The owner API is not configured. Contact the administrator.",
      503
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },

    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
        }),
    },
  });
}

async function authorizeOwner(
  request: NextRequest,
  requireMfa = true
) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/i)?.[1];

  if (!token || token.length > 16000) {
    throw new OwnerAccessError(
      "Sign in to continue.",
      401
    );
  }

  const admin = createAdminClient();

  // The exact supplied token is verified by Supabase before
  // its claims are used for authorization.
  const { data, error } =
    await admin.auth.getUser(token);

  if (error || !data.user) {
    throw new OwnerAccessError(
      "Your session has expired. Sign in again.",
      401
    );
  }

  const ownerIds = (
    process.env.OWNER_USER_IDS || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!ownerIds.length) {
    throw new OwnerAccessError(
      "The owner allowlist has not been configured.",
      503
    );
  }

  if (!ownerIds.includes(data.user.id)) {
    throw new OwnerAccessError(
      "This account is not authorized for the owner portal.",
      403
    );
  }

  let claims: VerifiedClaims;

  try {
    claims = JSON.parse(
      Buffer.from(
        token.split(".")[1],
        "base64url"
      ).toString("utf8")
    ) as VerifiedClaims;
  } catch {
    throw new OwnerAccessError(
      "Invalid session token.",
      401
    );
  }

  if (requireMfa && claims.aal !== "aal2") {
    throw new OwnerAccessError(
      "Two-factor verification is required.",
      403
    );
  }

  return {
    admin,
    user: data.user,
    claims,
  };
}

function handleError(error: unknown) {
  if (error instanceof OwnerAccessError) {
    return NextResponse.json(
      { error: error.message },
      {
        status: error.status,
        headers: responseHeaders,
      }
    );
  }

  console.error("Owner dashboard API error:", error);

  return NextResponse.json(
    {
      error:
        "The owner request could not be completed. " +
        "Check the server logs and database migration.",
    },
    {
      status: 500,
      headers: responseHeaders,
    }
  );
}

function safeImage(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 6_000_000
  ) {
    return null;
  }

  if (
    /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(
      value
    )
  ) {
    return value;
  }

  try {
    const image = new URL(value);

    const project = new URL(
      process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    );

    if (
      image.protocol === "https:" &&
      image.origin === project.origin &&
      image.pathname.startsWith(
        "/storage/v1/object/"
      )
    ) {
      return image.href;
    }
  } catch {
    // Reject unsupported schemes and external image hosts.
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const mode =
      request.nextUrl.searchParams.get("mode") ||
      "shifts";

    const { admin, user } =
      await authorizeOwner(
        request,
        mode !== "access"
      );

    // This confirms owner eligibility without returning
    // financial records before MFA has been completed.
    if (mode === "access") {
      return NextResponse.json(
        {
          owner: true,
          userId: user.id,
          mfaRequired: true,
        },
        { headers: responseHeaders }
      );
    }

    if (mode === "proof") {
      const id =
        request.nextUrl.searchParams.get("id");

      if (!id || id.length > 128) {
        throw new OwnerAccessError(
          "A valid shift ID is required.",
          400
        );
      }

      const { data, error } = await admin
        .from("shifts")
        .select(
          "id,opening_proof_image,proof_image"
        )
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        throw new OwnerAccessError(
          "The shift was not found.",
          404
        );
      }

      return NextResponse.json(
        {
          opening: safeImage(
            data.opening_proof_image
          ),
          closing: safeImage(data.proof_image),
        },
        { headers: responseHeaders }
      );
    }

    if (mode !== "shifts") {
      throw new OwnerAccessError(
        "Unknown owner request.",
        400
      );
    }

    const period =
      request.nextUrl.searchParams.get("period") ||
      "weekly";

    if (
      !["weekly", "monthly", "all"].includes(
        period
      )
    ) {
      throw new OwnerAccessError(
        "Invalid date filter.",
        400
      );
    }

    const search = (
      request.nextUrl.searchParams.get(
        "search"
      ) || ""
    )
      .trim()
      .slice(0, 120);

    const from = new Date();

    from.setUTCHours(0, 0, 0, 0);

    from.setUTCDate(
      from.getUTCDate() -
        (period === "monthly" ? 29 : 6)
    );

    const rows: Record<string, unknown>[] = [];

    for (
      let offset = 0;
      offset <= MAX_ROWS;
      offset += 500
    ) {
      let query = admin
        .from("shifts")
        .select(
          [
            "id",
            "client_shift_id",
            "created_at",
            "supervisor_name",
            "opening_meter",
            "closing_meter",
            "fuel_price",
            "cash_collected",
            "momo_collected",
            "expenses",
          ].join(",")
        )
        .order("created_at", {
          ascending: false,
        })
        .order("id", {
          ascending: false,
        });

      if (period !== "all") {
        query = query.gte(
          "created_at",
          from.toISOString()
        );
      }

      if (search) {
        const escaped = search.replace(
          /[\\%_]/g,
          "\\$&"
        );

        query = query.ilike(
          "supervisor_name",
          `%${escaped}%`
        );
      }

      const { data, error } =
        await query.range(
          offset,
          offset + 499
        );

      if (error) throw error;

      rows.push(
        ...((data || []) as unknown as Record<
          string,
          unknown
        >[])
      );

      if (
        !data ||
        data.length < 500 ||
        rows.length > MAX_ROWS
      ) {
        break;
      }
    }

    return NextResponse.json(
      {
        rows: rows.slice(0, MAX_ROWS),
        truncated: rows.length > MAX_ROWS,
        limit: MAX_ROWS,
        fetchedAt: new Date().toISOString(),
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: NextRequest
) {
  try {
    const origin =
      request.headers.get("origin");

    if (
      !origin ||
      origin !== request.nextUrl.origin
    ) {
      throw new OwnerAccessError(
        "This request must originate from the owner portal.",
        403
      );
    }

    const { admin, user, claims } =
      await authorizeOwner(request);

    const text = await request.text();

    if (text.length > 4096) {
      throw new OwnerAccessError(
        "Request is too large.",
        413
      );
    }

    let body: {
      action?: string;
      meter?: unknown;
      reason?: unknown;
      confirmation?: string;
    };

    try {
      body = JSON.parse(text);
    } catch {
      throw new OwnerAccessError(
        "Invalid request body.",
        400
      );
    }

    if (body.action !== "baseline") {
      throw new OwnerAccessError(
        "Unknown owner action.",
        400
      );
    }

    const now = Date.now() / 1000;

    const recentTotp = (
      Array.isArray(claims.amr)
        ? claims.amr
        : []
    ).some(
      (entry) =>
        entry.method === "totp" &&
        typeof entry.timestamp === "number" &&
        now - entry.timestamp >= 0 &&
        now - entry.timestamp <= 300
    );

    if (!recentTotp) {
      throw new OwnerAccessError(
        "Verify a fresh authenticator code before changing the baseline.",
        403
      );
    }

    const meter =
      typeof body.meter === "number"
        ? body.meter
        : NaN;

    const reason =
      typeof body.reason === "string"
        ? body.reason.trim()
        : "";

    if (
      !Number.isFinite(meter) ||
      meter < 0 ||
      meter > 1e12 ||
      reason.length < 10 ||
      reason.length > 500 ||
      body.confirmation !== "RESET"
    ) {
      throw new OwnerAccessError(
        "Enter a valid baseline, a reason of 10â€“500 characters, and RESET confirmation.",
        400
      );
    }

    const { data, error } =
      await admin.rpc(
        "owner_set_main_baseline",
        {
          p_meter: meter,
          p_actor: user.id,
          p_reason: reason,
        }
      );

    if (error) throw error;

    return NextResponse.json(
      {
        ok: true,
        result: data,
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    return handleError(error);
  }
}