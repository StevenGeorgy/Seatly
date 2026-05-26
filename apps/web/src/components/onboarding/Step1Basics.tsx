import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { clearDraft, readDraft, useDraftAutosave } from "./draftPersistence";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CuisineSelect } from "@/components/restaurant/CuisineSelect";
import { GoogleAddressAutocompleteInput } from "@/components/restaurant/GoogleAddressAutocompleteInput";
import { useUser } from "@/hooks/useUser";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { RESTAURANT_BUSINESS_TYPE_OPTIONS } from "@/lib/restaurant-business-types";
import {
  RESTAURANT_DIETARY_TAGS,
  type RestaurantDietaryTag,
} from "@/lib/restaurant-dietary-tags";

import { STARTER_TABLES, type WizardBasics, type WizardTable } from "./wizardTypes";

const DESCRIPTION_MAX = 360;

const DIETARY_LABEL: Record<RestaurantDietaryTag, string> = {
  halal: "Halal",
  kosher: "Kosher",
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  nut_free: "Nut-free",
};

const formSchema = z.object({
  restaurantName: z.string().trim().min(1, "Required").max(120, "Name is too long"),
  address: z.string().trim().min(1, "Required").max(300, "Address is too long"),
  city: z.string().trim().min(1, "Required").max(120, "City is too long"),
  province: z.string().trim().min(1, "Required").max(80, "Province is too long"),
  country: z.string().trim().min(1, "Required").max(80, "Country is too long"),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]\d[A-Za-z][ ]?\d[A-Za-z]\d$/, "Enter a Canadian postal code, e.g. M5V 3A8")
    .max(7, "Postal code is too long"),
  businessType: z.string().trim().min(1, "Required").max(80, "Too long"),
  cuisineType: z.string().trim().min(1, "Required").max(80, "Too long"),
  phone: z.string().trim().min(1, "Required").max(20, "Phone is too long"),
  description: z.string().max(DESCRIPTION_MAX),
  acceptsWalkins: z.boolean(),
  dietaryTags: z.array(z.string().max(80)).max(30),
  hstRegistrationNumber: z.string().trim().max(40, "Too long").optional().or(z.literal("")),
});

type Step1FormValues = z.infer<typeof formSchema>;

export type Step1Result = {
  restaurantId: string;
  basics: WizardBasics;
  tables: WizardTable[];
};

type Step1BasicsProps = {
  initial?: Partial<WizardBasics>;
  onComplete: (result: Step1Result) => void;
  /** When true, edge fn skips draft reuse and always inserts. */
  forceNew?: boolean;
  /** When set, edge fn targets this specific draft. */
  targetRestaurantId?: string | null;
};

type Step1Draft = Step1FormValues & { lat: number | null; lng: number | null };

export function Step1Basics({
  initial,
  onComplete,
  forceNew = false,
  targetRestaurantId = null,
}: Step1BasicsProps) {
  const { refreshUser } = useUser();
  const { errorToast } = useErrorToast();
  const [submitting, setSubmitting] = useState(false);

  // Per-step draft key: scope by target draft so multi-restaurant owners
  // don't see one draft bleed into another. Pre-Continue (no draft id yet)
  // we use "new", which is what ?new=1 also points at.
  const draftKey = `step1.${targetRestaurantId ?? "new"}`;

  // Read any saved draft synchronously so the form mounts already populated.
  // forceNew (?new=1 from "+ Add restaurant") explicitly bypasses drafts.
  const draftSeed = useMemo<Step1Draft | null>(
    () => (forceNew ? null : readDraft<Step1Draft>(draftKey)),
    // Capture at mount only — don't react to draftKey changes mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [lat, setLat] = useState<number | null>(draftSeed?.lat ?? initial?.lat ?? null);
  const [lng, setLng] = useState<number | null>(draftSeed?.lng ?? initial?.lng ?? null);

  const form = useForm<Step1FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      restaurantName: draftSeed?.restaurantName ?? initial?.restaurantName ?? "",
      address: draftSeed?.address ?? initial?.address ?? "",
      city: draftSeed?.city ?? initial?.city ?? "",
      province: draftSeed?.province ?? initial?.province ?? "",
      country: draftSeed?.country ?? initial?.country ?? "Canada",
      postalCode: draftSeed?.postalCode ?? initial?.postalCode ?? "",
      businessType: draftSeed?.businessType ?? initial?.businessType ?? "Restaurant",
      cuisineType: draftSeed?.cuisineType ?? initial?.cuisineType ?? "",
      phone: draftSeed?.phone ?? initial?.phone ?? "",
      description: draftSeed?.description ?? initial?.description ?? "",
      acceptsWalkins: draftSeed?.acceptsWalkins ?? initial?.acceptsWalkins ?? true,
      dietaryTags: draftSeed?.dietaryTags ?? initial?.dietaryTags ?? [],
      hstRegistrationNumber: draftSeed?.hstRegistrationNumber ?? "",
    },
  });

  // Auto-persist the form (and lat/lng) on every change. Debounced inside the
  // hook so we don't pound sessionStorage on every keystroke.
  const watchedAll = form.watch();
  useDraftAutosave<Step1Draft>(draftKey, { ...watchedAll, lat, lng }, { enabled: !forceNew });

  // react-hook-form captures defaultValues only on first mount. When the
  // parent's resume effect populates `initial` *after* mount (the common
  // case for users returning to /setup mid-flow), we have to push the
  // values into the form imperatively. Guard on a stable key so we only
  // reset when the resumed restaurant actually changes.
  useEffect(() => {
    if (!initial) return;
    form.reset({
      restaurantName: initial.restaurantName ?? "",
      address: initial.address ?? "",
      city: initial.city ?? "",
      province: initial.province ?? "",
      country: initial.country ?? "Canada",
      postalCode: initial.postalCode ?? "",
      businessType: initial.businessType ?? "Restaurant",
      cuisineType: initial.cuisineType ?? "",
      phone: initial.phone ?? "",
      description: initial.description ?? "",
      acceptsWalkins: initial.acceptsWalkins ?? true,
      dietaryTags: initial.dietaryTags ?? [],
      hstRegistrationNumber: "",
    });
    setLat(initial.lat ?? null);
    setLng(initial.lng ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initial?.restaurantName,
    initial?.address,
    initial?.phone,
    initial?.cuisineType,
    initial?.businessType,
  ]);

  const watchedDescription = form.watch("description") ?? "";
  const watchedDietary = form.watch("dietaryTags");
  const watchedAcceptsWalkins = form.watch("acceptsWalkins");

  const onSubmit = async (values: Step1FormValues) => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();

      const tags = (values.dietaryTags ?? []).filter((tag): tag is RestaurantDietaryTag =>
        (RESTAURANT_DIETARY_TAGS as readonly string[]).includes(tag),
      );

      const tablesPayload = STARTER_TABLES.map((t) => ({
        label: t.label,
        capacity: t.capacity,
        shape: t.shape,
      }));

      const { data, error } = await client.functions.invoke("signup-restaurant-owner", {
        body: {
          restaurant_name: values.restaurantName.trim(),
          full_name: values.restaurantName.trim(),
          address: values.address.trim(),
          city: values.city.trim(),
          province: values.province.trim(),
          country: values.country.trim() || "Canada",
          postal_code: values.postalCode.trim().toUpperCase(),
          hst_registration_number: values.hstRegistrationNumber?.trim() || null,
          lat,
          lng,
          cuisine_type: values.cuisineType,
          business_type: values.businessType,
          phone: values.phone.trim(),
          description: values.description?.trim() || null,
          currency: values.country.trim().toLowerCase() === "canada" ? "CAD" : "USD",
          hours_json: null,
          accepts_walkins: values.acceptsWalkins,
          dietary_tags: tags,
          tables: tablesPayload,
          // Draft routing: workspace "+ Add restaurant" → force_new=true.
          // /drafts continue-this-draft → restaurant_id=<id>.
          force_new: forceNew,
          restaurant_id: targetRestaurantId,
        },
      });

      if (error || !data || typeof (data as { restaurant_id?: string }).restaurant_id !== "string") {
        const dataErr = (data as { error?: string } | null)?.error;
        // Prefer the edge fn's body error (more specific), then the invoke
        // error, then a generic fallback.
        errorToast(error ?? (dataErr ? new Error(dataErr) : null), {
          fallback: "Could not create restaurant. Try again.",
          logTag: "[Step1Basics.signupRestaurantOwner]",
        });
        return;
      }

      await refreshUser();

      // Draft is now committed to the DB — wipe sessionStorage so a future
      // re-entry of Step 1 reads from the canonical row, not stale typing.
      clearDraft(draftKey);

      onComplete({
        restaurantId: (data as { restaurant_id: string }).restaurant_id,
        basics: {
          restaurantName: values.restaurantName.trim(),
          address: values.address.trim(),
          city: values.city.trim(),
          province: values.province.trim(),
          country: values.country.trim(),
          postalCode: values.postalCode.trim(),
          lat,
          lng,
          businessType: values.businessType,
          cuisineType: values.cuisineType,
          phone: values.phone.trim(),
          description: values.description?.trim() ?? "",
          acceptsWalkins: values.acceptsWalkins,
          dietaryTags: tags,
        },
        tables: STARTER_TABLES,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDietary = (tag: RestaurantDietaryTag) => {
    const current = form.getValues("dietaryTags") ?? [];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    form.setValue("dietaryTags", next, { shouldDirty: true });
  };

  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      id="onboarding-step-1-form"
    >
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Tell us about your restaurant</h1>
        <p className="mt-1 text-sm text-text-muted">
          We'll use this to set up your public page. You can change anything later.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="restaurantName">
              Restaurant name <span className="text-danger">*</span>
            </Label>
            <Input id="restaurantName" maxLength={120} {...form.register("restaurantName")} placeholder="The Golden Fork" />
            {errors.restaurantName ? (
              <p className="text-xs text-danger">{errors.restaurantName.message}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="businessType">
              Business type <span className="text-danger">*</span>
            </Label>
            <Controller
              control={form.control}
              name="businessType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="businessType">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESTAURANT_BUSINESS_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">
            Street address <span className="text-danger">*</span>
          </Label>
          <Controller
            control={form.control}
            name="address"
            render={({ field }) => (
              <GoogleAddressAutocompleteInput
                value={field.value ?? ""}
                onChange={(v) => field.onChange(v)}
                placeholder="142 King St W"
                onAddressSelected={(parts) => {
                  // Auto-fill the rest of the address block from the Google
                  // Place. Owners can still edit any field manually.
                  if (parts.address) field.onChange(parts.address);
                  if (parts.city) form.setValue("city", parts.city, { shouldValidate: true });
                  if (parts.province) form.setValue("province", parts.province, { shouldValidate: true });
                  if (parts.country) form.setValue("country", parts.country, { shouldValidate: true });
                  if (parts.postalCode) form.setValue("postalCode", parts.postalCode, { shouldValidate: true });
                  if (typeof parts.lat === "number") setLat(parts.lat);
                  if (typeof parts.lng === "number") setLng(parts.lng);
                }}
              />
            )}
          />
          {errors.address ? <p className="text-xs text-danger">{errors.address.message}</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">
              City <span className="text-danger">*</span>
            </Label>
            <Input id="city" maxLength={120} {...form.register("city")} placeholder="Toronto" />
            {errors.city ? <p className="text-xs text-danger">{errors.city.message}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="province">
              Province <span className="text-danger">*</span>
            </Label>
            <Input id="province" maxLength={80} {...form.register("province")} placeholder="ON" />
            {errors.province ? <p className="text-xs text-danger">{errors.province.message}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="country">
              Country <span className="text-danger">*</span>
            </Label>
            <Input id="country" maxLength={80} {...form.register("country")} placeholder="Canada" />
            {errors.country ? <p className="text-xs text-danger">{errors.country.message}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="postalCode">Postal code <span className="text-danger">*</span></Label>
            <Input
              id="postalCode"
              maxLength={7}
              {...form.register("postalCode")}
              placeholder="M5V 3A8"
              onBlur={(e) => form.setValue("postalCode", e.target.value.toUpperCase().trim(), { shouldValidate: true })}
            />
            {errors.postalCode ? <p className="text-xs text-danger">{errors.postalCode.message}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hstRegistrationNumber">GST/HST Registration Number (optional)</Label>
          <Input
            id="hstRegistrationNumber"
            {...form.register("hstRegistrationNumber")}
            placeholder="123456789RT0001"
            maxLength={40}
          />
          <p className="text-xs text-text-muted">
            If you're HST-registered, enter your number so we include it on your Cenaiva invoices for your tax records.
          </p>
          {errors.hstRegistrationNumber ? <p className="text-xs text-danger">{errors.hstRegistrationNumber.message}</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cuisineType">
              Cuisine <span className="text-danger">*</span>
            </Label>
            <Controller
              control={form.control}
              name="cuisineType"
              render={({ field }) => (
                <CuisineSelect
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder="Select cuisine"
                />
              )}
            />
            {errors.cuisineType ? (
              <p className="text-xs text-danger">{errors.cuisineType.message}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">
              Phone <span className="text-danger">*</span>
            </Label>
            <Controller
              control={form.control}
              name="phone"
              render={({ field }) => (
                <PhoneInput
                  id="phone"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={!!errors.phone}
                />
              )}
            />
            {errors.phone ? <p className="text-xs text-danger">{errors.phone.message}</p> : null}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-bg-surface p-4">
          <div>
            <p className="text-sm font-semibold text-text-primary">Accept walk-ins</p>
            <p className="text-xs text-text-muted">Diners can be seated without a reservation.</p>
          </div>
          <button
            type="button"
            onClick={() => form.setValue("acceptsWalkins", !watchedAcceptsWalkins, { shouldDirty: true })}
            className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${
              watchedAcceptsWalkins ? "bg-gold" : "bg-border"
            }`}
            aria-pressed={watchedAcceptsWalkins}
          >
            <span
              className={`size-5 rounded-full bg-white shadow transition-transform ${
                watchedAcceptsWalkins ? "translate-x-[22px]" : "translate-x-[2px]"
              }`}
            />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Dietary &amp; religious accommodations</Label>
          <p className="text-xs text-text-muted">Optional — surfaces filters for diners.</p>
          <div className="flex flex-wrap gap-2">
            {RESTAURANT_DIETARY_TAGS.map((tag) => {
              const active = (watchedDietary ?? []).includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleDietary(tag)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border bg-bg-elevated text-text-secondary hover:border-gold/30"
                  }`}
                >
                  {DIETARY_LABEL[tag]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={4}
            maxLength={DESCRIPTION_MAX}
            placeholder="A short description guests will see on your public page."
            {...form.register("description")}
          />
          <p className="text-right text-[11px] text-text-muted">
            {watchedDescription.length}/{DESCRIPTION_MAX}
          </p>
        </div>
      </section>

      <Button id="wizard-step-submit" type="submit" disabled={submitting} className="self-end gap-2 px-6">
        {submitting ? "Creating restaurant…" : "Continue to hours"}
      </Button>
    </form>
  );
}
