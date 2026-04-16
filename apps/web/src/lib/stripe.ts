import { loadStripe } from "@stripe/stripe-js";

const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

/**
 * Singleton Stripe.js instance.
 * Resolves to null when VITE_STRIPE_PUBLISHABLE_KEY is not set (test mode).
 */
export const stripePromise = key ? loadStripe(key) : null;

/**
 * True when Stripe keys are configured and real charges are enabled.
 * False in test/demo mode — card forms use the mock flow instead.
 */
export const isStripeConfigured = !!key;
