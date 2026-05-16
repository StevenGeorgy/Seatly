import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, ShieldAlert, Store } from "lucide-react";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import type { DashboardPermissionOverrides, StaffRole } from "@/types/auth";

type AcceptState =
  | "checking"
  | "needs-auth"
  | "wrong-account"
  | "ready"
  | "accepting"
  | "accepted"
  | "declining"
  | "declined"
  | "failed";
type InvitePreview = {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  role: StaffRole;
  contact: string | null;
  status: string;
  expires_at: string;
  permission_overrides_json: DashboardPermissionOverrides;
};

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizePhone(value: string | null | undefined): string {
  return value?.trim().replace(/[^\d+]/g, "") ?? "";
}

function isEmailContact(contact: string | null): boolean {
  return Boolean(contact?.includes("@"));
}

function inviteMatchesSession(invite: InvitePreview | null, session: ReturnType<typeof useUser>["session"]): boolean {
  if (!invite?.contact || !session?.user) return true;
  if (isEmailContact(invite.contact)) {
    return normalizeEmail(invite.contact) === normalizeEmail(session.user.email);
  }
  return normalizePhone(invite.contact) === normalizePhone(session.user.phone);
}

async function callAcceptInvite(
  action: "preview" | "accept" | "decline",
  token: string,
  accessToken?: string,
): Promise<{
  ok?: boolean;
  invite?: InvitePreview;
  error?: string;
  redirect_to?: string;
}> {
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/accept-staff-invite`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, token }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    invite?: InvitePreview;
    error?: string;
    redirect_to?: string;
  };
  if (!res.ok) {
    const friendly = toUserFacingEdgeError(res, payload);
    throw new Error(friendly.message);
  }
  return payload;
}

export default function AcceptInvitePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session, signOut, refreshUser } = useUser();
  const token = useMemo(() => params.get("token")?.trim() ?? "", [params]);
  const [state, setState] = useState<AcceptState>("checking");
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !isSupabaseConfigured()) return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      setState("checking");
      try {
        const payload = await callAcceptInvite("preview", token);
        if (cancelled) return;
        const preview = payload.invite ?? null;
        setInvite(preview);
        if (!preview || preview.status !== "pending") {
          setError(preview?.status === "declined"
            ? t("auth.acceptInvite.declinedDesc")
            : t("auth.acceptInvite.inactiveDesc"));
          setState(preview?.status === "declined" ? "declined" : "failed");
          return;
        }
        setState(session ? "ready" : "needs-auth");
      } catch (err) {
        if (cancelled) return;
        const friendly = toUserFacingError(err, t("auth.acceptInvite.genericError"));
        setError(friendly.message);
        console.error("[AcceptInvite]", friendly.code, friendly.technical ?? err);
        setState("failed");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session, t, token]);

  const handleAccept = useCallback(async () => {
    if (!token || !session) return;
    setState("accepting");
    setError(null);
    try {
      const payload = await callAcceptInvite("accept", token, session.access_token);
      await refreshUser();
      setState("accepted");
      window.setTimeout(() => {
        navigate(payload.redirect_to ?? "/dashboard/reservations", { replace: true });
      }, 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.acceptInvite.genericError"));
      setState("failed");
    }
  }, [navigate, refreshUser, session, t, token]);

  const handleDecline = useCallback(async () => {
    if (!token) return;
    setState("declining");
    setError(null);
    try {
      await callAcceptInvite("decline", token);
      setState("declined");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.acceptInvite.genericError"));
      setState("failed");
    }
  }, [t, token]);

  const invitePath = `/accept-invite?token=${token}`;
  const invitedEmail = invite?.contact && isEmailContact(invite.contact) ? normalizeEmail(invite.contact) : "";
  const loginTarget = `/login?from=${encodeURIComponent(invitePath)}${
    invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : ""
  }`;
  const registerTarget = `/register?from=${encodeURIComponent(invitePath)}${
    invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : ""
  }`;
  const signedInEmail = normalizeEmail(session?.user.email);
  const isWrongAccount =
    Boolean(session && invite?.status === "pending") && !inviteMatchesSession(invite, session);
  const handleSwitchAccount = useCallback(async () => {
    await signOut();
    navigate(loginTarget, { replace: true });
  }, [loginTarget, navigate, signOut]);
  const effectiveState: AcceptState = !token
    ? "failed"
    : !isSupabaseConfigured()
      ? "failed"
      : isWrongAccount && state !== "accepted" && state !== "declined" && state !== "checking" && state !== "failed"
        ? "wrong-account"
      : !session && state !== "accepted" && state !== "declined" && state !== "checking" && state !== "failed"
        ? "needs-auth"
        : state;
  const effectiveError = !token
    ? t("auth.acceptInvite.missingToken")
    : !isSupabaseConfigured()
      ? t("auth.acceptInvite.supabaseMissing")
      : error;

  return (
    <AuthPageLayout titleKey="auth.acceptInvite.title">
      <div className="flex flex-col items-center gap-4 text-center">
        {effectiveState === "accepted" || effectiveState === "declined" ? (
          <CheckCircle2 className="size-12 text-success" />
        ) : effectiveState === "failed" || effectiveState === "wrong-account" ? (
          <ShieldAlert className="size-12 text-danger" />
        ) : effectiveState === "ready" || effectiveState === "needs-auth" ? (
          <Store className="size-12 text-gold" />
        ) : (
          <Loader2 className="size-12 animate-spin text-gold" />
        )}

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-text-primary">
            {effectiveState === "needs-auth"
              ? t("auth.acceptInvite.signInTitle")
              : effectiveState === "wrong-account"
                ? t("auth.acceptInvite.wrongAccountTitle")
              : effectiveState === "ready"
                ? t("auth.acceptInvite.readyTitle")
              : effectiveState === "accepted"
                ? t("auth.acceptInvite.acceptedTitle")
                : effectiveState === "declined"
                  ? t("auth.acceptInvite.declinedTitle")
                : effectiveState === "failed"
                  ? t("auth.acceptInvite.failedTitle")
                  : t("auth.acceptInvite.acceptingTitle")}
          </h1>
          <p className="text-sm text-text-secondary">
            {effectiveState === "needs-auth"
              ? t("auth.acceptInvite.signInDesc")
              : effectiveState === "wrong-account"
                ? t("auth.acceptInvite.wrongAccountDesc", {
                    invited: invite?.contact ?? t("auth.acceptInvite.invitedAccountFallback"),
                    current: signedInEmail || t("auth.acceptInvite.currentAccountFallback"),
                  })
              : effectiveState === "ready"
                ? t("auth.acceptInvite.readyDesc")
              : effectiveState === "accepted"
                ? t("auth.acceptInvite.acceptedDesc")
                : effectiveState === "declined"
                  ? t("auth.acceptInvite.declinedDesc")
                : effectiveState === "failed"
                  ? effectiveError
                  : t("auth.acceptInvite.acceptingDesc")}
          </p>
        </div>

        {invite && (effectiveState === "ready" || effectiveState === "needs-auth" || effectiveState === "wrong-account") ? (
          <div className="w-full rounded-xl border border-border bg-bg-surface p-4 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
              {t("auth.acceptInvite.inviteDetails")}
            </p>
            <p className="mt-2 font-serif text-2xl text-text-primary">{invite.restaurant_name}</p>
            <div className="mt-3 grid gap-2 text-sm text-text-secondary">
              <p>
                {t("auth.acceptInvite.roleLabel")}:{" "}
                <span className="capitalize text-text-primary">{invite.role}</span>
              </p>
              {invite.contact ? (
                <p>
                  {t("auth.acceptInvite.sentTo")}:{" "}
                  <span className="text-text-primary">{invite.contact}</span>
                </p>
              ) : null}
              <p>
                {t("auth.acceptInvite.expires")}:{" "}
                <span className="text-text-primary">
                  {new Date(invite.expires_at).toLocaleDateString()}
                </span>
              </p>
            </div>
          </div>
        ) : null}

        {effectiveState === "needs-auth" ? (
          <div className="grid w-full gap-2">
            <Button asChild>
              <Link to={loginTarget}>{t("auth.acceptInvite.login")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={registerTarget}>{t("auth.acceptInvite.createAccount")}</Link>
            </Button>
            <Button variant="ghost" onClick={() => void handleDecline()}>
              {t("auth.acceptInvite.decline")}
            </Button>
          </div>
        ) : effectiveState === "wrong-account" ? (
          <div className="grid w-full gap-2">
            <Button onClick={() => void handleSwitchAccount()}>
              {t("auth.acceptInvite.switchAccount")}
            </Button>
            <Button asChild variant="outline">
              <Link to={loginTarget}>{t("auth.acceptInvite.login")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to={registerTarget}>{t("auth.acceptInvite.createAccount")}</Link>
            </Button>
          </div>
        ) : effectiveState === "ready" ? (
          <div className="grid w-full gap-2">
            <Button onClick={() => void handleAccept()}>{t("auth.acceptInvite.accept")}</Button>
            <Button variant="outline" onClick={() => void handleDecline()}>
              {t("auth.acceptInvite.decline")}
            </Button>
          </div>
        ) : effectiveState === "declining" || effectiveState === "accepting" || effectiveState === "checking" ? (
          <p className="text-xs text-text-muted">{t("auth.acceptInvite.working")}</p>
        ) : null}
      </div>
    </AuthPageLayout>
  );
}
