// Diner change-email form. Lives on /account/security alongside
// ChangePasswordSection.
//
// Re-verifies the current password via signInWithPassword before
// calling auth.updateUser({email}). Same defense as the password form:
// a stolen session token can't silently rotate the login email.
//
// Supabase sends a verification email to the NEW address. The email
// only flips after the user clicks that link, so the current address
// keeps working in the meantime. Hidden for users without a password
// identity (OAuth / phone-only) — those users don't have a current
// password to re-verify against, so the protection wouldn't apply.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/hooks/useUser";
import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newEmail: z.string().trim().email("Enter a valid email."),
    confirmEmail: z.string().trim().min(1, "Confirm your new email."),
  })
  .refine(
    (data) => data.newEmail.toLowerCase() === data.confirmEmail.toLowerCase(),
    {
      message: "Emails don't match.",
      path: ["confirmEmail"],
    },
  );

type FormValues = z.infer<typeof schema>;

export function ChangeEmailSection() {
  const { user } = useUser();
  const [hasPasswordIdentity, setHasPasswordIdentity] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newEmail: "", confirmEmail: "" },
  });

  const userId = user?.id ?? null;
  const currentEmail = useMemo(() => user?.email ?? "", [user?.email]);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) {
      setHasPasswordIdentity(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data, error } = await client.auth.getUserIdentities();
      if (cancelled) return;
      if (error) {
        console.error("[ChangeEmailSection.identities]", error);
        setHasPasswordIdentity(false);
        return;
      }
      const identities = data?.identities ?? [];
      setHasPasswordIdentity(identities.some((i) => i.provider === "email"));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      if (!isSupabaseConfigured()) {
        toast.error("Auth is not configured.");
        return;
      }
      if (!currentEmail) {
        toast.error("Couldn't find your account email.");
        return;
      }
      const nextEmail = values.newEmail.trim().toLowerCase();
      if (nextEmail === currentEmail.toLowerCase()) {
        setError("newEmail", {
          message: "That's already your email.",
        });
        return;
      }

      setSubmitting(true);
      try {
        const client = getSupabaseBrowserClient();
        const { error: verifyErr } = await client.auth.signInWithPassword({
          email: currentEmail,
          password: values.currentPassword,
        });
        if (verifyErr) {
          setError("currentPassword", {
            message: "That doesn't match your current password.",
          });
          console.error("[ChangeEmailSection.verify]", verifyErr);
          return;
        }

        const { error: updateErr } = await client.auth.updateUser({
          email: nextEmail,
        });
        if (updateErr) {
          const friendly = toUserFacingError(
            updateErr,
            "Couldn't start the email change.",
          );
          toast.error(friendly.message);
          console.error(
            "[ChangeEmailSection.update]",
            friendly.code,
            friendly.technical ?? updateErr,
          );
          return;
        }

        setPendingEmail(nextEmail);
        reset();
        toast.success("Check your inbox to confirm the new email.");
      } finally {
        setSubmitting(false);
      }
    },
    [currentEmail, reset, setError],
  );

  if (hasPasswordIdentity !== true) {
    return null;
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-bg-surface p-6">
      <h3 className="font-serif text-lg text-white">Change email</h3>
      <p className="mt-1 text-xs text-text-secondary">
        Current email: <span className="text-white">{currentEmail}</span>.
        We'll send a confirmation link to the new address — your current
        email keeps working until you click that link.
      </p>

      {pendingEmail ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-text-secondary">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <div>
            <p className="font-medium text-white">Verification email sent.</p>
            <p className="mt-1 text-xs">
              We sent a link to <span className="text-white">{pendingEmail}</span>.
              Open it from that inbox to finish the change. Until then your
              account still uses <span className="text-white">{currentEmail}</span>.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setPendingEmail(null)}
            >
              Change a different email instead
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="mt-5 space-y-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="emailCurrentPassword">Current password</Label>
            <Input
              id="emailCurrentPassword"
              type="password"
              autoComplete="current-password"
              {...register("currentPassword")}
            />
            {errors.currentPassword && (
              <p className="text-xs text-danger">{errors.currentPassword.message}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="newEmail">New email</Label>
              <Input
                id="newEmail"
                type="email"
                autoComplete="email"
                {...register("newEmail")}
              />
              {errors.newEmail && (
                <p className="text-xs text-danger">{errors.newEmail.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmEmail">Confirm new email</Label>
              <Input
                id="confirmEmail"
                type="email"
                autoComplete="email"
                {...register("confirmEmail")}
              />
              {errors.confirmEmail && (
                <p className="text-xs text-danger">{errors.confirmEmail.message}</p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Send verification link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => reset()}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
