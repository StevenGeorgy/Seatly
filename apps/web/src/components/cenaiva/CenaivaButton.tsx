import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { useCenaiva } from "./CenaivaProvider";
import { cn } from "@/lib/utils";

export function CenaivaButton() {
  const cenaiva = useCenaiva();
  if (!cenaiva) return null;

  const { toggle, status, isOpen } = cenaiva;
  if (isOpen) return null;

  return (
    <button
      onClick={toggle}
      className={cn(
        "fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105",
        "bg-gradient-to-br from-[#C8A951] to-[#A68B3E] text-black",
      )}
      aria-label="Open Cenaiva AI Assistant"
    >
      {/* Pulse ring when listening */}
      {status === "listening" && (
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-[#C8A951]"
          animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}

      {/* Spinner when thinking */}
      {status === "thinking" ? (
        <motion.div
          className="h-6 w-6 rounded-full border-2 border-black border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
        />
      ) : (
        <MessageCircle className="h-6 w-6" />
      )}
    </button>
  );
}
