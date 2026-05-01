import { X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ExitButtonProps {
  onExit: () => void;
  className?: string;
}

export function ExitButton({ onExit, className }: ExitButtonProps) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      onClick={onExit}
      className={cn(
        "absolute left-4 top-4 z-50 flex size-12 items-center justify-center",
        "rounded-full border border-gold/40 bg-gold/15 text-gold shadow-lg shadow-black/30 backdrop-blur-sm",
        "transition-colors hover:bg-gold/25",
        className,
      )}
      aria-label="Close"
    >
      <X className="size-6" />
    </motion.button>
  );
}
