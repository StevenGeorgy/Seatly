import {
  LandingNavbar,
  LandingFooter,
} from "@/components/landing";
import { FeaturesPageHero } from "@/components/landing/features/FeaturesPageHero";
import { FeaturesPageSection } from "@/components/landing/features/FeaturesPageSection";
import { FeaturesFloorPlanMockup } from "@/components/landing/features/FeaturesFloorPlanMockup";
import { FeaturesCrmMockup } from "@/components/landing/features/FeaturesCrmMockup";
import { FeaturesAiBriefingMockup } from "@/components/landing/features/FeaturesAiBriefingMockup";
import { FeaturesPreOrdersMockup } from "@/components/landing/features/FeaturesPreOrdersMockup";
import { FeaturesWaitlistMockup } from "@/components/landing/features/FeaturesWaitlistMockup";
import { FeaturesAnalyticsMockup } from "@/components/landing/features/FeaturesAnalyticsMockup";
import { FeaturesVoiceAiMockup } from "@/components/landing/features/FeaturesVoiceAiMockup";
import { FeaturesStaffMockup } from "@/components/landing/features/FeaturesStaffMockup";

const FEATURES = [
  {
    title: "Live Floor Plan",
    description:
      "See every table at a glance. Real-time status updates, colour-coded by state—empty, seated, arriving, overdue, or reserved. Tap any table to see the guest card, take payment, or manage orders.",
    mockup: FeaturesFloorPlanMockup,
    id: "floor-plan",
  },
  {
    title: "Guest CRM",
    description:
      "Every guest gets a permanent profile. Full dining history, preferences, spend patterns, and notes. AI surfaces insights so your team knows exactly who is walking in the door.",
    mockup: FeaturesCrmMockup,
    id: "crm",
  },
  {
    title: "AI Shift Briefing",
    description:
      "Before every service, AI generates a nightly briefing. VIPs arriving, allergy alerts, no-show risks, and table recommendations. Your team hits the floor prepared.",
    mockup: FeaturesAiBriefingMockup,
    id: "ai-briefing",
  },
  {
    title: "Pre-Orders",
    description:
      "Guests order before they arrive. Kitchen is ready when they sit down. Reduce wait times, increase average spend, and impress every guest.",
    mockup: FeaturesPreOrdersMockup,
    id: "pre-orders",
  },
  {
    title: "Smart Waitlist",
    description:
      "Walk-ins join remotely. Get notified by SMS when a table is ready. No more crowded lobbies or lost customers.",
    mockup: FeaturesWaitlistMockup,
    id: "waitlist",
  },
  {
    title: "Analytics",
    description:
      "Revenue, covers, no-show rate, top dishes. Know your business inside and out. Track trends and make data-driven decisions.",
    mockup: FeaturesAnalyticsMockup,
    id: "analytics",
  },
  {
    title: "Voice AI Receptionist",
    description:
      "VAPI answers calls 24/7. Takes bookings, answers questions, and never misses a reservation. Your phone is always covered.",
    mockup: FeaturesVoiceAiMockup,
    id: "voice-ai",
  },
  {
    title: "Staff Management",
    description:
      "Scheduling, clock in/out, and performance tracking. Know who worked when, who sold what, and how your team is performing.",
    mockup: FeaturesStaffMockup,
    id: "staff",
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background-dark">
      <LandingNavbar />
      <main>
        <FeaturesPageHero />
        {FEATURES.map((feature, index) => (
          <FeaturesPageSection
            key={feature.id}
            title={feature.title}
            description={feature.description}
            mockup={feature.mockup}
            imageRight={index % 2 === 1}
          />
        ))}
      </main>
      <LandingFooter />
    </div>
  );
}
