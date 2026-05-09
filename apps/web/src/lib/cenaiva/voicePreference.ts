export type CenaivaTtsVoice = "female" | "male";

const FEMALE_DEFAULT = "8vf2Pg7VZD0Piv8GA8v9";
const MALE_DEFAULT = "f5HLTX707KIM4SzJYzSz";

export function normalizeCenaivaTtsVoice(
  value: string | null | undefined,
): CenaivaTtsVoice | null {
  if (value === "female" || value === "male") return value;
  return null;
}

export function getCenaivaTtsVoiceId(voice: CenaivaTtsVoice | null): string | null {
  if (voice === "female") {
    return import.meta.env.VITE_CENAIVA_TTS_VOICE_FEMALE_ID ?? FEMALE_DEFAULT;
  }
  if (voice === "male") {
    return import.meta.env.VITE_CENAIVA_TTS_VOICE_MALE_ID ?? MALE_DEFAULT;
  }
  return null;
}

export function storageKeyForUser(authUserId: string): string {
  return `@cenaiva/tts-voice/${authUserId}`;
}
