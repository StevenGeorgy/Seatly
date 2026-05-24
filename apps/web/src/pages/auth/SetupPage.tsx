import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { PreviewAsDinerButton } from "@/components/onboarding/PreviewAsDinerButton";
import { Step1Basics, type Step1Result } from "@/components/onboarding/Step1Basics";
import { Step2Hours } from "@/components/onboarding/Step2Hours";
import { Step3FloorPlan } from "@/components/onboarding/Step3FloorPlan";
import { Step4BookingRules } from "@/components/onboarding/Step4BookingRules";
import { Step5Menu } from "@/components/onboarding/Step5Menu";
import { Step6Photos } from "@/components/onboarding/Step6Photos";
import { Step7DepositPolicy } from "@/components/onboarding/Step7DepositPolicy";
import { Step8PaymentSetup } from "@/components/onboarding/Step8PaymentSetup";
import { WizardShell } from "@/components/onboarding/WizardShell";
import {
  STARTER_TABLES,
  WIZARD_TOTAL_STEPS,
  type HoursJson,
  type WizardBasics,
  type WizardShift,
  type WizardTable,
} from "@/components/onboarding/wizardTypes";
import type { RestaurantDepositTier } from "@/hooks/useStaffRestaurants";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type WizardState = {
  restaurantId: string | null;
  basics: WizardBasics | null;
  hours: HoursJson | null;
  tables: WizardTable[] | null;
  shift: WizardShift | null;
  /** Brand primary color the owner picked on Step 6. Null until they
   *  reach Step 6 — the preview modal then falls back to its default. */
  themeColor: string | null;
};

const INITIAL_STATE: WizardState = {
  restaurantId: null,
  basics: null,
  hours: null,
  tables: null,
  shift: null,
  themeColor: null,
};

// SessionStorage snapshot — survives tab discards / reloads within the same
// tab. Prevents the wizard from (a) losing cross-step state and (b) jumping
// to a "furthest completed" step that doesn't match where the owner was
// actually working. NOT a substitute for per-step input drafts: mid-step
// edits that haven't hit Continue still live in step-component state and
// will be lost if the tab unloads.
const SNAPSHOT_KEY = "cenaiva.wizard.v1";
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type WizardSnapshot = {
  v: 1;
  step: number;
  state: WizardState;
  ts: number;
};

function readSnapshot(): WizardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardSnapshot;
    if (parsed.v !== 1) return null;
    if (typeof parsed.step !== "number" || parsed.step < 1 || parsed.step > WIZARD_TOTAL_STEPS) return null;
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: Omit<WizardSnapshot, "v" | "ts">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: WizardSnapshot = { v: 1, ts: Date.now(), ...snap };
    window.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can throw (private mode quota, disabled storage) — fail silently.
  }
}

function clearSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* noop */
  }
}

type ResumeResult = {
  state: WizardState;
  startAtStep: number;
};

type LoadResumeOptions = {
  /**
   * If provided, target this specific unpublished restaurant instead of
   * picking the most recent one. Returns null if the user doesn't own it
   * or if it's already published — caller should redirect to /drafts.
   */
  targetRestaurantId?: string | null;
};

async function loadInProgressRestaurant(
  userProfileId: string | null,
  options: LoadResumeOptions = {},
): Promise<ResumeResult | null> {
  if (!userProfileId) return null;
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data: roleRows } = await client
    .from("user_restaurant_roles")
    .select("restaurant_id")
    .eq("user_id", userProfileId);
  const restaurantIds = (roleRows ?? [])
    .map((r) => (r as { restaurant_id: string | null }).restaurant_id)
    .filter((id): id is string => Boolean(id));
  if (restaurantIds.length === 0) return null;

  // When targeting a specific restaurant, narrow restaurantIds to just that
  // one — if it's not in the user's owned set, the query returns nothing and
  // the caller redirects to /drafts.
  const idsForQuery = options.targetRestaurantId
    ? restaurantIds.filter((id) => id === options.targetRestaurantId)
    : restaurantIds;
  if (idsForQuery.length === 0) return null;

  const { data: restaurants } = await client
    .from("restaurants")
    .select(
      "id, name, address, city, province, country, lat, lng, phone, description, cuisine_type, business_type, hours_json, accepts_walkins, settings_json, is_published, cover_photo_url, deposit_tiers",
    )
    .in("id", idsForQuery)
    .eq("is_published", false)
    .order("created_at", { ascending: false })
    .limit(1);

  const restaurant = (restaurants ?? [])[0] as
    | {
        id: string;
        name: string | null;
        address: string | null;
        city: string | null;
        province: string | null;
        country: string | null;
        lat: number | null;
        lng: number | null;
        phone: string | null;
        description: string | null;
        cuisine_type: string | null;
        business_type: string | null;
        hours_json: HoursJson | null;
        accepts_walkins: boolean | null;
        settings_json: {
          dietaryTags?: string[];
          theme?: { primaryColor?: string };
        } | null;
        cover_photo_url: string | null;
        deposit_tiers: RestaurantDepositTier[] | null;
      }
    | undefined;
  if (!restaurant) return null;

  const [{ data: tableRows }, { data: shiftRows }, { data: tierCategoryRow }] = await Promise.all([
    client
      .from("tables")
      .select("id, label, table_number, capacity, shape")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true),
    client
      .from("shifts")
      .select("id, name")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true)
      .limit(1),
    client
      .from("menu_categories")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true)
      .eq("is_pricing_tier_source", true)
      .maybeSingle(),
  ]);

  let tierItemCount = 0;
  if (tierCategoryRow) {
    const { count } = await client
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurant.id)
      .eq("category_id", (tierCategoryRow as { id: string }).id)
      .eq("is_active", true);
    tierItemCount = count ?? 0;
  }

  const basics: WizardBasics = {
    restaurantName: restaurant.name ?? "",
    address: restaurant.address ?? "",
    city: restaurant.city ?? "",
    province: restaurant.province ?? "",
    country: restaurant.country ?? "Canada",
    postalCode: "",
    lat: restaurant.lat ?? null,
    lng: restaurant.lng ?? null,
    businessType: restaurant.business_type ?? "Restaurant",
    cuisineType: restaurant.cuisine_type ?? "",
    phone: restaurant.phone ?? "",
    description: restaurant.description ?? "",
    acceptsWalkins: restaurant.accepts_walkins ?? true,
    dietaryTags: Array.isArray(restaurant.settings_json?.dietaryTags)
      ? (restaurant.settings_json!.dietaryTags as WizardBasics["dietaryTags"])
      : [],
  };

  const hours = (restaurant.hours_json as HoursJson | null) ?? null;
  const hasHours = hours !== null && Object.values(hours).some((v) => v !== null);
  const hasTables = (tableRows ?? []).length > 0;
  const hasShift = (shiftRows ?? []).length > 0;
  const hasMenuItems = tierItemCount >= 3;
  const hasCover = Boolean(restaurant.cover_photo_url);
  // Treat `deposit_tiers IS NULL` as Step 7 not done.
  // Empty array means "explicit no deposits" and counts as done.
  const hasDepositPolicy = restaurant.deposit_tiers !== null;

  let startAtStep = 2;
  if (!hasHours) startAtStep = 2;
  else if (!hasTables) startAtStep = 3;
  else if (!hasShift) startAtStep = 4;
  else if (!hasMenuItems) startAtStep = 5;
  else if (!hasCover) startAtStep = 6;
  else if (!hasDepositPolicy) startAtStep = 7;
  else startAtStep = 8;

  const hydratedTables: WizardTable[] | null = hasTables
    ? (tableRows ?? []).map((row) => {
        const r = row as { id: string; label: string | null; table_number: string | null; capacity: number | null; shape: string | null };
        const shapeRaw = (r.shape ?? "round").toLowerCase();
        const shape: WizardTable["shape"] =
          shapeRaw === "square" || shapeRaw === "rectangle" || shapeRaw === "booth"
            ? shapeRaw
            : "round";
        return {
          id: r.id,
          label: r.label ?? r.table_number ?? "T",
          capacity: typeof r.capacity === "number" && r.capacity > 0 ? r.capacity : 2,
          shape,
        };
      })
    : null;

  const savedPrimary = restaurant.settings_json?.theme?.primaryColor;
  const themeColor =
    typeof savedPrimary === "string" && /^#[0-9a-f]{6}$/i.test(savedPrimary)
      ? savedPrimary
      : null;

  return {
    state: {
      restaurantId: restaurant.id,
      basics,
      hours: hasHours ? hours : null,
      tables: hydratedTables,
      shift: null,
      themeColor,
    },
    startAtStep,
  };
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, profile } = useUser();
  // Query-param-driven entry modes:
  //   ?new=1            → skip resume entirely, fresh Step 1
  //   ?restaurant_id=X  → resume that specific draft (or redirect if not owned)
  // Captured on mount so a later URL change doesn't disrupt the in-progress
  // wizard.
  const forceNewRef = useRef(searchParams.get("new") === "1");
  const targetRestaurantIdRef = useRef(searchParams.get("restaurant_id"));
  const forceNew = forceNewRef.current;
  const targetRestaurantId = targetRestaurantIdRef.current;

  // Deep-link support: ?step=8 lets banners (e.g. "Finish verification" on
  // the dashboard) drop the owner straight into the Stripe Connect / payment
  // step without walking all 8 wizard steps again. Clamped to valid range.
  // Returns null when absent so we can distinguish "user picked a step" from
  // "fall back to default".
  const stepFromUrl = useMemo<number | null>(() => {
    const raw = Number(searchParams.get("step") ?? "");
    if (!Number.isFinite(raw) || raw < 1 || raw > WIZARD_TOTAL_STEPS) return null;
    return Math.floor(raw);
    // searchParams intentionally captured at mount via initial render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate from sessionStorage before the first render so the user lands on
  // the same step they were on if the tab reloads. ?new=1 and an explicit
  // ?restaurant_id that doesn't match the snapshot both invalidate it.
  const initialSnapshotRef = useRef<WizardSnapshot | null>(null);
  if (initialSnapshotRef.current === null) {
    const snap = forceNew ? null : readSnapshot();
    if (snap && targetRestaurantId && snap.state.restaurantId !== targetRestaurantId) {
      initialSnapshotRef.current = null;
    } else {
      initialSnapshotRef.current = snap;
    }
  }
  const initialSnapshot = initialSnapshotRef.current;

  const [step, setStep] = useState<number>(
    initialSnapshot?.step ?? stepFromUrl ?? 1,
  );
  const [state, setState] = useState<WizardState>(
    initialSnapshot?.state ?? INITIAL_STATE,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // One resume attempt per mount. Reset on unmount so a remount (StrictMode
  // double-mount or route revisit) re-fetches.
  const resumeAttemptedRef = useRef(false);

  useEffect(() => {
    const profileId = profile?.id ?? null;
    if (!user) {
      resumeAttemptedRef.current = false;
      return;
    }
    if (profileId === null) return;
    if (state.restaurantId !== null) return;
    if (resumeAttemptedRef.current) return;
    // Honor ?new=1 — skip the DB resume so the wizard starts at Step 1 with
    // an empty form. Step 1's submit will pass force_new=true to the edge fn.
    if (forceNew) {
      resumeAttemptedRef.current = true;
      return;
    }
    resumeAttemptedRef.current = true;
    let cancelled = false;
    void (async () => {
      const resume = await loadInProgressRestaurant(profileId, {
        targetRestaurantId,
      });
      if (cancelled) return;
      if (resume) {
        setState(resume.state);
        // Only jump to the DB-derived "furthest completed" step when the user
        // didn't already specify a step (via URL ?step or a restored snapshot).
        // Otherwise we'd yank an owner who went BACK to an earlier step
        // forward to a later one on every tab reload.
        if (stepFromUrl === null && initialSnapshot === null) {
          setStep(resume.startAtStep);
        }
      } else if (targetRestaurantId) {
        // Caller asked for a specific draft but it's not owned / not unpublished.
        toast.error("That restaurant isn't available.");
        navigate("/drafts", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
      resumeAttemptedRef.current = false;
    };
  }, [profile?.id, state.restaurantId, user, forceNew, targetRestaurantId, navigate]);

  const handleStep1Complete = useCallback((result: Step1Result) => {
    setState((prev) => ({
      ...prev,
      restaurantId: result.restaurantId,
      basics: result.basics,
      tables: result.tables,
    }));
    setStep(2);
    // Drop ?new=1 from the URL once we have a real draft. If anything
    // remounts SetupPage after this point (browser back, refresh, the
    // Stripe Connect Embedded flow), we want the resume path to kick in
    // and pick up the draft — not start a brand-new wizard and lose
    // everything the owner just entered.
    setSearchParams({ restaurant_id: result.restaurantId }, { replace: true });
  }, [setSearchParams]);

  const handleStep2Complete = useCallback((hours: HoursJson) => {
    setState((prev) => ({ ...prev, hours }));
    setStep(3);
  }, []);

  const handleStep3Complete = useCallback((tables: WizardTable[]) => {
    setState((prev) => ({ ...prev, tables }));
    setStep(4);
  }, []);

  const handleStep4Complete = useCallback((shift: WizardShift) => {
    setState((prev) => ({ ...prev, shift }));
    setStep(5);
  }, []);

  const handleStep5Complete = useCallback(() => {
    setStep(6);
  }, []);

  const handleStep6Complete = useCallback((themeColor: string) => {
    setState((prev) => ({ ...prev, themeColor }));
    setStep(7);
  }, []);

  const handleStep7Complete = useCallback(() => {
    setStep(8);
  }, []);

  const handlePublished = useCallback(() => {
    clearSnapshot();
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  // Persist wizard progress to sessionStorage on every state/step change. The
  // useState initializer above reads this back on mount so tab reloads keep
  // the owner where they were. We only snapshot once a draft exists — before
  // Step 1 lands there's nothing useful to keep.
  useEffect(() => {
    if (state.restaurantId === null) return;
    writeSnapshot({ step, state });
  }, [step, state]);

  // ?new=1 means the owner asked for a fresh start — wipe any stale snapshot
  // so a previously-discarded draft doesn't get restored over their new one.
  useEffect(() => {
    if (forceNew) clearSnapshot();
  }, [forceNew]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(1, s - 1));
  }, []);

  const handleSaveAndExit = useCallback(() => {
    if (state.restaurantId) {
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/discover", { replace: true });
    }
  }, [navigate, state.restaurantId]);

  const handleNextFromShell = useCallback(() => {
    // Each step renders its primary action button with id="wizard-step-submit".
    // The footer Next is a parallel control that triggers the same submission,
    // so users can advance from either button.
    const submitButton = document.getElementById("wizard-step-submit");
    if (submitButton instanceof HTMLButtonElement && !submitButton.disabled) {
      submitButton.click();
      return;
    }
    setStep((s) => Math.min(WIZARD_TOTAL_STEPS, s + 1));
  }, []);

  const nextLabel = useMemo(() => {
    if (step === 1) return "Continue";
    if (step === WIZARD_TOTAL_STEPS) return "Finish";
    return "Next";
  }, [step]);

  const stepContent = useMemo(() => {
    if (step === 1) {
      return (
        <Step1Basics
          initial={state.basics ?? undefined}
          onComplete={handleStep1Complete}
          forceNew={forceNew}
          targetRestaurantId={targetRestaurantId}
        />
      );
    }
    if (step === 2 && state.restaurantId) {
      return (
        <Step2Hours
          restaurantId={state.restaurantId}
          initial={state.hours}
          onComplete={handleStep2Complete}
          onBusyChange={setBusy}
        />
      );
    }
    if (step === 3 && state.restaurantId) {
      return (
        <Step3FloorPlan
          restaurantId={state.restaurantId}
          initial={state.tables ?? STARTER_TABLES}
          onComplete={handleStep3Complete}
          onBusyChange={setBusy}
        />
      );
    }
    if (step === 4 && state.restaurantId) {
      return (
        <Step4BookingRules
          restaurantId={state.restaurantId}
          hours={state.hours}
          initial={state.shift}
          onComplete={handleStep4Complete}
          onBusyChange={setBusy}
        />
      );
    }
    if (step === 5 && state.restaurantId) {
      return (
        <Step5Menu
          restaurantId={state.restaurantId}
          onComplete={handleStep5Complete}
          onBusyChange={setBusy}
        />
      );
    }
    if (step === 6 && state.restaurantId) {
      return (
        <Step6Photos
          restaurantId={state.restaurantId}
          onComplete={handleStep6Complete}
          onBusyChange={setBusy}
        />
      );
    }
    if (step === 7 && state.restaurantId) {
      return (
        <Step7DepositPolicy
          restaurantId={state.restaurantId}
          onComplete={handleStep7Complete}
          onBusyChange={setBusy}
        />
      );
    }
    if (step === 8 && state.restaurantId) {
      return (
        <Step8PaymentSetup
          restaurantId={state.restaurantId}
          onPublished={handlePublished}
          onBusyChange={setBusy}
        />
      );
    }
    return null;
  }, [
    forceNew,
    handlePublished,
    handleStep1Complete,
    handleStep2Complete,
    handleStep3Complete,
    handleStep4Complete,
    handleStep5Complete,
    handleStep6Complete,
    handleStep7Complete,
    state.basics,
    state.hours,
    state.restaurantId,
    state.shift,
    state.tables,
    step,
    targetRestaurantId,
  ]);

  return (
    <>
      <WizardShell
        currentStep={step}
        totalSteps={WIZARD_TOTAL_STEPS}
        restaurantId={state.restaurantId}
        onBack={handleBack}
        onNext={handleNextFromShell}
        onSaveAndExit={handleSaveAndExit}
        onPreviewClick={() => setPreviewOpen(true)}
        canGoNext={step !== WIZARD_TOTAL_STEPS}
        nextLabel={nextLabel}
        busy={busy}
        hideFooterNext={step !== WIZARD_TOTAL_STEPS}
      >
        {stepContent}
      </WizardShell>
      <PreviewAsDinerButton
        restaurantId={state.restaurantId}
        basics={state.basics}
        themeColor={state.themeColor}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
