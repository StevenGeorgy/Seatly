import type { UserFacingError } from "./types";

/**
 * Stripe surfaces errors in several shapes:
 *  - `StripeError` from stripe-js: `{ type, code, decline_code?, message, payment_intent? }`
 *  - SetupIntent / PaymentIntent submit errors with the same shape
 *  - Edge-fn responses that wrap Stripe errors as `{ error: "...", code: "..." }`
 *
 * We map by `decline_code` first (most specific), then `code`, then `type`.
 * See https://docs.stripe.com/error-codes for the full list — these are the
 * ones diners actually hit.
 */

type DeclineCode =
  | "insufficient_funds"
  | "lost_card"
  | "stolen_card"
  | "expired_card"
  | "incorrect_cvc"
  | "card_velocity_exceeded"
  | "do_not_honor"
  | "fraudulent"
  | "generic_decline"
  | "pickup_card"
  | "transaction_not_allowed"
  | "currency_not_supported";

type StripeCode =
  | "card_declined"
  | "expired_card"
  | "incorrect_cvc"
  | "incorrect_number"
  | "incomplete_number"
  | "incomplete_cvc"
  | "incomplete_expiry"
  | "invalid_expiry_month"
  | "invalid_expiry_year"
  | "invalid_number"
  | "authentication_required"
  | "processing_error"
  | "api_connection_error"
  | "rate_limit";

const DECLINE_MESSAGES: Record<DeclineCode, string> = {
  insufficient_funds: "That card doesn't have enough funds. Try a different card.",
  lost_card: "That card was reported lost. Use a different card.",
  stolen_card: "That card was reported stolen. Use a different card.",
  expired_card: "That card has expired. Try a different card.",
  incorrect_cvc: "The security code (CVC) doesn't match. Double-check it.",
  card_velocity_exceeded:
    "Your card hit its transaction limit. Try a different card or wait a bit.",
  do_not_honor: "Your bank declined the card. Try a different card or call your bank.",
  fraudulent:
    "Your bank declined the card for suspected fraud. Call your bank or use a different card.",
  generic_decline: "Your card was declined. Try a different card or call your bank.",
  pickup_card: "That card can't be used. Use a different card.",
  transaction_not_allowed:
    "Your card doesn't allow this kind of payment. Try a different card.",
  currency_not_supported:
    "Your card doesn't support payments in this currency. Use a different card.",
};

const CODE_MESSAGES: Record<StripeCode, string> = {
  card_declined: "Your card was declined. Try a different card or call your bank.",
  expired_card: "That card has expired. Try a different card.",
  incorrect_cvc: "The security code (CVC) doesn't match. Double-check it.",
  incorrect_number: "That card number isn't valid. Double-check it.",
  incomplete_number: "Finish entering the card number.",
  incomplete_cvc: "Finish entering the security code (CVC).",
  incomplete_expiry: "Finish entering the expiration date.",
  invalid_expiry_month: "Check the expiration month on your card.",
  invalid_expiry_year: "Check the expiration year on your card.",
  invalid_number: "That card number isn't valid. Double-check it.",
  authentication_required:
    "Your bank wants to verify this payment. Complete the prompt to finish.",
  processing_error: "Couldn't process the card. Try again in a moment.",
  api_connection_error: "We couldn't reach the payment service. Try again.",
  rate_limit: "Too many payment attempts. Wait a minute and try again.",
};

function looksLikeStripeError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const obj = e as { type?: string; code?: string; decline_code?: string };
  // Stripe error objects always have a `type` (e.g. "card_error",
  // "validation_error", "api_error") or a `decline_code`.
  if (typeof obj.decline_code === "string") return true;
  if (typeof obj.type === "string" && obj.type.endsWith("_error")) return true;
  return false;
}

export function tryMapStripeError(error: unknown): UserFacingError | null {
  if (!looksLikeStripeError(error)) return null;

  const e = error as {
    type?: string;
    code?: string;
    decline_code?: string;
    message?: string;
  };

  // Decline code is the most specific.
  if (e.decline_code) {
    const declineMsg = DECLINE_MESSAGES[e.decline_code as DeclineCode];
    if (declineMsg) {
      return {
        code: `stripe_${e.decline_code}`,
        message: declineMsg,
        source: "stripe",
        retryable: true,
        technical: e,
      };
    }
  }

  // Then code.
  if (e.code) {
    const codeMsg = CODE_MESSAGES[e.code as StripeCode];
    if (codeMsg) {
      const retryable =
        e.code === "processing_error" ||
        e.code === "api_connection_error" ||
        e.code === "rate_limit" ||
        e.code === "card_declined";
      return {
        code: `stripe_${e.code}`,
        message: codeMsg,
        source: "stripe",
        retryable,
        technical: e,
      };
    }
  }

  // Type-level fallback.
  if (e.type === "validation_error") {
    return {
      code: "stripe_validation",
      message: "Check your card details and try again.",
      source: "stripe",
      retryable: false,
      technical: e,
    };
  }

  if (e.type === "api_error" || e.type === "api_connection_error") {
    return {
      code: "stripe_api_down",
      message: "The payment service is having trouble. Try again in a minute.",
      source: "stripe",
      retryable: true,
      technical: e,
    };
  }

  // Unknown Stripe error — return a friendly generic.
  return {
    code: "stripe_unknown",
    message: "We couldn't process that payment. Try again or use a different card.",
    source: "stripe",
    retryable: true,
    technical: e,
  };
}
