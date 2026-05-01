# Hey Cenaiva Mobile Integration Handoff

Target mobile repository:

```text
https://github.com/savyo777/mobile-seatly-v2
```

This document is written for the implementation agent working in that mobile repository. The current repository, `Seatly-7`, is only the web app and Supabase backend source of truth. Do not add mobile implementation files to `Seatly-7`.

I checked `mobile-seatly-v2` from GitHub. The repository is reachable and the HEAD observed during this handoff was:

```text
4defe8bedc75e556b376f79f208aa2f3141422ad
```

The mobile app is an Expo Router app named `mobile-cenaiva-v2` / `Cenaiva`, using Expo SDK 55, React 19, React Native 0.83, NativeWind/theme helpers, Supabase, AsyncStorage, `react-native-maps`, `expo-location`, `expo-file-system`, and an existing mock AI chat UI. The existing AI chat is not the production Hey Cenaiva workflow. The task is to replace the mock AI experience with the real Hey Cenaiva orchestrator-backed workflow used by the web app.

## Non-Negotiable Goal

The mobile app must mirror the working web Hey Cenaiva process exactly at the behavior level:

- Same Supabase project.
- Same `cenaiva-orchestrate` edge function.
- Same request/response schema.
- Same booking state machine.
- Same final confirmation rule.
- Same anti-repetition behavior.
- Same post-booking preorder prompt.
- Same safe handling for allergies, accessibility, payments, no availability, and ambiguous requests.

The mobile app must not reimplement restaurant intelligence locally. All booking and assistant logic must go through Supabase edge functions.

## Existing Mobile Repo Structure To Use

Current files in `mobile-seatly-v2` that matter:

```text
app/_layout.tsx
app/(customer)/_layout.tsx
app/(customer)/ai-chat.tsx
app/(customer)/discover/index.tsx
app/(customer)/map.tsx
app/booking/[restaurantId]/step1-date.tsx
app/booking/[restaurantId]/step2-time.tsx
app/booking/[restaurantId]/confirm.tsx
app/booking/[restaurantId]/step4-preorder.tsx
app/booking/[restaurantId]/step5-review.tsx
app/booking/[restaurantId]/step6-payment.tsx
app/booking/[restaurantId]/step7-confirmation.tsx
components/ai/AiChatFab.tsx
components/ai/AiChatPanel.tsx
components/map/RestaurantDiscoveryMap.tsx
components/map/RestaurantDiscoveryMap.web.tsx
components/map/RestaurantMapDetailSheet.tsx
components/map/RestaurantMapMarker.tsx
components/discover/DiscoverMapView.tsx
components/booking/BookingCalendarModal.tsx
components/booking/PartySizeWheel.tsx
components/booking/TimeSlotWheel.tsx
hooks/useAiVoiceInput.ts
lib/auth/AuthContext.tsx
lib/supabase/client.ts
lib/supabase/env.ts
lib/supabase/fetchRestaurants.ts
lib/supabase/mapRestaurantRow.ts
lib/data/restaurantCatalog.ts
lib/booking/getAvailability.ts
lib/booking/availabilityTypes.ts
packages/types/index.ts
app.json
.env.example
package.json
```

Important current-state notes:

- `components/ai/AiChatPanel.tsx` is a mock assistant. It uses `lib/mock/aiChat`, `pickRestaurantsForQuery`, and fake delayed replies. This must not remain as the production Hey Cenaiva implementation.
- `hooks/useAiVoiceInput.ts` uses `expo-speech-recognition` / Web Speech style transcription. The web Hey Cenaiva flow uses Deepgram token + Deepgram transcription instead. Keep the current hook only as a fallback or replace it with the real Deepgram adapter.
- `app/booking/[restaurantId]/step7-confirmation.tsx` generates fake confirmation codes locally. Hey Cenaiva must never use this for assistant-created bookings. Confirmation codes must come from the backend response after `cenaiva-orchestrate` completes the reservation.
- `lib/booking/getAvailability.ts` currently returns mock availability. Hey Cenaiva availability must come from the backend/orchestrator. Manual non-assistant booking can keep mock flow temporarily if necessary, but do not let the assistant use mock availability or fake reservation confirmation.
- `components/map/*` already has native map support. Reuse it for assistant-visible markers/highlight state.
- `lib/supabase/client.ts` already has the correct AsyncStorage-based Supabase session persistence. Reuse it.
- `lib/auth/AuthContext.tsx` already exposes the session. Reuse it to get the bearer token.
- `app/(customer)/_layout.tsx` already renders `AiChatFab`. Replace the contents behind this FAB with the real Cenaiva shell/provider.

## Web Source Of Truth

Use these files from `Seatly-7` as the behavior reference:

```text
packages/assistant/src/schema.ts
packages/assistant/src/intents.ts
apps/web/src/components/cenaiva/AssistantProvider.tsx
apps/web/src/components/cenaiva/AssistantStore.tsx
apps/web/src/components/cenaiva/BookingSheet.tsx
apps/web/src/components/cenaiva/CenaivaVoiceShell.tsx
apps/web/src/components/cenaiva/CustomerMap.tsx
apps/web/src/components/cenaiva/RestaurantRail.tsx
apps/web/src/hooks/useCenaivaOrchestrator.ts
apps/web/src/hooks/useCenaivaVoice.ts
apps/web/src/hooks/useDeepgramTranscription.ts
apps/web/src/hooks/useElevenLabsTTS.ts
apps/web/src/hooks/useSavedCards.ts
apps/web/src/hooks/useAvailability.ts
supabase/functions/cenaiva-orchestrate/index.ts
supabase/functions/cenaiva-orchestrate/followup.ts
supabase/functions/cenaiva-orchestrate/followup.test.ts
supabase/functions/deepgram-live-token/index.ts
supabase/functions/elevenlabs-tts/index.ts
```

Do not use these legacy web files as the source of truth for the customer booking assistant:

```text
apps/web/src/components/cenaiva/CenaivaProvider.tsx
apps/web/src/components/cenaiva/CenaivaDrawer.tsx
apps/web/src/hooks/useCenaivaChat.ts
supabase/functions/cenaiva-chat/index.ts
```

Those are not the modern Hey Cenaiva orchestrated reservation flow.

## Required Mobile Package Changes

Current mobile dependencies already include:

```text
@react-native-async-storage/async-storage
@supabase/supabase-js
expo-file-system
expo-location
expo-speech-recognition
react-native-maps
zod
```

Add what is missing:

```bash
npx expo install expo-audio expo-speech
npm install react-native-sse date-fns
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "start": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "web": "expo start --web"
  }
}
```

If you add Jest or Vitest for reducer/client tests, add:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  }
}
```

Do not remove existing app dependencies unless you confirm they are unused elsewhere.

## App Config Changes

`mobile-seatly-v2/app.json` already has app name, scheme, Supabase-compatible Expo structure, location plugin, camera plugin, and speech-recognition plugin.

Add `expo-audio` to plugins when installing `expo-audio`:

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-font",
      "expo-audio"
    ]
  }
}
```

Keep existing plugins. Do not delete the camera/image-picker/location plugins.

Make sure these permission strings exist:

```text
iOS microphone:
Cenaiva uses your microphone so you can speak restaurant and booking requests.

iOS location:
Cenaiva uses your location to find nearby restaurants.

iOS speech recognition, if expo-speech-recognition remains installed:
Cenaiva may use speech recognition to process spoken restaurant and booking requests.

Android:
RECORD_AUDIO
ACCESS_FINE_LOCATION
ACCESS_COARSE_LOCATION
```

For App Store / Play Store v1:

- Foreground tap-to-talk only.
- No background wake-word listener.
- No continuous background recording.
- Stop recording when the assistant shell closes or app backgrounds.

## Environment Variables

Update `.env.example`:

```env
# Same Supabase project as the web app.
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Feature flags. These are public booleans, not secrets.
EXPO_PUBLIC_DEEPGRAM_STT_ENABLED=true
EXPO_PUBLIC_ELEVENLABS_ENABLED=true
```

Never place these in the mobile app:

```text
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
DEEPGRAM_API_KEY
ELEVENLABS_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

The mobile app must call Supabase edge functions with:

- signed-in user bearer token
- Supabase anon key

## Shared Assistant Package

The web app has `packages/assistant` with schemas and constants. The mobile repo currently has only `packages/types`, not `packages/assistant`.

Preferred implementation:

1. Copy `Seatly-7/packages/assistant` into `mobile-seatly-v2/packages/assistant`.
2. Add it to mobile `package.json`:

```json
{
  "dependencies": {
    "@cenaiva/assistant": "file:packages/assistant"
  }
}
```

3. Keep `@cenaiva/assistant` synced with the web package.

Alternative:

- Create `lib/cenaiva/schema.ts` in mobile by copying the schema from `Seatly-7/packages/assistant/src/schema.ts`.
- This is less ideal because schema drift becomes easier.

Do not hand-write a looser schema from memory. Use the actual web schema.

## Shared Contract

Mobile sends:

```ts
type OrchestratorRequest = {
  transcript?: string;
  screen?: string;
  booking_state?: BookingDelta;
  map_state?: MapDelta;
  filters?: FiltersDelta;
  visible_restaurant_ids?: string[];
  selected_restaurant_id?: string | null;
  user_location?: { lat: number; lng: number } | null;
  timezone?: string;
  conversation_id?: string;
  has_saved_card?: boolean;
  guest_id?: string | null;
  reservation_id?: string | null;
};
```

Mobile receives:

```ts
type AssistantResponse = {
  conversation_id: string;
  spoken_text: string;
  intent: string;
  step: string;
  next_expected_input: string;
  ui_actions: UIAction[];
  booking: BookingDelta | null;
  map: MapDelta | null;
  filters: FiltersDelta | null;
};
```

The orchestrator endpoint:

```text
POST {EXPO_PUBLIC_SUPABASE_URL}/functions/v1/cenaiva-orchestrate
```

Headers:

```ts
{
  Authorization: `Bearer ${session.access_token}`,
  apikey: EXPO_PUBLIC_SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
  Accept: "text/event-stream"
}
```

## State Machine Requirements

Create:

```text
lib/cenaiva/state/assistantStore.tsx
```

or, if the app convention prefers features:

```text
features/cenaiva/state/assistantStore.tsx
```

The state must mirror web `AssistantStore`.

Booking state:

```ts
type BookingStatus =
  | "idle"
  | "collecting_minimum_fields"
  | "loading_availability"
  | "awaiting_time_selection"
  | "confirming"
  | "confirmed"
  | "post_booking"
  | "offering_preorder"
  | "browsing_menu"
  | "reviewing_cart"
  | "choosing_tip_timing"
  | "choosing_tip_amount"
  | "choosing_payment_split"
  | "collecting_payment"
  | "charging"
  | "paid";

type BookingState = {
  restaurant_id: string | null;
  restaurant_name: string | null;
  party_size: number | null;
  date: string | null;
  time: string | null;
  shift_id: string | null;
  slot_iso: string | null;
  special_request: string | null;
  occasion: string | null;
  status: BookingStatus;
  confirmation_code: string | null;
  reservation_id: string | null;
  order_id: string | null;
  payment_status: "idle" | "pending" | "paid" | "failed";
  tip_choice: "now" | "after" | null;
  tip_amount: number | null;
  tip_percent: number | null;
  payment_split: "single" | "split" | null;
  pending_action: {
    type: "modify_reservation" | "cancel_reservation" | "late_note" | "save_preference";
    payload: Record<string, unknown>;
    confirmation_text: string;
  } | null;
  cart_subtotal: number;
  cart: Array<{
    menu_item_id: string;
    name: string;
    qty: number;
    unit_price: number;
    note?: string | null;
  }>;
  has_saved_card: boolean;
};
```

Assistant state:

```ts
type AssistantState = {
  isOpen: boolean;
  voiceStatus: "idle" | "listening" | "processing" | "speaking" | "error";
  lastSpokenText: string;
  conversationId: string | null;
  booking: BookingState;
  map: {
    visible: boolean;
    center: { lat: number; lng: number } | null;
    zoom: number;
    marker_restaurant_ids: string[];
    highlighted_restaurant_id: string | null;
  };
  filters: {
    cuisine?: string[];
    city?: string;
    query?: string;
  } | null;
  availabilityOpen: boolean;
  showExitX: boolean;
  customerAccepted: boolean;
};
```

## Critical Reducer Rules

When applying `response.booking`, ignore null and undefined fields.

This is mandatory. This was one of the causes of repeated questions on web.

```ts
if (response.booking) {
  const bookingPatch = Object.fromEntries(
    Object.entries(response.booking).filter(([, value]) => value != null),
  );
  next.booking = { ...next.booking, ...bookingPatch };
}
```

When applying map state, preserve current marker ids if a response omits them:

```ts
if (response.map) {
  const mapPatch = { ...response.map };
  if (!Array.isArray(mapPatch.marker_restaurant_ids)) {
    mapPatch.marker_restaurant_ids = next.map.marker_restaurant_ids;
  }
  next.map = { ...next.map, ...mapPatch };
}
```

Handle every UI action in `packages/assistant/src/schema.ts`:

```text
open_assistant
close_assistant
show_map
update_map_center
update_map_markers
highlight_restaurant
show_restaurant_cards
open_restaurant_preview
set_filters
clear_filters
start_booking
set_booking_field
load_availability
select_time_slot
confirm_booking
show_confirmation
show_post_booking_questions
show_exit_x
toast
navigate
fallback_to_manual
offer_preorder
show_menu
add_menu_item
remove_menu_item
clear_cart
set_tip_choice
set_tip
set_payment_split
navigate_to_checkout
show_payment_success
```

Important action behavior:

- `start_booking`: store selected restaurant and move to `collecting_minimum_fields`, but keep existing party/date/time if already known.
- `set_booking_field`: update only the specified field.
- `load_availability`: status `loading_availability`, open availability UI if used.
- `select_time_slot`: store `slot_iso`, `shift_id`, status `awaiting_time_selection`.
- `confirm_booking`: status `confirming`.
- `show_confirmation`: status `offering_preorder`, set confirmation code, set `customerAccepted = true`.
- `offer_preorder`: status `offering_preorder`.
- `show_menu`: status `browsing_menu`.
- `add_menu_item`: add/increment item and recompute `cart_subtotal`.
- `remove_menu_item`: remove/decrement according to UI design and recompute `cart_subtotal`.
- `navigate_to_checkout`: navigate only after the edge function gives a path/order id.
- `show_payment_success`: status `paid`, payment status `paid`.

Safety net after `APPLY_RESPONSE`:

```ts
const wasNotBooked = !previous.booking.reservation_id;
const isNowBooked = !!next.booking.reservation_id;
const alreadyPastPreorder = [
  "browsing_menu",
  "reviewing_cart",
  "choosing_tip_timing",
  "choosing_tip_amount",
  "choosing_payment_split",
  "charging",
  "paid",
  "post_booking",
].includes(next.booking.status);

if (wasNotBooked && isNowBooked && !alreadyPastPreorder && next.booking.status !== "offering_preorder") {
  next.booking.status = "offering_preorder";
  next.customerAccepted = true;
}
```

This prevents the process from stalling after a booking is created.

## Orchestrator Client

Create:

```text
lib/cenaiva/api/useCenaivaOrchestrator.ts
```

Responsibilities:

- Get `session.access_token` from Supabase.
- Return `not_authenticated` if no session.
- POST to `cenaiva-orchestrate`.
- Send `Accept: text/event-stream`.
- Support abort/cancel.
- Use a 45 second timeout like web.
- Parse SSE frames.
- Expose `send`, `cancel`, `loading`, `error`, and `lastErrorRef`.

SSE frame types:

```text
speech_chunk
discard_pending_speech
final
error
```

Streaming parser requirements:

- If `res.body.getReader()` exists, stream frame by frame.
- If React Native runtime only returns full text, parse `await res.text()` as SSE fallback.
- Frames are separated by blank lines.
- Each frame contains `data: <json>`.

Callbacks:

```ts
type SendCallbacks = {
  onSpeechChunk?: (text: string) => void;
  onDiscardPendingSpeech?: () => void;
};
```

Pseudo-flow:

```ts
const response = await fetch(url, { method: "POST", headers, body, signal });
if (!response.ok) return null;

for each SSE frame:
  if type === "speech_chunk": callbacks.onSpeechChunk?.(frame.text)
  if type === "discard_pending_speech": callbacks.onDiscardPendingSpeech?.()
  if type === "final": finalPayload = frame.payload
  if type === "error": error = frame.message

return AssistantResponse.safeParse(finalPayload).success
  ? parsed.data
  : finalPayload as AssistantResponseType;
```

Do not call OpenAI directly from mobile. Do not make any extra LLM call.

## Assistant Provider

Create:

```text
lib/cenaiva/CenaivaAssistantProvider.tsx
```

Wrap it in `app/_layout.tsx`, inside `AuthProvider` and before app screens need assistant context:

```tsx
<AuthProvider>
  <MenuProvider>
    <CenaivaAssistantProvider>
      <ThemedRootShell />
    </CenaivaAssistantProvider>
  </MenuProvider>
</AuthProvider>
```

Provider API:

```ts
type CenaivaAssistant = {
  open: (restaurantId?: string, restaurantName?: string, opts?: { autoListen?: boolean }) => void;
  close: () => void;
  sendTranscript: (
    transcript: string,
    opts?: { restaurantId?: string; silent?: boolean; force?: boolean },
  ) => Promise<void>;
  startListening: () => Promise<void>;
  setSpeechHints: (hints: string[]) => void;
  setTextMode: (active: boolean) => void;
};
```

Critical implementation detail:

Use a state ref so `sendTranscript` always sends current booking fields:

```ts
const stateRef = useRef(state);
stateRef.current = state;
```

Build every request from `stateRef.current`, not from an old closure. This was a real web bug that caused Cenaiva to ask for the same party size/date/time again.

Processing guard:

```ts
if (processingRef.current) {
  if (!opts?.force) return;
  orchestrator.cancel();
  processingRef.current = false;
}
processingRef.current = true;
```

Before sending:

- Stop microphone recording/listening.
- Set voice status `processing`.
- Include current booking state, map state, filters, visible restaurant ids, selected restaurant, user location, timezone, conversation id, saved-card state, guest id if available, and reservation id.

Request body must include:

```ts
booking_state: {
  restaurant_id,
  restaurant_name,
  party_size,
  date,
  time,
  shift_id,
  slot_iso,
  special_request,
  occasion,
  status,
  confirmation_code,
  reservation_id,
  order_id,
  tip_choice,
  tip_amount,
  tip_percent,
  payment_split,
  payment_status,
  pending_action,
  cart_subtotal,
  cart,
}
```

After response:

1. Dispatch `APPLY_RESPONSE`.
2. Run side effects for `toast`, `navigate`, and `navigate_to_checkout`.
3. Speak `response.spoken_text`.
4. If a booking was just created and the text does not mention preorder/menu, append:

```text
Would you like to pre-order from the menu?
```

5. Auto-relisten only when:

```ts
assistant is open
AND not text mode
AND booking.status is not "offering_preorder"
AND booking.status is not "browsing_menu"
```

Do not auto-open the mic while the user is browsing menu/preorder UI.

## Replace Existing Mock AI

Current mock AI files:

```text
components/ai/AiChatPanel.tsx
components/ai/AiChatFab.tsx
app/(customer)/ai-chat.tsx
hooks/useAiVoiceInput.ts
lib/mock/aiChat.ts
```

Required changes:

- Keep `AiChatFab` visual placement if desired, but make it open the real Cenaiva shell.
- Replace `AiChatPanel` mock delayed responses with an orchestrator-backed shell.
- Remove dependency on `pickRestaurantsForQuery`, `pickEventPlan`, and mock assistant replies for production.
- Keep mock data only as offline fallback UI when Supabase is not configured, not as assistant intelligence.

Suggested new structure:

```text
lib/cenaiva/
  schema.ts or package import from @cenaiva/assistant
  CenaivaAssistantProvider.tsx
  state/assistantStore.tsx
  api/useCenaivaOrchestrator.ts
  api/dataHooks.ts
  voice/useMobileTranscription.ts
  voice/useMobileTTS.ts
  voice/useCenaivaVoice.ts
components/cenaiva/
  CenaivaVoiceShell.tsx
  BookingSheet.tsx
  RestaurantRail.tsx
  AssistantMapOverlay.tsx
  VoiceOrb.tsx
```

Then update:

```text
components/ai/AiChatFab.tsx
app/(customer)/ai-chat.tsx
```

to render `CenaivaVoiceShell` instead of `AiChatPanel`.

## UI Requirements

The mobile UI does not need to be a pixel clone of web, but the workflow must match.

Required UI states:

- closed assistant
- open assistant
- listening
- processing/thinking
- speaking
- text mode
- restaurant recommendation cards
- map markers/highlighted restaurant
- booking field collection
- availability loading
- time selection, if the orchestrator asks UI to show slots
- confirmation card
- post-confirmation preorder prompt
- menu browsing
- cart/review order
- payment/preorder state if the backend returns it
- error/retry state

Use existing mobile design system:

```text
lib/theme/*
components/ui/Button.tsx
components/ui/Input.tsx
components/map/*
components/booking/*
```

Do not show instructional paragraphs inside the app explaining how Hey Cenaiva works. The UI should be usable directly.

## Confirmation Card

When `booking.status === "confirming"`, show:

- Restaurant
- Guests
- Date
- Time
- `Confirm booking`
- `Change details`

Button handlers must be:

```ts
onConfirmBooking = () =>
  assistant.sendTranscript("yes, confirm booking", { force: true });

onChangeDetails = () =>
  assistant.sendTranscript("change the booking details", { force: true });
```

Do not create a reservation directly in mobile. The confirm button must go back through `cenaiva-orchestrate` because the edge function performs the live availability check and final reservation write.

The existing mobile manual confirmation screen:

```text
app/booking/[restaurantId]/confirm.tsx
```

can stay for manual booking if needed, but the assistant confirmation card should be inside the assistant shell or a shared sheet that dispatches through `sendTranscript`.

The existing fake confirmation code screen:

```text
app/booking/[restaurantId]/step7-confirmation.tsx
```

must not be used to claim assistant booking success unless it receives the real backend `confirmation_code` and `reservation_id`.

## Restaurant Cards And Map

Reuse:

```text
components/map/RestaurantDiscoveryMap.tsx
components/map/RestaurantMapMarker.tsx
components/map/RestaurantMapDetailSheet.tsx
lib/supabase/fetchRestaurants.ts
lib/supabase/mapRestaurantRow.ts
lib/data/restaurantCatalog.ts
```

But update restaurant data mapping as needed for the shared Supabase DB. Current mobile `RestaurantRow` uses `settings_json` for lat/lng and rating. The web app uses fields like:

```text
id
name
slug
cuisine_type
city
address
lat
lng
price_range
avg_rating
hero_image_url
is_active
```

Update `packages/types/index.ts` and `lib/supabase/mapRestaurantRow.ts` so mobile accepts the actual DB fields and still falls back to `settings_json` when needed.

Assistant map behavior:

- If `response.map.visible`, show/keep the map visible.
- If `response.map.marker_restaurant_ids`, filter cards/map to those restaurants.
- If `response.map.highlighted_restaurant_id`, visually highlight that restaurant.
- If `response.ui_actions` includes `highlight_restaurant`, highlight it.
- If `response.ui_actions` includes `show_restaurant_cards`, show bottom/rail cards for those ids.

Restaurant card tap behavior:

```ts
assistant.sendTranscript(`book ${restaurant.name}`, {
  restaurantId: restaurant.id,
  force: true,
});
```

or:

```ts
assistant.open(restaurant.id, restaurant.name, { autoListen: false });
assistant.sendTranscript(`book ${restaurant.name}`, { restaurantId: restaurant.id, force: true });
```

Do not navigate straight into the old mock booking flow for assistant-selected restaurants unless you are intentionally transferring context and still using the orchestrator for final booking.

## Availability

The existing mobile file:

```text
lib/booking/getAvailability.ts
```

currently uses mocks. Do not use that for Hey Cenaiva final booking.

For assistant-driven availability, use either:

- orchestrator tool calls, which already check availability server-side, or
- a direct mobile hook calling the shared edge endpoint only for display:

```text
GET {SUPABASE_URL}/functions/v1/get-availability?restaurant_id=...&date=...&party_size=...
```

Headers:

```ts
{
  apikey: EXPO_PUBLIC_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${session.access_token}`
}
```

Important:

- A displayed slot is not a reservation.
- Final confirmation still goes through `cenaiva-orchestrate`.
- If party size or time changes, re-check availability before saying it changed.

## Preorder/Menu Flow

The existing mobile preorder screen:

```text
app/booking/[restaurantId]/step4-preorder.tsx
```

uses mock menu items. The assistant preorder flow must read live menu data from Supabase.

Add hooks:

```text
lib/cenaiva/api/dataHooks.ts
```

Minimum menu queries:

```ts
menu_items:
  id,name,description,price,category,category_id,is_available,is_preorderable
  where restaurant_id = booking.restaurant_id
  where is_active = true

menu_categories:
  id,name,sort_order
  where restaurant_id = booking.restaurant_id
  order by sort_order
```

When `booking.status === "offering_preorder"`:

- show optional preorder prompt
- yes -> status `browsing_menu`
- no -> close assistant or show post-booking completion state

When `booking.status === "browsing_menu"`:

- show live preorderable menu items
- support adding/removing cart items
- update subtotal
- do not auto-relisten voice after every menu interaction

Payment/preorder charging:

- Never charge automatically.
- If backend returns a checkout path/order id, navigate only on explicit user action.
- Separate reservation confirmation from preorder/payment confirmation.

## Voice: STT

Current mobile hook:

```text
hooks/useAiVoiceInput.ts
```

uses `expo-speech-recognition`. The production Hey Cenaiva flow should use Deepgram like web because the web workflow was tuned and tested around Deepgram command transcription.

Create:

```text
lib/cenaiva/voice/useMobileTranscription.ts
```

Deepgram token endpoint:

```text
POST {SUPABASE_URL}/functions/v1/deepgram-live-token
Authorization: Bearer <user access token>
apikey: <anon key>
```

Deepgram transcription endpoint:

```text
POST https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true
Authorization: Bearer <deepgram temporary token>
Content-Type: <recorded audio mime type>
```

Important:

- Use `language=en`, not `en-CA`.
- Add up to 12 `keyterm` params for restaurant names, visible restaurant names, and important terms.
- Start with a short fixed recording window if needed, but target web-like silence detection.
- Web target is 700ms silence after speech.
- No speech timeout around 4 seconds.
- Hard max turn timeout around 30 seconds.
- Use echo cancellation/noise suppression/auto gain if the native recording path exposes equivalents.
- Stop recording when shell closes, app backgrounds, or send starts.

Existing `expo-speech-recognition` can remain as a fallback only if:

- Deepgram is unavailable.
- It does not bypass orchestrator.
- It does not change response behavior.

## Voice: TTS

Create:

```text
lib/cenaiva/voice/useMobileTTS.ts
```

Call:

```text
POST {SUPABASE_URL}/functions/v1/elevenlabs-tts
Authorization: Bearer <user access token>
apikey: <anon key>
Content-Type: application/json
Body: { "text": "..." }
```

Expected response is audio.

Mobile playback requirements:

- Cache audio temporarily with `expo-file-system`.
- Play with `expo-audio`.
- Delete cached file after playback.
- Fallback to `expo-speech` if ElevenLabs or native playback fails.
- Stop playback when shell closes or new user speech starts.

Streaming TTS:

- On `speech_chunk`, fetch/play that chunk in queue order.
- On `discard_pending_speech`, stop playback and clear queued chunks.
- After final response:
  - If streamed text equals final `spoken_text`, drain queue.
  - If final text differs, discard queue and speak final text.

This prevents double-speaking and keeps the interaction fast.

## Text Mode

Text mode must use the same `sendTranscript` path as voice.

Do not create a separate mock chat response path.

Text input requirements:

- Send user text to `cenaiva-orchestrate`.
- Display user message.
- Display assistant `spoken_text`.
- Preserve existing booking state.
- Keep `conversation_id`.
- Do not clear `booking_state` on every message.

## Fallback Copy

Do not hardcode or display:

```text
Want me to look something else up?
```

Allowed local fallback copy:

```text
Please sign in to continue.
The assistant is taking a while. Try again.
Something went wrong. Try again.
Voice input is not available. Type your request.
```

Let `cenaiva-orchestrate` own semantic fallback text whenever possible.

## Business Logic Rules Mobile Must Preserve

These are not optional:

- Do not ask for party size again if `booking_state.party_size` is present.
- Do not ask for date again if `booking_state.date` is present.
- Do not ask for time again if `booking_state.time` or `booking_state.slot_iso` is present.
- Do not ask every possible booking question up front.
- For discovery requests, show options first unless the user clearly asks to book.
- For booking requests, collect only minimum missing fields.
- For multiple restaurant locations, ask the user to choose the location.
- For ambiguous dates/times, confirm exact date/time.
- For allergies, never guarantee safety. Add note and recommend confirming directly.
- For accessibility, do not guarantee unless restaurant data confirms it.
- For changes/cancellations, do not say done until backend confirms it.
- For payments/preorders, never charge without explicit payment confirmation.
- For no availability, offer alternate times/restaurants/waitlist when available.
- Prevent accidental duplicate bookings.

## Integration Order

Recommended sequence:

1. Copy/import `packages/assistant`.
2. Add missing dependencies and scripts.
3. Create assistant store/reducer.
4. Create orchestrator SSE client.
5. Create assistant provider and wrap `app/_layout.tsx`.
6. Replace `AiChatPanel` mock behavior with real `CenaivaVoiceShell`.
7. Implement typed text flow first.
8. Connect restaurant cards/map markers to assistant state.
9. Implement booking sheet confirmation card.
10. Implement `Confirm booking` and `Change details` buttons with `{ force: true }`.
11. Implement post-booking preorder prompt.
12. Connect live menu/preorder data.
13. Implement Deepgram STT.
14. Implement ElevenLabs/native TTS.
15. Add reducer/client tests.
16. Run backend Deno tests.
17. Run mobile typecheck/device tests.
18. Run full manual scenario matrix.

## Test Commands: Backend Source Of Truth

The backend/orchestrator tests live in `Seatly-7`, not the mobile repo.

Before claiming the mobile process is correct, run the web/backend tests against the same branch/deployment the mobile app uses.

Primary Deno test:

```bash
cd /path/to/Seatly-7
deno test supabase/functions/cenaiva-orchestrate/followup.test.ts
```

If Deno requests permissions or imports require it, use:

```bash
cd /path/to/Seatly-7
deno test --allow-env --allow-net --allow-read supabase/functions/cenaiva-orchestrate/followup.test.ts
```

Expected result:

```text
15 passed
0 failed
```

If `deno` is not installed:

```bash
brew install deno
deno --version
deno test supabase/functions/cenaiva-orchestrate/followup.test.ts
```

Alternative if the mobile agent cannot install Deno locally:

- Run the Deno test in CI.
- Or ask the web/backend agent to run it and paste the full output.
- Do not mark the integration perfect until that output shows all tests passing.

Also run:

```bash
cd /path/to/Seatly-7
npm run build
```

If build fails from unrelated web TypeScript errors, document those separately and still run the Deno orchestrator tests. Do not hide unrelated build failures.

Optional local edge-function runtime check:

```bash
cd /path/to/Seatly-7
SUPABASE_URL=https://<project-ref>.supabase.co \
deno run --env-file=.env \
  --allow-env --allow-net --allow-read \
  --node-modules-dir=auto \
  supabase/functions/cenaiva-orchestrate/index.ts
```

Then send representative authenticated requests from a QA script or Postman using the same payload shape mobile sends.

## Test Commands: Mobile Repo

Add and run:

```bash
cd /path/to/mobile-seatly-v2
npm install
npm run typecheck
npx expo config --type public
npx expo-doctor
```

Run on device/simulator:

```bash
npx expo start --clear
npx expo run:ios
npx expo run:android
```

Because `expo-speech-recognition`, `expo-audio`, maps, microphone, and native permissions are involved, Expo Go may not be enough. Use a development build for reliable iOS/Android validation.

## Tests To Add In Mobile

Add reducer tests:

- `APPLY_RESPONSE` ignores null booking fields.
- Existing `party_size` is not erased by `party_size: null`.
- Existing `date` is not erased by `date: null`.
- Existing `time` is not erased by `time: null`.
- `show_confirmation` moves status to `offering_preorder`.
- Reservation id appearing forces `offering_preorder`.
- `confirm_booking` moves status to `confirming`.
- `select_time_slot` stores `slot_iso` and `shift_id` without losing restaurant/date/party.
- `start_booking` keeps existing party/date/time.
- `add_menu_item` increments quantity and subtotal.
- `remove_menu_item` updates subtotal.
- `update_map_markers` updates marker ids.
- `highlight_restaurant` sets highlighted id.

Add orchestrator client tests:

- Sends Authorization bearer token.
- Sends anon apikey.
- Sends `Accept: text/event-stream`.
- Parses `speech_chunk`.
- Parses `discard_pending_speech`.
- Parses `final`.
- Surfaces `error`.
- Handles non-OK HTTP response.
- Handles no session as `not_authenticated`.
- Cancels previous request on `force`.
- Times out without crashing.

Add UI tests if test tooling exists:

- `Confirm booking` calls `sendTranscript("yes, confirm booking", { force: true })`.
- `Change details` calls `sendTranscript("change the booking details", { force: true })`.
- Restaurant card tap sends `book <name>` with `restaurantId` and `force: true`.
- Text submit calls `sendTranscript` and does not reset booking state.
- Menu/preorder state does not auto-open microphone.

## Manual QA Matrix

Run all of these on iOS and Android before claiming completion.

Basic booking:

1. Sign in with a real customer using the shared Supabase project.
2. Open Hey Cenaiva.
3. Type `Book me a table for two tonight at 7`.
4. Confirm it asks only for missing restaurant/search choice, not party size again.
5. Choose a restaurant.
6. Confirm it preserves party size and time.
7. Reach confirmation card.
8. Tap `Confirm booking`.
9. Confirm backend creates exactly one reservation.
10. Confirm confirmation code appears.
11. Confirm reservation appears in web account.

Halal/time regression:

1. Type `I want halal food at 8`.
2. Confirm it shows/recommends halal-compatible options or asks the minimum missing question.
3. Confirm it never says `Want me to look something else up?`.
4. Continue booking.
5. Confirm time is preserved.

Change details:

1. Reach confirmation card.
2. Tap `Change details`.
3. Type `make it 8:30`.
4. Confirm availability is rechecked.
5. Confirm card updates to 8:30.
6. Confirm booking.

No repeated fields:

1. Say `Book for 4 tomorrow at 7`.
2. If asked restaurant/cuisine, answer `Italian`.
3. Confirm Cenaiva does not ask for party size again.
4. Confirm Cenaiva does not ask for date again.
5. Confirm Cenaiva does not ask for time again unless availability requires a different slot.

Discovery:

1. Ask `What's good around me?`
2. Confirm it shows options and does not instantly book.
3. Tap a card.
4. Confirm booking flow starts with that restaurant selected.

Multiple locations:

1. Ask `Book at La Piazza`.
2. If multiple locations exist, confirm it asks which location.
3. Confirm it does not pick randomly.

Allergy:

1. Ask `I have a nut allergy. Book somewhere safe for dinner.`
2. Confirm it does not guarantee safety.
3. Confirm it offers/adds reservation note and recommends confirming with restaurant.

Accessibility:

1. Ask `Find wheelchair-accessible restaurants.`
2. Confirm it does not guarantee unless listed.
3. Confirm it offers to add an accessible-table note.

No availability:

1. Ask for a popular restaurant at a constrained time for a large party.
2. Confirm it offers alternate times/restaurants/waitlist if supported.
3. Confirm it does not say booked.

Preorder:

1. Complete a booking.
2. Confirm preorder prompt appears.
3. Tap yes.
4. Confirm live menu items load.
5. Add/remove items.
6. Confirm subtotal updates.
7. Confirm microphone does not auto-reopen while browsing.

Voice:

1. Grant mic permission.
2. Speak `Book a table for two tonight at 7`.
3. Confirm Deepgram transcript is correct enough.
4. Confirm assistant responds with TTS.
5. Interrupt with another tap/speech and confirm old audio stops.
6. Background app while recording and confirm recording stops.

Permission denial:

1. Deny microphone permission.
2. Confirm typed input works.
3. Deny location permission.
4. Confirm restaurant search still works without crashing.

Duplicate protection:

1. Tap `Confirm booking` twice quickly.
2. Confirm only one reservation is created.
3. Confirm UI does not show two confirmation codes.

Network failure:

1. Disable network during request.
2. Confirm app shows `Something went wrong. Try again.`
3. Confirm it does not reset collected booking fields.

## Definition Of Done

The mobile integration is not complete until:

- Deno orchestrator tests pass in `Seatly-7`.
- Mobile `npm run typecheck` passes.
- Expo config resolves without plugin/permission errors.
- iOS device/simulator flow passes.
- Android device/emulator flow passes.
- Manual QA matrix has no unresolved failures.
- No assistant response in mobile says `Want me to look something else up?`.
- No collected booking field is repeated unless the user changes it or availability requires a new choice.
- Confirm/change buttons work through `sendTranscript(..., { force: true })`.
- Booking confirmation code comes from backend, not local random generation.
- No secret keys are present in the mobile repo.
- Any remaining issue is listed with repro steps, expected result, actual result, suspected cause, and file path.

## Common Failure Modes To Avoid

- Building the mobile assistant on top of `lib/mock/aiChat`.
- Navigating assistant users into the old mock booking flow and generating fake confirmations.
- Calling `cenaiva-chat` instead of `cenaiva-orchestrate`.
- Dropping `booking_state` between turns.
- Merging null booking fields over known values.
- Blocking confirm/change button actions with a stale processing flag.
- Speaking both streamed TTS chunks and final text.
- Auto-opening mic during menu/preorder flow.
- Calling OpenAI directly from mobile.
- Shipping service-role or vendor API keys in the app.
- Claiming tests passed without running the Deno orchestrator test.

## Implementation Summary For The Agent

Use the existing mobile app shell, auth, map, theme, and FAB. Replace the mock AI panel with a real Hey Cenaiva provider/shell that sends every user turn to `cenaiva-orchestrate`, applies the web state machine locally, and renders mobile-native cards, map highlights, booking confirmation, and preorder UI from the returned `ui_actions`, `booking`, `map`, and `filters`.

The orchestrator is the brain. Mobile is the client, state applier, voice adapter, and native UI.

