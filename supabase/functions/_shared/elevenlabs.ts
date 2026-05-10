// @ts-nocheck
// Shared ElevenLabs configuration. Both `elevenlabs-tts` and
// `cenaiva-small-prompt` previously kept independently-edited copies of
// these values; centralizing here prevents drift.

export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

// "Sarah" — ElevenLabs public default voice. Override per-request via the
// caller's voice_id parameter when the user has selected a custom voice.
export const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export const ELEVENLABS_MODEL = "eleven_flash_v2_5";

export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.8,
  speed: 1.1,
};

export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
