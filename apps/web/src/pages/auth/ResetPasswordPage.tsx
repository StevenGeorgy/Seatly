import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { RouteFallback } from "@/components/routing/RouteFallback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { createResetPasswordSchema } from "@/lib/validation/auth-schemas";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [supabaseMissing, setSupabaseMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const schema = useMemo(() => createResetPasswordSchema(t), [t]);
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSupabaseMissing(true);
      return;
    }

    const timer = window.setTimeout(() => setTimedOut(true), 8000);
    const client = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        window.clearTimeout(timer);
        setRecoveryMode(true);
      }
    });
    return () => {
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.updateUser({ password: values.password });
      if (error) {
        toast.error(t("auth.errors.updatePasswordFailed"));
        return;
      }
      toast.success(t("auth.reset.success"));
      await client.auth.signOut();
      navigate("/login", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  if (supabaseMissing) {
    return (
      <AuthPageLayout titleKey="auth.reset.title">
        <p className="text-muted-foreground text-center text-sm">{t("auth.errors.supabaseNotConfigured")}</p>
        <Button className="w-full" asChild>
          <Link to="/login">{t("auth.forgot.backToLogin")}</Link>
        </Button>
      </AuthPageLayout>
    );
  }

  if (!recoveryMode && !timedOut) {
    return <RouteFallback />;
  }

  if (!recoveryMode && timedOut) {
    return (
      <AuthPageLayout titleKey="auth.reset.title">
        <p className="text-muted-foreground text-center text-sm">{t("auth.reset.invalid")}</p>
        <Button className="w-full" asChild>
          <Link to="/forgot-password">{t("auth.reset.requestNew")}</Link>
        </Button>
        <p className="text-muted-foreground text-center text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" to="/login">
            {t("auth.forgot.backToLogin")}
          </Link>
        </p>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout titleKey="auth.reset.title">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="space-y-2">
          <Label htmlFor="reset-password">{t("auth.fields.password.label")}</Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            className="h-12 px-4 rounded-md"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
          {errors.password ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.password.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="reset-confirm">{t("auth.fields.confirmPassword.label")}</Label>
          <Input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            className="h-12 px-4 rounded-md"
            aria-invalid={errors.confirmPassword ? true : undefined}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>
        <Button className="w-full" disabled={submitting} type="submit">
          {t("auth.reset.submit")}
        </Button>
      </form>
    </AuthPageLayout>
  );
}
