// Diner change-password form, mounted in AccountPage Preferences.
//
// Re-verifies the current password by calling signInWithPassword before
// applying the change. That prevents a stolen-session-token attacker from
// silently rotating the password and locking the real user out.
//
// Renders only for users who have an `email` identity (i.e. signed up
// with a password). Apple / Google / Phone-OTP-only users see nothing —
// they have no password to change.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/hooks/useUser";
import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your current one.",
    path: ["newPassword"],
  });

type FormValues = z.infer<typeof schema>;

export function ChangePasswordSection() {
  const { user } = useUser();
  const [hasPasswordIdentity, setHasPasswordIdentity] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const userId = user?.id ?? null;

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
        console.error("[ChangePasswordSection.identities]", error);
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

  const emailForVerify = useMemo(() => user?.email ?? "", [user?.email]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      if (!isSupabaseConfigured()) {
        toast.error("Auth is not configured.");
        return;
      }
      if (!emailForVerify) {
        toast.error("Couldn't find your account email.");
        return;
      }
      setSubmitting(true);
      try {
        const client = getSupabaseBrowserClient();
        const { error: verifyErr } = await client.auth.signInWithPassword({
          email: emailForVerify,
          password: values.currentPassword,
        });
        if (verifyErr) {
          setError("currentPassword", {
            message: "That doesn't match your current password.",
          });
          console.error(
            "[ChangePasswordSection.verify]",
            verifyErr,
          );
          return;
        }

        const { error: updateErr } = await client.auth.updateUser({
          password: values.newPassword,
        });
        if (updateErr) {
          const friendly = toUserFacingError(
            updateErr,
            "Couldn't update your password.",
          );
          toast.error(friendly.message);
          console.error(
            "[ChangePasswordSection.update]",
            friendly.code,
            friendly.technical ?? updateErr,
          );
          return;
        }

        toast.success("Password updated.");
        reset();
      } finally {
        setSubmitting(false);
      }
    },
    [emailForVerify, reset, setError],
  );

  if (hasPasswordIdentity !== true) {
    return null;
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-bg-surface p-6">
      <h3 className="font-serif text-lg text-white">Change password</h3>
      <p className="mt-1 text-xs text-text-secondary">
        Enter your current password, then choose a new one.
      </p>
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="mt-5 space-y-5"
      >
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
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
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...register("newPassword")}
            />
            {errors.newPassword && (
              <p className="text-xs text-danger">{errors.newPassword.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-danger">{errors.confirmPassword.message}</p>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
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
    </div>
  );
}
