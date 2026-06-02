# MOBILE_TRANSCRIPTION_REPORT.md

**Direction:** mobile → web (the **reverse** of the parity spec). The **mobile** app handles transcription (STT) and voice (TTS) well; the **web** app has been flaky. This documents how mobile does it and what web does differently, so you can **fix the web app**.

> Do **not** change mobile — it works. Everything below is intel + suggested **web** fixes.

**Analyzed:** mobile `mobile-seatly-v2` · web `Seatly-16/apps/web/src` · backend `Seatly-16/supabase`.

---

## 0. TL;DR — the single most likely cause of web flakiness

The web `elevenlabs-tts` edge function streams **the wrong model with an unspecified output format**, and is **inconsistent with both its sibling function and its own cache key**:

- `supabase/functions/elevenlabs-tts/index.ts:90` hardcodes `model_id: "eleven_turbo_v2_5"` and sends **no** `output_format` (`:81`) → ElevenLabs returns its **default** format, not guaranteed `mp3_44100_128`.
- The web sibling `cenaiva-small-prompt/index.ts:190,200` uses the shared `eleven_flash_v2_5` + `output_format=mp3_44100_128` (`_shared/elevenlabs.ts:12,20`).
- The web TTS **cache key** is `flash25-mp3-44100-128-v1` (`useElevenLabsTTS.ts:22`).

So on web: the IndexedDB cache is labeled "flash @ 44.1kHz/128k", the small-prompt path actually produces that, but the **main TTS path produces turbo @ a variable default format**. Feeding a different/variable codec into a **single reused `<audio>` element** (`useElevenLabsTTS.ts:239`) is exactly what causes intermittent stalls, mis-decodes, and the voice changing turn-to-turn.

**Mobile never has this** — `mobile .../elevenlabs-tts/index.ts:132,141` uses the shared `eleven_flash_v2_5` + `output_format=mp3_44100_128` on **every** call, fully consistent with its cache key.

**Fix #1 (highest value, lowest risk, backend-only):** make web `elevenlabs-tts` import from `_shared/elevenlabs.ts` exactly like `cenaiva-small-prompt` already does — `ELEVENLABS_MODEL`, `DEFAULT_VOICE_SETTINGS`, and `?output_format=${DEFAULT_OUTPUT_FORMAT}` on the stream URL.

---

## 1. MOBILE — STT (the reference that works)

**Files:** `lib/cenaiva/voice/useMobileTranscription.ts`, `useCenaivaVoice.ts`; token fn `mobile-seatly-v2/supabase/functions/deepgram-live-token/index.ts`.

**Architecture — native-first, Deepgram-REST fallback (two backends):**
1. **On-device native STT** (`ExpoSpeechRecognition`, `:73-91`) — tried **first** (`startListening`, `:493`) when `EXPO_PUBLIC_CENAIVA_NATIVE_STT_FIRST !== 'false'` (`:104`). Interim results on-device, finalize on stable-interim timer `NATIVE_INTERIM_STABLE_MS=1300` (`:40`), per-turn timeout `18s` (`:36`).
2. **Deepgram REST** (`https://api.deepgram.com/v1/listen`, `:15`) as fallback — pre-recorded endpoint (record-then-POST blob, **not** a WebSocket).

**Audio capture (Deepgram path):** `expo-audio` `useAudioRecorder`, `HIGH_QUALITY` + metering (`:48-51`); 80ms metering poll, speech = `metering > -30 dB` (`:613-642`); end-of-turn timers `SILENCE_TIMEOUT_MS=1400`, `NO_SPEECH_TIMEOUT_MS=6000`, hard cap `30s`, `MIN_RECORDING_MS=800`. Blob POSTed with `Content-Type: blob.type||'audio/mp4'` (`:249-272`).

**Deepgram config:** `model=nova-3`, `language=en`, `smart_format=true`, `punctuate=true`, ≤12 keyterms, no `alternatives` (`buildDeepgramUrl :112-123`).

**Token + auth (the robust part):** `fetchDeepgramToken` (`:192-247`) calls `supabase.auth.getSession()` for the freshest token, and if `expires_at - now < 60s` it **force-calls `refreshSession()`** before hitting the edge fn (`:209-220`). Why: the mobile client runs `autoRefreshToken:false` and pauses refresh while backgrounded, so the React `session` can hold an expired JWT. **Mobile proactively refreshes.** Backend mints a Deepgram grant token, TTL ≈ 30s (`deepgram-live-token/index.ts:75`).

**Retry/error:** native↔Deepgram cross-fallback (native `audio-capture` → retry once 250ms → fall to Deepgram, `:499-503`); `shouldFallbackToNative` blocks fallback for `not-allowed`/`voice-stt-unavailable`/etc (`:142-152`). Clean teardown on `AppState` non-active (`:668-676`).

---

## 2. MOBILE — TTS (the reference that works)

**Files:** `lib/cenaiva/voice/useMobileTTS.ts`; edge fn `mobile .../elevenlabs-tts/index.ts`; shared `mobile .../_shared/elevenlabs.ts`.

**Provider + request config (CONSISTENT — the key):**
- URL `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128` (`:132`).
- `model_id = eleven_flash_v2_5` (`:141`), `voice_settings = {stability:0.5, similarity_boost:0.8, speed:1.1}` (`:142`).
- One auto-retry on 5xx (`:146-154`); accepts both **GET `?text=`** (`:97-101`) and POST.
- → model + codec + sample-rate + bitrate exactly match the cache key `flash25-mp3-44100-128-v1` and the small-prompt path. **No drift.**

**Three-tier playback w/ cache (`useMobileTTS.ts`):** `speak()` (`:476-505`) tries (1) persistent **file cache** for ~9 common phrases (`:43-53`, key `${VERSION}-${hash}.mp3`, `:187-209`); (2) **streaming GET URL** playable (`:235-254`, plays as it downloads); (3) POST→file→play (`:256-296`); (4) OS `expo-speech` fallback (`:334-354`) only if all fail.

**Playback robustness:** fresh `expo-audio` player per clip + `playbackStatusUpdate` listener **AND** 40ms `currentStatus` poll (`:432-448`), **4s first-audio watchdog + 30s hard timeout** (`:455-456`) → returns `played|failed|stopped`. Gap-free sentence queue with per-entry fallback ladder + generation counter (`runQueue :523-572`). `primeTTS` pre-warms the cache on first gesture (`:607-625`).

---

## 3. WEB — current STT/TTS

**STT — `apps/web/src/hooks/useDeepgramTranscription.ts`:** Deepgram REST **only** (native/Web-Speech STT deliberately disabled, `useCenaivaVoice.ts:106-121`). `getUserMedia` (noise-robust, mono) → AudioContext RMS → `MediaRecorder` 250ms chunks; MIME `webm;opus → webm → mp4` (`:72-76`); end-of-turn `SILENCE=1500`, `NO_SPEECH=15000`, `TURN=60000`, RMS `0.015`. **Warm-stream reuse 12s** (`:359-368`). 50ms drain + `MIN_AUDIO_BYTES=2048` guard (corrupt-webm). **Token cache + single-flight + retry `[0,200,600]ms` on 401/403/5xx** invalidating cache between tries (`:137-273`) — this part is good, arguably better than mobile. Deepgram query identical to mobile (`nova-3`/en/smart_format/punctuate). Token fn equivalent (30s grant, rate-limit 120/min).

**TTS — `useElevenLabsTTS.ts` + `useCenaivaVoice.ts` + `useCenaivaSpeech.ts`:** ElevenLabs via `elevenlabs-tts` (POST only, no GET) → MP3 blob → `URL.createObjectURL` → **single reused `HTMLAudioElement`** (`:239,259-266`). IndexedDB cache key `flash25-mp3-44100-128-v1-…` (`:22,58-62`). Streaming queue mirrors mobile. Fallback ladder in `useCenaivaVoice.ts:161-260`: ElevenLabs → retry once → after 2 failures set `elevenAvailable=false` for `ELEVEN_COOLDOWN_MS=5000` and route to **Web Speech synthesis** (a **different OS voice**).

---

## 4. DIFFERENCES that explain web flakiness

| Area | Mobile (works) | Web (flaky) | Risk |
|---|---|---|---|
| **TTS model/format consistency** | both fns use shared `eleven_flash_v2_5` + `mp3_44100_128`; matches cache key | `elevenlabs-tts:90` hardcodes `eleven_turbo_v2_5`, **no** `output_format`; small-prompt uses flash; cache key says flash → **3-way mismatch** | **HIGH** — variable codec into reused `<audio>` → stalls, decode fails, voice changes |
| **Token freshness** | proactive `refreshSession()` when <60s to expiry (`:209-220`) | proactive refresh **removed** (to avoid an AuthProvider unmount flicker) — relies on supabase-js auto-refresh | **MED** — near-expiry JWT → 401; STT retries 3× (ok) but can fail closed; TTS drops to Web Speech |
| **TTS fallback voice** | OS speech, rarely hit | Web Speech (clearly different voice), hit on any 2 ElevenLabs blips; the turbo/format mismatch makes blips frequent → "voice randomly changes" | **HIGH (amplifier)** — Fix #1 should sharply cut this |
| **Reused `<audio>` element** | fresh player per clip + 40ms poll + 4s start-watchdog (`:369-474`) | single reused `HTMLAudioElement`, `onended`/`onerror` only, **no poll, no start-watchdog** | **MED** — a silently-stalled clip pins `isSpeaking=true` and wedges the queue |
| **STT backend count** | native + Deepgram | Deepgram only (fails closed) | **MED** — any Deepgram blip = "transcription unavailable" (partly covered by 3× backoff) |
| **GET streaming TTS** | edge fn has GET; streams via expo-audio | no GET branch; POST blob then play | LOW |
| **Recorder codec** | `audio/mp4` native | `webm;opus`/mp4 + corrupt-webm 400 handling + 2KB guard | LOW–MED (mitigated) |

---

## 5. Suggested WEB fixes (do NOT touch mobile)

**Fix 1 — TTS model/format consistency (do first).** In `supabase/functions/elevenlabs-tts/index.ts`, replace the hardcoded `model_id:"eleven_turbo_v2_5"` (`:90`) and the format-less URL (`:81`) with the shared config — exactly as web `cenaiva-small-prompt/index.ts:190,200` already does: import `ELEVENLABS_BASE, ELEVENLABS_MODEL, DEFAULT_VOICE_SETTINGS, DEFAULT_OUTPUT_FORMAT` from `../_shared/elevenlabs.ts`; URL → `…/stream?output_format=${DEFAULT_OUTPUT_FORMAT}`; body → `model_id: ELEVENLABS_MODEL, voice_settings: DEFAULT_VOICE_SETTINGS`. (If turbo was an intentional latency choice, instead encode `turbo` into the cache-version string AND still pin `output_format` — but matching flash is simpler and is what the cache key already promises.)

**Fix 2 — playback start-watchdog in `useElevenLabsTTS.ts`.** In `speak()` (`:394-440`) and `playBlobOnce()` (`:288-308`), add a ~3–4s watchdog after `audio.play()`: if neither `onended` nor `currentTime>0` progress occurs, resolve failed/stopped (mirror mobile `useMobileTTS.ts:455-456` + status poll). Prevents a stalled clip from pinning `isSpeaking=true` and wedging `drainQueue()`.

**Fix 3 — scoped refresh-on-401 for the voice token (not global).** In `useDeepgramTranscription.ts` `fetchDeepgramTokenFresh` (`:146-179`) and `useElevenLabsTTS.ts` `fetchTTSBlob` (`:158-222`): on a 401, do ONE targeted `auth.getSession()` re-read (then `refreshSession()` only if needed) **inside the hook**, retry once — without wiring through the global `onAuthStateChange` path that caused the prior unmount flicker. Recovers mobile's stale-token resilience without the regression. Verify it doesn't flip AuthProvider `loading`.

**Fix 4 (optional) — reduce false "ElevenLabs failed" rate.** After Fix 1, re-tune the 2-strike → 5s Web-Speech cooldown (`useCenaivaVoice.ts:225-235`), and log the actual HTTP status that triggered fallback (currently DEV-only) so prod flakiness is diagnosable.

---

## 6. Data flow + tokens + rate limits

**STT:** mic → (mobile: native OR record→blob; web: MediaRecorder webm/opus chunks) → on silence/timeout POST to Deepgram `/v1/listen` (`nova-3`/en/smart_format/punctuate/keyterms) with a **30s grant token** from `deepgram-live-token` → transcript to `AssistantProvider.sendTranscript`.

**TTS:** text → local cache (web IDB / mobile FS, key `flash25-mp3-44100-128-v1-<hash>`) → miss → `elevenlabs-tts` → ElevenLabs `/text-to-speech/<voice>/stream` → MP3 → play (web `<audio>` blob URL / mobile `expo-audio`) → on failure OS/Web Speech.

**Tokens:** Deepgram grant TTL = **30s** (web caches w/ 5s buffer). Supabase JWT = ~1h (mobile force-refreshes near expiry; web does not).

**Rate limits (web backend):** `deepgram-live-token` 120/min/user; `elevenlabs-tts` 240/min/user. Mobile backend additionally layers per-day + paid-usage budget gates (not a flakiness cause; relevant only if web ever needs cost ceilings).

---

## File:line index
- **Mobile STT:** `mobile-seatly-v2/lib/cenaiva/voice/useMobileTranscription.ts` (native 73-91; token+refresh 192-247; transcribe 249-272; timers 605-642; teardown 668-676). Token fn `mobile .../deepgram-live-token/index.ts:75-89`.
- **Mobile TTS:** `mobile-seatly-v2/lib/cenaiva/voice/useMobileTTS.ts` (cache 41,187-209; stream 235-254; playSource 369-474; speak 476-505; queue 523-572; prime 607-625). Edge `mobile .../elevenlabs-tts/index.ts:97-101,132,141-142`; shared `_shared/elevenlabs.ts:12,20`.
- **Web STT:** `apps/web/src/hooks/useDeepgramTranscription.ts` (query 34-46; token 137-190; retry 200-273; capture 423-620). Token fn `supabase/functions/deepgram-live-token/index.ts:52-88`.
- **Web TTS:** `apps/web/src/hooks/useElevenLabsTTS.ts` (cache 22,58-62; fetch+token 127-222; reused `<audio>` 239,259-266; speak 394-440; queue 310-392; prime 448-513). Orchestration `useCenaivaVoice.ts:41-43,161-260`; Web Speech `useCenaivaSpeech.ts`. **Mismatch site:** `supabase/functions/elevenlabs-tts/index.ts:81,90`. Correct sibling: `cenaiva-small-prompt/index.ts:190,200`. Shared (unused by web TTS): `_shared/elevenlabs.ts:12,20`.

---

*Generated from a read-only audit. No code was changed. Companion file: `MOBILE_PARITY_SPEC.md`.*
