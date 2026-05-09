import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  CenaivaVoicePreferenceContext,
  type CenaivaVoicePreferenceContextValue,
} from "@/contexts/cenaiva-voice-preference-context";
import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getCenaivaTtsVoiceId,
  normalizeCenaivaTtsVoice,
  storageKeyForUser,
  type CenaivaTtsVoice,
} from "@/lib/cenaiva/voicePreference";

const Storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // quota or SSR — ignore
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // noop
    }
  },
};

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
    const authUserId = user?.id ?? "";

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
        .from("user_profiles")
        .select("cenaiva_tts_voice")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (error) {
        if (!cached) setVoicePreferenceState(null);
        return;
      }

      const remote = normalizeCenaivaTtsVoice(
        (data as { cenaiva_tts_voice?: string | null } | null)?.cenaiva_tts_voice,
      );
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

  useEffect(() => {
    // Loading the initial preference on mount + user-id change. The setState
    // happens asynchronously after IO; this effect is the canonical place
    // to do that, so we silence the strict "no setState in effect" rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const setVoicePreference = useCallback(
    async (voice: CenaivaTtsVoice) => {
      const supabase = getSupabaseBrowserClient();
      const authUserId = user?.id ?? "";
      const storageKey = authUserId ? storageKeyForUser(authUserId) : "";

      if (!isAuthenticated || !authUserId) return false;

      setVoicePreferenceState(voice);
      setResolvedUserId(authUserId);
      setIsSaving(true);
      try {
        await Storage.setItem(storageKey, voice);

        if (!supabase) return true;

        const { error } = await supabase
          .from("user_profiles")
          .update({ cenaiva_tts_voice: voice })
          .eq("auth_user_id", authUserId);

        return !error;
      } catch {
        return true;
      } finally {
        setIsSaving(false);
      }
    },
    [isAuthenticated, user?.id],
  );

  const effectiveLoading = isLoading || (isAuthenticated && resolvedUserId !== currentUserId);

  const value = useMemo<CenaivaVoicePreferenceContextValue>(
    () => ({
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
    }),
    [
      currentUserId,
      effectiveLoading,
      isAuthenticated,
      isSaving,
      refresh,
      resolvedUserId,
      setVoicePreference,
      voicePreference,
    ],
  );

  return (
    <CenaivaVoicePreferenceContext.Provider value={value}>
      {children}
    </CenaivaVoicePreferenceContext.Provider>
  );
}
