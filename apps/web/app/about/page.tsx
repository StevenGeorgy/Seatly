import {
  LandingNavbar,
  LandingFooter,
} from "@/components/landing";
import { AboutHero } from "@/components/landing/AboutHero";
import { AboutProblem } from "@/components/landing/AboutProblem";
import { AboutSolution } from "@/components/landing/AboutSolution";
import { AboutTeam } from "@/components/landing/AboutTeam";
import { AboutValues } from "@/components/landing/AboutValues";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background-dark">
      <LandingNavbar />
      <main>
        <AboutHero />
        <AboutProblem />
        <AboutSolution />
        <AboutTeam />
        <AboutValues />
      </main>
      <LandingFooter />
    </div>
  );
}
