import { useCallback, useRef, useState } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useElevenLabsTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Reuse ONE HTMLAudioElement across every speak() call. Creating a fresh
  // `new Audio(url)` each turn was the biggest source of TTS flakiness:
  // Chrome's autoplay policy attaches the "unmuted" grant to a specific
  // element, and a new one sometimes starts muted or stalls on first play
  // → fallback to Web Speech → user hears a different voice randomly.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      // Intentionally don't null out the element — we reuse it.
      try { audioRef.current.currentTime = 0; } catch { /* noop */ }
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string, voiceId?: string): Promise<boolean> => {
      stop();

      const token = await getBearerToken();
      if (!token) return false;

      try {
        const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/elevenlabs-tts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: getSupabaseAnonKey(),
          },
          body: JSON.stringify({ text, voice_id: voiceId }),
        });

        if (!res.ok) return false;

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        const audio = getAudio();
        audio.src = url;

        setIsSpeaking(true);

        let played = false;
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            audio.onended = null;
            audio.onerror = null;
            if (blobUrlRef.current === url) {
              URL.revokeObjectURL(url);
              blobUrlRef.current = null;
            }
          };
          audio.onended = () => {
            played = true;
            setIsSpeaking(false);
            cleanup();
            resolve();
          };
          audio.onerror = () => {
            setIsSpeaking(false);
            cleanup();
            resolve();
          };
          audio.play().catch(() => {
            setIsSpeaking(false);
            cleanup();
            resolve();
          });
        });
        return played;
      } catch {
        setIsSpeaking(false);
        return false;
      }
    },
    [stop, getAudio],
  );

  return { speak, stop, isSpeaking };
}
