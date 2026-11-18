"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  FormEvent,
  ReactNode,
} from "react";

import { supabase } from "@/lib/supabase";

type Gate = "checking" | "login" | "mfa" | "dashboard";

type Period = "weekly" | "monthly" | "all";

type ResultFilter =
  | "all"
  | "balanced"
  | "shortage"
  | "overage"
  | "review";

type RawShift = Record<string, unknown>;

type Shift = {
  id: string;
  reference: string;
  supervisor: string;
  recordedAt: string;

  opening: number | null;
  closing: number | null;
  price: number | null;

  cash: number | null;
  momo: number | null;
  expenses: number | null;

  litres: number;
  expected: number;
  collections: number;
  accounted: number;
  variance: number;

  valid: boolean;
};

type Notice = {
  type: "info" | "success" | "error";
  text: string;
};

type Proof = {
  title: string;
  opening: string | null;
  closing: string | null;
};

type OwnerApiResponse = {
  error?: string;
  owner?: boolean;
  userId?: string;
  rows?: RawShift[];
  truncated?: boolean;
  fetchedAt?: string;
  opening?: string | null;
  closing?: string | null;
  ok?: boolean;
};

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-950/70 " +
  "px-4 py-3 text-base text-slate-100 outline-none transition " +
  "placeholder:text-slate-600 focus:border-amber-400/70 " +
  "focus:ring-4 focus:ring-amber-400/10 disabled:opacity-50";

const labelCls =
  "mb-2 block text-[10px] font-semibold uppercase " +
  "tracking-[0.15em] text-slate-400";

const buttonCls =
  "inline-flex min-h-11 items-center justify-center gap-2 " +
  "rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 " +
  "text-xs font-medium text-slate-200 transition " +
  "hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40";

const primaryCls =
  "inline-flex min-h-12 items-center justify-center rounded-xl " +
  "bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 " +
  "transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    return String(error.message);
  }

  return "The request could not be completed.";
}

function money(value: number): string {
  return (
    "GHS " +
    value.toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function volume(value: number): string {
  return value.toLocaleString("en-GH", {
    maximumFractionDigits: 3,
  });
}

function displayDate(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Accra",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function parseAmount(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const amount = Number(value);

  return Number.isFinite(amount) && amount >= 0
    ? amount
    : null;
}

function normalizeShift(raw: RawShift): Shift {
  const opening = parseAmount(raw.opening_meter);
  const closing = parseAmount(raw.closing_meter);
  const price = parseAmount(raw.fuel_price);

  const cash = parseAmount(raw.cash_collected);
  const momo = parseAmount(raw.momo_collected);
  const expenses = parseAmount(raw.expenses);

  const valid =
    opening !== null &&
    closing !== null &&
    closing >= opening &&
    price !== null &&
    price > 0 &&
    cash !== null &&
    momo !== null &&
    expenses !== null;

  const litres = valid ? closing! - opening! : 0;
  const expected = valid ? litres * price! : 0;
  const collections = valid ? cash! + momo! : 0;
  const accounted = valid ? collections + expenses! : 0;

  const id = String(raw.id ?? "");
  const clientId = String(raw.client_shift_id ?? "");

  return {
    id,
    reference: clientId
      ? `DG-${clientId.slice(0, 8).toUpperCase()}`
      : `SHIFT-${id || "UNKNOWN"}`,

    supervisor: String(
      raw.supervisor_name || "Not recorded"
    ),

    recordedAt: String(raw.created_at || ""),

    opening,
    closing,
    price,

    cash,
    momo,
    expenses,

    litres,
    expected,
    collections,
    accounted,
    variance: accounted - expected,

    valid,
  };
}

function resultLabel(shift: Shift): string {
  if (!shift.valid) return "Review";
  if (shift.variance < -0.005) return "Shortage";
  if (shift.variance > 0.005) return "Overage";
  return "Balanced";
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "rounded-2xl border border-slate-800 " +
        "bg-slate-900/70 p-5 " +
        "print:border-slate-300 print:bg-white " +
        className
      }
    >
      {children}
    </section>
  );
}

function StatusBadge({ shift }: { shift: Shift }) {
  return (
    <span
      className={
        "inline-flex rounded-full px-2.5 py-1 " +
        "text-[10px] font-semibold " +
        (!shift.valid || shift.variance < -0.005
          ? "bg-red-400/10 text-red-300"
          : shift.variance > 0.005
          ? "bg-amber-400/10 text-amber-300"
          : "bg-emerald-400/10 text-emerald-300")
      }
    >
      {resultLabel(shift)}
    </span>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-xs leading-5">
      <dt className="text-slate-400">{label}</dt>

      <dd className="max-w-[65%] break-words text-right font-medium">
        {value}
      </dd>
    </div>
  );
}

export default function OwnerDashboard() {
  const [gate, setGate] = useState<Gate>("checking");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [otp, setOtp] = useState("");

  const [notice, setNotice] = useState<Notice | null>(null);

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const [shifts, setShifts] = useState<Shift[]>([]);

  const [period, setPeriod] = useState<Period>("weekly");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const [resultFilter, setResultFilter] =
    useState<ResultFilter>("all");

  const [page, setPage] = useState(1);

  const [truncated, setTruncated] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const [panel, setPanel] =
    useState<"baseline" | "password" | null>(null);

  const [baseline, setBaseline] = useState("");
  const [baselineReason, setBaselineReason] = useState("");
  const [baselineConfirmation, setBaselineConfirmation] =
    useState("");

  const [actionOtp, setActionOtp] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [proof, setProof] = useState<Proof | null>(null);
  const [proofLoading, setProofLoading] =
    useState<string | null>(null);

  const activeRef = useRef(false);
  const ownerIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const actionLockRef = useRef(false);

  const lastActivityRef = useRef(Date.now());

  const proofDialogRef =
    useRef<HTMLDialogElement | null>(null);

  const notify = useCallback(
    (type: Notice["type"], text: string) => {
      setNotice({ type, text });
    },
    []
  );

  const clearPrivateState = useCallback(() => {
    activeRef.current = false;
    ownerIdRef.current = null;

    generationRef.current += 1;
    requestRef.current += 1;

    setShifts([]);
    setProof(null);
    setFetchedAt(null);
    setTruncated(false);

    setPassword("");
    setOtp("");
    setQrCode("");
    setSetupSecret("");
    setFactorId("");

    setPanel(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setActionOtp("");

    setGate("login");
  }, []);

  const lockPortal = useCallback(async () => {
    clearPrivateState();

    const { error } = await supabase.auth.signOut({
      scope: "local",
    });

    if (error) {
      notify(
        "error",
        "Dashboard hidden, but sign-out failed. Retry before leaving a shared device."
      );
    }
  }, [clearPrivateState, notify]);

  const ownerApi = useCallback(
    async (
      query = "",
      body?: Record<string, unknown>
    ): Promise<OwnerApiResponse> => {
      const { data, error } =
        await supabase.auth.getSession();

      if (error || !data.session) {
        throw new Error("Your session has expired. Sign in again.");
      }

      const controller = new AbortController();

      const timeout = window.setTimeout(
        () => controller.abort(),
        30000
      );

      try {
        const response = await fetch(
          `/api/owner-dashboard${query}`,
          {
            method: body ? "POST" : "GET",
            cache: "no-store",
            signal: controller.signal,

            headers: {
              Authorization:
                `Bearer ${data.session.access_token}`,

              ...(body
                ? { "Content-Type": "application/json" }
                : {}),
            },

            ...(body
              ? { body: JSON.stringify(body) }
              : {}),
          }
        );

        const result =
          (await response.json()) as OwnerApiResponse;

        if (!response.ok) {
          throw new Error(
            result.error || "The owner request failed."
          );
        }

        return result;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    []
  );

  const checkOwnerAccess = useCallback(async () => {
    const access = await ownerApi("?mode=access");

    if (!access.owner || !access.userId) {
      throw new Error("Owner access was not confirmed.");
    }

    ownerIdRef.current = access.userId;

    const {
      data: assurance,
      error: assuranceError,
    } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (assuranceError) throw assuranceError;

    const {
      data: factors,
      error: factorsError,
    } = await supabase.auth.mfa.listFactors();

    if (factorsError) throw factorsError;

    const verified = factors.totp.find(
      (factor) => factor.status === "verified"
    );

    setFactorId(verified?.id || "");

    if (assurance.currentLevel === "aal2") {
      activeRef.current = true;
      lastActivityRef.current = Date.now();

      setOtp("");
      setQrCode("");
      setSetupSecret("");
      setGate("dashboard");
    } else {
      activeRef.current = false;
      lastActivityRef.current = Date.now();

      setShifts([]);
      setGate("mfa");
    }
  }, [ownerApi]);

  useEffect(() => {
    let cancelled = false;

    try {
      localStorage.removeItem("owner_pin");
    } catch {
      // The old browser PIN is no longer used.
    }

    const initialize = async () => {
      const { data } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!data.user) {
        setGate("login");
        return;
      }

      setEmail(data.user.email || "");

      try {
        await checkOwnerAccess();
      } catch (error) {
        if (!cancelled) {
          clearPrivateState();
          notify("error", errorText(error));
        }
      }
    };

    void initialize().catch(() => {
      if (!cancelled) setGate("login");
    });

    const { data: subscription } =
      supabase.auth.onAuthStateChange(
        (event, session) => {
          if (
            event === "SIGNED_OUT" ||
            (
              ownerIdRef.current &&
              session &&
              session.user.id !== ownerIdRef.current
            )
          ) {
            clearPrivateState();
          }
        }
      );

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [checkOwnerAccess, clearPrivateState, notify]);

  useEffect(() => {
    if (gate !== "dashboard" && gate !== "mfa") return;

    const recordActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const checkIdle = () => {
      if (
        Date.now() - lastActivityRef.current >
        10 * 60 * 1000
      ) {
        void lockPortal();

        notify(
          "info",
          "You were signed out after 10 minutes of inactivity."
        );
      }
    };

    const checkVisibility = () => {
      if (document.visibilityState === "visible") {
        checkIdle();
      }
    };

    window.addEventListener(
      "pointerdown",
      recordActivity
    );

    window.addEventListener(
      "keydown",
      recordActivity
    );

    document.addEventListener(
      "visibilitychange",
      checkVisibility
    );

    const timer = window.setInterval(checkIdle, 15000);

    return () => {
      window.removeEventListener(
        "pointerdown",
        recordActivity
      );

      window.removeEventListener(
        "keydown",
        recordActivity
      );

      document.removeEventListener(
        "visibilitychange",
        checkVisibility
      );

      window.clearInterval(timer);
    };
  }, [gate, lockPortal, notify]);

  const fetchShifts = useCallback(async () => {
    if (!activeRef.current) return;

    const requestId = ++requestRef.current;
    const generation = generationRef.current;

    setLoading(true);

    try {
      const result = await ownerApi(
        `?period=${period}&search=${encodeURIComponent(
          appliedSearch
        )}`
      );

      if (
        !activeRef.current ||
        generation !== generationRef.current ||
        requestId !== requestRef.current
      ) {
        return;
      }

      setShifts(
        (result.rows || []).map(normalizeShift)
      );

      setTruncated(Boolean(result.truncated));
      setFetchedAt(result.fetchedAt || null);
      setPage(1);
    } catch (error) {
      if (
        generation === generationRef.current &&
        requestId === requestRef.current
      ) {
        setShifts([]);
        setFetchedAt(null);

        notify("error", errorText(error));
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, [ownerApi, period, appliedSearch, notify]);

  useEffect(() => {
    if (gate === "dashboard") {
      void fetchShifts();
    }
  }, [gate, fetchShifts]);

  useEffect(() => {
    if (!proof || !proofDialogRef.current) return;

    const dialog = proofDialogRef.current;

    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [proof]);

  const handleLogin = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (actionLockRef.current) return;

    actionLockRef.current = true;
    setBusy(true);
    setNotice(null);

    try {
      const { error } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (error) {
        throw new Error(
          "Sign-in failed. Check your credentials or try again later."
        );
      }

      setPassword("");
      await checkOwnerAccess();
    } catch (error) {
      await lockPortal();
      notify("error", errorText(error));
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const enrollAuthenticator = async () => {
    if (actionLockRef.current) return;

    actionLockRef.current = true;
    setBusy(true);

    try {
      const {
        data: factors,
        error: listError,
      } = await supabase.auth.mfa.listFactors();

      if (listError) throw listError;

      for (
        const factor of factors.totp.filter(
          (item) => item.status === "unverified"
        )
      ) {
        const { error } =
          await supabase.auth.mfa.unenroll({
            factorId: factor.id,
          });

        if (error) throw error;
      }

      const { data, error } =
        await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Dong Gas Owner",
        });

      if (error) throw error;

      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSetupSecret(data.totp.secret);
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const verifyCode = async (code: string) => {
    if (!factorId) {
      throw new Error(
        "Set up your authenticator before continuing."
      );
    }

    const { error } =
      await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });

    if (error) {
      throw new Error(
        "Authenticator code was not accepted. Check the code and your phone's time."
      );
    }
  };

  const handleMfa = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (actionLockRef.current) return;

    actionLockRef.current = true;
    setBusy(true);

    try {
      await verifyCode(otp);
      await checkOwnerAccess();
      setNotice(null);
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const handleBaseline = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (actionLockRef.current) return;

    const meter = Number(baseline);

    if (
      !baseline.trim() ||
      !Number.isFinite(meter) ||
      meter < 0 ||
      meter > 1e12 ||
      baselineReason.trim().length < 10 ||
      baselineConfirmation !== "RESET"
    ) {
      notify(
        "error",
        "Enter a valid baseline, a reason of at least 10 characters, and RESET confirmation."
      );
      return;
    }

    actionLockRef.current = true;
    setBusy(true);

    try {
      await verifyCode(actionOtp);

      await ownerApi("", {
        action: "baseline",
        meter,
        reason: baselineReason.trim(),
        confirmation: baselineConfirmation,
      });

      setPanel(null);
      setBaseline("");
      setBaselineReason("");
      setBaselineConfirmation("");
      setActionOtp("");

      notify(
        "success",
        "Baseline configuration saved and audited. Existing shifts and active supervisor workspaces were not changed."
      );
    } catch (error) {
      notify("error", errorText(error));
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const handlePasswordChange = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (actionLockRef.current) return;

    if (
      newPassword.length < 12 ||
      newPassword !== confirmPassword
    ) {
      notify(
        "error",
        "Use at least 12 characters and matching password confirmation."
      );
      return;
    }

    actionLockRef.current = true;
    setBusy(true);

    try {
      const { error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        });

      if (signInError) {
        throw new Error(
          "Current password was not accepted."
        );
      }

      await verifyCode(actionOtp);

      const { error } =
        await supabase.auth.updateUser({
          password: newPassword,
        });

      if (error) throw error;

      await lockPortal();

      notify(
        "success",
        "Password updated. Sign in again using your authenticator."
      );
    } catch (error) {
      await lockPortal();

      notify(
        "error",
        `${errorText(error)} Sign in again to continue.`
      );
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const openProof = async (shift: Shift) => {
    if (!shift.id) return;

    const generation = generationRef.current;

    setProofLoading(shift.id);

    try {
      const result = await ownerApi(
        `?mode=proof&id=${encodeURIComponent(shift.id)}`
      );

      if (
        activeRef.current &&
        generation === generationRef.current
      ) {
        setProof({
          title:
            `${shift.reference} — ${shift.supervisor}`,
          opening: result.opening || null,
          closing: result.closing || null,
        });
      }
    } catch (error) {
      if (activeRef.current) {
        notify("error", errorText(error));
      }
    } finally {
      setProofLoading(null);
    }
  };

  const filteredShifts = useMemo(
    () =>
      shifts.filter((shift) => {
        if (resultFilter === "all") return true;
        if (resultFilter === "review") return !shift.valid;
        if (!shift.valid) return false;

        if (resultFilter === "shortage") {
          return shift.variance < -0.005;
        }

        if (resultFilter === "overage") {
          return shift.variance > 0.005;
        }

        return Math.abs(shift.variance) <= 0.005;
      }),
    [shifts, resultFilter]
  );

  const totals = useMemo(
    () =>
      filteredShifts
        .filter((shift) => shift.valid)
        .reduce(
          (total, shift) => ({
            cash: total.cash + shift.cash!,
            momo: total.momo + shift.momo!,
            expenses:
              total.expenses + shift.expenses!,
            litres: total.litres + shift.litres,
            expected: total.expected + shift.expected,
            collections:
              total.collections + shift.collections,
            accounted:
              total.accounted + shift.accounted,
            variance: total.variance + shift.variance,
            shortages:
              total.shortages +
              Math.max(0, -shift.variance),
            overages:
              total.overages +
              Math.max(0, shift.variance),
          }),
          {
            cash: 0,
            momo: 0,
            expenses: 0,
            litres: 0,
            expected: 0,
            collections: 0,
            accounted: 0,
            variance: 0,
            shortages: 0,
            overages: 0,
          }
        ),
    [filteredShifts]
  );

  const invalidCount = filteredShifts.filter(
    (shift) => !shift.valid
  ).length;

  const pageCount = Math.max(
    1,
    Math.ceil(filteredShifts.length / 20)
  );

  const currentPage = Math.min(page, pageCount);

  const visibleShifts = filteredShifts.slice(
    (currentPage - 1) * 20,
    currentPage * 20
  );

  const periodLabel =
    period === "weekly"
      ? "Last 7 days"
      : period === "monthly"
      ? "Last 30 days"
      : "All time";

  const exportCsv = () => {
    const cell = (
      value: string | number | null
    ): string => {
      if (typeof value === "number") {
        return String(value);
      }

      const raw = value ?? "Not recorded";

      const safe =
        /^[\s]*[=+\-@\t\r]/.test(raw)
          ? "'" + raw
          : raw;

      return `"${safe.replace(/"/g, '""')}"`;
    };

    const table: (string | number | null)[][] = [
      [
        "Reference",
        "Recorded date (Ghana)",
        "Supervisor",
        "Opening L",
        "Closing L",
        "Price GHS/L",
        "Litres",
        "Expected GHS",
        "Cash GHS",
        "MoMo GHS",
        "Expenses GHS",
        "Collections GHS",
        "Accounted GHS",
        "Variance GHS",
        "Result",
      ],
    ];

    filteredShifts.forEach((shift) => {
      table.push([
        shift.reference,
        displayDate(shift.recordedAt),
        shift.supervisor,
        shift.opening,
        shift.closing,
        shift.price,
        shift.valid ? shift.litres : null,
        shift.valid ? shift.expected : null,
        shift.cash,
        shift.momo,
        shift.expenses,
        shift.valid ? shift.collections : null,
        shift.valid ? shift.accounted : null,
        shift.valid ? shift.variance : null,
        resultLabel(shift),
      ]);
    });

    const blob = new Blob(
      [
        "\ufeff" +
          table
            .map((row) => row.map(cell).join(","))
            .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      `Dong-Gas-Owner-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      10000
    );
  };

  const noticeElement = notice && (
    <div
      role={notice.type === "error" ? "alert" : "status"}
      className={
        "mb-5 flex items-start justify-between gap-3 " +
        "rounded-xl border p-4 text-xs leading-6 print:hidden " +
        (notice.type === "error"
          ? "border-red-400/20 bg-red-400/5 text-red-300"
          : notice.type === "success"
          ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
          : "border-slate-700 text-slate-300")
      }
    >
      <p>{notice.text}</p>

      <button
        type="button"
        onClick={() => setNotice(null)}
        className="shrink-0 px-2"
        aria-label="Dismiss message"
      >
        Close
      </button>
    </div>
  );

  if (gate !== "dashboard") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080d16] px-4 py-10 text-slate-100">
        <div className="w-full max-w-md">
          {noticeElement}

          <Card className="p-7 sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 font-black tracking-widest text-amber-300">
              DG
            </div>

            <p className="mt-5 text-center text-[9px] uppercase tracking-[0.24em] text-slate-500">
              Dong Gas · Owner workspace
            </p>

            <h1 className="mt-2 text-center text-2xl font-semibold">
              {gate === "checking"
                ? "Checking access"
                : gate === "login"
                ? "Owner sign-in"
                : "Two-factor verification"}
            </h1>

            <p className="mt-3 text-center text-xs leading-6 text-slate-400">
              {gate === "login"
                ? "Use your authorized owner account. The old browser PIN no longer grants access."
                : gate === "mfa"
                ? "An authenticator is required before financial records can be opened."
                : "Verifying your account and authorization."}
            </p>

            {gate === "login" && (
              <form
                onSubmit={handleLogin}
                className="mt-6 space-y-4"
              >
                <div>
                  <label
                    htmlFor="owner-email"
                    className={labelCls}
                  >
                    Email
                  </label>

                  <input
                    id="owner-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="owner-password"
                    className={labelCls}
                  >
                    Password
                  </label>

                  <input
                    id="owner-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <button
                  disabled={busy}
                  className={primaryCls + " w-full"}
                >
                  {busy ? "Signing in…" : "Continue"}
                </button>
              </form>
            )}

            {gate === "mfa" && (
              <div className="mt-6 space-y-4">
                {!factorId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void enrollAuthenticator()
                    }
                    className={primaryCls + " w-full"}
                  >
                    Set up authenticator
                  </button>
                )}

                {qrCode && (
                  <>
                    <p className="text-xs leading-6 text-slate-400">
                      Scan this QR code with your authenticator.
                      Keep the setup secret private.
                    </p>

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="Authenticator setup QR code"
                      src={
                        qrCode.startsWith("data:")
                          ? qrCode
                          : "data:image/svg+xml;charset=utf-8," +
                            encodeURIComponent(qrCode)
                      }
                      className="mx-auto h-52 w-52 rounded-xl bg-white p-3"
                    />

                    <details className="rounded-xl border border-slate-700 p-3">
                      <summary className="cursor-pointer text-xs text-slate-400">
                        Manual setup secret
                      </summary>

                      <p className="mt-3 break-all font-mono text-sm">
                        {setupSecret}
                      </p>
                    </details>
                  </>
                )}

                {factorId && (
                  <form
                    onSubmit={handleMfa}
                    className="space-y-4"
                  >
                    <div>
                      <label
                        htmlFor="owner-otp"
                        className={labelCls}
                      >
                        Six-digit authenticator code
                      </label>

                      <input
                        id="owner-otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        value={otp}
                        onChange={(event) =>
                          setOtp(
                            event.target.value.replace(
                              /\D/g,
                              ""
                            )
                          )
                        }
                        className={
                          inputCls +
                          " text-center tracking-[0.4em]"
                        }
                      />
                    </div>

                    <button
                      disabled={busy}
                      className={primaryCls + " w-full"}
                    >
                      {busy
                        ? "Verifying…"
                        : "Open owner dashboard"}
                    </button>
                  </form>
                )}

                <button
                  type="button"
                  onClick={() => void lockPortal()}
                  className={buttonCls + " w-full"}
                >
                  Sign out
                </button>
              </div>
            )}
          </Card>

          <p className="mt-4 text-center text-[10px] leading-5 text-slate-600">
            Owner access requires internet. Owner financial data
            is not intentionally stored for offline viewing.
          </p>
        </div>
      </main>
    );
  }

  const financialCards = [
    [
      "Actual collections",
      money(totals.collections),
      "Cash + MoMo; supervisor-declared",
    ],
    [
      "Cash collected",
      money(totals.cash),
      "Physical cash after shift expenses",
    ],
    [
      "MoMo collected",
      money(totals.momo),
      "Supervisor-declared mobile money",
    ],
    [
      "Shift expenses",
      money(totals.expenses),
      "Paid from shift takings",
    ],
    [
      "Expected sales",
      money(totals.expected),
      "Meter difference × recorded fuel price",
    ],
    [
      "Total accounted",
      money(totals.accounted),
      "Cash + MoMo + expenses",
    ],
    [
      "Volume dispensed",
      `${volume(totals.litres)} L`,
      "Valid closing minus opening readings",
    ],
    [
      "Net variance",
      `${totals.variance >= 0 ? "+" : "-"}${money(
        Math.abs(totals.variance)
      )}`,
      "Accounted minus expected",
    ],
  ];

  const renderTableRow = (
    shift: Shift,
    printOnly: boolean
  ) => (
    <tr
      key={`${printOnly ? "print-" : ""}${
        shift.id || shift.reference
      }`}
      className={
        printOnly
          ? "hidden print:table-row"
          : "hover:bg-white/[0.02] print:hidden"
      }
    >
      <td className="whitespace-nowrap px-4 py-4 text-slate-400">
        {displayDate(shift.recordedAt)}
      </td>

      <td className="px-4 py-4">
        <p className="font-medium">{shift.supervisor}</p>
        <p className="mt-1 text-[9px] text-slate-500">
          {shift.reference}
        </p>
      </td>

      <td className="px-4 py-4">
        {shift.valid ? volume(shift.litres) : "Review"}
      </td>

      <td className="px-4 py-4">
        {shift.valid ? money(shift.expected) : "Review"}
      </td>

      <td className="px-4 py-4">
        {shift.cash === null
          ? "Not recorded"
          : money(shift.cash)}
      </td>

      <td className="px-4 py-4">
        {shift.momo === null
          ? "Not recorded"
          : money(shift.momo)}
      </td>

      <td className="px-4 py-4">
        {shift.expenses === null
          ? "Not recorded"
          : money(shift.expenses)}
      </td>

      <td className="px-4 py-4">
        {shift.valid ? money(shift.collections) : "Review"}
      </td>

      <td className="px-4 py-4 font-semibold">
        {shift.valid ? money(shift.accounted) : "Review"}
      </td>

      <td className="px-4 py-4">
        {shift.valid
          ? `${shift.variance >= 0 ? "+" : "-"}${money(
              Math.abs(shift.variance)
            )}`
          : "Review"}
      </td>

      <td className="px-4 py-4">
        {printOnly ? (
          resultLabel(shift)
        ) : (
          <StatusBadge shift={shift} />
        )}
      </td>

      {!printOnly && (
        <td className="px-4 py-4 print:hidden">
          <button
            type="button"
            disabled={!shift.id || proofLoading !== null}
            onClick={() => void openProof(shift)}
            className={buttonCls}
          >
            {proofLoading === shift.id
              ? "Loading…"
              : "View photos"}
          </button>
        </td>
      )}
    </tr>
  );

  return (
    <main
      id="owner-dashboard"
      className="min-h-screen bg-[#080d16] px-4 py-6 text-slate-100 sm:px-6 lg:py-10 print:bg-white print:p-0 print:text-black"
    >
      <style>{`
        @media print {
          @page {
            size: landscape;
            margin: 10mm;
          }

          #owner-dashboard {
            color: #111 !important;
          }

          #owner-dashboard table {
            min-width: 0 !important;
            font-size: 8px;
          }

          #owner-dashboard td,
          #owner-dashboard th {
            padding: 5px !important;
            color: #111 !important;
          }

          #owner-dashboard p,
          #owner-dashboard span,
          #owner-dashboard h1,
          #owner-dashboard h2 {
            color: #111 !important;
          }
        }
      `}</style>

      <div className="mx-auto max-w-[1600px]">
        <header className="mb-6 flex flex-col justify-between gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-center">
          <div>
            <p className="text-[9px] uppercase tracking-[0.23em] text-amber-300">
              Dong Gas · Owner intelligence
            </p>

            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Financial overview
            </h1>

            <p className="mt-2 text-xs leading-6 text-slate-400">
              Collections, expenses and reconciliations in one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              disabled={loading}
              onClick={() => void fetchShifts()}
              className={buttonCls}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>

            <button
              disabled={loading || !filteredShifts.length}
              onClick={exportCsv}
              className={buttonCls}
            >
              Export CSV
            </button>

            <button
              disabled={loading}
              onClick={() => window.print()}
              className={buttonCls}
            >
              Print report
            </button>

            <button
              onClick={() => {
                setPanel(
                  panel === "baseline"
                    ? null
                    : "baseline"
                );
                setActionOtp("");
              }}
              className={buttonCls}
            >
              Baseline settings
            </button>

            <button
              onClick={() => {
                setPanel(
                  panel === "password"
                    ? null
                    : "password"
                );
                setActionOtp("");
              }}
              className={buttonCls}
            >
              Change password
            </button>

            <button
              onClick={() => void lockPortal()}
              className={buttonCls + " text-red-300"}
            >
              Sign out
            </button>
          </div>
        </header>

        {noticeElement}

        <div className="mb-5 flex flex-col justify-between gap-2 text-[10px] leading-5 text-slate-500 sm:flex-row">
          <p>
            {periodLabel} · Ghana time ·{" "}
            {filteredShifts.length} matching records
          </p>

          <p>
            {fetchedAt
              ? `Fetched ${displayDate(fetchedAt)}`
              : "Awaiting server data"}
          </p>
        </div>

        {panel && (
          <Card className="mb-5 print:hidden">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">
                {panel === "baseline"
                  ? "Main pump baseline configuration"
                  : "Change account password"}
              </h2>

              <button
                onClick={() => setPanel(null)}
                className={buttonCls}
              >
                Close
              </button>
            </div>

            {panel === "baseline" ? (
              <form
                onSubmit={handleBaseline}
                className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"
              >
                <p className="text-xs leading-6 text-slate-400 lg:col-span-2">
                  This changes the fallback configuration only.
                  Existing completed shifts take precedence.
                  Active and offline supervisor workspaces are not
                  overwritten. Do not use this to correct historical
                  shifts or handle a meter replacement.
                </p>

                <div>
                  <label
                    htmlFor="new-baseline"
                    className={labelCls}
                  >
                    New baseline · litres
                  </label>

                  <input
                    id="new-baseline"
                    type="number"
                    min="0"
                    max="1000000000000"
                    step="any"
                    required
                    value={baseline}
                    onChange={(event) =>
                      setBaseline(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="baseline-reason"
                    className={labelCls}
                  >
                    Reason · at least 10 characters
                  </label>

                  <input
                    id="baseline-reason"
                    minLength={10}
                    maxLength={500}
                    required
                    value={baselineReason}
                    onChange={(event) =>
                      setBaselineReason(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="baseline-confirmation"
                    className={labelCls}
                  >
                    Type RESET
                  </label>

                  <input
                    id="baseline-confirmation"
                    required
                    value={baselineConfirmation}
                    onChange={(event) =>
                      setBaselineConfirmation(
                        event.target.value
                      )
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="baseline-otp"
                    className={labelCls}
                  >
                    Fresh authenticator code
                  </label>

                  <input
                    id="baseline-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={actionOtp}
                    onChange={(event) =>
                      setActionOtp(
                        event.target.value.replace(/\D/g, "")
                      )
                    }
                    className={inputCls}
                  />
                </div>

                <button
                  disabled={busy}
                  className={primaryCls + " lg:col-span-2"}
                >
                  {busy
                    ? "Verifying and saving…"
                    : "Confirm audited baseline change"}
                </button>
              </form>
            ) : (
              <form
                onSubmit={handlePasswordChange}
                className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <div>
                  <label
                    htmlFor="current-password"
                    className={labelCls}
                  >
                    Current password
                  </label>

                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(event) =>
                      setCurrentPassword(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-password"
                    className={labelCls}
                  >
                    New password · 12+ characters
                  </label>

                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    value={newPassword}
                    onChange={(event) =>
                      setNewPassword(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm-password"
                    className={labelCls}
                  >
                    Confirm new password
                  </label>

                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    className={inputCls}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password-otp"
                    className={labelCls}
                  >
                    Fresh authenticator code
                  </label>

                  <input
                    id="password-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={actionOtp}
                    onChange={(event) =>
                      setActionOtp(
                        event.target.value.replace(/\D/g, "")
                      )
                    }
                    className={inputCls}
                  />
                </div>

                <button
                  disabled={busy}
                  className={primaryCls + " sm:col-span-2"}
                >
                  {busy
                    ? "Updating…"
                    : "Verify and update password"}
                </button>
              </form>
            )}
          </Card>
        )}

        <Card className="mb-5 print:hidden">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["weekly", "Last 7 days"],
                  ["monthly", "Last 30 days"],
                  ["all", "All time"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    setPeriod(value);
                    setPage(1);
                  }}
                  className={
                    buttonCls +
                    (period === value
                      ? " border-amber-400/50 text-amber-300"
                      : "")
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(search.trim());
              }}
              className="flex flex-1 gap-2 xl:max-w-lg"
            >
              <label
                htmlFor="owner-search"
                className="sr-only"
              >
                Search supervisor
              </label>

              <input
                id="owner-search"
                maxLength={120}
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search supervisor name"
                className={inputCls}
              />

              <button className={buttonCls}>
                Search
              </button>
            </form>

            <div>
              <label
                htmlFor="result-filter"
                className={labelCls}
              >
                Result
              </label>

              <select
                id="result-filter"
                value={resultFilter}
                onChange={(event) => {
                  setResultFilter(
                    event.target.value as ResultFilter
                  );
                  setPage(1);
                }}
                className={inputCls}
              >
                <option value="all">All results</option>
                <option value="balanced">Balanced</option>
                <option value="shortage">Shortages</option>
                <option value="overage">Overages</option>
                <option value="review">Needs review</option>
              </select>
            </div>
          </div>
        </Card>

        {truncated && (
          <p
            role="alert"
            className="mb-5 rounded-xl border border-amber-400/20 p-4 text-xs leading-6 text-amber-300"
          >
            Results are capped at the newest 5,000 matching
            records. Totals, CSV and printing cover only these
            returned records. Narrow the filters for a complete
            smaller result.
          </p>
        )}

        {invalidCount > 0 && (
          <p className="mb-5 rounded-xl border border-red-400/20 p-4 text-xs leading-6 text-red-300">
            {invalidCount} record(s) have missing or invalid
            financial inputs. They are marked Review and excluded
            from calculated totals.
          </p>
        )}

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {financialCards.map(
            ([label, value, description]) => (
              <Card key={label}>
                <p className={labelCls}>{label}</p>

                <p className="break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl">
                  {loading ? "Loading…" : value}
                </p>

                <p className="mt-2 text-[10px] leading-5 text-slate-500">
                  {description}
                </p>
              </Card>
            )
          )}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <p className={labelCls}>
              Shortages before offsetting
            </p>

            <p className="font-mono text-xl text-red-300">
              {money(totals.shortages)}
            </p>
          </Card>

          <Card>
            <p className={labelCls}>
              Overages before offsetting
            </p>

            <p className="font-mono text-xl text-amber-300">
              {money(totals.overages)}
            </p>
          </Card>
        </div>

        <p className="mb-5 text-[11px] leading-6 text-slate-500">
          Cash is reported after expenses paid from takings,
          excluding opening float and personal money. Total
          accounted = cash + MoMo + expenses. Dates below are
          database-recorded/upload times; an offline shift may
          have been worked earlier.
        </p>

        {loading ? (
          <Card>
            <p
              role="status"
              className="py-12 text-center text-sm text-slate-400"
            >
              Loading owner-authorized financial records…
            </p>
          </Card>
        ) : !filteredShifts.length ? (
          <Card>
            <h2 className="text-center font-semibold">
              No matching shifts
            </h2>

            <p className="mt-2 text-center text-xs text-slate-500">
              Try another period, supervisor name or result filter.
            </p>
          </Card>
        ) : (
          <>
            <div className="space-y-3 md:hidden print:hidden">
              {visibleShifts.map((shift) => (
                <Card key={shift.id || shift.reference}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {shift.supervisor}
                      </p>

                      <p className="mt-1 text-[10px] leading-5 text-slate-500">
                        {shift.reference}
                        <br />
                        {displayDate(shift.recordedAt)}
                      </p>
                    </div>

                    <StatusBadge shift={shift} />
                  </div>

                  <dl className="mt-3 divide-y divide-slate-800">
                    <DetailRow
                      label="Cash"
                      value={
                        shift.cash === null
                          ? "Not recorded"
                          : money(shift.cash)
                      }
                    />

                    <DetailRow
                      label="MoMo"
                      value={
                        shift.momo === null
                          ? "Not recorded"
                          : money(shift.momo)
                      }
                    />

                    <DetailRow
                      label="Expenses"
                      value={
                        shift.expenses === null
                          ? "Not recorded"
                          : money(shift.expenses)
                      }
                    />

                    <DetailRow
                      label="Expected"
                      value={
                        shift.valid
                          ? money(shift.expected)
                          : "Review required"
                      }
                    />

                    <DetailRow
                      label="Accounted"
                      value={
                        shift.valid
                          ? money(shift.accounted)
                          : "Review required"
                      }
                    />

                    <DetailRow
                      label="Variance"
                      value={
                        shift.valid
                          ? money(shift.variance)
                          : "Review required"
                      }
                    />
                  </dl>

                  <button
                    disabled={
                      !shift.id || proofLoading !== null
                    }
                    onClick={() => void openProof(shift)}
                    className={buttonCls + " mt-3 w-full"}
                  >
                    {proofLoading === shift.id
                      ? "Loading evidence…"
                      : "View meter evidence"}
                  </button>
                </Card>
              ))}
            </div>

            <section className="hidden overflow-hidden rounded-2xl border border-slate-800 md:block print:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1350px] text-left text-xs">
                  <caption className="sr-only">
                    Owner financial audit for {periodLabel}
                  </caption>

                  <thead className="bg-slate-900 text-[9px] uppercase tracking-wider text-slate-400">
                    <tr>
                      {[
                        "Recorded date",
                        "Supervisor / reference",
                        "Litres",
                        "Expected",
                        "Cash",
                        "MoMo",
                        "Expenses",
                        "Cash + MoMo",
                        "Accounted",
                        "Variance",
                        "Result",
                        "Evidence",
                      ].map((heading) => (
                        <th
                          key={heading}
                          className={
                            "px-4 py-4 " +
                            (heading === "Evidence"
                              ? "print:hidden"
                              : "")
                          }
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-800">
                    {visibleShifts.map((shift) =>
                      renderTableRow(shift, false)
                    )}

                    {filteredShifts.map((shift) =>
                      renderTableRow(shift, true)
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <p className="text-xs text-slate-500">
                Page {currentPage} of {pageCount} ·{" "}
                {filteredShifts.length} records
              </p>

              <div className="flex gap-2">
                <button
                  disabled={currentPage <= 1}
                  onClick={() =>
                    setPage((value) => Math.max(1, value - 1))
                  }
                  className={buttonCls}
                >
                  Previous
                </button>

                <button
                  disabled={currentPage >= pageCount}
                  onClick={() =>
                    setPage((value) =>
                      Math.min(pageCount, value + 1)
                    )
                  }
                  className={buttonCls}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        <footer className="mt-8 border-t border-slate-800 pt-5 text-[10px] leading-6 text-slate-600">
          <p>
            Dong Gas · Owner dashboard · Authenticator verification
            and server-side owner authorization
          </p>

          <p>
            Exported reports contain confidential information.
            Store them securely.
          </p>
        </footer>

        <dialog
          ref={proofDialogRef}
          onCancel={(event) => {
            event.preventDefault();
            setProof(null);
          }}
          className="max-h-[90vh] w-[min(95vw,900px)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 text-white backdrop:bg-black/80 print:hidden"
        >
          {proof && (
            <>
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    Meter evidence
                  </h2>

                  <p className="mt-1 text-xs text-slate-400">
                    {proof.title}
                  </p>
                </div>

                <button
                  autoFocus
                  onClick={() => setProof(null)}
                  className={buttonCls}
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(
                  [
                    ["Opening meter", proof.opening],
                    ["Closing meter", proof.closing],
                  ] as const
                ).map(([label, image]) => (
                  <section key={label}>
                    <h3 className="mb-2 text-xs text-slate-400">
                      {label}
                    </h3>

                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt={`${label} photo evidence`}
                        referrerPolicy="no-referrer"
                        className="max-h-[65vh] w-full rounded-xl bg-black object-contain"
                      />
                    ) : (
                      <p className="rounded-xl border border-slate-800 p-6 text-xs text-slate-500">
                        No supported photo recorded.
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </dialog>
      </div>
    </main>
  );
}