// Helper for the `setup_intent_unexpected_state` idempotency dance.
//
// When the user clicks Save Card and Stripe confirms the SetupIntent
// successfully, but the follow-up edge fn call (save-subscription-
// payment-method or update-subscription-payment-method) fails for some
// reason (network blip, transient 500, etc.), the user retries by
// clicking Save Card again WITHOUT refreshing. The SetupIntent is
// already in the `succeeded` state, and Stripe rejects re-confirmation
// with code `setup_intent_unexpected_state`.
//
// The recovery: pull the already-succeeded SetupIntent off the error
// payload, extract its PaymentMethod id, and proceed to the save step
// as if confirm had returned cleanly. This avoids forcing a refresh
// + re-tokenize on every transient downstream failure.
//
// This module deliberately does NOT call confirmSetup itself — that
// happens in the call site. It only parses the error shape Stripe
// returns and surfaces the PaymentMethod id (or an explanation if it
// can't be recovered).

/**
 * Type narrower for the error returned by `stripe.confirmSetup`. Stripe's
 * types don't expose `code` + `setup_intent` on the StripeError union, so
 * we treat the value structurally.
 */
export function recoverFromSetupIntentUnexpectedState(
  confirmError: unknown,
):
  | { recovered: true; paymentMethodId: string }
  | { recovered: false; reason: string } {
  if (!confirmError || typeof confirmError !== "object") {
    return { recovered: false, reason: "no_error_payload" };
  }
  const errObj = confirmError as {
    code?: string;
    setup_intent?: { status?: string; payment_method?: string };
  };
  if (errObj.code !== "setup_intent_unexpected_state") {
    return { recovered: false, reason: "code_mismatch" };
  }
  const si = errObj.setup_intent;
  if (!si || si.status !== "succeeded") {
    return { recovered: false, reason: "si_not_succeeded" };
  }
  if (typeof si.payment_method !== "string") {
    return { recovered: false, reason: "no_payment_method" };
  }
  return { recovered: true, paymentMethodId: si.payment_method };
}
