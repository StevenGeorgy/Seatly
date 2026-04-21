import { Mic, MicOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { VoiceStatus } from "@cenaiva/assistant";

interface VoiceOrbProps {
  status: VoiceStatus;
  onClick: () => void;
  className?: string;
}

const STATUS_STYLES: Record<VoiceStatus, string> = {
  idle: "bg-gradient-to-br from-[#C8A951] to-[#A68B3E] shadow-[0_0_20px_rgba(200,169,81,0.3)]",
  listening: "bg-gradient-to-br from-[#C8A951] to-[#E6C060] shadow-[0_0_30px_rgba(200,169,81,0.6)]",
  processing: "bg-gradient-to-br from-[#A68B3E] to-[#C8A951] shadow-[0_0_20px_rgba(200,169,81,0.4)]",
  speaking: "bg-gradient-to-br from-[#C8A951] to-[#E8C87A] shadow-[0_0_35px_rgba(232,200,122,0.5)]",
  interrupted: "bg-gradient-to-br from-[#C8A951] to-[#A68B3E]",
  error: "bg-gradient-to-br from-red-500 to-red-700 shadow-[0_0_20px_rgba(239,68,68,0.4)]",
};

export function VoiceOrb({ status, onClick, className }: VoiceOrbProps) {
  return (
    <motion.button
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center w-16 h-16 rounded-full",
        "transition-all duration-200 cursor-pointer select-none",
        STATUS_STYLES[status],
        className,
      )}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={status === "listening" ? "Stop listening" : "Start listening"}
    >
      {/* Idle: soft heartbeat so the orb never looks dead */}
      {status === "idle" && (
        <motion.span
          className="absolute inset-0 rounded-full bg-[#C8A951]/25"
          animate={{ scale: [1, 1.08, 1], opacity: [0.2, 0.35, 0.2] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Listening: scan ring */}
      {status === "listening" && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-[#C8A951]"
          animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {/* Processing: shimmer ring to signal ongoing work */}
      {status === "processing" && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-[#E8C87A]/80"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          style={{
            borderTopColor: "transparent",
            borderRightColor: "transparent",
          }}
        />
      )}

      {/* Speaking: wave rings */}
      {status === "speaking" && (
        <>
          {[1.3, 1.6].map((s, i) => (
            <motion.span
              key={s}
              className="absolute inset-0 rounded-full border border-[#E8C87A]/40"
              animate={{ scale: [1, s], opacity: [0.4, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.28 }}
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
