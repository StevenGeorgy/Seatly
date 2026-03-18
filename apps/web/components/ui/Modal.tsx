"use client";

import type { ReactNode } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gold-glass bg-gold-glass p-xl shadow-gold-glow backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 className="mb-lg text-lg font-semibold tracking-tight-section text-text-on-dark">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
