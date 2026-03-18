import {
  LandingNavbar,
  LandingHero,
  LandingSocialProof,
  LandingDashboardPreview,
  LandingFeatures,
  LandingAi,
  LandingHowItWorks,
  LandingPricing,
  LandingCta,
  LandingFooter,
} from "@/components/landing";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background-dark">
      <LandingNavbar />
      <main>
        <LandingHero />
        <LandingSocialProof />
        <LandingDashboardPreview />
        <LandingFeatures />
        <LandingAi />
        <LandingHowItWorks />
        <LandingPricing />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
