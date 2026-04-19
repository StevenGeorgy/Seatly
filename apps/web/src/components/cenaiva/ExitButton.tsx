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
        "absolute top-4 left-4 z-50 flex items-center justify-center",
        "w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm border border-white/10",
        "text-white hover:bg-black/80 transition-colors",
        className,
      )}
      aria-label="Close"
    >
      <X className="w-4 h-4" />
    </motion.button>
  );
}
