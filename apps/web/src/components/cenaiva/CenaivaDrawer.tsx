import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeOff,
  Trash2,
  Radio,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCenaiva } from "./CenaivaProvider";
import { CenaivaMessageBubble } from "./CenaivaMessageBubble";
import { useTranslation } from "react-i18next";

const CUSTOMER_PROMPTS = [
  { key: "dateNight", text: "Best date night restaurants near me" },
  { key: "budget", text: "Where can I get sushi under $30?" },
  { key: "allergy", text: "I have a nut allergy, what's safe?" },
  { key: "birthday", text: "Plan a birthday dinner for 6" },
];

const OWNER_PROMPTS = [
  { key: "reservationsToday", text: "What reservations do I have today?" },
  { key: "pendingOrders", text: "Any pending orders right now?" },
  { key: "dailySummary", text: "Give me today's summary" },
  { key: "seatGuest", text: "Who's next to be seated?" },
];

export function CenaivaDrawer() {
  const { t } = useTranslation("common");
  const cenaiva = useCenaiva();

  const isOpen = cenaiva?.isOpen ?? false;
  const close = cenaiva?.close ?? (() => {});
  const status = cenaiva?.status ?? "idle";
  const messages = cenaiva?.messages ?? [];
  const loading = cenaiva?.loading ?? false;
  const error = cenaiva?.error ?? null;
  const sendMessage = cenaiva?.sendMessage ?? (async () => {});
  const clearConversation = cenaiva?.clearConversation ?? (() => {});
  const startVoiceInput = cenaiva?.startVoiceInput ?? (async () => {});
  const stopVoiceInput = cenaiva?.stopVoiceInput ?? (() => {});
  const isRecording = cenaiva?.isRecording ?? false;
  const ttsEnabled = cenaiva?.ttsEnabled ?? false;
  const setTtsEnabled = cenaiva?.setTtsEnabled ?? (() => {});
  const isRecognitionSupported = cenaiva?.isRecognitionSupported ?? false;
  const voiceMode = cenaiva?.voiceMode ?? false;
  const wakeWordEnabled = cenaiva?.wakeWordEnabled ?? false;
  const toggleWakeWord = cenaiva?.toggleWakeWord ?? (() => {});
  const isWakeWordSupported = cenaiva?.isWakeWordSupported ?? false;
  const mode = cenaiva?.mode ?? "customer";

  const suggestedPrompts = mode === "owner" ? OWNER_PROMPTS : CUSTOMER_PROMPTS;

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || loading) return;
      setInput("");
      // Typing manually exits the continuous voice loop
      if (voiceMode) stopVoiceInput();
      await sendMessage(text);
    },
    [input, loading, sendMessage, voiceMode, stopVoiceInput],
  );

  const handleSuggestion = useCallback(
    async (text: string) => {
      if (loading) return;
      await sendMessage(text);
    },
    [loading, sendMessage],
  );

  const handleMic = useCallback(async () => {
    if (isRecording) {
      // Red mic — stop recording and exit voice mode entirely
      stopVoiceInput();
    } else {
      // Gold mic (voiceMode, not yet recording) or grey (idle):
      // clicking always starts recording immediately.
      await startVoiceInput();
    }
  }, [isRecording, startVoiceInput, stopVoiceInput]);

  const statusLabel =
    status === "listening"
      ? t("cenaiva.status.listening", "Listening...")
      : status === "thinking"
        ? t("cenaiva.status.thinking", "Thinking...")
        : status === "speaking"
          ? t("cenaiva.status.speaking", "Speaking...")
          : t("cenaiva.status.idle", "Ready to help");

  const statusColor =
    status === "listening"
      ? "bg-amber-400"
      : status === "thinking"
        ? "bg-blue-400"
        : status === "speaking"
          ? "bg-purple-400"
          : "bg-emerald-400";

  if (!cenaiva) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col overflow-hidden border-l border-[#2E2E2E] bg-[#141414] p-0 sm:w-[400px]"
      >
        {/* Header */}
        <SheetHeader className="shrink-0 border-b border-[#2E2E2E] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg font-semibold text-white">
                {t("cenaiva.title", "Cenaiva")}
              </SheetTitle>
              <div className={cn("h-2 w-2 rounded-full", statusColor)} />
              <span className="text-xs text-muted-foreground">{statusLabel}</span>
            </div>
            <div className="mr-8 flex items-center gap-1">
              {/* TTS toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-white"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                title={ttsEnabled ? "Disable voice" : "Enable voice"}
              >
                {ttsEnabled ? (
                  <Volume2 className="h-4 w-4" />
                ) : (
                  <VolumeOff className="h-4 w-4" />
                )}
              </Button>

              {/* Wake word toggle */}
              {isWakeWordSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    wakeWordEnabled
                      ? "text-[#C8A951]"
                      : "text-muted-foreground hover:text-white",
                  )}
                  onClick={toggleWakeWord}
                  title={
                    wakeWordEnabled
                      ? t("cenaiva.wakeWord.disable", 'Disable "Hey Cenaiva"')
                      : t("cenaiva.wakeWord.enable", 'Enable "Hey Cenaiva"')
                  }
                >
                  <Radio className="h-4 w-4" />
                </Button>
              )}

              {/* Clear conversation */}
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-white"
                  onClick={clearConversation}
                  title="New conversation"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        {/* Messages — plain div with overflow-y-auto + min-h-0 so it scrolls
            properly inside the flex column without pushing the input off screen */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className="space-y-4 py-4">
            {messages.length === 0 ? (
              <div className="space-y-4 pt-8">
                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#C8A951] to-[#A68B3E]">
                    <span className="text-2xl font-bold text-black">C</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {mode === "owner"
                      ? t("cenaiva.subtitleOwner", "Hi! I'm Cenaiva, your staff assistant. What do you need?")
                      : t("cenaiva.subtitle", "Hi! I'm Cenaiva, your AI restaurant assistant. How can I help?")}
                  </p>
                </div>
                <div className="space-y-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt.key}
                      className="w-full rounded-xl border border-[#2E2E2E] bg-[#1E1E1E] px-4 py-3 text-left text-sm text-gray-300 transition-colors hover:border-[#C8A951]/40 hover:bg-[#252525]"
                      onClick={() => handleSuggestion(prompt.text)}
                      disabled={loading}
                    >
                      {t(`cenaiva.suggestedPrompts.${prompt.key}`, prompt.text)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <CenaivaMessageBubble key={msg.id} message={msg} />
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("cenaiva.status.thinking", "Thinking...")}
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Input — shrink-0 keeps it pinned at the bottom */}
        <div className="shrink-0 border-t border-[#2E2E2E] px-4 py-3">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            {isRecognitionSupported && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0",
                  isRecording
                    ? "text-red-400 hover:text-red-300"
                    : voiceMode
                      ? "text-[#C8A951] hover:text-[#B89A42]"
                      : "text-muted-foreground hover:text-white",
                )}
                onClick={handleMic}
                title={
                  isRecording
                    ? "Stop listening (click to exit voice mode)"
                    : voiceMode
                      ? "Click to start listening now"
                      : "Speak to Cenaiva"
                }
              >
                {isRecording ? (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    <MicOff className="h-4 w-4" />
                  </motion.div>
                ) : voiceMode ? (
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Mic className="h-4 w-4" />
                  </motion.div>
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                voiceMode
                  ? t("cenaiva.inputPlaceholder.voiceMode", "Listening... type to switch to text")
                  : t("cenaiva.inputPlaceholder", "Ask me anything about restaurants...")
              }
              className="flex-1 border-[#2E2E2E] bg-[#1E1E1E] text-sm text-white placeholder:text-gray-500"
              disabled={loading || isRecording}
            />
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 shrink-0 bg-[#C8A951] text-black hover:bg-[#B89A42]"
              disabled={!input.trim() || loading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
