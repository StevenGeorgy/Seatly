interface LandingSectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

export function LandingSectionLabel({ children, className = "" }: LandingSectionLabelProps) {
  return (
    <span
      className={`mb-md inline-block text-xs font-medium uppercase tracking-label text-gold ${className}`}
    >
      {children}
    </span>
  );
}
