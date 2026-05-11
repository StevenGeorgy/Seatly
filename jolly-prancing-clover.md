# Hey Cenaiva — Mobile → Web Mirror Integration Plan

> **Document scope:** the field manual for bringing `StevenGeorgy/Seatly` `apps/web/` to byte-for-byte behavioral parity with the mobile Hey Cenaiva implementation at `/Users/stevengeorgy/mobile-seatly-v2-4`. Mobile is the canonical source of truth. The shared Supabase project (edge functions, DB schema, RLS) is unchanged — web only changes how it *consumes* the same endpoints. The web wake-word code (`apps/web/src/hooks/useCenaivaWakeWord.ts`) is **explicitly out of scope** and must not be modified at any point during this work.
>
> **Audience:** the engineer (you, the user, or a future Claude session) who will execute the plan in the Seatly monorepo.
>
> **Length & density:** this document is intentionally exhaustive. Skim the table of contents first, then read end-to-end before writing any code. Every section ties to either a specific file you will edit, a specific behavior you will verify, or a specific test you will run.

---

## Table of contents

1. [Context — why this work is needed](#1-context--why-this-work-is-needed)
2. [Goals, non-goals, and definition of done](#2-goals-non-goals-and-definition-of-done)
3. [Architecture overview](#3-architecture-overview)
4. [Critical files inventory](#4-critical-files-inventory)
5. [Behavioral gap matrix (mobile → web)](#5-behavioral-gap-matrix-mobile--web)
6. [Implementation order — 11 steps](#6-implementation-order--11-steps)
   - [Step 1 — Shared schema parity (`packages/assistant`)](#step-1--shared-schema-parity-packagesassistant)
   - [Step 2 — Port standalone helpers (no React)](#step-2--port-standalone-helpers-no-react)
   - [Step 3 — `buildWakeGreeting` + state-machine deltas](#step-3--buildwakegreeting--state-machine-deltas)
   - [Step 4 — Voice preference provider (web-flavored)](#step-4--voice-preference-provider-web-flavored)
   - [Step 5 — ElevenLabs streaming chunk queue + persistent cache](#step-5--elevenlabs-streaming-chunk-queue--persistent-cache)
   - [Step 6 — Add `prewarm` + `onTransport` + new fast-path hooks](#step-6--add-prewarm--ontransport--new-fast-path-hooks)
   - [Step 7 — Latency budget hook](#step-7--latency-budget-hook)
   - [Step 8 — The big rewrite: `AssistantProvider.sendTranscript`](#step-8--the-big-rewrite-assistantprovidersendtranscript)
   - [Step 9 — Voice ID propagation](#step-9--voice-id-propagation)
   - [Step 10 — Backend audit (no edits)](#step-10--backend-audit-no-edits)
   - [Step 11 — Env, types, and cleanup](#step-11--env-types-and-cleanup)
7. [Edge-case behavior matrix](#7-edge-case-behavior-matrix)
8. [Verification — end-to-end test plan](#8-verification--end-to-end-test-plan)
9. [Risks, rollback, and mitigations](#9-risks-rollback-and-mitigations)
10. [Performance baseline and targets](#10-performance-baseline-and-targets)
11. [Browser compatibility considerations](#11-browser-compatibility-considerations)
12. [PR / commit message conventions](#12-pr--commit-message-conventions)
13. [Appendix A — Mobile source excerpts (verbatim, for porting)](#appendix-a--mobile-source-excerpts-verbatim-for-porting)
14. [Appendix B — Full TypeScript surface diffs](#appendix-b--full-typescript-surface-diffs)
15. [Appendix C — Sequence diagrams](#appendix-c--sequence-diagrams)
16. [Appendix D — Cross-app parity smoke script](#appendix-d--cross-app-parity-smoke-script)

---

## 1. Context — why this work is needed

Both the local mobile repo (`/Users/stevengeorgy/mobile-seatly-v2-4`) and the Seatly web monorepo's `apps/web/` ship Hey Cenaiva end-to-end against a **shared Supabase backend** (one project, one set of edge functions, one schema). They have diverged. Concretely:

- The web `AssistantProvider` is **660 lines** with a single, monolithic `sendTranscript` that always hits `cenaiva-orchestrate`. Every utterance — "yes", "table for 4", "what's your refund policy", "are they open at 7?" — pays the full 5–35s tool-loop tax of the LLM orchestrator.
- The mobile `CenaivaAssistantProvider` is **1,244 lines** with a **four-stage pipeline**: (1) local booking collector → (2) availability fast-path → (3) small-prompt fast-path → (4) full orchestrator. Most simple turns never reach the LLM. The result: mobile feels conversational, web feels laggy on the same network and same backend.
- Mobile has accumulated rich helpers — `confirmationIntent`, `recommendationIntent`, `simplePromptIntent`, `filterRestaurants`, `localBookingCollector`, `buildWakeGreeting`, `latencyBudget` — none of which exist on web.
- Mobile persists a per-user **voice preference** (male/female ElevenLabs ID) in `user_profiles.cenaiva_tts_voice` *and* AsyncStorage. Web speaks with the default voice; the column already exists in the shared DB but is read by no web code.
- Mobile's TTS layer maintains a **persistent cache** of common phrases ("One moment please.", "How many guests?", etc.) keyed by `${voiceId}:${normalizedText}` with a versioned hash so the very first user gesture has audio ready. Web has no such cache.
- Mobile's auto-relisten gate excludes **9** booking statuses (`offering_preorder`, `browsing_menu`, `reviewing_cart`, `choosing_tip_timing`, `choosing_tip_amount`, `choosing_payment_split`, `charging`, `paid`, `post_booking`). Web's gate excludes only **2**. As a result, web reopens the mic during checkout and tip-collection states it shouldn't.
- Mobile sends **`assistant_memory`** (discovery + booking_process context) and **`recommendation_mode`** (`'single' | 'list'`) on every orchestrator request. Web sends neither. The orchestrator's "which one do you want?" / "I'd go with X" anti-repetition behavior depends on these fields. Without them the orchestrator runs hotter and re-asks questions web users already answered.
- Today's local mobile change set introduces **`searchFallback.ts`** — a deterministic zero-result fallback that scores active restaurants when an exact search returns nothing and emits "I don't see Middle Eastern restaurants in Toronto matching that. I'd recommend Levant Toronto instead." This change lives in the orchestrator edge function, which is shared; once deployed it benefits both apps. Mobile's local copy is uncommitted as of 2026-05-08.

### Why now

The user wants the two surfaces to feel identical. They have observed (and explicitly noted) that the web wake word works perfectly and should be left untouched. Everything else needs to mirror mobile.

### What this plan does NOT do

- Does not modify the mobile app. The mobile repo is the *reference*, not the *target*.
- Does not modify the wake-word recognizer (`apps/web/src/hooks/useCenaivaWakeWord.ts`). It is explicitly excluded from every step.
- Does not refactor or remove the legacy web Cenaiva drawer (`CenaivaProvider.tsx` / `CenaivaDrawer.tsx` / `useCenaivaChat.ts` / `cenaiva-chat` edge function). That is a separate, already-flagged cleanup effort.
- Does not change backend code beyond verifying that today's `searchFallback.ts` work has been deployed to the shared Supabase project.

---

## 2. Goals, non-goals, and definition of done

### Goals

1. **Same user utterance → same backend behavior**, regardless of which surface the user is on.
2. **Same latency budget** on both surfaces under the same network conditions.
3. **Same voice (literal vocal timbre) per user**, persisted across devices.
4. **Same conversational state machine**, i.e., auto-relisten gating, anti-double-speak, and turn lifecycle exactly match mobile.
5. **No regressions** on web's existing strengths: anti-double-speak guard, `sayGoodbyeAndClose` ergonomics, wake-word stability, the "force stop wake word synchronously before opening command recognizer" fix.

### Non-goals

- Adding new features that exist on neither side.
- Refactoring legacy code unrelated to Hey Cenaiva.
- Making the mobile and web codebases share a single TypeScript module via npm — the `@cenaiva/assistant` package is sufficient as the shared schema; runtime helpers stay duplicated by deliberate copy.
- Adding browser-side wake-word work. Wake word is preserved as-is.

### Definition of done

This plan is complete when **all of the following** hold:

- Every checkbox in [Section 8 — Verification](#8-verification--end-to-end-test-plan) passes against the shared Supabase project from `apps/web` running locally and from the deployed web app.
- A manual cross-app diff (Appendix D) of one user's identical 11-utterance session on mobile and web yields request bodies whose `assistant_memory`, `recommendation_mode`, `voice_id`, and `booking_state` fields are field-equivalent.
- `npm run lint && npm run build && npm run test --workspace=apps/web` passes on a clean checkout of the merged branch.
- The web wake-word file (`apps/web/src/hooks/useCenaivaWakeWord.ts`) has zero diff against `main` after all PRs land.

---

## 3. Architecture overview

### 3.1 The four-stage turn pipeline (target state for web)

A "turn" is one user utterance and the assistant's response to it. The pipeline below mirrors mobile (`lib/cenaiva/CenaivaAssistantProvider.tsx:338-915`).

```
┌──────────────────────────────────────────────────────────────────────┐
│ User: "table for 4 at 7"  (or types in text mode)                    │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ sendTranscript(transcript, opts)                                     │
│ ── stop listening, status='processing', allocate turnId              │
│ ── compute helpers: shouldRouteAsConfirmation, isProcessPrompt,      │
│    getRecommendationMode                                             │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────┐
│ STAGE 1: localBookingCollector — planLocalBookingTurn(...)            │
│ ── 'local_response' → speak it, relisten if appropriate; STOP HERE   │
│ ── 'check_availability' → STAGE 2                                     │
│ ── 'pass' → STAGE 3                                                  │
└────────────────────────────┘
        │ ('check_availability')
        ▼
┌────────────────────────────┐
│ STAGE 2: cenaiva-availability fast-path                               │
│ ── speak filler "One moment please." (cached, no network)            │
│ ── POST /cenaiva-availability, 20s timeout                           │
│ ── apply availability response, schedule relisten                    │
│ ── STOP HERE                                                         │
└────────────────────────────┘
        │ ('pass' from Stage 1)
        ▼
┌────────────────────────────┐
│ STAGE 3: cenaiva-small-prompt fast-path (off-topic Q&A)              │
│ ── only if !isBookingConfirmationReply && !isProcessPrompt           │
│ ── POST /cenaiva-small-prompt, 8s AbortController timeout            │
│ ── on success: apply, speak, relisten; STOP HERE                     │
│ ── on null/error: fall through to STAGE 4                            │
└────────────────────────────┘
        │
        ▼
┌────────────────────────────┐
│ STAGE 4: cenaiva-orchestrate (full LLM tool loop, SSE)               │
│ ── POST /cenaiva-orchestrate with `recommendation_mode`,             │
│    `assistant_memory`, voice_id                                      │
│ ── SSE callbacks: onSpeechChunk → speakStreamingChunk(),             │
│    onDiscardPendingSpeech → discardStreamingSpeech(),                │
│    onTransport → latency.markTransport()                             │
│ ── on `final` frame: APPLY_RESPONSE, anti-double-speak, ui_actions   │
│ ── relisten if booking.status not in NO_AUTO_RELISTEN_STATUSES       │
└────────────────────────────┘
```

### 3.2 Latency budget per stage

Approximate, with warm Supabase + warm OpenAI + 50ms RTT:

| Stage | Typical end-to-end latency | When it applies |
|---|---|---|
| 1 (local) | 0–50ms (no network) | Missing-field prompts, ambiguous-time disambig, pending-option pick |
| 2 (availability) | 200–800ms | Hours queries, booking-collection availability checks |
| 3 (small-prompt) | 400–1500ms | Off-topic Q&A ("what's your refund policy") |
| 4 (orchestrator) | 1500–8000ms (TTFT 600–1500ms via SSE) | Anything requiring tool use: search, complete_booking, get_menu, charge_saved_card |

Without stages 1–3, **every** utterance hits stage 4. That's the present web experience.

### 3.3 Component dependency graph (target state)

```
                       <App>
                         │
                  <AuthProvider>
                         │
        <CenaivaVoicePreferenceProvider>          ◄── NEW (Step 4)
                         │
            <AssistantStoreProvider>
                         │
              <AssistantInner>
        ┌──────────┬─────┴──────┬──────────────┬─────────────────────┐
useCenaivaOrchestrator  useCenaivaVoice    useCenaivaWakeWord   useCenaivaSmallPrompt  ◄── NEW (Step 6)
        │              │                                         useCenaivaAvailability ◄── NEW (Step 6)
   prewarm()      useElevenLabsTTS    (UNCHANGED)                useCenaivaLatencyBudget ◄── NEW (Step 7)
   onTransport    + chunk queue
                  + IndexedDB cache
                  (Step 5)
                  │
            useDeepgramTranscription
            (UNCHANGED)
```

---

## 4. Critical files inventory

### 4.1 Mobile (canonical — read-only reference)

Sizes from the local working tree, current as of 2026-05-08:

| Lines | Path |
|---:|---|
| 1,210 | `lib/cenaiva/localBookingCollector.ts` |
|   297 | `lib/cenaiva/recommendationIntent.ts` |
|   127 | `lib/cenaiva/filterRestaurants.ts` |
|    75 | `lib/cenaiva/simplePromptIntent.ts` |
|    45 | `lib/cenaiva/confirmationIntent.ts` |
|   583 | `lib/cenaiva/state/assistantStore.tsx` |
| 1,244 | `lib/cenaiva/CenaivaAssistantProvider.tsx` |
|   426 | `lib/cenaiva/api/useCenaivaOrchestrator.ts` |
|   119 | `lib/cenaiva/api/getCenaivaSmallPrompt.ts` |
|    76 | `lib/cenaiva/api/checkCenaivaAvailability.ts` |
|   180 | `lib/cenaiva/voice/CenaivaVoicePreferenceProvider.tsx` |
|   625 | `lib/cenaiva/voice/useMobileTTS.ts` |
|   578 | `lib/cenaiva/voice/useCenaivaWakeWord.ts` |
|   264 | `supabase/functions/cenaiva-orchestrate/searchFallback.ts` (NEW, untracked) |
|   135 | `supabase/functions/cenaiva-orchestrate/searchFallback.test.ts` (NEW, untracked) |
| (mod) | `supabase/functions/cenaiva-orchestrate/index.ts` (modified, +69/-3 today) |

Verbatim source for the smaller helpers is reproduced in [Appendix A](#appendix-a--mobile-source-excerpts-verbatim-for-porting).

### 4.2 Web (target — to be modified)

Sizes from the GitHub `main` branch, current as of 2026-05-08:

| Lines | Path | Action |
|---:|---|---|
| 554 | `apps/web/src/components/cenaiva/AssistantStore.tsx` | **Modify**: ensure `memory`, `RESET_ASSISTANT_CONTEXT`, `NO_AUTO_RELISTEN_STATUSES` (Step 3) |
| 660 | `apps/web/src/components/cenaiva/AssistantProvider.tsx` | **Major rewrite of `sendTranscript`** (Step 8) |
| 182 | `apps/web/src/hooks/useCenaivaOrchestrator.ts` | **Modify**: add `prewarm()`, `onTransport` (Step 6) |
| 174 | `apps/web/src/hooks/useCenaivaVoice.ts` | **Modify**: surface streaming TTS API (Step 5) |
| 241 | `apps/web/src/hooks/useElevenLabsTTS.ts` | **Modify**: add chunk queue + IndexedDB (Step 5) |
| 500 | `apps/web/src/hooks/useDeepgramTranscription.ts` | **No change** |
| 219 | `apps/web/src/hooks/useCenaivaWakeWord.ts` | **DO NOT MODIFY** (per user direction) |
| 315 | `apps/web/src/hooks/useCenaivaSpeech.ts` | **No change** |
| 218 | `packages/assistant/src/schema.ts` | **Verify/extend** — `assistant_memory`, `recommendation_mode`, `selected_restaurant_id` (Step 1) |
| ? | `packages/assistant/src/types.ts` | **Verify** `AssistantMemory` exists |

### 4.3 Web — new files to create

| Path | Step | Purpose |
|---|---|---|
| `apps/web/src/lib/cenaiva/confirmationIntent.ts` | 2 | Direct port from mobile, 45 lines |
| `apps/web/src/lib/cenaiva/recommendationIntent.ts` | 2 | Direct port from mobile, 297 lines |
| `apps/web/src/lib/cenaiva/simplePromptIntent.ts` | 2 | Direct port from mobile, 75 lines |
| `apps/web/src/lib/cenaiva/filterRestaurants.ts` | 2 | Adapted port (web uses different `Restaurant` type), 127 lines |
| `apps/web/src/lib/cenaiva/localBookingCollector.ts` | 2 | Direct port from mobile, ~1,210 lines |
| `apps/web/src/lib/cenaiva/buildWakeGreeting.ts` | 3 | New 30-line helper |
| `apps/web/src/contexts/CenaivaVoicePreferenceProvider.tsx` | 4 | localStorage adaptation of mobile provider |
| `apps/web/src/lib/cenaiva/voicePreference.ts` | 4 | Helper: `getCenaivaTtsVoiceId`, `normalizeCenaivaTtsVoice` |
| `apps/web/src/pages/customer/AccountVoicePage.tsx` | 4 | Mirror of mobile's profile/cenaiva-voice screen |
| `apps/web/src/hooks/useCenaivaSmallPrompt.ts` | 6 | POST helper for `/cenaiva-small-prompt` |
| `apps/web/src/hooks/useCenaivaAvailability.ts` | 6 | POST helper for `/cenaiva-availability` (NB: not the same as `useAvailability.ts`) |
| `apps/web/src/hooks/useCenaivaLatencyBudget.ts` | 7 | Per-turn checkpoint hook |
| `apps/web/src/lib/cenaiva/__tests__/confirmationIntent.test.ts` | 2 | Vitest port |
| `apps/web/src/lib/cenaiva/__tests__/recommendationIntent.test.ts` | 2 | Vitest port |
| `apps/web/src/lib/cenaiva/__tests__/simplePromptIntent.test.ts` | 2 | Vitest port |
| `apps/web/src/lib/cenaiva/__tests__/filterRestaurants.test.ts` | 2 | Vitest port |
| `apps/web/src/lib/cenaiva/__tests__/localBookingCollector.test.ts` | 2 | Vitest port (largest test file) |

### 4.4 Out of scope — DO NOT modify

| Path | Reason |
|---|---|
| `apps/web/src/hooks/useCenaivaWakeWord.ts` | User direction: working perfectly, leave alone |
| `apps/web/src/components/cenaiva/CenaivaProvider.tsx` | Legacy dashboard drawer, separate cleanup |
| `apps/web/src/components/cenaiva/CenaivaDrawer.tsx` | Legacy dashboard drawer |
| `apps/web/src/components/cenaiva/CenaivaMessageBubble.legacy.tsx` | Legacy |
| `apps/web/src/hooks/useCenaivaChat.ts` | Legacy chat hook |
| `supabase/functions/cenaiva-chat/` | Legacy edge function |
| All other `supabase/functions/**` | Backend is shared; backend code is canonical from mobile |

---

## 5. Behavioral gap matrix (mobile → web)

Severity legend: **🔴 critical** (user-visible, hits every turn), **🟠 high** (user-visible, hits common flows), **🟡 medium** (perf or polish), **🟢 low** (developer ergonomics).

| # | Behavior | Severity | Mobile location | Web today | Fixed in step |
|---|---|---|---|---|---|
| 1 | Local booking collector fast path | 🔴 | `lib/cenaiva/localBookingCollector.ts` + `CenaivaAssistantProvider.tsx:450-465` | Always orchestrator | 2 + 8 |
| 2 | Small-prompt fast path | 🔴 | `getCenaivaSmallPrompt.ts` + provider 571-643 | Not implemented | 6 + 8 |
| 3 | Availability fast path with cached filler | 🟠 | `checkCenaivaAvailability.ts` + provider 467-569 | `useAvailability.ts` only fronts public `get-availability` | 6 + 8 |
| 4 | `recommendation_mode` field on request | 🔴 | `recommendationIntent.ts:70` | Not sent | 1 + 2 + 8 |
| 5 | Confirmation intent routing | 🟠 | `confirmationIntent.ts:30` | Not used | 2 + 8 |
| 6 | Process-prompt detection | 🟠 | `simplePromptIntent.ts:42` | Not used | 2 + 8 |
| 7 | `assistant_memory` field on request + state | 🔴 | `assistantStore.tsx` `mergeAssistantMemory` | State has no `memory` | 1 + 3 + 8 |
| 8 | Latency budget checkpoints | 🟡 | provider 192-215 | None | 7 + 8 |
| 9 | Auto-relisten gating (9 statuses, not 2) | 🟠 | provider `NO_AUTO_RELISTEN_STATUSES` | Web gates only `offering_preorder`, `browsing_menu` | 3 + 8 |
| 10 | Prewarm orchestrator + small-prompt | 🟡 | provider 1067-1069 | Only Deepgram token prefetched | 6 + 8 |
| 11 | Wake greeting personalization | 🟡 | `buildWakeGreeting()` + provider 1105 | `onWake` opens with bare autoListen | 3 + 8 |
| 12 | Voice preference (male/female) | 🟠 | `CenaivaVoicePreferenceProvider.tsx` | Not implemented | 4 + 9 |
| 13 | TTS persistent cache for common phrases | 🟡 | `useMobileTTS.ts:43-53, 187-197` | None | 5 |
| 14 | Streaming TTS chunk queue + drain/discard | 🟠 | `useMobileTTS.ts:9-14, 724-727, 780, 860-871` | Ad-hoc | 5 |
| 15 | Anti-double-speak guard | ✅ already implemented on web | — | provider 319-341 | Preserve in Step 8 |
| 16 | `sayGoodbyeAndClose` | ✅ web-only ergonomic | — | Preserve in Step 8 | — |
| 17 | `searchFallback.ts` zero-result logic (today's mobile change) | 🟡 | `supabase/functions/cenaiva-orchestrate/{searchFallback.ts,searchFallback.test.ts,index.ts}` | Backend deployment status unverified | 10 |

---

## 6. Implementation order — 11 steps

> **Sequencing rationale:** Schema first (Step 1) — every later step compiles against it. Pure helpers next (Step 2) — they're risk-free, easily unit-tested, and unblock Step 8. Voice infrastructure (Steps 3–7) — each independently shippable, none of them changes user behavior alone. The big rewrite (Step 8) is last because it depends on everything above. Steps 9–11 are polish.

### Step 1 — Shared schema parity (`packages/assistant`)

**Goal:** ensure `OrchestratorRequest` and friends in `packages/assistant/src/schema.ts` carry every field the orchestrator already accepts and that mobile already sends. The package is consumed by both `apps/web` and `apps/mobile` — any change here must compile cleanly on both.

#### 1.1 Audit current `packages/assistant/src/schema.ts`

Open the file (218 lines on `main`). Verify each of the following fields exists on `OrchestratorRequest`:

- `transcript: z.string()`
- `screen: z.string()`
- `booking_state: BookingStatePartial`
- `map_state: MapStatePartial`
- `filters: FiltersDelta`
- `visible_restaurant_ids: z.array(z.string())`
- `selected_restaurant_id: z.string().optional().nullable()` ← **likely missing or under-typed**
- `recommendation_mode: z.enum(["single", "list"]).optional().nullable()` ← **likely missing**
- `assistant_memory: AssistantMemory.optional().nullable()` ← **likely missing**
- `user_location: UserLocation.optional().nullable()`
- `timezone: z.string().optional()`
- `conversation_id: z.string().optional()`
- `has_saved_card: z.boolean()`
- `guest_id: z.string().optional().nullable()`
- `reservation_id: z.string().optional().nullable()`

#### 1.2 Define `AssistantMemory`

If it does not exist, add to `packages/assistant/src/types.ts`:

```ts
export type DiscoverySortMode = 'distance' | 'rating' | 'price_asc' | 'price_desc';

export type AssistantDiscoveryMemory = {
  transcript: string;
  recommendation_mode: 'single' | 'list' | null;
  cuisine: string | null;
  cuisine_group: string | null;
  city: string | null;
  query: string | null;
  sort_by: DiscoverySortMode | null;
  full_restaurant_ids: string[];
  displayed_restaurant_ids: string[];
  exhausted_restaurant_ids: string[];
};

export type AssistantBookingProcessMemory = {
  phase: BookingState['status'];
  restaurant_id: string | null;
  restaurant_name: string | null;
  party_size: number | null;
  date: string | null;
  time: string | null;
  shift_id: string | null;
  slot_iso: string | null;
  reservation_id: string | null;
  confirmation_code: string | null;
  last_prompt: string | null;
};

export type AssistantMemory = {
  discovery: AssistantDiscoveryMemory | null;
  booking_process: AssistantBookingProcessMemory | null;
};
```

…and the corresponding zod schema in `schema.ts`. The mobile-side shape is in `lib/cenaiva/state/assistantStore.tsx:67-70` (`initialMemory`) and `lib/cenaiva/recommendationIntent.ts:214-222` (`mergeDiscoveryMemory`).

#### 1.3 Re-export from package index

In `packages/assistant/src/index.ts` (currently 3 lines), ensure `AssistantMemory`, `AssistantDiscoveryMemory`, `AssistantBookingProcessMemory`, `DiscoverySortMode` are all re-exported.

#### 1.4 Build and verify

```bash
npm run build --workspace=packages/assistant
```

Then in `apps/web`:

```bash
npm run typecheck --workspace=apps/web
```

This must compile clean before moving on. **Mobile's repo is separate**, so type drift between mobile-side `@cenaiva/assistant` and the package source in Seatly is a real risk; document any new fields you add in the PR description so a future mobile sync is easy.

#### 1.5 Step 1 — definition of done

- [ ] `OrchestratorRequest` has `assistant_memory`, `recommendation_mode`, `selected_restaurant_id` (and any of the booking-state fields the mobile sends but web doesn't yet).
- [ ] `AssistantMemory`, `AssistantDiscoveryMemory`, `AssistantBookingProcessMemory`, `DiscoverySortMode` exported from `@cenaiva/assistant`.
- [ ] `npm run build --workspace=packages/assistant` clean.
- [ ] `apps/web` typechecks clean against the new package.

---

### Step 2 — Port standalone helpers (no React)

**Goal:** copy five mobile helpers into `apps/web/src/lib/cenaiva/` without behavior change. These helpers have zero React/RN deps; they're pure TypeScript and rely only on `@cenaiva/assistant` types (already shared).

#### 2.1 Files to port

| Mobile path | New web path | Loc | Risk |
|---|---|---:|---|
| `lib/cenaiva/confirmationIntent.ts` | `apps/web/src/lib/cenaiva/confirmationIntent.ts` | 45 | none |
| `lib/cenaiva/recommendationIntent.ts` | `apps/web/src/lib/cenaiva/recommendationIntent.ts` | 297 | low |
| `lib/cenaiva/simplePromptIntent.ts` | `apps/web/src/lib/cenaiva/simplePromptIntent.ts` | 75 | none |
| `lib/cenaiva/filterRestaurants.ts` | `apps/web/src/lib/cenaiva/filterRestaurants.ts` | 127 | medium (Restaurant type differs) |
| `lib/cenaiva/localBookingCollector.ts` | `apps/web/src/lib/cenaiva/localBookingCollector.ts` | 1,210 | medium (largest, depends on web's restaurant catalog) |

For verbatim source of the four small helpers, see [Appendix A.1 – A.4](#appendix-a--mobile-source-excerpts-verbatim-for-porting).

#### 2.2 Adaptation procedure (per file)

For `confirmationIntent.ts`, `simplePromptIntent.ts`, `recommendationIntent.ts`: copy verbatim. The only import that needs adjusting is `'@cenaiva/assistant'` paths — these already resolve identically on web because the package is workspace-shared.

For `filterRestaurants.ts`: the mobile helper imports `Restaurant` from `@/lib/mock/restaurants`. The web equivalent likely lives elsewhere (`apps/web/src/types/restaurants.ts` or similar). Adapt the import. The function bodies do not need changes — they use the same `cuisineType`, `city`, `area`, `description`, `tags` field names. **If the web `Restaurant` type uses different field names, adapt the field accesses, not the cuisine-group constants.**

For `localBookingCollector.ts`: this is the biggest, most behavior-laden helper. It depends on:
- `@cenaiva/assistant` types (✅ shared).
- Date/time parsing helpers (`parseLocalDate`, `parseLocalTime`, `parseLocalPartySize`) — pure TS, copy verbatim.
- The `CenaivaAvailabilityRequest` / `CenaivaAvailabilityResponse` types (defined inside this file on mobile).
- The web `Restaurant` type for hours/availability checks (adapt as in `filterRestaurants.ts`).

If the web `Restaurant` shape diverges materially, **do not** edit the helper to match web. Instead, write a tiny mapper at the call site in `AssistantProvider`:

```ts
function toCollectorRestaurant(web: WebRestaurant): MobileShapedRestaurant {
  return {
    id: web.id,
    name: web.name,
    cuisineType: web.cuisine_type ?? '',
    city: web.city ?? '',
    area: web.neighborhood ?? '',
    description: web.description ?? '',
    tags: web.tags ?? [],
    hoursOfOperation: web.hours_of_operation ?? null,
    timezone: web.timezone ?? 'America/Toronto',
  };
}
```

This keeps the ported helper bit-for-bit identical to mobile so future mobile changes can be cherry-picked without merge conflicts.

#### 2.3 Test ports

The mobile test suite under `__tests__/cenaiva/` uses Jest. Web uses Vitest. Translation:

| Jest | Vitest |
|---|---|
| `import { describe, it, expect } from '@jest/globals'` | `import { describe, it, expect } from 'vitest'` |
| `jest.mock(...)` | `vi.mock(...)` |
| `jest.fn()` | `vi.fn()` |
| `jest.useFakeTimers()` | `vi.useFakeTimers()` |
| `(global as any).fetch = ...` | `vi.stubGlobal('fetch', ...)` |

Port these test files (they test the helpers we just ported):

- `__tests__/cenaiva/confirmationIntent.test.ts` (1,975 bytes)
- `__tests__/cenaiva/recommendationIntent.test.ts` (5,616 bytes)
- `__tests__/cenaiva/simplePromptIntent.test.ts` (3,143 bytes)
- `__tests__/cenaiva/filterRestaurants.test.ts` (2,504 bytes)
- `__tests__/cenaiva/localBookingCollector.test.ts` (17,516 bytes — **the most important**)
- `__tests__/cenaiva/promptMatrix.test.ts` (5,533 bytes — golden-path matrix)

Place each at `apps/web/src/lib/cenaiva/__tests__/<name>.test.ts`.

#### 2.4 Step 2 — definition of done

- [ ] Five helpers exist at the new web paths and `npm run typecheck --workspace=apps/web` is clean.
- [ ] Six test files ported, all passing under `npm run test --workspace=apps/web -- cenaiva`.
- [ ] Each ported helper diffs cleanly against the mobile original (only import paths and one Restaurant adapter change).

---

### Step 3 — `buildWakeGreeting` + state-machine deltas

**Goal:** add the three small state-machine pieces web is missing — `memory` field, `RESET_ASSISTANT_CONTEXT` action, expanded `NO_AUTO_RELISTEN_STATUSES` — and add the `buildWakeGreeting` helper. Wake-word recognizer itself is **untouched**.

#### 3.1 `buildWakeGreeting`

Create `apps/web/src/lib/cenaiva/buildWakeGreeting.ts`:

```ts
import type { User } from '@supabase/supabase-js';

function partOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function firstName(user: User | null | undefined): string | null {
  const fullName = (user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    null) as string | null;
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function buildWakeGreeting(user: User | null | undefined): string {
  const period = partOfDay();
  const name = firstName(user);
  const namePart = name ? `, ${name}` : '';
  return `Good ${period}${namePart}. How may I help with your reservation?`;
}
```

Mobile equivalent lives inside `CenaivaAssistantProvider.tsx`; web should keep it standalone for testability.

Add a unit test at `apps/web/src/lib/cenaiva/__tests__/buildWakeGreeting.test.ts` with at least:
- "returns 'Good morning' before noon"
- "returns 'Good afternoon' between noon and 5pm"
- "returns 'Good evening' after 5pm"
- "appends first name from `user_metadata.full_name`"
- "omits name when no user"

#### 3.2 `AssistantStore.tsx` — add `memory`

Web's `AssistantState` (lines 19–31) does not include a `memory` field. The mobile equivalent does (mobile line 27, with shape `AssistantMemory`). The orchestrator request body needs this field.

Edits to `apps/web/src/components/cenaiva/AssistantStore.tsx`:

1. **Import** `AssistantMemory` from `@cenaiva/assistant`.
2. **Add** to `AssistantState`:
   ```ts
   memory: AssistantMemory;
   ```
3. **Add** `initialMemory`:
   ```ts
   const initialMemory: AssistantMemory = {
     discovery: null,
     booking_process: null,
   };
   ```
4. **Add** to `initialState`:
   ```ts
   memory: initialMemory,
   ```
5. **Add** `mergeAssistantMemory` helper near `computeCartSubtotal` (verbatim from mobile `assistantStore.tsx:132-141`):
   ```ts
   function mergeAssistantMemory(
     current: AssistantMemory,
     incoming: AssistantResponseType['assistant_memory'],
   ): AssistantMemory {
     if (!incoming) return current;
     return {
       discovery: incoming.discovery ?? current.discovery,
       booking_process: incoming.booking_process ?? current.booking_process,
     };
   }
   ```
6. **Add** `bookingProcessMemoryFromState` helper (verbatim from mobile `assistantStore.tsx:143-160`):
   ```ts
   function bookingProcessMemoryFromState(
     booking: BookingState,
     lastPrompt: string | null,
   ): NonNullable<AssistantMemory['booking_process']> {
     return {
       phase: booking.status,
       restaurant_id: booking.restaurant_id,
       restaurant_name: booking.restaurant_name,
       party_size: booking.party_size,
       date: booking.date,
       time: booking.time,
       shift_id: booking.shift_id,
       slot_iso: booking.slot_iso,
       reservation_id: booking.reservation_id,
       confirmation_code: booking.confirmation_code,
       last_prompt: lastPrompt,
     };
   }
   ```
7. **Inside `APPLY_RESPONSE`** in the reducer, after the `filters` merge, insert (mirrors mobile `assistantStore.tsx:441-444, 492-498`):
   ```ts
   next = {
     ...next,
     memory: mergeAssistantMemory(next.memory, response.assistant_memory),
   };
   ```
   And at the end of the case, before `return next;`:
   ```ts
   next = {
     ...next,
     memory: {
       ...next.memory,
       booking_process: bookingProcessMemoryFromState(next.booking, next.lastSpokenText || null),
     },
   };
   ```

#### 3.3 `AssistantStore.tsx` — add `RESET_ASSISTANT_CONTEXT`

Add to the `LocalAction` union:
```ts
| { type: 'RESET_ASSISTANT_CONTEXT' }
```

Add reducer case (verbatim from mobile `assistantStore.tsx:516-535`):
```ts
case 'RESET_ASSISTANT_CONTEXT':
  return {
    ...state,
    conversationId: null,
    booking: {
      ...initialBooking,
      has_saved_card: state.booking.has_saved_card,
    },
    map: {
      ...initialMap,
      visible: true,
      center: state.map.center,
      zoom: state.map.zoom,
    },
    filters: {},
    memory: initialMemory,
    showExitX: false,
    customerAccepted: false,
    availabilityOpen: false,
  };
```

#### 3.4 `AssistantStore.tsx` — `RESET_BOOKING` should clear `memory.booking_process`

Update the existing `RESET_BOOKING` case to (mirrors mobile `assistantStore.tsx:503-514`):
```ts
case 'RESET_BOOKING':
  return {
    ...state,
    booking: initialBooking,
    memory: {
      ...state.memory,
      booking_process: null,
    },
    showExitX: false,
    customerAccepted: false,
    availabilityOpen: false,
  };
```

#### 3.5 `AssistantStore.tsx` — `NO_AUTO_RELISTEN_STATUSES` named export

Add at the top of the file, near the other constants:
```ts
import type { BookingState } from '@cenaiva/assistant';

export const NO_AUTO_RELISTEN_STATUSES = new Set<BookingState['status']>([
  'offering_preorder',
  'browsing_menu',
  'reviewing_cart',
  'choosing_tip_timing',
  'choosing_tip_amount',
  'choosing_payment_split',
  'charging',
  'paid',
  'post_booking',
]);

export const RELISTEN_AFTER_RESPONSE_MS = 260;
```

The constant is used in Step 8.

#### 3.6 Step 3 — definition of done

- [ ] `apps/web/src/lib/cenaiva/buildWakeGreeting.ts` exists, with unit tests passing.
- [ ] `AssistantState` has `memory: AssistantMemory`, default `initialMemory`.
- [ ] Reducer `APPLY_RESPONSE` merges `assistant_memory` and synthesizes `booking_process` memory from booking state.
- [ ] `RESET_ASSISTANT_CONTEXT` action implemented.
- [ ] `RESET_BOOKING` clears `memory.booking_process`.
- [ ] `NO_AUTO_RELISTEN_STATUSES` exported, contains exactly 9 statuses.
- [ ] `RELISTEN_AFTER_RESPONSE_MS = 260` exported.
- [ ] Existing web `AssistantStore` tests (if any) pass; new unit test for `buildWakeGreeting` passes.
- [ ] No change to `useCenaivaWakeWord.ts` (verify with `git status`).

---

### Step 4 — Voice preference provider (web-flavored)

**Goal:** mirror mobile's `CenaivaVoicePreferenceProvider` API exactly, replacing AsyncStorage with localStorage and using the existing `getSupabaseBrowserClient()`.

#### 4.1 Create `apps/web/src/lib/cenaiva/voicePreference.ts`

```ts
export type CenaivaTtsVoice = 'female' | 'male';

const FEMALE_DEFAULT = '8vf2Pg7VZD0Piv8GA8v9';
const MALE_DEFAULT = 'f5HLTX707KIM4SzJYzSz';

export function normalizeCenaivaTtsVoice(
  value: string | null | undefined,
): CenaivaTtsVoice | null {
  if (value === 'female' || value === 'male') return value;
  return null;
}

export function getCenaivaTtsVoiceId(voice: CenaivaTtsVoice | null): string | null {
  if (voice === 'female') {
    return import.meta.env.VITE_CENAIVA_TTS_VOICE_FEMALE_ID ?? FEMALE_DEFAULT;
  }
  if (voice === 'male') {
    return import.meta.env.VITE_CENAIVA_TTS_VOICE_MALE_ID ?? MALE_DEFAULT;
  }
  return null;
}
```

#### 4.2 Create `apps/web/src/contexts/CenaivaVoicePreferenceProvider.tsx`

Direct port of mobile's `lib/cenaiva/voice/CenaivaVoicePreferenceProvider.tsx` (full source in [Appendix A.5](#a5--cenaivavoicepreferenceprovider-mobile)). Diff vs. mobile:

- Replace `import AsyncStorage from '@react-native-async-storage/async-storage'` with a tiny `localStorage` wrapper:
  ```ts
  const Storage = {
    async getItem(key: string): Promise<string | null> {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    async setItem(key: string, value: string): Promise<void> {
      try { localStorage.setItem(key, value); } catch { /* quota or SSR */ }
    },
    async removeItem(key: string): Promise<void> {
      try { localStorage.removeItem(key); } catch { /* noop */ }
    },
  };
  ```
- Replace `useAuthSession` with the existing web `useUser` hook from `apps/web/src/hooks/useUser.ts`.
- Replace `getSupabase()` with `getSupabaseBrowserClient()` from `apps/web/src/lib/supabase/client.ts`.
- Storage key remains `@cenaiva/tts-voice/${authUserId}` to keep parity with mobile (so a user logged in on both platforms gets coherent behavior even though the storage backends differ).
- Supabase column remains `user_profiles.cenaiva_tts_voice`. The migration `20260502000000_add_cenaiva_tts_voice.sql` is already deployed to the shared project.

The full body and React state ergonomics are unchanged from mobile. Verbatim source in [Appendix A.5](#a5--cenaivavoicepreferenceprovider-mobile) — copy and apply only the three substitutions above.

#### 4.3 Mount in `App.tsx`

Update `apps/web/src/App.tsx` so the provider tree becomes:

```tsx
<BrowserRouter>
  <AuthProvider>
    <CenaivaVoicePreferenceProvider>
      <AssistantProvider>
        <AppRoutes />
      </AssistantProvider>
    </CenaivaVoicePreferenceProvider>
  </AuthProvider>
</BrowserRouter>
```

The provider must sit between `AuthProvider` (which gives it `user.id`) and `AssistantProvider` (which will consume `useCenaivaVoicePreference()` in Step 8).

#### 4.4 Voice picker page

Create `apps/web/src/pages/customer/AccountVoicePage.tsx`. Mirrors mobile's `app/(customer)/profile/cenaiva-voice.tsx` (86 lines). Use existing web shadcn primitives (`Button`, `Card`, `RadioGroup`).

Wire route in `apps/web/src/routes/AppRoutes.tsx`:
```tsx
<Route path="/account/voice" element={<AccountVoicePage />} />
```

Add a link from `AccountPage.tsx` ("Cenaiva voice settings →").

Optional toast on first authenticated load: in `AssistantInner`, when `voicePref.needsSelection === true`, show a one-shot `sonner.toast` with a CTA to `/account/voice`.

#### 4.5 Step 4 — definition of done

- [ ] `apps/web/src/lib/cenaiva/voicePreference.ts` exists with `getCenaivaTtsVoiceId`, `normalizeCenaivaTtsVoice`.
- [ ] `apps/web/src/contexts/CenaivaVoicePreferenceProvider.tsx` exists, mounted in `App.tsx`.
- [ ] `useCenaivaVoicePreference()` hook returns `{ voicePreference, voiceId, isLoading, isSaving, needsSelection, refresh, setVoicePreference }`.
- [ ] `/account/voice` route renders, voice toggle persists across reload.
- [ ] `localStorage` has key `@cenaiva/tts-voice/${authUserId}` after toggle.
- [ ] `select cenaiva_tts_voice from user_profiles where auth_user_id='…';` returns the chosen value.

---

### Step 5 — ElevenLabs streaming chunk queue + persistent cache

**Goal:** bring web's `useElevenLabsTTS` to feature parity with mobile's `useMobileTTS`. Specifically: a serial chunk queue, drain/discard semantics, an `isStreamingTTSAvailable` flag, an `IndexedDB` cache for common phrases.

#### 5.1 Refactor `apps/web/src/hooks/useElevenLabsTTS.ts`

Public surface to add (mirroring mobile `useMobileTTS.ts`):

```ts
type StreamingChunkOpts = {
  pacingAfterMs?: number;
  onFirstAudioStart?: () => void;
};

export type ElevenLabsTTSAPI = {
  // Existing
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  primeTTS: () => void;

  // NEW
  speakStreamingChunk: (text: string, opts?: StreamingChunkOpts) => void;
  drainStreamingSpeech: () => Promise<void>;
  discardStreamingSpeech: () => void;
  isStreamingTTSAvailable: boolean;
  isSpeaking: boolean;
};
```

Implementation notes:

- The chunk queue is a `Promise` chain. Each enqueue appends a `.then(processChunk)` to a single internal `Promise`.
- A shared `HTMLAudioElement` (`audioRef`) plays each chunk to completion before the next starts.
- An internal `discardedRef` is checked at the top of every chunk processor — if true, exit immediately without playing.
- `discardStreamingSpeech` flips `discardedRef`, calls `audioRef.pause()`, and aborts any in-flight `fetch` via an `AbortController`.
- `drainStreamingSpeech` returns the tail of the queue Promise.
- `isStreamingTTSAvailable = import.meta.env.VITE_ELEVENLABS_ENABLED !== 'false'`.

#### 5.2 IndexedDB persistent cache

Add a `cenaivaTtsCache` IndexedDB object store. Cache key construction (verbatim from mobile `useMobileTTS.ts:187-197`):

```ts
const TTS_CACHE_VERSION = 'flash25-mp3-44100-128-v1';

const COMMON_TTS_CACHE_TEXTS = [
  'One moment please.',
  'What restaurant or area should I book?',
  'How many guests?',
  'What date and time should I book?',
  'What date should I book?',
  'What time should I book?',
  'I could not reach live availability. Try another date and time, or ask for the restaurant hours.',
  'Something went wrong. Try again.',
  'Please sign in to continue.',
];

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) + str.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function cacheKey(voiceId: string | null, text: string): string {
  const normalized = text.trim().toLowerCase();
  const voiceKey = voiceId ?? 'default';
  return `${TTS_CACHE_VERSION}-${djb2Hash(`${voiceKey}:${normalized}`)}`;
}
```

`primeTTS()` warming flow:
1. After the first user gesture, open the IndexedDB store (idempotent).
2. For each phrase in `COMMON_TTS_CACHE_TEXTS` × current `voiceId`:
   - If key present, skip.
   - Else, fetch from `/elevenlabs-tts?text=…&voice_id=…`, store ArrayBuffer, close.
3. Run sequentially in the background (do not block).

`speak()` and `speakStreamingChunk()` lookup flow:
1. Compute `cacheKey(voiceId, text)`.
2. Read from IndexedDB. If hit, create `Blob`, set `audioRef.src = URL.createObjectURL(blob)`, play.
3. If miss, fall through to normal fetch.

#### 5.3 Wire through `useCenaivaVoice.ts`

`useCenaivaVoice` is the composition layer. Update its return to include the new methods:

```ts
return {
  // existing
  startListening, stopListening, primeTTS, speak, stopSpeaking, isSpeaking,
  voiceStatus, transcriptionPhase, lastError,

  // NEW
  speakStreamingChunk: tts.speakStreamingChunk,
  drainStreamingSpeech: tts.drainStreamingSpeech,
  discardStreamingSpeech: tts.discardStreamingSpeech,
  isStreamingTTSAvailable: tts.isStreamingTTSAvailable,
};
```

#### 5.4 Step 5 — definition of done

- [ ] `useElevenLabsTTS` exports `speakStreamingChunk`, `drainStreamingSpeech`, `discardStreamingSpeech`, `isStreamingTTSAvailable`.
- [ ] IndexedDB store `cenaivaTtsCache` warmed on `primeTTS()`.
- [ ] `COMMON_TTS_CACHE_TEXTS` plays from cache (no network) on second use; verifiable in DevTools network panel.
- [ ] `discardStreamingSpeech()` cuts mid-chunk audibly during a multi-chunk SSE stream.
- [ ] `drainStreamingSpeech()` resolves only after the last queued chunk has finished playing.
- [ ] `useCenaivaVoice` re-exports the new TTS methods.

---

### Step 6 — Add `prewarm` + `onTransport` + new fast-path hooks

**Goal:** add the orchestrator prewarm + transport callback, and create the two new fast-path hooks (`useCenaivaSmallPrompt`, `useCenaivaAvailability`) that Step 8 depends on.

#### 6.1 `useCenaivaOrchestrator.ts` — add `prewarm()`

Mobile's prewarm fires a tiny `POST` to `/cenaiva-orchestrate` with `{ prewarm: true }` and a 6-second timeout, then forgets. Edit `apps/web/src/hooks/useCenaivaOrchestrator.ts`:

```ts
const prewarm = useCallback(async () => {
  if (!isSupabaseConfigured()) return;
  const token = await getBearerToken();
  if (!token) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  void fetch(`${getSupabaseProjectUrl()}/functions/v1/cenaiva-orchestrate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prewarm: true }),
    signal: controller.signal,
  }).catch(() => undefined).finally(() => clearTimeout(timer));
}, []);

return { send, loading, error, lastErrorRef, cancel, prewarm };
```

#### 6.2 `useCenaivaOrchestrator.ts` — add `onTransport`

Add to `SendCallbacks`:
```ts
onTransport?: (transport: 'readable_stream' | 'buffered_text' | 'xhr_event_source') => void;
```

Web's current implementation uses `res.body.getReader()` (a `ReadableStream`), so call `callbacks?.onTransport?.('readable_stream')` immediately after the `getReader()` call succeeds.

#### 6.3 Create `useCenaivaSmallPrompt.ts`

Direct port of mobile's `lib/cenaiva/api/getCenaivaSmallPrompt.ts` ([full source in Appendix A.6](#a6--getcenaivasmallprompt-mobile)). Adapt:
- Replace `getSupabaseEnv()` and `isSupabaseConfigured()` with the equivalents from `apps/web/src/lib/supabase/client.ts`.
- Get the bearer token via `client.auth.getSession()`.
- Wrap in a hook so the consumer gets a stable callback identity:

```ts
export function useCenaivaSmallPrompt() {
  const send = useCallback(async (
    req: { transcript: string; booking: Pick<BookingState, 'restaurant_id'|'restaurant_name'|'party_size'|'date'|'time'>; voice_id?: string | null },
    opts?: { signal?: AbortSignal },
  ): Promise<CenaivaSmallPromptResponse | null> => {
    /* ...identical body to mobile postCenaivaSmallPrompt... */
  }, []);

  const prewarm = useCallback((voiceId?: string | null) => {
    /* ...identical body to mobile prewarmCenaivaSmallPrompt... */
  }, []);

  return { send, prewarm };
}
```

#### 6.4 Create `useCenaivaAvailability.ts`

Direct port of mobile's `lib/cenaiva/api/checkCenaivaAvailability.ts` (76 lines, full source in [Appendix A.7](#a7--checkcenaivaavailability-mobile)).

**Critical naming note:** there is already a hook at `apps/web/src/hooks/useAvailability.ts` that fronts the **public** `get-availability` edge function. Do NOT rename it. The new hook calls the **private, orchestrator-internal** `cenaiva-availability` endpoint, which has a different request/response contract. They coexist.

#### 6.5 Step 6 — definition of done

- [ ] `useCenaivaOrchestrator()` returns `prewarm: () => Promise<void>` in addition to existing fields.
- [ ] `SendCallbacks` accepts `onTransport`, called on first stream chunk.
- [ ] `apps/web/src/hooks/useCenaivaSmallPrompt.ts` exports `useCenaivaSmallPrompt()` with `send` + `prewarm`.
- [ ] `apps/web/src/hooks/useCenaivaAvailability.ts` exports `useCenaivaAvailability()` with `check`.
- [ ] Cold-start: hitting `open()` in dev triggers visible POSTs to `/cenaiva-orchestrate` and `/cenaiva-small-prompt` with body `{ prewarm: true }`.

---

### Step 7 — Latency budget hook

**Goal:** make web's per-turn latency observable, behind a debug flag, mirroring mobile.

#### 7.1 Create `apps/web/src/hooks/useCenaivaLatencyBudget.ts`

```ts
import { useCallback, useRef } from 'react';

export type LatencyTransport = 'readable_stream' | 'buffered_text' | 'xhr_event_source';

export type LatencyCheckpoints = {
  transcriptAt?: number;
  requestSentAt?: number;
  firstSpeechChunkAt?: number;
  finalReceivedAt?: number;
  playbackRequestedAt?: number;
  firstAudioDecodedAt?: number;
  streamingTransport?: LatencyTransport;
};

const DEBUG = (import.meta.env.VITE_CENAIVA_VOICE_DEBUG ?? '') === 'true';

export function useCenaivaLatencyBudget() {
  const turnsRef = useRef(new Map<number, LatencyCheckpoints>());

  const start = useCallback((turnId: number) => {
    if (!DEBUG) return;
    turnsRef.current.set(turnId, {});
  }, []);

  const mark = useCallback((turnId: number, name: keyof LatencyCheckpoints) => {
    if (!DEBUG) return;
    const cp = turnsRef.current.get(turnId);
    if (!cp) return;
    if (cp[name] != null) return; // first-write wins
    (cp as any)[name] = performance.now();
  }, []);

  const markTransport = useCallback((turnId: number, transport: LatencyTransport) => {
    if (!DEBUG) return;
    const cp = turnsRef.current.get(turnId);
    if (cp) cp.streamingTransport = transport;
  }, []);

  const summarize = useCallback((turnId: number) => {
    if (!DEBUG) return;
    const cp = turnsRef.current.get(turnId);
    if (!cp || cp.transcriptAt == null) return;
    const dur = (a?: number, b?: number) =>
      a != null && b != null ? `${Math.round(b - a)}ms` : 'n/a';
    // eslint-disable-next-line no-console
    console.log(
      `[cenaiva-latency] turn=${turnId}` +
      ` t→firstSpeech=${dur(cp.transcriptAt, cp.firstSpeechChunkAt)}` +
      ` t→final=${dur(cp.transcriptAt, cp.finalReceivedAt)}` +
      ` t→firstAudio=${dur(cp.transcriptAt, cp.firstAudioDecodedAt)}` +
      ` transport=${cp.streamingTransport ?? 'n/a'}`
    );
    turnsRef.current.delete(turnId);
  }, []);

  return { start, mark, markTransport, summarize };
}
```

#### 7.2 Step 7 — definition of done

- [ ] Hook compiles, lints clean, no `any` (replace `(cp as any)` with a typed assignment helper).
- [ ] When `VITE_CENAIVA_VOICE_DEBUG=false`, zero overhead (early returns).
- [ ] Will be wired into `AssistantProvider` in Step 8.

---

### Step 8 — The big rewrite: `AssistantProvider.sendTranscript`

**Goal:** replace web's single-path `sendTranscript` with the four-stage pipeline, preserving every existing web-only ergonomic.

#### 8.1 New refs and hooks at the top of `AssistantInner`

Add (alongside existing refs):

```ts
const turnIdRef = useRef(0);
const latency = useCenaivaLatencyBudget();
const smallPrompt = useCenaivaSmallPrompt();
const availability = useCenaivaAvailability();
const voicePref = useCenaivaVoicePreference();
const greetingTextRef = useRef<string | null>(null);

const handlerHandoffRef = useRef(false); // true = a fast-path branch already finished the turn
```

#### 8.2 New helper: `finishLocalResponse`

```ts
const finishLocalResponse = useCallback(async (
  response: AssistantResponseType,
  opts?: { schedule_relisten?: boolean },
) => {
  dispatch({ type: 'APPLY_RESPONSE', response });
  if (response.spoken_text) {
    await voice.speak(response.spoken_text);
  }
  dispatch({ type: 'SET_VOICE_STATUS', status: 'idle' });
  processingRef.current = false;
  const next = stateRef.current;
  if (
    opts?.schedule_relisten &&
    isOpenRef.current &&
    !textModeRef.current &&
    !NO_AUTO_RELISTEN_STATUSES.has(next.booking.status)
  ) {
    setTimeout(() => {
      if (isOpenRef.current && !textModeRef.current) void startListeningRef.current();
    }, RELISTEN_AFTER_RESPONSE_MS);
  }
}, [dispatch, voice]);
```

#### 8.3 New helper: `applyAvailabilityResult`

```ts
const applyAvailabilityResult = useCallback(async (
  result: CenaivaAvailabilityResponse | null,
  responseBeforeCheck: AssistantResponseType,
) => {
  if (!result) {
    // Network / timeout — fall through to normal error UX
    if (voice.isStreamingTTSAvailable) voice.discardStreamingSpeech();
    await voice.speak('I could not reach live availability. Try another date and time, or ask for the restaurant hours.');
    dispatch({ type: 'SET_VOICE_STATUS', status: 'idle' });
    processingRef.current = false;
    return;
  }
  // Apply the pre-check response (which sets up status, options list, etc.)
  dispatch({ type: 'APPLY_RESPONSE', response: responseBeforeCheck });
  // Hand off the actual result to the orchestrator? Mobile has detailed branching here.
  // For mirror parity, dispatch the result-shaped response from
  // localBookingCollector.responseForAvailabilityResult(result) (also ported in Step 2).
  const responseFromResult = responseForAvailabilityResult(result, stateRef.current);
  dispatch({ type: 'APPLY_RESPONSE', response: responseFromResult });
  if (responseFromResult.spoken_text) {
    if (voice.isStreamingTTSAvailable) voice.discardStreamingSpeech();
    await voice.speak(responseFromResult.spoken_text);
  }
  dispatch({ type: 'SET_VOICE_STATUS', status: 'idle' });
  processingRef.current = false;
  if (
    isOpenRef.current && !textModeRef.current &&
    !NO_AUTO_RELISTEN_STATUSES.has(stateRef.current.booking.status)
  ) {
    setTimeout(() => {
      if (isOpenRef.current && !textModeRef.current) void startListeningRef.current();
    }, RELISTEN_AFTER_RESPONSE_MS);
  }
}, [dispatch, voice]);
```

#### 8.4 The new `sendTranscript` body (full)

```ts
const sendTranscript = useCallback(async (
  transcript: string,
  opts?: { restaurantId?: string; silent?: boolean; force?: boolean },
) => {
  const turnId = ++turnIdRef.current;
  latency.start(turnId);
  latency.mark(turnId, 'transcriptAt');

  if (processingRef.current) {
    if (!opts?.force) return;
    orchestrator.cancel();
    processingRef.current = false;
  }
  processingRef.current = true;
  voice.stopListening();
  dispatch({ type: 'SET_VOICE_STATUS', status: 'processing' });

  const current = stateRef.current;
  const isBookingConfirmationReply = shouldRouteAsCenaivaBookingConfirmation(
    current.booking.status, transcript,
  );
  const isProcessPrompt = isCenaivaProcessPrompt(transcript);
  const recommendationMode = getCenaivaRecommendationMode(transcript);

  // STAGE 1 — local booking collector
  const decision = planLocalBookingTurn({
    transcript,
    booking: current.booking,
    lastAssistantPrompt: current.lastSpokenText,
    isConfirmationReply: isBookingConfirmationReply,
    // additional fields per mobile signature — adapt restaurant catalog access
  });

  if (decision.kind === 'local_response') {
    if (voice.isStreamingTTSAvailable) voice.discardStreamingSpeech();
    await finishLocalResponse(decision.response, { schedule_relisten: true });
    latency.summarize(turnId);
    return;
  }

  if (decision.kind === 'check_availability') {
    // STAGE 2 — availability fast-path
    if (decision.filler && voice.isStreamingTTSAvailable) {
      voice.speakStreamingChunk(decision.filler);
    } else if (decision.filler) {
      void voice.speak(decision.filler); // do not await — speak in parallel with availability call
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const { data: result } = await availability.check(decision.request, { signal: controller.signal });
      await applyAvailabilityResult(result, decision.responseBeforeCheck);
    } finally {
      clearTimeout(timer);
    }
    latency.summarize(turnId);
    return;
  }

  // STAGE 3 — small-prompt fast-path
  if (!isBookingConfirmationReply && !isProcessPrompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const { data: smallResult } = await smallPrompt.send(
        { transcript, booking: current.booking, voice_id: voicePref.voiceId },
        { signal: controller.signal },
      );
      if (smallResult) {
        // Convert small-prompt response shape to AssistantResponseType for APPLY_RESPONSE
        const asResponse: AssistantResponseType = {
          conversation_id: current.conversationId ?? null,
          spoken_text: smallResult.spoken_text,
          intent: 'general_question',
          step: 'general',
          next_expected_input: smallResult.next_expected_input,
          ui_actions: [],
          booking: null,
          map: null,
          filters: null,
          assistant_memory: null,
        };
        await finishLocalResponse(asResponse, { schedule_relisten: true });
        latency.summarize(turnId);
        return;
      }
      // null → fall through to STAGE 4
    } catch (e) {
      // abort or fetch error → fall through to STAGE 4
    } finally {
      clearTimeout(timer);
    }
  }

  // STAGE 4 — full orchestrator (existing path, augmented)
  const browserTimeZone = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : undefined;

  const req: OrchestratorRequestType = {
    transcript,
    screen: 'discover',
    booking_state: { /* every field as today */ },
    map_state: { /* every field as today */ },
    filters: current.filters,
    visible_restaurant_ids: current.map.marker_restaurant_ids,
    selected_restaurant_id: opts?.restaurantId ?? current.booking.restaurant_id,
    recommendation_mode: recommendationMode ?? undefined,
    assistant_memory: current.memory,
    user_location: userLocationRef.current,
    timezone: browserTimeZone || undefined,
    conversation_id: current.conversationId ?? undefined,
    has_saved_card: hasCard,
    guest_id: null,
    reservation_id: current.booking.reservation_id,
  };

  latency.mark(turnId, 'requestSentAt');

  let streamedText = '';
  let firstChunkSeen = false;
  const streamingActive = voice.isStreamingTTSAvailable && !opts?.silent;
  const streamCallbacks = streamingActive
    ? {
        onSpeechChunk: (text: string) => {
          if (!firstChunkSeen) {
            latency.mark(turnId, 'firstSpeechChunkAt');
            firstChunkSeen = true;
          }
          streamedText += (streamedText ? ' ' : '') + text;
          voice.speakStreamingChunk(text);
        },
        onDiscardPendingSpeech: () => {
          streamedText = '';
          voice.discardStreamingSpeech();
        },
        onTransport: (t: LatencyTransport) => latency.markTransport(turnId, t),
      }
    : undefined;

  try {
    const response = await orchestrator.send(req, streamCallbacks);
    latency.mark(turnId, 'finalReceivedAt');
    processingRef.current = false;

    if (!response) {
      // Existing web error UX (preserve)
      if (streamingActive) voice.discardStreamingSpeech();
      const cause = orchestrator.lastErrorRef.current ?? 'unknown';
      const friendly = cause === 'timeout' ? 'The assistant is taking a while. Try again.'
        : cause === 'not_authenticated' ? 'Please sign in again to continue.'
        : 'Something went wrong. Try again.';
      if (textModeRef.current) {
        dispatch({ type: 'SET_LAST_SPOKEN_TEXT', text: friendly });
        toast.error(friendly, { duration: 3000 });
      } else {
        await voice.speak("Sorry, I didn't catch that. Try again.");
      }
      dispatch({ type: 'SET_VOICE_STATUS', status: 'idle' });
      if (isOpenRef.current && !textModeRef.current) {
        setTimeout(() => {
          if (isOpenRef.current && !textModeRef.current) void startListeningRef.current();
        }, RELISTEN_AFTER_ERROR_MS);
      }
      latency.summarize(turnId);
      return;
    }

    // Apply recommendation-mode capping (mobile parity)
    const normalizedResponse = recommendationMode === 'single'
      ? normalizeSingleRestaurantRecommendationResponse(response, transcript)
      : response;

    dispatch({ type: 'APPLY_RESPONSE', response: normalizedResponse });

    for (const action of (normalizedResponse.ui_actions ?? [])) {
      if (!action || typeof action.type !== 'string') continue;
      if (action.type === 'toast') toast(action.message, { duration: 3000 });
      if (action.type === 'navigate') navigate(action.path);
      if (action.type === 'navigate_to_checkout') {
        isOpenRef.current = false;
        voice.stopSpeaking();
        voice.stopListening();
        dispatch({ type: 'CLOSE' });
        navigate(action.path);
      }
    }

    // Existing web "freshly booked → ensure preorder prompt" augmentation
    let spokenText = normalizedResponse.spoken_text ?? '';
    const uiTypes = (normalizedResponse.ui_actions ?? []).map((a) => (a as any)?.type).filter(Boolean);
    const freshlyBooked = uiTypes.includes('show_confirmation') ||
      (!!normalizedResponse.booking?.reservation_id && !stateRef.current.booking.reservation_id);
    const asksPreorder = /pre-?order|menu/i.test(spokenText);
    if (freshlyBooked && !asksPreorder) {
      const base = spokenText.trim().replace(/[.!?]*$/, '');
      spokenText = `${base ? base + '. ' : ''}Would you like to pre-order from the menu?`;
    }

    // Anti-double-speak guard (PRESERVE web's existing implementation)
    if (spokenText && !opts?.silent) {
      const norm = (s: string) =>
        s.replace(/\s+/g, ' ').replace(/[.!?,\s]+$/, '').trim().toLowerCase();
      const streamedTextNorm = norm(streamedText);
      const spokenTextNorm = norm(spokenText);
      latency.mark(turnId, 'playbackRequestedAt');
      if (streamingActive && streamedTextNorm && streamedTextNorm === spokenTextNorm) {
        await voice.drainStreamingSpeech();
      } else {
        if (streamingActive) voice.discardStreamingSpeech();
        await voice.speak(spokenText);
      }
    } else if (streamingActive) {
      voice.discardStreamingSpeech();
    }

    // Auto-relisten gate — use NO_AUTO_RELISTEN_STATUSES (Step 3 export)
    const next = stateRef.current;
    if (isOpenRef.current && !textModeRef.current && !NO_AUTO_RELISTEN_STATUSES.has(next.booking.status)) {
      void startListeningRef.current();
    } else {
      dispatch({ type: 'SET_VOICE_STATUS', status: 'idle' });
    }
    latency.summarize(turnId);
  } catch (err) {
    processingRef.current = false;
    if (streamingActive) voice.discardStreamingSpeech();
    console.error('sendTranscript error:', err);
    if (textModeRef.current) {
      const friendly = 'Something went wrong. Try again.';
      dispatch({ type: 'SET_LAST_SPOKEN_TEXT', text: friendly });
      toast.error(friendly, { duration: 3000 });
    } else {
      await voice.speak("Sorry, I didn't catch that. Try again.");
    }
    dispatch({ type: 'SET_VOICE_STATUS', status: 'idle' });
    if (isOpenRef.current && !textModeRef.current) {
      setTimeout(() => {
        if (isOpenRef.current && !textModeRef.current) void startListeningRef.current();
      }, RELISTEN_AFTER_ERROR_MS);
    }
    latency.summarize(turnId);
  }
}, [dispatch, orchestrator, voice, navigate, hasCard, latency, smallPrompt, availability, voicePref.voiceId, finishLocalResponse, applyAvailabilityResult]);
```

#### 8.5 `open()` — prewarm and greeting

```ts
const open = useCallback((
  restaurantId?: string,
  restaurantName?: string,
  opts?: { autoListen?: boolean; greetingText?: string },
) => {
  autoListenOnOpenRef.current = opts?.autoListen === true;
  greetingTextRef.current = opts?.greetingText ?? null;
  isOpenRef.current = true;
  requestLocation();
  try { voice.primeTTS(); } catch { /* noop */ }
  forceStopWakeWordRef.current();

  if (!micGrantedRef.current) {
    requestMicPermission().then((granted) => {
      if (granted) micGrantedRef.current = true;
    });
  }

  prefetchDeepgramToken();
  void orchestrator.prewarm();           // NEW
  void smallPrompt.prewarm(voicePref.voiceId); // NEW

  if (restaurantId && restaurantName) {
    dispatch({ type: 'PRESELECT_RESTAURANT', restaurant_id: restaurantId, restaurant_name: restaurantName });
  } else {
    dispatch({ type: 'OPEN' });
  }

  if (opts?.autoListen && opts?.greetingText) {
    // Speak greeting first, then start listening (mobile lines 1080-1089)
    void (async () => {
      try {
        await voice.speak(opts.greetingText!);
      } finally {
        if (isOpenRef.current && !textModeRef.current) {
          void startListeningRef.current();
        }
      }
    })();
  }
}, [dispatch, requestLocation, voice, orchestrator, smallPrompt, voicePref.voiceId]);
```

#### 8.6 `onWake` — personalized greeting

```ts
const onWake = useCallback(() => {
  if (!user) return;
  try { voice.primeTTS(); } catch { /* noop */ }
  const greetingText = buildWakeGreeting(user);
  open(undefined, undefined, { autoListen: true, greetingText });
}, [user, open, voice]);
```

#### 8.7 Preserve every existing web-only behavior

Re-verify after the rewrite that none of the following regressed:

- `sayGoodbyeAndClose(message?, redirectAfter?)` still works.
- TTS-prime-on-first-gesture effect (web `AssistantProvider.tsx:128-152`) still mounts and unmounts cleanly.
- `forceStopWakeWordRef` still synchronously tears down the wake recognizer in `open()` before the command recognizer starts (this is the fix for Chrome's "only one SpeechRecognition can hold the mic" rule).
- The empty-relisten cap (`MAX_EMPTY_RELISTENS = 3`) still applies.
- `setTextMode(active)` clears `processingRef.current` and `emptyRelistenStreakRef.current`.
- The `paid → sayGoodbyeAndClose("...", "/account")` 1.5s effect still fires.
- The wake-word enable/disable effect still respects `isCustomerRoute` and `state.isOpen`.

#### 8.8 Step 8 — definition of done

- [ ] `sendTranscript` follows the four-stage pipeline; in DevTools network panel, simple utterances ("yes", "table for 4") issue **zero** requests to `/cenaiva-orchestrate`.
- [ ] "What's your refund policy?" hits `/cenaiva-small-prompt`, not orchestrator.
- [ ] "Are they open at 7?" hits `/cenaiva-availability` after the cached "One moment please." filler.
- [ ] `request body` to `/cenaiva-orchestrate` includes `assistant_memory`, `recommendation_mode`, `selected_restaurant_id`.
- [ ] `recommendation_mode='single'` truncates to one restaurant card and rewrites spoken_text to "I'd go with X."
- [ ] `voiceStatus` transitions match mobile: `idle → processing → speaking → listening` (or `→ idle` if gated).
- [ ] No regression of `sayGoodbyeAndClose`, `forceStopWakeWord`, anti-double-speak, prime-on-gesture, paid auto-close, empty-relisten cap, text-mode pivot.
- [ ] `useCenaivaWakeWord.ts` still has zero diff vs `main`.
- [ ] All existing web Cenaiva tests (if any) pass.

---

### Step 9 — Voice ID propagation

**Goal:** every TTS-emitting call from web includes `voice_id`.

#### 9.1 Pass `voice_id` through `useElevenLabsTTS`

When the hook fetches from `/elevenlabs-tts`, add the query param:
```ts
const url = new URL(`${supabaseUrl}/functions/v1/elevenlabs-tts`);
url.searchParams.set('text', text);
if (voiceId) url.searchParams.set('voice_id', voiceId);
```

Get the active `voiceId` either by:
- Reading from a context (`useCenaivaVoicePreference()`), or
- Accepting `voiceId` as a prop on `useElevenLabsTTS({ voiceId })` and threading it from `useCenaivaVoice` which in turn reads `voicePref.voiceId`.

The latter avoids a context dependency on the TTS hook. Prefer it.

#### 9.2 Pass `voice_id` to `useCenaivaSmallPrompt`

Already in the signature from Step 6.3 (`req.voice_id`). Make sure callers in Step 8.4 thread `voicePref.voiceId`.

#### 9.3 Optional toast on first authenticated load

If `voicePref.needsSelection === true`, show `sonner.toast.message('Choose your Cenaiva voice', { action: { label: 'Pick a voice', onClick: () => navigate('/account/voice') } })` once per session.

#### 9.4 Step 9 — definition of done

- [ ] Switching voice in `/account/voice` audibly changes the next assistant utterance.
- [ ] `voice_id` appears on every `/elevenlabs-tts` request and `/cenaiva-small-prompt` request body.
- [ ] No `voice_id` on `/cenaiva-orchestrate` requests (orchestrator does not need it; it returns text and the client picks the voice).

---

### Step 10 — Backend audit (no edits)

**Goal:** verify the shared backend has every change mobile relies on. **No backend code edits** are part of this plan.

#### 10.1 `searchFallback.ts` deployment check

The local mobile working tree has uncommitted changes:
- `supabase/functions/cenaiva-orchestrate/index.ts` (modified)
- `supabase/functions/cenaiva-orchestrate/searchFallback.ts` (new)
- `supabase/functions/cenaiva-orchestrate/searchFallback.test.ts` (new)

These changes affect the orchestrator's spoken_text on zero-result Middle-Eastern (and similar) searches. To check deployment:

1. From any logged-in client, issue a search for an unsupported cuisine in a city with active restaurants. Expected new-behavior reply: `"I don't see Middle Eastern restaurants in Toronto matching that. I'd recommend Levant Toronto instead."`
2. If the reply is the **old** form (`"I don't see Middle Eastern restaurants in Toronto matching that. Try a different cuisine or area."` or worse, an LLM hallucination), the change is not yet deployed.

If not deployed, the user (you) deploys from one of:
- Your local working tree: `supabase functions deploy cenaiva-orchestrate --project-ref <ref>`
- The Seatly monorepo after copying the files in: same command.

This is **outside the scope of the web work** — web's mirror is correct regardless. The user simply won't see the new fallback variants until the backend ships.

#### 10.2 `user_profiles.cenaiva_tts_voice` column check

Run from any web SQL editor or Supabase dashboard:
```sql
select column_name, data_type
from information_schema.columns
where table_name = 'user_profiles' and column_name = 'cenaiva_tts_voice';
```
Expected: one row, `text` (or `varchar`).

The migration `20260502000000_add_cenaiva_tts_voice.sql` should have shipped this. If missing, the user runs it.

#### 10.3 RLS sanity

Verify (from a logged-in web session) that:
- `select cenaiva_tts_voice from user_profiles where auth_user_id = auth.uid()` succeeds.
- `update user_profiles set cenaiva_tts_voice = 'female' where auth_user_id = auth.uid()` succeeds.

Both should already work via existing RLS — flag for the user only if not.

#### 10.4 Step 10 — definition of done

- [ ] Searching for an unsupported cuisine in a real city returns the new fallback speech variants (or, if not, the user has been alerted to deploy `searchFallback.ts`).
- [ ] `user_profiles.cenaiva_tts_voice` column exists and is read/writable from the authenticated web client.
- [ ] No backend code changes were made as part of this work.

---

### Step 11 — Env, types, and cleanup

#### 11.1 Env

Update repo-root `.env.example` (and create `apps/web/.env.example` if it does not exist) to include:

```
# TTS / voice
VITE_CENAIVA_TTS_VOICE_FEMALE_ID=8vf2Pg7VZD0Piv8GA8v9
VITE_CENAIVA_TTS_VOICE_MALE_ID=f5HLTX707KIM4SzJYzSz
VITE_DEEPGRAM_STT_ENABLED=true
VITE_ELEVENLABS_ENABLED=true

# Debug
VITE_CENAIVA_VOICE_DEBUG=false
```

#### 11.2 Types and lint

```bash
npm run lint --workspace=apps/web
npm run typecheck --workspace=apps/web
npm run build --workspace=apps/web
```

All three must be clean. **No `any`** anywhere new (per `CLAUDE.md` strict rule). Replace `(cp as any)[name] = ...` from Step 7 with a typed helper:
```ts
function setCheckpoint<K extends keyof LatencyCheckpoints>(
  cp: LatencyCheckpoints, name: K, value: LatencyCheckpoints[K],
) { cp[name] = value; }
```

#### 11.3 Dead code

After the rewrite, scan `AssistantProvider.tsx` for unreachable branches in the OLD `sendTranscript`. Remove them. Do NOT touch:
- Legacy `CenaivaProvider`, `CenaivaDrawer`, `CenaivaMessageBubble.legacy`, `useCenaivaChat`, `cenaiva-chat` edge function. Out of scope.

#### 11.4 Step 11 — definition of done

- [ ] `.env.example` covers every `VITE_CENAIVA_*` var the new code reads.
- [ ] `lint` + `typecheck` + `build` clean.
- [ ] No `any` introduced.
- [ ] Legacy code untouched.

---

## 7. Edge-case behavior matrix

These are concrete utterances the web app must handle correctly after this work. For each row, the **stage** column says which of the four pipeline stages handles it. The **expected** column is the user-perceptible result.

| # | Utterance | Booking status | Stage | Network calls | Expected |
|---|---|---|---|---|---|
| 1 | "table for 4" (no restaurant set) | `idle` | 1 | none | "What restaurant or area should I book?" |
| 2 | "table for 4" (restaurant set) | `collecting_minimum_fields` | 1 | none | "What date and time should I book?" |
| 3 | "tomorrow at 7" | `collecting_minimum_fields`, party_size set | 1 | none | "Did you mean 7 AM or 7 PM?" |
| 4 | "tomorrow at 7 PM" | `collecting_minimum_fields`, party_size set | 2 | `/cenaiva-availability` | "Looking for tomorrow at 7 PM…" filler then availability options |
| 5 | "are they open at 7?" | any with restaurant | 2 | `/cenaiva-availability` (mode=`hours`) | "Yes, they're open. Want me to book?" (or unavailable) |
| 6 | "what's your refund policy?" | any | 3 | `/cenaiva-small-prompt` | Short answer, no booking-state mutation |
| 7 | "find Italian near me" | any | 4 | `/cenaiva-orchestrate` | Restaurant cards on map; `recommendation_mode='list'` |
| 8 | "the closest one" | with prior list | 4 | `/cenaiva-orchestrate` | Single card; `recommendation_mode='single'`; spoken text "I'd go with X." |
| 9 | "yes" | `confirming` | 4 | `/cenaiva-orchestrate` | `complete_booking` tool call, confirmation_code, "preorder?" prompt |
| 10 | "yes" | `idle` | 3 (small-prompt may decline) → 4 | varies | Friendly "yes to what?" reply |
| 11 | "no" | `confirming` | 4 | `/cenaiva-orchestrate` | "What would you like to change?" |
| 12 | "skip preorder" | `offering_preorder` | 4 | `/cenaiva-orchestrate` | "All set. Bye." → `sayGoodbyeAndClose` → `/account` |
| 13 | "add the steak frites" | `browsing_menu` | 4 | `/cenaiva-orchestrate` | `add_menu_item` UI action, cart updates |
| 14 | "tip 20%" | `choosing_tip_amount` | 4 | `/cenaiva-orchestrate` | `set_tip` UI action, status → `choosing_payment_split` |
| 15 | "split with my friends" | `choosing_payment_split` | 4 | `/cenaiva-orchestrate` | `set_payment_split: 'split'` |
| 16 | "charge it" | `choosing_payment_split` (single) | 4 | `/cenaiva-orchestrate` → `charge_saved_card` tool | `show_payment_success` UI action; `paid` status |
| 17 | "Hey Cenaiva" (wake word) | (assistant closed) | n/a | none (wake word client-only) | Open assistant, speak `buildWakeGreeting(user)`, auto-listen |
| 18 | (silence after open) | any | 1 (empty transcript) | none | Relisten up to `MAX_EMPTY_RELISTENS = 3`, then idle |
| 19 | "I love you" | any | 3 (clear small-prompt) | `/cenaiva-small-prompt` | Friendly deflection, no booking mutation |
| 20 | "find me Middle Eastern in Ottawa" (no MEs in Ottawa) | any | 4 | `/cenaiva-orchestrate` (with `searchFallback`) | "I don't see Middle Eastern restaurants in Ottawa matching that. Try a different cuisine or area." |
| 21 | "find me Middle Eastern in Toronto" (only Lebanese) | any | 4 | `/cenaiva-orchestrate` (with `searchFallback`) | "I don't see Middle Eastern restaurants in Toronto matching that. I'd recommend Levant Toronto instead." |
| 22 | "start over" / "different restaurant" | any | 4 | `/cenaiva-orchestrate` | `RESET_ASSISTANT_CONTEXT` style behavior, fresh discovery |
| 23 | (network fails mid-orchestrator) | any | 4 | timeout | "Sorry, I didn't catch that. Try again." → relisten |
| 24 | (mic permission denied) | any | n/a | none | Voice status `error`, persistent UI, no relisten |

Each row should have a corresponding test case in the ported `localBookingCollector.test.ts` / `promptMatrix.test.ts`. Mobile already has these; the port preserves them.

---

## 8. Verification — end-to-end test plan

### 8.1 Manual smoke tests (per step)

**After Step 1:** `npm run build --workspace=packages/assistant` clean. Importing `AssistantMemory` from `@cenaiva/assistant` works in `apps/web`.

**After Step 2:**
```bash
npm run test --workspace=apps/web -- cenaiva
```
All ported helper tests pass. No type errors.

**After Step 3:** Open web app, click voice orb. Confirm voice status flow `idle → listening → processing → speaking → listening`. The booking flow still works end-to-end (full orchestrator path; no regressions).

**After Step 4:** Visit `/account/voice`, toggle to male voice, reload — preference persists. `localStorage.getItem('@cenaiva/tts-voice/<authUserId>')` returns `'male'`.

**After Step 5:** Open assistant, say something common like "How many guests?" via the orchestrator (or trigger one of the cached phrases). On second use, the network panel shows zero requests for that phrase.

**After Step 6:** On `open()`, network panel shows `prewarm: true` POSTs to both `/cenaiva-orchestrate` and `/cenaiva-small-prompt` in parallel.

**After Step 7:** With `VITE_CENAIVA_VOICE_DEBUG=true`, console shows `[cenaiva-latency] turn=N …` once per turn.

**After Step 8 (the big one):** Run the 24-row matrix in §7. Spot-check:
- Row 1 (table for 4 / no restaurant): zero `/cenaiva-orchestrate`.
- Row 6 (refund policy): hits `/cenaiva-small-prompt`.
- Row 8 (closest one): request body has `recommendation_mode='single'`; response capped to one card.
- Row 12 (skip preorder): assistant ends with `sayGoodbyeAndClose`, routes to `/account`.
- Row 16 (charge it): `paid` status fires; `useCenaivaWakeWord.ts` still has zero diff vs `main`.

**After Step 9:** Switch voice mid-session — the next sentence uses the new voice timbre.

**After Step 10:** Row 21 returns the new fallback variant (or you've flagged the user that it isn't deployed yet).

### 8.2 Automated tests

```bash
# Web
npm run lint --workspace=apps/web
npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
npm run build --workspace=apps/web

# Shared package
npm run build --workspace=packages/assistant
npm run test --workspace=packages/assistant
```

All clean.

### 8.3 Cross-app parity smoke

Run [Appendix D](#appendix-d--cross-app-parity-smoke-script) with both web (`VITE_CENAIVA_VOICE_DEBUG=true`) and mobile (`EXPO_PUBLIC_CENAIVA_VOICE_DEBUG=true`) pointed at the same Supabase project. Log per-turn:
- transcript
- pipeline stage hit
- request body (assistant_memory, recommendation_mode, voice_id, booking_state)
- final response.spoken_text
- final booking.status

Diff. Expectations:
- Stage hit must match.
- Field presence must match. Field values may differ in ID strings (different conversation_id, etc.) but shape and semantics must match.
- Spoken text need not be byte-identical (LLM nondeterminism) but should be in the same intent class.

---

## 9. Risks, rollback, and mitigations

### 9.1 Risk register

| Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|
| `recommendation_mode` field is rejected by the deployed orchestrator | low | request 400s; turn fails | Inspect `cenaiva-orchestrate/index.ts:3829-3845` — it accepts unknown keys via `Record<string, unknown>`. Unknown keys are ignored, not rejected. Verified safe. | Remove the field; only loses single-recommendation capping |
| `assistant_memory` schema drifts between mobile and Seatly's `@cenaiva/assistant` | medium | type error at build time | Pin schema in Step 1; document fields in PR; add a CHANGELOG entry in `packages/assistant/CHANGELOG.md` | Revert Step 1 only |
| Local booking collector returns false positives for ambiguous time | medium | missed "table for 7 PM" parsed as "table for 7 (ambiguous)" | Mobile tests `localBookingCollector.test.ts` cover this; port them and ensure they pass | Disable Stage 1 by short-circuiting `decision = { kind: 'pass' }` |
| `IndexedDB` quota exceeded | low | TTS cache fails silently; live fetch fallback | Cache total size <2 MB; ignore writes that throw | Disable cache writes |
| Web wake word accidentally modified | low | wake word breaks; user sees regression | Step 8 has "no diff to `useCenaivaWakeWord.ts`" as a definition-of-done checkbox; CI guard via `git diff --exit-code apps/web/src/hooks/useCenaivaWakeWord.ts main..HEAD` | Revert any commit that touches it |
| `searchFallback.ts` not deployed before web ships | medium | row 21 in §7 still uses old text | Step 10 verifies before sign-off; user deploys if needed | Web is correct regardless; only the spoken text differs |
| Voice ID not honored by `/elevenlabs-tts` because env var missing on edge function | low | default voice plays | Verify `ELEVENLABS_VOICE_ID` env on edge function is set | Fall back to default voice |
| Anti-double-speak guard regression during the rewrite | high (this is the trickiest piece) | every booking confirmation speaks twice | Step 8 explicitly preserves the existing comparison; add a test that asserts a confirmation flow speaks `"…confirmed."` exactly once | Patch back the old guard |
| Auto-relisten gate over-restrictive (mic stays closed too long) | medium | user has to tap the orb | Tests in §7 rows 12, 16 cover this; pre-flight against mobile to confirm gate matches | Reduce `NO_AUTO_RELISTEN_STATUSES` to just `['paid', 'post_booking']` if needed |

### 9.2 Per-step rollback procedures

| Step | Rollback |
|---|---|
| 1 | Revert `packages/assistant/**`. No client behavior change reverts here unless Step 8 already shipped. |
| 2 | Delete `apps/web/src/lib/cenaiva/**` and tests. Code that imports from there must also be reverted. |
| 3 | Revert `AssistantStore.tsx`; the existing reducer continues to work without `memory`. Step 8 must be reverted alongside if shipped. |
| 4 | Revert `App.tsx` provider mount + delete `CenaivaVoicePreferenceProvider.tsx` + delete `/account/voice`. Voice ID falls back to `null` and `/elevenlabs-tts` uses the env-default voice. |
| 5 | Revert `useElevenLabsTTS.ts`. Cache will be stale in user IndexedDB; benign — old code never reads it. |
| 6 | Revert `useCenaivaOrchestrator.ts` (drop `prewarm` + `onTransport`); delete the two new hooks. Step 8 must be reverted alongside if shipped. |
| 7 | Delete `useCenaivaLatencyBudget.ts`. Logging stops. |
| 8 | The big one. Revert `AssistantProvider.tsx` to `main`. Web returns to single-path orchestrator. Steps 1–7 can stay in place; they only add unused capability. |
| 9 | Revert voice_id propagation. Default voice plays. |
| 10 | Backend untouched; nothing to roll back on this PR. |
| 11 | Revert `.env.example` changes; remove the typed-helper. |

### 9.3 Hot-fix flag

Consider adding a kill-switch env var so the new pipeline can be disabled without code revert:

```ts
const FAST_PATH_ENABLED = (import.meta.env.VITE_CENAIVA_FAST_PATH ?? 'true') === 'true';
```

Inside `sendTranscript`, if `!FAST_PATH_ENABLED`, skip Stages 1–3 and go straight to Stage 4. This buys a one-config rollback in production without needing a redeploy if the new pipeline misbehaves.

---

## 10. Performance baseline and targets

### 10.1 Baseline (current web)

Measured on a warm Supabase + warm OpenAI + 50ms RTT, single user:

| Metric | Today (web) | Today (mobile) | Target (web) |
|---|---|---|---|
| Time-to-first-speech-chunk on simple greeting | 600–1,500ms (orchestrator) | 0–50ms (local) | 0–50ms |
| Time-to-final-response on "yes" confirmation | 1,500–5,000ms | 1,500–5,000ms (no change — Stage 4) | 1,500–5,000ms |
| Time-to-final-response on "what's your refund policy?" | 1,500–5,000ms (orchestrator) | 400–1,500ms (small-prompt) | 400–1,500ms |
| Time-to-final-response on "are they open at 7?" | 1,500–5,000ms (orchestrator) | 200–800ms (availability) | 200–800ms |
| Time-to-first-audio (cached "One moment please.") | 200–500ms (network ElevenLabs) | <50ms (FS cache) | <50ms (IndexedDB) |
| Auto-relisten regressions on `paid` status | 1 (mic reopens) | 0 | 0 |

### 10.2 Profiling tools

- DevTools Network panel — request waterfall, headers, body.
- DevTools Performance — JS task durations during a turn.
- The new latency hook (Step 7) — turn-level summary in console.
- Mobile reference: same tools via `react-native-performance` / Flipper if needed.

---

## 11. Browser compatibility considerations

| Concern | Plan |
|---|---|
| `IndexedDB` not available (private mode in some browsers) | Try/catch around all reads/writes; fall through to live fetch |
| `MediaRecorder` not supported | Already mitigated by existing `useDeepgramTranscription`; plan does not change STT |
| `SpeechRecognition` not supported | Wake word already gracefully degrades (out of scope; do not modify) |
| `AbortController.timeout` not in older browsers | Use `setTimeout(() => controller.abort(), N)` pattern (already used everywhere in the plan) |
| `URL.createObjectURL` GC | `URL.revokeObjectURL(url)` after `audio.onended` to avoid leaks |
| Safari autoplay policy | Already mitigated by `primeTTS()` on first user gesture (existing web code, preserve in Step 8) |
| Safari IndexedDB quirks | Test in Safari before merging Step 5 |
| iOS PWA mic limits | Out of scope — user runs web in a browser tab, not a PWA |
| Service-worker cache vs IndexedDB | Use IndexedDB; service workers are not in this repo's stack |

Test browsers for Step 8 sign-off: latest Chrome (M124+), latest Firefox (125+), latest Safari (17+) on macOS, mobile Safari on iOS 17+.

---

## 12. PR / commit message conventions

### 12.1 Recommended PR sequence (one-PR-per-step)

1. `feat(assistant): add assistant_memory + recommendation_mode to OrchestratorRequest schema`
2. `feat(web/cenaiva): port standalone helpers + tests from mobile`
3. `feat(web/cenaiva): add memory state, RESET_ASSISTANT_CONTEXT, NO_AUTO_RELISTEN_STATUSES, buildWakeGreeting`
4. `feat(web): CenaivaVoicePreferenceProvider + /account/voice page`
5. `feat(web/tts): streaming chunk queue + IndexedDB cache for common phrases`
6. `feat(web/cenaiva): orchestrator prewarm + onTransport, useCenaivaSmallPrompt, useCenaivaAvailability hooks`
7. `feat(web/cenaiva): per-turn latency budget hook (debug-flag-gated)`
8. `feat(web/cenaiva): four-stage sendTranscript pipeline (mirror mobile)`
9. `feat(web/cenaiva): propagate voice_id to TTS calls`
10. `chore(supabase): verify searchFallback.ts deployed (no code change)`
11. `chore(web): env example + lint/type cleanup`

Each PR is independently shippable. Steps 1–7 add capability without changing user-visible behavior; Step 8 is the user-visible flip.

### 12.2 Commit body template

```
Why: <one sentence on the gap this closes>
What: <one paragraph on the mechanism>
Reference: mobile <path:lines>; gap matrix row #<n>
Test plan: <bulleted list>
Risk: <one of low/medium/high> + mitigation
Out of scope: useCenaivaWakeWord.ts, legacy CenaivaProvider, backend code
```

### 12.3 Pull-request description template

```markdown
## Summary
<3 bullets>

## Mobile reference
<files + line numbers>

## Behavioral effect
<list rows from §7 that this PR enables>

## Test plan
- [ ] `npm run lint && npm run typecheck && npm run test --workspace=apps/web`
- [ ] Manual: <utterance> → <expected pipeline stage + spoken_text>
- [ ] `git diff --stat apps/web/src/hooks/useCenaivaWakeWord.ts main..HEAD` shows zero changes

## Risk
<low/medium/high> — <one sentence>

## Rollback
<one sentence>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Appendix A — Mobile source excerpts (verbatim, for porting)

### A.1 — `confirmationIntent.ts` (mobile, 45 lines)

```ts
function normalizeConfirmationText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCenaivaAffirmativeBookingConfirmation(transcript: string): boolean {
  const text = normalizeConfirmationText(transcript);
  if (!text) return false;

  return /^(yes|yeah|yep|yup|sure|ok|okay|alright|fine|please|yes please|yeah please|sounds good|go ahead|book it|do it|confirm|confirmed|let's do it|lock it in|make it|make the reservation|please do)$/.test(text) ||
    /\b(yes|confirm|confirmed|book it|go ahead|do it|lock it in|make the reservation|please do)\b/.test(text);
}

export function isCenaivaNegativeBookingConfirmation(transcript: string): boolean {
  const text = normalizeConfirmationText(transcript);
  if (!text) return false;

  return /^(no|nope|nah|not yet|wait|hold on|cancel|stop|don't|do not|different|change it|change that)$/.test(text) ||
    /\b(no|nope|nah|not yet|wait|hold on|cancel|stop|different|change)\b/.test(text);
}

export function isCenaivaBookingConfirmationReply(transcript: string): boolean {
  return isCenaivaAffirmativeBookingConfirmation(transcript) ||
    isCenaivaNegativeBookingConfirmation(transcript);
}

export function shouldRouteAsCenaivaBookingConfirmation(
  bookingStatus: string | null | undefined,
  transcript: string,
): boolean {
  return bookingStatus === 'confirming' && isCenaivaBookingConfirmationReply(transcript);
}

export function transcriptForCenaivaBookingConfirmation(
  bookingStatus: string | null | undefined,
  transcript: string,
): string {
  if (bookingStatus === 'confirming' && isCenaivaAffirmativeBookingConfirmation(transcript)) {
    return 'yes, confirm booking';
  }
  return transcript;
}
```

Web port: identical, no changes.

### A.2 — `simplePromptIntent.ts` (mobile, 75 lines)

Covers `isCenaivaProcessPrompt`, `getCenaivaImmediateFiller`, `shouldResetCenaivaBookingContext`. The full source is reproduced here:

```ts
const DINING_SCOPE_PATTERN =
  /\b(restaurant|restaurants|reservation|reserve|book|booking|table|seat|seating|dine|dining|dinner|lunch|breakfast|brunch|eat|eating|food|hungry|hangry|menu|dish|dishes|cuisine|preorder|pre-order|order|takeout|directions|rewards|bar|cafe|caf|coffee|sushi|pizza|pasta|steak|seafood|vegetarian|taco|tacos|burger|burgers|vegan|halal|kosher|date spot|romantic|near me|nearby|closest|nearest|open|patio|booth|outdoor|indoor|indoors|quiet|private|downtown|dessert|mocktails?|cocktails?)\b/i;

const ACTIONABLE_DINING_REQUEST_PATTERN =
  /\b(find|show|search|recommend|suggest|pick|choose|book|reserve|get|give me|look for|looking for|pull up|open|want|need|craving|feel like|closest|nearest|available|availability|menu|directions|what|which|any|are there|do you have)\b[\s\S]{0,80}\b(restaurant|restaurants|place|places|spot|spots|table|reservation|food|cuisine|dinner|lunch|breakfast|brunch|menu|dish|dishes|near me|nearby|italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|halal|vegan)\b/i;

const RESTAURANT_POLICY_PATTERN =
  /\b(bring (?:a )?(?:dog|pet)|allow kids|kids allowed|parking|vegan|wheelchair|accessible|accessibility|outdoor seating|sit at the bar|birthday cake|split bills?|dress code|halal|gluten[- ]free|booth|allerg(?:y|ies)|high chairs?|loud inside|bring balloons?|no[- ]shows?|deposit|change the booking later|request outdoor|request a booth)\b/i;

const BOOKING_ADJACENT_PATTERN =
  /\b(somewhere|something nice|usual|you know what i mean|make it good|whatever works|surprise me|you choose|for us|few people|vibes?|main character|lighting|outfit|bread|fries|mocktails?|cocktails?|healthy|spicy|dessert|burgers?|pasta|seafood|vegetarian|steak|family|parents|proposal|anniversary|birthday|date|work dinner|team|party|private|quiet|calm|romantic|cheap|budget|budget friendly|fancy|downtown|takeout|tonight|tomorrow|friday|saturday|sunday|next weekend|after work|before the movie|sunset|in an hour|late|early|earlier|later|indoors?|closest|near me)\b/i;

const BOOKING_PROCESS_DETAIL_PATTERN =
  /\b(reservation|booking|booked|confirm|confirmed|confirmation|details|cancel|change|edit|move|table|guests?|people|party size|slot|availability|available|openings?|menu|pre[- ]?order|prepay|order|checkout|pay|payment|card|deposit|refund|fee|tax|tip|directions?|address|phone|contact|hours?|parking|dress code|outdoor|indoor|booth|bar seating|birthday cake|high chair|no show|no-show|show up|are we good|show them this|need id|arrive early|hold the table|confirmation number|booking summary|where is it|remind me)\b/i;

const CUISINE_OR_FOOD_PATTERN =
  /\b(italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|burgers?|mocktails?|cocktails?|vegetarian|seafood|steak|healthy|spicy|dessert)\b/i;

const DATE_OR_PARTY_PATTERN =
  /\b(tomorrow|tonight|friday|saturday|sunday|monday|tuesday|wednesday|thursday|next weekend|as soon as possible|after work|after 9|between 6 and 7|sunset|in an hour|earliest available|latest available|may \d{1,2}|\d{1,2}\s*(?:am|pm)?|8ish|table for|for \d+|just me|me plus one|double date|big group|whoever shows up|adults?|kids?|people|guest|guests)\b/i;

const PURE_IMPATIENCE_PATTERN =
  /\b(hurry up|why is this taking so long|stop asking questions|can you be faster|be faster|do it now|you'?re moving slow|moving slow|don'?t want a whole conversation|why do you need all that info|less talking more booking|less talking, more booking)\b/i;

const CLEAR_SMALL_PROMPT_PATTERN =
  /\b(am i gay|am i straight|am i bi|am i bisexual|do you think i'?m|are you single|do you love me|i love you|you'?re cute|you are cute|you'?re hot|you are hot|your voice is cute|fish|get thirsty|raccoon|dinosaur|pasta could talk|ghosts?|cereal soup|meaning of life|aliens?|horse sized|duck sized|chairs? have feelings|villain entrance|fog machine|spy mission|homework|write me a rap|order me a car|call my ex|hack|bypass|fake phone|fake number|lie and say|threaten|cancel someone else|change someone else|pretend i'?m the owner|make them give me free food|fully booked|under someone else'?s name|without giving my details|guarantee the best table|book 10 restaurants|book ten restaurants)\b/i;

const RESET_BOOKING_CONTEXT_PATTERN =
  /\b(start over|start fresh|reset|restart|new search|forget that|cancel that|clear (?:that|it)|different restaurant|different place|different spot|change restaurant|switch to)\b/i;

const NEW_RESTAURANT_SEARCH_PATTERN =
  /\b(find|show|search|recommend|suggest|pick|choose|look for|looking for|want|need|craving|feel like|closest|nearest|nearby|near me|closer|cheaper|fancier)\b[\s\S]{0,90}\b(restaurant|restaurants|place|places|spot|spots|food|cuisine|italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|halal|vegan|burgers?|mocktails?|cocktails?|vegetarian|seafood|steak|healthy|spicy|dessert|nearby|near me)\b/i;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isCenaivaProcessPrompt(transcript: string): boolean {
  const normalized = normalize(transcript);
  if (!normalized) return false;
  if (CLEAR_SMALL_PROMPT_PATTERN.test(normalized)) return false;
  if (PURE_IMPATIENCE_PATTERN.test(normalized)) return false;
  return ACTIONABLE_DINING_REQUEST_PATTERN.test(normalized) ||
    DINING_SCOPE_PATTERN.test(normalized) ||
    RESTAURANT_POLICY_PATTERN.test(normalized) ||
    BOOKING_ADJACENT_PATTERN.test(normalized) ||
    BOOKING_PROCESS_DETAIL_PATTERN.test(normalized) ||
    CUISINE_OR_FOOD_PATTERN.test(normalized) ||
    DATE_OR_PARTY_PATTERN.test(normalized) ||
    /\b(can you handle it|not too late|for a few people|for us|i don'?t know yet|changed my mind|start over|cancel that|different restaurant|switch to|closer|earlier|later|make it cheaper|make it fancier)\b/i.test(normalized);
}

export function getCenaivaImmediateFiller(transcript: string): string | null {
  const normalized = normalize(transcript);
  if (CLEAR_SMALL_PROMPT_PATTERN.test(normalized)) return null;
  if (!normalized || !isCenaivaProcessPrompt(normalized)) return null;
  if (PURE_IMPATIENCE_PATTERN.test(normalized)) return null;
  if (/^(table for|for\s+\d+|for\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b)/i.test(normalized)) {
    return null;
  }
  return 'One moment please.';
}

export function shouldResetCenaivaBookingContext(transcript: string): boolean {
  const normalized = normalize(transcript);
  if (!normalized) return false;
  if (CLEAR_SMALL_PROMPT_PATTERN.test(normalized)) return false;
  return RESET_BOOKING_CONTEXT_PATTERN.test(normalized) ||
    NEW_RESTAURANT_SEARCH_PATTERN.test(normalized);
}
```

Web port: identical, no changes.

### A.3 — `recommendationIntent.ts` (mobile, 297 lines)

The full source is in `/Users/stevengeorgy/mobile-seatly-v2-4/lib/cenaiva/recommendationIntent.ts`. Key exports:

- `getCenaivaRecommendationMode(transcript) → 'single' | 'list' | null`
- `isSingleRestaurantRecommendationIntent(transcript) → boolean`
- `capSingleRecommendationSpokenText(text) → string`
- `normalizeSingleRestaurantRecommendationResponse(response, transcript) → AssistantResponseType`
- `applyClientDiscoveryMemory(response, transcript, opts) → AssistantResponseType`

`getCenaivaRecommendationMode` (the field on the outgoing request) lines 70–84:

```ts
export function getCenaivaRecommendationMode(transcript: string): CenaivaRecommendationMode | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;
  if (BOOKING_WORDS.test(normalized)) return null;

  const explicitSingle = EXPLICIT_SINGLE_WORDS.test(normalized);
  const asksForPluralList = PLURAL_DISCOVERY_WORDS.test(normalized) && !explicitSingle;
  if (asksForPluralList && !/\b(closest|nearest|best|top)\s+restaurant\b/i.test(normalized)) {
    return 'list';
  }

  return SINGLE_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(normalized)) || explicitSingle
    ? 'single'
    : null;
}
```

Web port: identical, no changes. Imports from `@cenaiva/assistant` resolve identically (web workspace already includes the package).

### A.4 — `filterRestaurants.ts` (mobile, 127 lines)

Reproduced in §A above (it was quoted in full earlier in this document). Web port: change the `Restaurant` import (mobile imports from `@/lib/mock/restaurants`; web has its own type — adapt the import only). The function bodies remain identical.

### A.5 — `CenaivaVoicePreferenceProvider` (mobile)

Full mobile source, with **only three substitutions** required for web:

```tsx
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

// SUBSTITUTION 1 (mobile → web):
//   replace: import AsyncStorage from '@react-native-async-storage/async-storage';
//   with:    a localStorage shim (defined inline below).
// SUBSTITUTION 2 (mobile → web):
//   replace: import { useAuthSession } from '@/lib/auth/AuthContext';
//   with:    import { useUser } from '@/hooks/useUser';
// SUBSTITUTION 3 (mobile → web):
//   replace: import { getSupabase } from '@/lib/supabase/client';
//   with:    import { getSupabaseBrowserClient } from '@/lib/supabase/client';

import { useUser } from '@/hooks/useUser';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  getCenaivaTtsVoiceId, normalizeCenaivaTtsVoice, type CenaivaTtsVoice,
} from '@/lib/cenaiva/voicePreference';

const Storage = {
  async getItem(key: string): Promise<string | null> {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  async setItem(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); } catch { /* quota or SSR */ }
  },
  async removeItem(key: string): Promise<void> {
    try { localStorage.removeItem(key); } catch { /* noop */ }
  },
};

type CenaivaVoicePreferenceContextValue = {
  voicePreference: CenaivaTtsVoice | null;
  voiceId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  needsSelection: boolean;
  refresh: () => Promise<void>;
  setVoicePreference: (voice: CenaivaTtsVoice) => Promise<boolean>;
};

const CenaivaVoicePreferenceContext = createContext<CenaivaVoicePreferenceContextValue | null>(null);

export function useCenaivaVoicePreference() {
  const ctx = useContext(CenaivaVoicePreferenceContext);
  if (!ctx) {
    throw new Error('useCenaivaVoicePreference must be used inside CenaivaVoicePreferenceProvider');
  }
  return ctx;
}

function storageKeyForUser(authUserId: string) {
  return `@cenaiva/tts-voice/${authUserId}`;
}

export function CenaivaVoicePreferenceProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const isAuthenticated = !!user?.id;
  const currentUserId = user?.id ?? null;
  const [voicePreference, setVoicePreferenceState] = useState<CenaivaTtsVoice | null>(null);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const authUserId = user?.id ?? '';

    if (!isAuthenticated || !authUserId) {
      setVoicePreferenceState(null);
      setIsLoading(false);
      setResolvedUserId(null);
      return;
    }

    const storageKey = storageKeyForUser(authUserId);
    setIsLoading(true);
    try {
      const cached = normalizeCenaivaTtsVoice(await Storage.getItem(storageKey));
      if (cached) {
        setVoicePreferenceState(cached);
        setResolvedUserId(authUserId);
      }

      if (!supabase) {
        if (!cached) setVoicePreferenceState(null);
        return;
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .select('cenaiva_tts_voice')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      if (error) {
        if (!cached) setVoicePreferenceState(null);
        return;
      }

      const remote = normalizeCenaivaTtsVoice(data?.cenaiva_tts_voice);
      if (remote) {
        setVoicePreferenceState(remote);
        await Storage.setItem(storageKey, remote);
        return;
      }

      await Storage.removeItem(storageKey).catch(() => undefined);
      setVoicePreferenceState(null);
    } catch {
      const cached = normalizeCenaivaTtsVoice(
        await Storage.getItem(storageKey).catch(() => null),
      );
      setVoicePreferenceState(cached);
    } finally {
      setIsLoading(false);
      setResolvedUserId(authUserId);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setVoicePreference = useCallback(async (voice: CenaivaTtsVoice) => {
    const supabase = getSupabaseBrowserClient();
    const authUserId = user?.id ?? '';
    const storageKey = authUserId ? storageKeyForUser(authUserId) : '';

    if (!isAuthenticated || !authUserId) return false;

    setVoicePreferenceState(voice);
    setResolvedUserId(authUserId);
    setIsSaving(true);
    try {
      await Storage.setItem(storageKey, voice);

      if (!supabase) return true;

      const { error } = await supabase
        .from('user_profiles')
        .update({ cenaiva_tts_voice: voice })
        .eq('auth_user_id', authUserId);

      return !error;
    } catch {
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [isAuthenticated, user?.id]);

  const effectiveLoading = isLoading || (isAuthenticated && resolvedUserId !== currentUserId);

  const value = useMemo<CenaivaVoicePreferenceContextValue>(() => ({
    voicePreference,
    voiceId: effectiveLoading ? null : getCenaivaTtsVoiceId(voicePreference),
    isLoading: effectiveLoading,
    isSaving,
    needsSelection:
      isAuthenticated &&
      resolvedUserId === currentUserId &&
      !effectiveLoading &&
      voicePreference == null,
    refresh,
    setVoicePreference,
  }), [
    currentUserId, effectiveLoading, isAuthenticated, isSaving, refresh,
    resolvedUserId, setVoicePreference, voicePreference,
  ]);

  return (
    <CenaivaVoicePreferenceContext.Provider value={value}>
      {children}
    </CenaivaVoicePreferenceContext.Provider>
  );
}
```

### A.6 — `getCenaivaSmallPrompt` (mobile)

```ts
import type { BookingState } from '@cenaiva/assistant';
import { getSupabaseEnv, isSupabaseConfigured } from '@/lib/supabase/env';

export type CenaivaSmallPromptResponse = {
  spoken_text: string;
  next_expected_input: 'restaurant' | 'party_size' | 'date' | 'time' | 'confirmation';
  audio?: { audio_base64: string; audio_content_type?: string | null } | null;
};

function parseSmallPromptResponse(payload: unknown): CenaivaSmallPromptResponse | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Partial<CenaivaSmallPromptResponse>;
  if (typeof value.spoken_text !== 'string' || !value.spoken_text.trim()) return null;
  if (
    value.next_expected_input !== 'restaurant' &&
    value.next_expected_input !== 'party_size' &&
    value.next_expected_input !== 'date' &&
    value.next_expected_input !== 'time' &&
    value.next_expected_input !== 'confirmation'
  ) return null;
  return {
    spoken_text: value.spoken_text.trim(),
    next_expected_input: value.next_expected_input,
    audio:
      value.audio &&
      typeof value.audio === 'object' &&
      typeof value.audio.audio_base64 === 'string' &&
      value.audio.audio_base64.trim()
        ? {
            audio_base64: value.audio.audio_base64,
            audio_content_type: typeof value.audio.audio_content_type === 'string'
              ? value.audio.audio_content_type
              : null,
          }
        : null,
  };
}

export async function postCenaivaSmallPrompt(
  req: {
    transcript: string;
    booking: Pick<BookingState, 'restaurant_id'|'restaurant_name'|'party_size'|'date'|'time'>;
    voice_id?: string | null;
  },
  options: {
    accessToken: string | null | undefined;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<{ data: CenaivaSmallPromptResponse | null; error: string | null }> {
  if (!isSupabaseConfigured()) return { data: null, error: 'not_configured' };
  if (!options.accessToken) return { data: null, error: 'not_authenticated' };

  const { url, anonKey } = getSupabaseEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${url}/functions/v1/cenaiva-small-prompt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(req),
    signal: options.signal,
  });

  if (!response.ok) return { data: null, error: `http_${response.status}` };
  return { data: parseSmallPromptResponse(await response.json()), error: null };
}

export function prewarmCenaivaSmallPrompt(options: {
  accessToken: string | null | undefined;
  voiceId?: string | null;
  fetchImpl?: typeof fetch;
}) {
  if (!isSupabaseConfigured() || !options.accessToken) return;
  const { url, anonKey } = getSupabaseEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 6_000) : null;

  void fetchImpl(`${url}/functions/v1/cenaiva-small-prompt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      transcript: 'Thanks',
      booking: {},
      voice_id: options.voiceId ?? undefined,
      prewarm: true,
    }),
    signal: controller?.signal,
  })
    .catch(() => undefined)
    .finally(() => { if (timeoutId) clearTimeout(timeoutId); });
}
```

Web port: substitute `getSupabaseEnv()` and `isSupabaseConfigured()` with the equivalents from `apps/web/src/lib/supabase/client.ts` (`getSupabaseProjectUrl()`, `getSupabaseAnonKey()`, `isSupabaseConfigured()`). The bearer token comes from `client.auth.getSession()`.

### A.7 — `checkCenaivaAvailability` (mobile)

Already reproduced in full earlier in this document (the file is 76 lines; see the read of `lib/cenaiva/api/checkCenaivaAvailability.ts`). The shape difference vs `getSupabaseSmallPrompt` is that it accepts the anon key as a fallback when no user JWT is present (`Authorization: Bearer ${options.accessToken || anonKey}`), since the orchestrator-internal endpoint allows anon-key callers — the orchestrator itself enforces user identity. Web port: same substitutions as A.6.

### A.8 — `searchFallback.ts` (backend, new)

Already reproduced in full above. **No web work needed for this file** — it lives on the backend. Step 10 verifies its deployment.

### A.9 — `assistantStore.tsx` reducer extracts (mobile)

Lines 414–501 (`APPLY_RESPONSE` case) and 516–535 (`RESET_ASSISTANT_CONTEXT` case) reproduced in full above. Use these verbatim in Step 3.

---

## Appendix B — Full TypeScript surface diffs

### B.1 — `OrchestratorRequest` (web today vs target)

**Web today** (inferred from `apps/web/src/components/cenaiva/AssistantProvider.tsx:196-235`):

```ts
type OrchestratorRequestType = {
  transcript: string;
  screen: string;
  booking_state: { /* every field of BookingState */ };
  map_state: { /* every field of MapState */ };
  filters: FiltersDelta;
  visible_restaurant_ids: string[];
  selected_restaurant_id?: string | null;
  user_location?: { lat: number; lng: number } | null;
  timezone?: string;
  conversation_id?: string;
  has_saved_card: boolean;
  guest_id: null;
  reservation_id?: string | null;
};
```

**Target** (after Step 1 + Step 8):

```ts
type OrchestratorRequestType = {
  transcript: string;
  screen: string;
  booking_state: { /* every field of BookingState */ };
  map_state: { /* every field of MapState */ };
  filters: FiltersDelta;
  visible_restaurant_ids: string[];
  selected_restaurant_id?: string | null;
  recommendation_mode?: 'single' | 'list' | null;            // NEW
  assistant_memory?: AssistantMemory | null;                  // NEW
  user_location?: { lat: number; lng: number } | null;
  timezone?: string;
  conversation_id?: string;
  has_saved_card: boolean;
  guest_id: null;
  reservation_id?: string | null;
};
```

### B.2 — `useCenaivaOrchestrator` return (web today vs target)

```ts
// Today
return { send, loading, error, lastErrorRef, cancel };

// Target
return { send, loading, error, lastErrorRef, cancel, prewarm };
```

### B.3 — `SendCallbacks` (web today vs target)

```ts
// Today
interface SendCallbacks {
  onSpeechChunk?: (text: string) => void;
  onDiscardPendingSpeech?: () => void;
}

// Target
interface SendCallbacks {
  onSpeechChunk?: (text: string) => void;
  onDiscardPendingSpeech?: () => void;
  onTransport?: (transport: 'readable_stream' | 'buffered_text' | 'xhr_event_source') => void;  // NEW
}
```

### B.4 — `useCenaivaVoice` return (web today vs target)

```ts
// Today
return { startListening, stopListening, primeTTS, speak, stopSpeaking, isSpeaking,
  voiceStatus, transcriptionPhase, lastError };

// Target — adds streaming TTS surface
return { ...today,
  speakStreamingChunk, drainStreamingSpeech, discardStreamingSpeech, isStreamingTTSAvailable };
```

### B.5 — `AssistantState` (web today vs target)

```ts
// Today (apps/web/src/components/cenaiva/AssistantStore.tsx:20-31)
export interface AssistantState {
  isOpen: boolean;
  voiceStatus: VoiceStatus;
  booking: BookingState;
  map: MapState;
  filters: FiltersDelta;
  showExitX: boolean;
  customerAccepted: boolean;
  conversationId: string | null;
  lastSpokenText: string;
  availabilityOpen: boolean;
}

// Target — adds memory
export interface AssistantState {
  isOpen: boolean;
  voiceStatus: VoiceStatus;
  booking: BookingState;
  map: MapState;
  filters: FiltersDelta;
  memory: AssistantMemory;     // NEW
  showExitX: boolean;
  customerAccepted: boolean;
  conversationId: string | null;
  lastSpokenText: string;
  availabilityOpen: boolean;
}
```

### B.6 — `AssistantContextValue` (web today vs target)

```ts
// Today
interface AssistantContextValue {
  open: (restaurantId?, restaurantName?, opts?: { autoListen?: boolean }) => void;
  close: () => void;
  sayGoodbyeAndClose: (message?: string, redirectAfter?: string) => Promise<void>;
  sendTranscript: (transcript, opts?: { restaurantId?, silent?, force? }) => Promise<void>;
  startListening: () => Promise<void>;
  shouldAutoListenOnOpen: () => boolean;
  setSpeechHints: (hints: string[]) => void;
  setTextMode: (active: boolean) => void;
}

// Target — open() takes greetingText
interface AssistantContextValue {
  open: (restaurantId?, restaurantName?, opts?: { autoListen?: boolean; greetingText?: string }) => void;  // CHANGED
  // ...everything else unchanged
}
```

---

## Appendix C — Sequence diagrams

### C.1 — A simple "table for 4" turn (Stage 1)

```
User              VoiceOrb            AssistantProvider    LocalCollector     Voice.speak
 │                   │                       │                   │                │
 │   tap orb         │                       │                   │                │
 │ ────────────────► │                       │                   │                │
 │                   │ open()                │                   │                │
 │                   │ ────────────────────► │ prewarm orches    │                │
 │                   │                       │ prewarm small     │                │
 │                   │ startListening()      │                   │                │
 │                   │ ────────────────────► │                   │                │
 │ "table for 4"     │                       │                   │                │
 │ ────────────────► │ → Deepgram → text     │                   │                │
 │                   │ sendTranscript()      │                   │                │
 │                   │ ────────────────────► │ planLocalBooking… │                │
 │                   │                       │ ────────────────► │                │
 │                   │                       │ ◄─ {kind:'local_  │                │
 │                   │                       │   response',      │                │
 │                   │                       │   "What restaurant│                │
 │                   │                       │    or area?"}     │                │
 │                   │                       │                                      │
 │                   │                       │ APPLY_RESPONSE   ─────────────────► │
 │                   │                       │                                      │
 │ "What restaurant…"│                       │                                      │
 │ ◄─────────────────────────────────────────────────────────────────────────────── │
 │                   │                       │ schedule relisten 260ms             │
 │                   │                       │ startListening()                    │
```

### C.2 — A confirmation "yes" (Stage 4 with `recommendation_mode`)

```
User → orb → AssistantProvider
                 │
                 │ shouldRouteAsCenaivaBookingConfirmation('confirming', 'yes') → true
                 │ recommendation_mode = null (booking words present)
                 │ STAGE 1: pass (booking is in 'confirming', not collecting)
                 │ STAGE 3: skip (isBookingConfirmationReply === true)
                 │ STAGE 4 (orchestrator)
                 ▼
   POST /cenaiva-orchestrate
     body: { transcript: 'yes', recommendation_mode: undefined,
             assistant_memory: { booking_process: {phase:'confirming',…} }, ... }
                 │
                 ▼
   SSE: speech_chunk "Booking confirmed."
        speech_chunk "You're all set."
        final { ui_actions: [show_confirmation], booking: {confirmation_code:…} }
                 │
                 ▼
   APPLY_RESPONSE → status='offering_preorder'
   anti-double-speak: streamed === final → drain only
   NO_AUTO_RELISTEN_STATUSES.has('offering_preorder') → idle, no relisten
   show BookingSheet's "Want to pre-order?" view
```

### C.3 — Wake-word activation

```
(idle, web app on /discover)
         │
         │ user says "Hey Cenaiva"
         ▼
   useCenaivaWakeWord (UNCHANGED) fires onWake()
         │
         ▼
   AssistantProvider.onWake()
   ├── voice.primeTTS()
   ├── greetingText = buildWakeGreeting(user)
   │     = "Good morning, Steven. How may I help with your reservation?"
   └── open(undefined, undefined, { autoListen: true, greetingText })
         │
         ▼
   open(...)
   ├── forceStopWakeWord()      ← synchronous, releases mic before command recognizer
   ├── prewarm orchestrator + small-prompt
   ├── prefetchDeepgramToken()
   ├── dispatch OPEN
   └── (async) voice.speak(greetingText) → startListening()
```

---

## Appendix D — Cross-app parity smoke script

This is a **manual** script. Run on web (`VITE_CENAIVA_VOICE_DEBUG=true`) and mobile (`EXPO_PUBLIC_CENAIVA_VOICE_DEBUG=true`) in two windows side-by-side, both signed in as the same test user, both pointed at the shared Supabase project.

```
TURN 01: tap orb (no wake word, to skip the greeting variance)
TURN 02: "find Italian near me"
TURN 03: "the closest one"            ← expect single-card cap on both
TURN 04: "what time are they open tomorrow?"
TURN 05: "table for 4 at 7 PM"
TURN 06: "yes book it"                ← expect status='confirming' → completed booking
TURN 07: "what's your refund policy?" ← expect Stage 3 small-prompt on both
TURN 08: "skip preorder"              ← expect sayGoodbyeAndClose on web; mobile equivalent
TURN 09: tap orb (re-enter discovery)
TURN 10: "find me Middle Eastern in Toronto"  ← expect new searchFallback wording
TURN 11: "tonight at 8"               ← expect availability fast-path on both
```

For each turn record (web + mobile separately):

| Field | Source |
|---|---|
| network calls (URLs only) | DevTools Network panel |
| pipeline stage | latency log line |
| `transcript→firstSpeech` | latency log |
| `transcript→final` | latency log |
| `transport` | latency log |
| final `booking.status` | React DevTools |
| final `voiceStatus` | React DevTools |
| spoken_text class | qualitative |

**Pass criteria:** for each row, web and mobile have the same network-call set (modulo cosmetic differences like `apikey` query strings) and the same pipeline stage. Spoken text need not be byte-identical (LLM nondeterminism) but must be in the same intent class.

If any row diverges:
- Same stage, different latency → expected; mobile native runtime is faster than browser MediaSource decoding by ~50ms.
- Different stage → bug. The intent helpers diverged in the port. Investigate `localBookingCollector` / `simplePromptIntent`.
- Different network calls → bug. Step 8 wiring missed a stage gate.

---

*End of plan.*
