import { useCallback, useRef, useState } from "react";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  metadata?: Record<string, any>;
  created_at: string;
};

export type ActionTaken = {
  type: string;
  data: Record<string, any>;
};

export function useCenaivaChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      text: string,
      opts?: {
        restaurantId?: string;
        language?: string;
        mode?: "customer" | "owner";
        userLocation?: { lat: number; lng: number };
      },
    ): Promise<{ reply: string; actions: ActionTaken[] } | null> => {
      if (!text.trim() || !isSupabaseConfigured()) return null;

      // Optimistic: add user message immediately
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text.trim(),
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setError(null);

      try {
        const client = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.access_token) {
          setError("Please sign in to use Cenaiva.");
          setLoading(false);
          return null;
        }

        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/cenaiva-chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              apikey: getSupabaseAnonKey(),
            },
            body: JSON.stringify({
              message: text.trim(),
              conversation_id: conversationId,
              restaurant_id: opts?.restaurantId,
              language: opts?.language || "en",
              mode: opts?.mode || "customer",
              user_lat: opts?.userLocation?.lat,
              user_lng: opts?.userLocation?.lng,
            }),
            signal: controller.signal,
          },
        );

        const data = await res.json();
        if (!res.ok) {
          const friendly = toUserFacingEdgeError(res, data);
          console.error("[useCenaivaChat.send]", friendly.code, friendly.technical ?? data);
          setError(friendly.message);
          setLoading(false);
          return null;
        }

        // Update conversation ID
        if (data.conversation_id && !conversationId) {
          setConversationId(data.conversation_id);
        }

        // Add assistant reply
        const assistantMsg: ChatMessage = {
          id: `resp-${Date.now()}`,
          role: "assistant",
          content: data.reply || "",
          metadata: data.actions_taken?.length
            ? { actions: data.actions_taken }
            : undefined,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setLoading(false);

        return {
          reply: data.reply,
          actions: data.actions_taken || [],
        };
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name !== "AbortError") {
          const friendly = toUserFacingError(err, "Connection failed.");
          console.error("[useCenaivaChat.send.catch]", friendly.code, friendly.technical ?? err);
          setError(friendly.message);
        }
        setLoading(false);
        return null;
      }
    },
    [conversationId],
  );

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return {
    messages,
    loading,
    error,
    conversationId,
    sendMessage,
    clearConversation,
    cancel,
  };
}
