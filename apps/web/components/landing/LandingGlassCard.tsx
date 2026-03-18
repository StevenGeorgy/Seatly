interface LandingGlassCardProps {
  children: React.ReactNode;
  className?: string;
}

export function LandingGlassCard({ children, className = "" }: LandingGlassCardProps) {
  return (
    <div
      className={`glass-card rounded-lg border border-border-card border-l-4 border-l-gold p-xl shadow-inset-card ${className}`}
    >
      {children}
    </div>
  );
}
