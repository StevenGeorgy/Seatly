import type { AuthError } from "@supabase/supabase-js";

/** i18n key under `auth.errors.signIn.*` */
export type SignInErrorI18nKey =
  | "auth.errors.signIn.invalidCredentials"
  | "auth.errors.signIn.emailNotConfirmed"
  | "auth.errors.signIn.userBanned"
  | "auth.errors.signIn.tooManyRequests"
  | "auth.errors.signIn.oauthOnly"
  | "auth.errors.signIn.generic";

/**
 * Maps Supabase Auth errors from signInWithPassword to stable i18n keys.
 * Message checks are defensive across GoTrue versions.
 */
export function signInErrorTranslationKey(error: AuthError | null): SignInErrorI18nKey {
  if (!error) return "auth.errors.signIn.generic";

  const msg = (error.message ?? "").toLowerCase();
  const code = (error as { code?: string }).code?.toLowerCase() ?? "";

  if (
    code === "email_not_confirmed" ||
    msg.includes("email not confirmed") ||
    msg.includes("confirm your email")
  ) {
    return "auth.errors.signIn.emailNotConfirmed";
  }

  if (code === "user_banned" || msg.includes("banned") || msg.includes("user is banned")) {
    return "auth.errors.signIn.userBanned";
  }

  if (
    error.status === 429 ||
    msg.includes("too many request") ||
    msg.includes("rate limit") ||
    code === "over_request_rate_limit"
  ) {
    return "auth.errors.signIn.tooManyRequests";
  }

  const looksLikeWrongPassword =
    msg.includes("invalid login credentials") ||
    msg.includes("invalid email or password") ||
    msg.includes("invalid password") ||
    msg.includes("wrong password") ||
    msg.includes("incorrect password") ||
    (msg.includes("invalid") &&
      (msg.includes("credential") || msg.includes("password") || msg.includes("email"))) ||
    code === "invalid_credentials" ||
    code === "invalid_grant";

  if (looksLikeWrongPassword) {
    return "auth.errors.signIn.invalidCredentials";
  }

  if (
    msg.includes("only for oauth") ||
    msg.includes("oauth") && msg.includes("password") ||
    msg.includes("signed up with") && msg.includes("google")
  ) {
    return "auth.errors.signIn.oauthOnly";
  }

  return "auth.errors.signIn.generic";
}
