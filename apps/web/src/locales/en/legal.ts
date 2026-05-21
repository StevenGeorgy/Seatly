// English strings for the consumer-facing legal pages (Terms, Privacy,
// Refund Policy). Body content stays in `lib/legal/termsContent.ts`; this
// namespace only covers titles, navigation, and short UI strings the
// pages chrome around the legal text.

const legal = {
  terms: {
    title: "Terms of Service",
    subtitleEffective: "Effective {{effectiveDate}}",
    subtitleUpdated: "Last updated {{lastUpdated}}",
    tocTitle: "Sections",
    contactPrefix: "Questions about these Terms?",
    contactEmail: "Contact legal@cenaiva.com",
  },
  privacy: {
    title: "Privacy Policy",
    placeholderBody:
      "Cenaiva's full Privacy Policy is currently maintained at cenaiva.com/privacy and is incorporated by reference into our Terms of Service (Section 24). We are working to surface the full text on this site. In the meantime, the canonical version is available at the link above.",
    contactCta: "Contact Privacy Team",
    readTermsCta: "Read Terms of Service",
  },
  refund: {
    title: "Refund Policy",
    subtitle: "How Cenaiva refunds deposits, pre-orders, and other charges.",
    sectionWhatYouPay: "What you pay",
    sectionWhatGetsRefunded: "What gets refunded",
    sectionWhenYouGetRefunded: "When you get refunded",
    sectionTiming: "Timing",
    sectionHowToRequest: "How to request a refund",
    sectionDisputes: "Disputes",
    findReservationCta: "Find my reservation",
  },
  translationPendingBanner: "",
};

export default legal;
