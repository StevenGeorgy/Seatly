import { createContext } from "react";

import type { CenaivaTtsVoice } from "@/lib/cenaiva/voicePreference";

export type CenaivaVoicePreferenceContextValue = {
  voicePreference: CenaivaTtsVoice | null;
  voiceId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  needsSelection: boolean;
  refresh: () => Promise<void>;
  setVoicePreference: (voice: CenaivaTtsVoice) => Promise<boolean>;
};

export const CenaivaVoicePreferenceContext =
  createContext<CenaivaVoicePreferenceContextValue | null>(null);
