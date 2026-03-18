import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t border-border-dark/50 bg-background-dark py-2xl">
      <div className="mx-auto max-w-6xl px-xl">
        <div className="flex flex-col items-center justify-between gap-lg sm:flex-row">
          <Link href="/" className="text-lg font-bold tracking-tight text-text-on-dark">
            Seatly
          </Link>
          <nav className="flex flex-wrap items-center justify-center gap-lg text-sm text-text-muted-on-dark">
            <Link href="/#features" className="hover:text-gold">
              Product
            </Link>
            <Link href="/#pricing" className="hover:text-gold">
              Pricing
            </Link>
            <Link href="/about" className="hover:text-gold">
              About
            </Link>
            <Link href="/login" className="hover:text-gold">
              Login
            </Link>
            <Link href="/signup" className="hover:text-gold">
              Sign Up
            </Link>
          </nav>
        </div>
        <p className="mt-xl text-center text-xs text-text-muted-on-dark">
          © 2026 Seatly. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
