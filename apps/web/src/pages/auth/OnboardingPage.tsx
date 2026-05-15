import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

// Phase 3 of diner auth overhaul: small "polite questions" screen
// that surfaces ONLY missing profile fields. Diners hit this when
// they try to book and `RequireCompleteProfile` redirects them.
//
// Pre-fills whatever the provider already gave us (name from
// Google/Apple, phone from phone-OTP, email from any of them) and
// asks for the rest. After submit, writes to user_profiles +
// redirects back to wherever they were headed.
//
// Apple privacy-relay quirk: if `profile.email` matches
// `@privaterelay.appleid.com`, we also surface an OPTIONAL "real
// email for receipts" field. Never required, never blocking.

type OnboardingFormValues = {
  full_name: string;
  email: string;
  phone: string;
  real_email: string;
};

const APPLE_RELAY_EMAIL = /@privaterelay\.appleid\.com$/i;

export default function OnboardingPage() {
  const { user, profile, refreshUser, loading: userLoading } = useUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  const fromParam = searchParams.get("from") ?? "/discover";

  const missingName = !profile?.full_name?.trim();
  const missingEmail = !profile?.email?.trim();
  const missingPhone = !profile?.phone?.trim();
  const hasRelayEmail =
    Boolean(profile?.email) && APPLE_RELAY_EMAIL.test(profile?.email ?? "");

  const showRealEmailField = !missingEmail && hasRelayEmail;
  const allComplete = !missingName && !missingEmail && !missingPhone;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OnboardingFormValues>({
    defaultValues: {
      full_name: profile?.full_name ?? "",
      email: profile?.email ?? "",
      phone: profile?.phone ?? "",
      real_email: "",
    },
  });

  // Reset form when the profile finishes loading (auth context can hydrate
  // after first render).
  useEffect(() => {
    reset({
      full_name: profile?.full_name ?? "",
      email: profile?.email ?? "",
      phone: profile?.phone ?? "",
      real_email: "",
    });
  }, [profile, reset]);

  // If user lands here but their profile is already complete (and not on a
  // relay-email-prompt path), bounce them straight to wherever they came
  // from. Keeps the URL clean of stale ?from= params.
  useEffect(() => {
    if (userLoading) return;
    if (allComplete && !hasRelayEmail) {
      navigate(fromParam, { replace: true });
    }
  }, [allComplete, hasRelayEmail, fromParam, navigate, userLoading]);

  const headerCopy = useMemo(() => {
    if (allComplete && hasRelayEmail) {
      return {
        title: "One last thing",
        body: "Apple gave us a forwarding email. Add a real one for receipts (optional).",
      };
    }
    if (!missingName && !missingPhone && missingEmail) {
      return {
        title: "What's your email?",
        body: "We need this for booking confirmations and receipts.",
      };
    }
    if (!missingName && !missingEmail && missingPhone) {
      return {
        title: "What's your phone number?",
        body: "We send SMS confirmations so you never miss a reservation.",
      };
    }
    return {
      title: "A few quick details",
      body: "We just need a couple of things to confirm your booking. You'll only have to do this once.",
    };
  }, [allComplete, hasRelayEmail, missingName, missingEmail, missingPhone]);

  const onSubmit = async (values: OnboardingFormValues) => {
    if (!user || !profile) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const updates: Record<string, string> = {};

      if (missingName && values.full_name.trim()) {
        updates.full_name = values.full_name.trim();
      }
      if (missingEmail && values.email.trim()) {
        updates.email = values.email.trim().toLowerCase();
      } else if (showRealEmailField && values.real_email.trim()) {
        // Apple-relay-email replacement. user_profiles.email gets the real
        // one; auth.users.email stays as the relay (Apple never re-issues
        // the real address so we can't sync it back to auth).
        updates.email = values.real_email.trim().toLowerCase();
      }
      if (missingPhone && values.phone.trim()) {
        // Naive normalization — accept whatever they type. Production
        // libphonenumber-js validation comes in Phase 2.
        updates.phone = values.phone.trim();
      }

      if (Object.keys(updates).length === 0) {
        // Nothing to write; just continue.
        navigate(fromParam, { replace: true });
        return;
      }

      const { error } = await client
        .from("user_profiles")
        .update(updates)
        .eq("auth_user_id", user.id);

      if (error) {
        toast.error(error.message);
        return;
      }

      await refreshUser();
      navigate(fromParam, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout titleKey="auth.onboarding.title">
      <div className="space-y-4">
        <div>
          <h2 className="font-serif text-2xl text-white">{headerCopy.title}</h2>
          <p className="mt-1.5 text-sm text-text-secondary">{headerCopy.body}</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {missingName ? (
            <div className="space-y-2">
              <Label htmlFor="onboarding-name">Your name</Label>
              <Input
                id="onboarding-name"
                type="text"
                autoComplete="name"
                className="h-12 px-4 rounded-md"
                placeholder="Mark Habbi"
                {...register("full_name", {
                  required: "Please enter your name",
                  minLength: { value: 2, message: "Too short" },
                })}
              />
              {errors.full_name ? (
                <p className="text-destructive text-sm" role="alert">
                  {errors.full_name.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {missingEmail ? (
            <div className="space-y-2">
              <Label htmlFor="onboarding-email">Email address</Label>
              <Input
                id="onboarding-email"
                type="email"
                autoComplete="email"
                className="h-12 px-4 rounded-md"
                placeholder="you@example.com"
                {...register("email", {
                  required: "We need an email for booking confirmations",
                  pattern: { value: /^\S+@\S+\.\S+$/, message: "That doesn't look right" },
                })}
              />
              {errors.email ? (
                <p className="text-destructive text-sm" role="alert">
                  {errors.email.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {missingPhone ? (
            <div className="space-y-2">
              <Label htmlFor="onboarding-phone">Phone number</Label>
              <Input
                id="onboarding-phone"
                type="tel"
                autoComplete="tel"
                className="h-12 px-4 rounded-md"
                placeholder="+1 416 555 1234"
                {...register("phone", {
                  required: "Phone number is required for SMS confirmation",
                  minLength: { value: 7, message: "Too short" },
                })}
              />
              {errors.phone ? (
                <p className="text-destructive text-sm" role="alert">
                  {errors.phone.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {showRealEmailField ? (
            <div className="space-y-2 rounded-2xl border border-border bg-bg-surface/50 p-4">
              <Label htmlFor="onboarding-real-email" className="font-medium text-white">
                Real email for receipts (optional)
              </Label>
              <p className="text-xs text-text-muted">
                You signed in with Apple's hide-my-email. Want to add a real
                address so receipts arrive directly? You can skip this — we'll
                use the forwarding address otherwise.
              </p>
              <Input
                id="onboarding-real-email"
                type="email"
                autoComplete="email"
                className="h-12 px-4 rounded-md"
                placeholder="you@example.com"
                {...register("real_email", {
                  pattern: { value: /^\S+@\S+\.\S+$/, message: "That doesn't look right" },
                })}
              />
              {errors.real_email ? (
                <p className="text-destructive text-sm" role="alert">
                  {errors.real_email.message}
                </p>
              ) : null}
            </div>
          ) : null}

          <Button
            className="h-12 w-full text-base font-semibold"
            disabled={submitting || userLoading}
            type="submit"
          >
            {submitting ? "Saving..." : "Continue"}
          </Button>

          {showRealEmailField ? (
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full text-sm text-text-muted"
              disabled={submitting}
              onClick={() => navigate(fromParam, { replace: true })}
            >
              Skip — use forwarding email
            </Button>
          ) : null}
        </form>
      </div>
    </AuthPageLayout>
  );
}
