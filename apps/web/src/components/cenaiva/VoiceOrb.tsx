import { useSyncExternalStore } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { VoiceStatus } from "@cenaiva/assistant";

interface VoiceOrbProps {
  status: VoiceStatus;
  onClick: () => void;
  className?: string;
  /** External store of live mic loudness [0, 1]; used to pulse the orb. */
  subscribeAudioLevel?: (cb: () => void) => () => void;
  getAudioLevel?: () => number;
}

const NOOP_SUBSCRIBE = () => () => {};
const ZERO_LEVEL = () => 0;

const STATUS_STYLES: Record<VoiceStatus, string> = {
  idle: "bg-gradient-to-br from-[#C8A951] to-[#A68B3E] shadow-[0_0_20px_rgba(200,169,81,0.3)]",
  listening: "bg-gradient-to-br from-[#C8A951] to-[#E6C060] shadow-[0_0_30px_rgba(200,169,81,0.6)]",
  processing: "bg-gradient-to-br from-[#A68B3E] to-[#C8A951] shadow-[0_0_20px_rgba(200,169,81,0.4)]",
  speaking: "bg-gradient-to-br from-[#C8A951] to-[#E8C87A] shadow-[0_0_35px_rgba(232,200,122,0.5)]",
  interrupted: "bg-gradient-to-br from-[#C8A951] to-[#A68B3E]",
  error: "bg-gradient-to-br from-red-500 to-red-700 shadow-[0_0_20px_rgba(239,68,68,0.4)]",
};

export function VoiceOrb({ status, onClick, className, subscribeAudioLevel, getAudioLevel }: VoiceOrbProps) {
  // Subscribe to mic-loudness from useDeepgramTranscription via external
  // store — never useState. RMS updates ~60 Hz; routing through React state
  // here would re-render the orb (and any parent reading the level prop)
  // on every audio frame, tanking framerate. useSyncExternalStore is the
  // intended primitive for "rapid external mutable state".
  const audioLevel = useSyncExternalStore(
    subscribeAudioLevel ?? NOOP_SUBSCRIBE,
    getAudioLevel ?? ZERO_LEVEL,
    ZERO_LEVEL,
  );
  const isPulsing = status === "listening";
  const pulseScale = isPulsing ? 1 + audioLevel * 0.18 : 1;
  const pulseOpacity = isPulsing ? 0.35 + audioLevel * 0.55 : 0.5;
  return (
    <motion.button
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center w-16 h-16 rounded-full",
        "transition-all duration-300 cursor-pointer select-none",
        STATUS_STYLES[status],
        className,
      )}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={status === "listening" ? "Stop listening" : "Start listening"}
    >
      {/* RMS-driven pulse ring when listening — gives the user visual proof
          the mic is still hot, replacing any countdown/timer affordance. */}
      {isPulsing && (
        <span
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#C8A951]"
          style={{
            transform: `scale(${pulseScale})`,
            opacity: pulseOpacity,
            transition: "transform 80ms linear, opacity 80ms linear",
          }}
        />
      )}

      {/* Speaking wave rings */}
      {status === "speaking" && (
        <>
          {[1.3, 1.6].map((s, i) => (
            <motion.span
              key={s}
              className="absolute inset-0 rounded-full border border-[#E8C87A]/40"
              animate={{ scale: [1, s], opacity: [0.4, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
            />
          ))}
        </>
      )}

      {status === "processing" ? (
        <Loader2 className="w-6 h-6 text-black animate-spin" />
      ) : status === "listening" ? (
        <MicOff className="w-6 h-6 text-black" />
      ) : (
        <Mic className="w-6 h-6 text-black" />
      )}
    </motion.button>
  );
}
