import type { AuthError } from "@supabase/supabase-js";

import { signInErrorTranslationKey } from "@/lib/auth/map-sign-in-error";

import type { UserFacingError } from "./types";

/**
 * Plain-English fallbacks for the existing `auth.errors.signIn.*` i18n keys.
 * Mirrors `apps/web/src/locales/en/common.ts` — keep in sync if the locale
 * text shifts. We translate when an i18next instance is around; otherwise
 * fall back to these literals so non-i18n callers still get friendly text.
 */
const SIGN_IN_FALLBACK: Record<string, string> = {
  "auth.errors.signIn.invalidCredentials":
    "That email or password isn't right. If you signed up with Google, use that button.",
  "auth.errors.signIn.emailNotConfirmed":
    "Check your inbox for the confirmation email, then try again.",
  "auth.errors.signIn.userBanned":
    "This account can't sign in. Contact support if you think this is a mistake.",
  "auth.errors.signIn.tooManyRequests":
    "Too many attempts. Wait a minute and try again.",
  "auth.errors.signIn.oauthOnly":
    "This account was created with Google. Use “Continue with Google” to sign in.",
  "auth.errors.signIn.generic": "Couldn't sign in. Check your email and password.",
};

function looksLikeAuthError(e: unknown): e is AuthError {
  if (!e || typeof e !== "object") return false;
  const obj = e as { name?: string; __isAuthError?: boolean; status?: number };
  return (
    obj.__isAuthError === true ||
    obj.name === "AuthApiError" ||
    obj.name === "AuthRetryableFetchError" ||
    obj.name === "AuthSessionMissingError"
  );
}

/**
 * Map Supabase auth errors (sign-in, sign-up, OTP, password reset, magic link)
 * to friendly text. OTP and password-reset paths in particular have no
 * existing mapper today — recon flagged these as zero-coverage.
 */
export function tryMapAuthError(error: unknown): UserFacingError | null {
  if (!looksLikeAuthError(error)) return null;

  const e = error as AuthError & { code?: string };
  const msg = (e.message ?? "").toLowerCase();
  const code = (e.code ?? "").toLowerCase();
  const status = e.status ?? 0;

  // OTP-specific codes (sms_send_failed, otp_expired, otp_disabled, etc.)
  if (code === "otp_expired" || msg.includes("token has expired")) {
    return {
      code: "otp_expired",
      message: "That code expired. Tap “Resend code” to get a new one.",
      source: "auth",
      retryable: true,
      technical: e,
    };
  }

  if (
    code === "invalid_otp" ||
    msg.includes("invalid otp") ||
    msg.includes("token is invalid")
  ) {
    return {
      code: "otp_invalid",
      message: "That code didn't match. Double-check it or tap “Resend”.",
      source: "auth",
      retryable: true,
      technical: e,
    };
  }

  if (code === "sms_send_failed" || msg.includes("sms could not be sent")) {
    return {
      code: "sms_failed",
      message: "We couldn't send the code. Check your phone number and try again.",
      source: "auth",
      retryable: true,
      technical: e,
    };
  }

  if (
    code === "phone_provider_disabled" ||
    code === "sms_provider_disabled" ||
    msg.includes("sms provider")
  ) {
    return {
      code: "sms_provider_down",
      message:
        "Text-message sign-in is unavailable right now. Try email sign-in.",
      source: "auth",
      retryable: false,
      technical: e,
    };
  }

  // Password reset / magic link
  if (code === "email_send_failed" || msg.includes("email could not be sent")) {
    return {
      code: "email_send_failed",
      message: "We couldn't send the email. Try again in a minute.",
      source: "auth",
      retryable: true,
      technical: e,
    };
  }

  // Sign-up: account already exists
  if (
    code === "user_already_exists" ||
    msg.includes("user already registered") ||
    msg.includes("already been registered")
  ) {
    return {
      code: "account_exists",
      message: "That email already has an account. Try signing in instead.",
      source: "auth",
      retryable: false,
      technical: e,
    };
  }

  // Weak password
  if (code === "weak_password" || msg.includes("password should be at least")) {
    return {
      code: "weak_password",
      message: "Pick a longer password (at least 8 characters).",
      source: "auth",
      retryable: false,
      technical: e,
    };
  }

  // Rate limit (general)
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many request")) {
    return {
      code: "rate_limited",
      message: "Too many attempts. Wait a minute and try again.",
      source: "auth",
      retryable: true,
      technical: e,
    };
  }

  // Session expired / missing
  if (
    code === "session_not_found" ||
    e.name === "AuthSessionMissingError" ||
    msg.includes("jwt expired") ||
    msg.includes("session_not_found")
  ) {
    return {
      code: "session_expired",
      message: "Your session ended. Sign in again to continue.",
      source: "auth",
      retryable: false,
      technical: e,
    };
  }

  // Fall through to the existing sign-in mapper for credential errors.
  const key = signInErrorTranslationKey(e);
  return {
    code: key.split(".").pop() ?? "auth_error",
    message: SIGN_IN_FALLBACK[key] ?? SIGN_IN_FALLBACK["auth.errors.signIn.generic"],
    source: "auth",
    retryable: key === "auth.errors.signIn.tooManyRequests",
    technical: e,
  };
}
