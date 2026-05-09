import { useContext } from "react";

import {
  CenaivaVoicePreferenceContext,
  type CenaivaVoicePreferenceContextValue,
} from "@/contexts/cenaiva-voice-preference-context";

export function useCenaivaVoicePreference(): CenaivaVoicePreferenceContextValue {
  const ctx = useContext(CenaivaVoicePreferenceContext);
  if (!ctx) {
    throw new Error(
      "useCenaivaVoicePreference must be used inside CenaivaVoicePreferenceProvider",
    );
  }
  return ctx;
}
