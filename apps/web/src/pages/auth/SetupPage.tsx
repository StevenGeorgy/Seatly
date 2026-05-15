import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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
};

const INITIAL_STATE: WizardState = {
  restaurantId: null,
  basics: null,
  hours: null,
  tables: null,
  shift: null,
};

type ResumeResult = {
  state: WizardState;
  startAtStep: number;
};

async function loadInProgressRestaurant(userProfileId: string | null): Promise<ResumeResult | null> {
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

  const { data: restaurants } = await client
    .from("restaurants")
    .select(
      "id, name, address, city, province, country, lat, lng, phone, description, cuisine_type, business_type, hours_json, accepts_walkins, settings_json, is_published, cover_photo_url, deposit_tiers",
    )
    .in("id", restaurantIds)
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
        settings_json: { dietaryTags?: string[] } | null;
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

  return {
    state: {
      restaurantId: restaurant.id,
      basics,
      hours: hasHours ? hours : null,
      tables: hasTables ? null : null,
      shift: null,
    },
    startAtStep,
  };
}

export default function SetupPage() {
  const navigate = useNavigate();
  const { user, profile } = useUser();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Track which profile.id we've already attempted resume for. If profile
  // transitions from null → a value (e.g. inline-signup completes on Step 1),
  // we re-run resume so the wizard hydrates the just-created restaurant
  // instead of showing Step 1 again on a refresh mid-flow.
  const lastResumedProfileIdRef = useRef<string | null>(null);

  useEffect(() => {
    const profileId = profile?.id ?? null;
    if (!user) {
      lastResumedProfileIdRef.current = null;
      return;
    }
    if (profileId === null) return;
    if (lastResumedProfileIdRef.current === profileId) return;
    lastResumedProfileIdRef.current = profileId;
    let cancelled = false;
    void (async () => {
      const resume = await loadInProgressRestaurant(profileId);
      if (cancelled) return;
      if (resume) {
        setState(resume.state);
        setStep(resume.startAtStep);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, user]);

  const handleStep1Complete = useCallback((result: Step1Result) => {
    setState((prev) => ({
      ...prev,
      restaurantId: result.restaurantId,
      basics: result.basics,
      tables: result.tables,
    }));
    setStep(2);
  }, []);

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

  const handleStep6Complete = useCallback(() => {
    setStep(7);
  }, []);

  const handleStep7Complete = useCallback(() => {
    setStep(8);
  }, []);

  const handlePublished = useCallback(() => {
    navigate("/dashboard", { replace: true });
  }, [navigate]);

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
        <Step1Basics initial={state.basics ?? undefined} onComplete={handleStep1Complete} />
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
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
