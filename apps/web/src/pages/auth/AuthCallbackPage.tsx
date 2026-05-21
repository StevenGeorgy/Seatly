import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { RouteFallback } from "@/components/routing/RouteFallback";
import { Button } from "@/components/ui/button";
import {
  AccountLinkPrompt,
  type DuplicateAccountInfo,
} from "@/components/customer/AccountLinkPrompt";
import { isSafeRedirectPath, resolvePostLoginPath } from "@/lib/auth/post-login-redirect";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadUserContext } from "@/lib/supabase/load-user-context";

export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateAccountInfo | null>(null);
  const from = params.get("from") ?? undefined;

  useEffect(() => {
    void (async () => {
      if (!isSupabaseConfigured()) {
        setFailed(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
      const client = getSupabaseBrowserClient();
      const {
        data: { session },
        error,
      } = await client.auth.getSession();
      if (error || !session) {
        setFailed(true);
        return;
      }

      // Phase 2 of diner auth overhaul (2026-05-15): Apple Sign-In quirk.
      // Apple returns the diner's name + email ONLY on the FIRST sign-in.
      // Every subsequent sign-in returns just the user id. Capture the
      // metadata now (the Phase 1 trigger may have missed it if the
      // auth.users INSERT fired before `user_metadata` was populated).
      const provider = session.user.app_metadata?.provider as string | undefined;
      const meta = session.user.user_metadata ?? {};
      if (provider === "apple") {
        const appleName =
          (typeof meta.full_name === "string" && meta.full_name.trim()) ||
          (typeof meta.name === "string" && meta.name.trim()) ||
          null;
        if (appleName) {
          await client
            .from("user_profiles")
            .update({ full_name: appleName })
            .eq("auth_user_id", session.user.id)
            .is("full_name", null);
        }
      }

      const ctx = await loadUserContext(client, session);
      if (!ctx.ok) {
        setFailed(true);
        return;
      }

      // Phase 5: duplicate-account detection. Look for ANOTHER
      // user_profiles row with matching email OR phone but a different
      // auth_user_id. If found, surface the merge prompt instead of
      // redirecting onward — the diner picks merge vs keep-separate.
      try {
        const profileEmail = ctx.profile?.email?.trim().toLowerCase() ?? null;
        const profilePhone = ctx.profile?.phone?.trim() ?? null;
        if (profileEmail || profilePhone) {
          const orFilters: string[] = [];
          if (profileEmail) orFilters.push(`email.eq.${profileEmail}`);
          if (profilePhone) orFilters.push(`phone.eq.${profilePhone}`);
          const { data: dupes } = await client
            .from("user_profiles")
            .select("id, auth_user_id, email, phone, created_at")
            .neq("auth_user_id", session.user.id)
            .or(orFilters.join(","))
            .limit(1);
          const dupe = (dupes ?? [])[0] as
            | { id: string; auth_user_id: string; email: string | null; phone: string | null; created_at: string }
            | undefined;
          if (dupe) {
            // Choose canonical = OLDER profile. Diners who created their
            // first account longer ago have more history attached to it,
            // so keeping that one minimizes data movement.
            const dupeCreated = new Date(dupe.created_at).getTime();
            const meCreated = ctx.profile?.created_at
              ? new Date(ctx.profile.created_at).getTime()
              : Date.now();
            const canonicalIsDuplicate = dupeCreated < meCreated;
            const canonicalAuthUserId = canonicalIsDuplicate
              ? dupe.auth_user_id
              : session.user.id;
            const archivedAuthUserId = canonicalIsDuplicate
              ? session.user.id
              : dupe.auth_user_id;
            const archivedProfileId = canonicalIsDuplicate
              ? (ctx.profile?.id ?? null)
              : dupe.id;

            // Count bookings on the archived profile for the prompt copy.
            let archivedBookingCount = 0;
            if (archivedProfileId) {
              const { count } = await client
                .from("reservations")
                .select("id", { count: "exact", head: true })
                .eq("user_profile_id", archivedProfileId);
              archivedBookingCount = count ?? 0;
            }

            const matchedOn: "email" | "phone" | "both" =
              dupe.email && profileEmail && dupe.email.toLowerCase() === profileEmail
                ? dupe.phone && profilePhone && dupe.phone === profilePhone
                  ? "both"
                  : "email"
                : "phone";
            const matchedValue =
              matchedOn === "phone" ? profilePhone! : profileEmail!;

            setDuplicate({
              canonicalAuthUserId,
              archivedAuthUserId,
              matchedOn,
              matchedValue,
              archivedCreatedAt: canonicalIsDuplicate
                ? (ctx.profile?.created_at ?? new Date().toISOString())
                : dupe.created_at,
              archivedBookingCount,
            });
            return; // Stop here — modal owns the next step.
          }
        }
      } catch (err) {
        // Duplicate detection is best-effort. Any failure → continue to
        // normal post-login redirect. The diner can still link manually
        // from /account/connected-accounts later.
        console.warn("[auth/callback] duplicate-detection failed", err);
      }

      navigate(resolvePostLoginPath(from, ctx), { replace: true });
    })();
  }, [from, navigate]);

  const handleMergeDone = () => {
    setDuplicate(null);
    // Bounce to the post-login destination. The session may have been
    // killed by the auth.users delete if the diner was signed into the
    // duplicate; force a hard reload to re-establish.
    //
    // `from` comes from the URL search param — validate it so an
    // attacker can't pass `?from=https://evil.com` and redirect a
    // freshly-merged victim to a phishing page while authenticated.
    const safeTarget = from && isSafeRedirectPath(from) ? from : "/discover";
    window.location.href = safeTarget;
  };

  if (failed) {
    return (
      <AuthPageLayout titleKey="auth.oauth.title">
        <p className="text-muted-foreground text-center text-sm">{t("auth.oauth.error")}</p>
        <Button className="w-full" asChild>
          <Link to="/login">{t("auth.oauth.backLogin")}</Link>
        </Button>
      </AuthPageLayout>
    );
  }

  return (
    <>
      <RouteFallback />
      <AccountLinkPrompt info={duplicate} onDone={handleMergeDone} />
    </>
  );
}
