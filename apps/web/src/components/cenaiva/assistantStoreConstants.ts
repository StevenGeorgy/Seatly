import type { BookingState } from "@cenaiva/assistant";

// Statuses where the assistant should NOT auto-reopen the mic after a turn.
//
// As of 2026-05-10 the voice flow no longer enters the preorder / menu /
// checkout / tipping / payment statuses — those are now hand-off paths to
// the public restaurant page (see cenaiva-orchestrate preorder + deposit
// hand-off). The mic should be on whenever the assistant is open, EXCEPT:
//   1. while AI TTS is speaking (already handled by `voice.speak()`),
//   2. while the user has muted the mic manually (see `useCenaivaVoice.isMuted`),
//   3. during the brief `paid` window — auto-closes 1.5s later anyway, no
//      point reopening the mic for chatter that won't be acted on.
// All other statuses fall through to the auto-resume path.
export const NO_AUTO_RELISTEN_STATUSES: ReadonlySet<BookingState["status"]> = new Set([
  "paid",
]);

export const RELISTEN_AFTER_RESPONSE_MS = 260;
