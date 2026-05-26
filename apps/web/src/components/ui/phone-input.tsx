// Shared phone-number input. Drops non-digits as the user types, hard
// caps at 10 NA digits, and reformats live to "+1 (XXX) XXX-XXXX". The
// goal is consistent UX everywhere a phone is collected in the app
// (account profile, booking checkout, demo form, onboarding wizards,
// staff guest-add, etc.) plus an end to the screenshot bug where
// people could paste "+12894000883WWW" and the system swallowed it.
//
// Contract:
//   - `value`: whatever the form is storing for this field. Can be any
//     string — raw user input, an E.164 number from the DB, a previous
//     formatted display value. The component re-formats internally.
//   - `onChange(formatted)`: fires with the new formatted display
//     string (e.g. "+1 (289) 400-0883"). Form state should just store
//     that. At submit time, run `normalizeE164Phone()` to get the
//     canonical E.164 shape the server expects.
//
// Why not return E.164 from onChange? Because forms historically store
// the raw user input and normalize at submit (see RestaurantPublicPage
// guest checkout). Returning the formatted string keeps that pattern
// intact; partial typing stays visible in the field instead of
// blinking back to empty until the 10th digit lands.

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatNorthAmericanAsTyping } from "@/lib/validation/phone-schemas";

export interface PhoneInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type" | "inputMode" | "maxLength"
  > {
  value: string;
  onChange: (formatted: string) => void;
  /** Visual error state — adds a destructive border. Set true when
   * the field has a validation message displayed below it. */
  error?: boolean;
}

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, error, className, placeholder, ...rest }, ref) => {
    // Whatever was passed in (raw, E.164, partial) is re-run through
    // the formatter so the visible value is always canonical.
    const display = React.useMemo(
      () => formatNorthAmericanAsTyping(value ?? ""),
      [value],
    );

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(formatNorthAmericanAsTyping(event.target.value));
    };

    return (
      <Input
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        // 18 chars covers "+1 (XXX) XXX-XXXX" plus a little slack.
        // The formatter caps at 10 digits regardless of what the user
        // pastes, so this is just belt-and-suspenders against very
        // long pastes flickering before they're sliced.
        maxLength={18}
        value={display}
        onChange={handleChange}
        placeholder={placeholder ?? "+1 (289) 400-0883"}
        aria-invalid={error || undefined}
        className={cn(error && "border-destructive", className)}
        {...rest}
      />
    );
  },
);
PhoneInput.displayName = "PhoneInput";

export { PhoneInput };
