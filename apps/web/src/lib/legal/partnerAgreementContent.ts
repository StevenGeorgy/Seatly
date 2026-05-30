// Cenaiva — Restaurant Partner Agreement v2.2
// Source of truth for the legal text rendered on /partners/agreement.
// Do NOT edit punctuation, casing, or wording without legal review.

import type { LegalSection } from "@/components/legal/LegalSection";

export const PARTNER_AGREEMENT_VERSION = "2.2";
export const PARTNER_AGREEMENT_EFFECTIVE_DATE = "May 30, 2026";
export const PARTNER_AGREEMENT_LAST_UPDATED = "May 30, 2026";

export const PARTNER_AGREEMENT_INTRO =
  "This Restaurant Partner Agreement (the \"Agreement\") governs your access to and use of the Cenaiva platform as a restaurant operator or owner (\"Restaurant Partner\", \"you\", \"your\"). This Agreement is between you and Cenaiva (\"Cenaiva\", \"we\", \"our\", \"us\").\n\nBy registering as a restaurant partner, accepting this Agreement in the app, or allowing Cenaiva to create an account on your behalf, you agree to be bound by these terms. Electronic acceptance through the Platform is binding and enforceable under the Electronic Commerce Act, 2000 (Ontario) and equivalent legislation. If you are agreeing on behalf of a business, you represent that you have the authority to bind that business to this Agreement.\n\nConsumer diners are subject to a separate Terms of Service available at cenaiva.com/terms and a separate Privacy Policy available at cenaiva.com/privacy.\n\nPrior versions of this Agreement are available at cenaiva.com/partners/agreement-history.";

export type PartnerAgreementHistoryEntry = {
  version: string;
  effectiveDate: string;
  summary: string;
};

export const PARTNER_AGREEMENT_HISTORY: PartnerAgreementHistoryEntry[] = [
  {
    version: "2.2",
    effectiveDate: PARTNER_AGREEMENT_EFFECTIVE_DATE,
    summary:
      "Corrected the Diner-payment fee model to a 2% platform fee on the food amount that is paid by the Diner at checkout (the restaurant receives 100% of food and applicable tax); corrected the merchant-of-record and payouts terms to reflect Stripe Connect, under which Diner payments are routed to the restaurant's connected account as a destination transfer; removed the unenforced 500-restaurant Trial cap and anchored the 90-day Trial to publication; and corrected the late-payment, cancellation and deletion timing, refund, and referral terms to match the deployed Platform.",
  },
  {
    version: "2.1",
    effectiveDate: "May 21, 2026",
    summary:
      "Initial published version of the v2.x agreement family. Establishes Subscription Fee at CAD $199.99/month, Per-Booking Platform Fee at CAD $1.00, Pre-Order Fee at 5.5%, the three-month Trial Period (first 500 qualifying restaurant partners), data-processing addendum (§10), and Schedule A sub-processor list.",
  },
];

export const PARTNER_AGREEMENT_SECTIONS: LegalSection[] = [
  {
    id: "definitions",
    number: "1",
    title: "Definitions",
    body: "- \"Billing Cycle\" means a recurring monthly period beginning on the anniversary of your subscription activation date (or, for Trial accounts, the date the Trial Period ends), running through the same day of the following calendar month.\n- \"Booking\" means a reservation, waitlist entry, or table request made by a Diner through the Platform.\n- \"Business Day\" means any day other than a Saturday, Sunday, or statutory holiday observed in the Province of Ontario.\n- \"Confirmed Booking\" means a reservation request that has been accepted by the Restaurant Partner (whether automatically or manually) and not cancelled by the Diner more than 24 hours before the reservation time measured in the restaurant's local time zone. No-shows are billable as Confirmed Bookings.\n- \"Deposit\" means an amount collected from a Diner through Stripe at the time of booking to secure a Confirmed Booking, and held against no-show or late-cancellation policies set by you.\n- \"Diner\" means a consumer or end user of the Cenaiva consumer app, who is subject to the consumer Terms of Service.\n- \"Partner Content\" means menu content, photos, descriptions, marks, and other materials you upload to the Platform.\n- \"Partner Dashboard\" means the restaurant-facing interface used to manage bookings, menus, floor plans, staff, CRM, and analytics.\n- \"Platform\" means the Cenaiva mobile application, web dashboard, edge functions, and related services made available to restaurant partners.\n- \"Pre-Order\" means a food or beverage order placed by a Diner through the Platform prior to or in connection with a Booking.\n- \"Pre-Order Fee\" (also referred to as the Platform Fee on Diner Payments) means the platform fee Cenaiva charges on Diner payments, equal to 2% of the food amount (the Pre-Order subtotal and any Deposit, before taxes and tips), set out in Section 5.1. This fee is added to the Diner's total at checkout and retained by Cenaiva out of the Diner's payment; it is not separately invoiced to you.\n- \"Sub-Processor\" means a third-party service provider that processes personal information on Cenaiva's behalf in delivering the Platform, as listed in Schedule A.\n- \"Subscription Fee\" means the monthly fee payable for access to the Platform.\n- \"Trial Period\" means the complimentary ninety (90)-day period of platform access described in Section 4, beginning on the day you publish your restaurant.",
  },
  {
    id: "platform-access",
    number: "2",
    title: "Platform Access and Services",
    body: "Subject to this Agreement, Cenaiva grants you a non-exclusive, non-transferable, revocable licence to access and use the Platform for the purpose of managing your restaurant's reservations, floor operations, guest relationships, menus, and related business functions in Canada.\n\nThe Platform includes access to the following features, subject to your subscription tier and availability:\n\n- Reservation, booking, and waitlist management, including Diner-paid Deposits for no-show protection\n- Floor plan, table, and section management\n- Guest CRM and diner profiles, including Cenaiva-generated guest tags, and — as these features roll out — no-show-risk and lifetime-value signals\n- Menu, modifier, and Pre-Order management\n- Team and staff access management, with optional biometric authentication (Face ID, Touch ID, or fingerprint) and an optional biometric confirmation step for sensitive actions such as approvals and transfers\n- Analytics, reporting, and kitchen display (KDS) views\n- AI-assisted guest communication and operational features where available\n- Mobile crash and error reporting, sign-in audit events, and new-device security alerts\n\nCenaiva reserves the right to modify, add, or remove platform features at any time. Cenaiva will give at least 30 days' notice before removing or materially restricting any feature you are actively using, except where shorter notice is required for security, legal, or safety reasons.\n\nThe Subscription Fee includes unlimited staff accounts per location at current subscription tiers. Cenaiva reserves the right to introduce staff-seat-based pricing in the future on at least 30 days' notice under Section 5.4.\n\nFuture POS integrations. Any future integration between the Platform and a third-party POS, KDS hardware, or in-venue payments system will be governed by a separate addendum to this Agreement.\n\nCenaiva warranty. Cenaiva warrants that it will perform the Services in a workmanlike manner consistent with industry standards for comparable SaaS platforms and in material compliance with applicable laws. Cenaiva's sole liability and your sole remedy for breach of this warranty is correction of the non-conforming service or, where correction is not commercially reasonable, termination of this Agreement and a pro-rata refund of prepaid Subscription Fees.\n\nNon-exclusivity. Nothing in this Agreement prevents you from using competing reservation, waitlist, or restaurant-management platforms concurrently with the Platform.",
  },
  {
    id: "account-setup",
    number: "3",
    title: "Account Setup and Onboarding",
    body: "Restaurant partner accounts may be created in one of two ways:\n\n- Self-serve — you register directly through the Platform by completing the restaurant onboarding flow and saving a card for billing after the Trial Period.\n- Cenaiva-assisted — in some cases, a Cenaiva team member may create your account on your behalf using information you have provided.\n\nIn both cases, you are responsible for ensuring that all information provided — including restaurant name, address, contact details, menu content, allergen information, operating hours, and billing details — is accurate, complete, and kept up to date.\n\nYou are responsible for all activity that occurs under your account, including activity by staff members you have granted access. You must notify us immediately at help@cenaiva.com if you suspect unauthorized access to your account.\n\nThere is no manual approval process for new restaurant partners. By completing registration, you confirm that you are authorized to operate the restaurant and to enter into this Agreement. Cenaiva reserves the right to verify your authority to operate the listed restaurant at any time. Verification may include requesting copies of business registration, food premises licensing, government-issued ID of the signing authority, or proof of address. Cenaiva will treat documents submitted for verification as Confidential Information under Section 12. Failure to respond to a verification request within a reasonable time may result in suspension of your account.\n\nMulti-location restaurants. Each restaurant location is treated as a separate account with its own Subscription Fee. Volume discounts and chain agreements are available by separate written arrangement — contact help@cenaiva.com.",
  },
  {
    id: "free-trial",
    number: "4",
    title: "Free Trial and Auto-Renewal",
    body: "New restaurant partners receive a complimentary Trial Period of ninety (90) days. The Trial Period begins on the day you publish your restaurant (make it live to Diners), not when you register or save a card. During the Trial Period the monthly Subscription Fee is waived.\n\nDuring the Trial Period:\n\n- The monthly Subscription Fee is waived\n- The Per-Booking Platform Fee described in Section 5 still accrues but is not billed during the Trial Period\n- All platform features available under the standard subscription are accessible\n- You may cancel at any time during the Trial Period without charge\n\nAuto-renewal disclosure. At the end of the Trial Period, your account will automatically transition to a paid monthly subscription and your saved card will be charged the Subscription Fee at the start of each subsequent Billing Cycle on a continuing basis until you cancel. We will notify you by email at least 7 days before your Trial Period ends, and a reminder of your next billing date is available in the Partner Dashboard at all times.\n\nIf you do not wish to continue after the Trial Period, you must cancel your subscription before the Trial Period expires to avoid being charged.",
  },
  {
    id: "fee-structure",
    number: "5.1",
    title: "Fee Structure",
    body: "The following fees apply to your use of the Platform:\n\n- Monthly Subscription Fee — CAD $199.99 per month, billed at the start of each Billing Cycle in CAD.\n- Per-Booking Platform Fee — CAD $1.00 per Confirmed Booking made through the Cenaiva consumer app, tracked per restaurant in our platform fee ledger and reconciled on each Billing Cycle.\n- Platform Fee on Diner Payments — Cenaiva charges 2% of the food amount (the Pre-Order subtotal and any Deposit, before taxes and tips) on Diner payments. This fee is added to the Diner's total at checkout and disclosed to the Diner; it is retained by Cenaiva out of the Diner's payment and is not separately invoiced to you. You receive 100% of the food amount and applicable tax for Pre-Orders and Deposits.\n\nGift cards and event tickets are not offered through the Platform. Cenaiva reserves the right to introduce additional transaction-based fees in the future with at least 30 days' written notice as described in Section 5.4.\n\nAll fees are exclusive of applicable taxes (GST/HST/QST/PST) unless otherwise stated. Applicable taxes will be displayed at the time of billing.",
  },
  {
    id: "billing-tax",
    number: "5.2",
    title: "Billing, Payment, and Tax Treatment",
    body: "- All fees are processed through Stripe. By accepting this Agreement, you agree to Stripe's Terms of Service.\n- You authorize Cenaiva to charge your nominated payment method on a recurring basis for the Subscription Fee, Per-Booking Platform Fees, and Pre-Order Fees.\n- Per-Booking Platform Fees and Pre-Order Fees are aggregated and billed on a monthly basis alongside the Subscription Fee.\n- It is your responsibility to ensure your payment method remains valid and up to date.\n- Stripe-generated invoices and receipts are available to you through the Stripe customer portal linked from the Partner Dashboard.\n\nTax treatment. Cenaiva acts as principal for the Subscription Fee, Per-Booking Platform Fee, and Pre-Order Fee, and is responsible for collecting and remitting applicable GST/HST and provincial sales taxes on those amounts. Where Cenaiva collects Deposits or other amounts on your behalf, Cenaiva acts as your agent, and you remain responsible for the tax treatment of those amounts in your own books and filings.",
  },
  {
    id: "late-payment",
    number: "5.3",
    title: "Late Payment",
    body: "If a payment fails, Stripe automatically retries the charge on its standard schedule and we will notify you by email. Your access to the Platform continues while these retries are pending.\n\nIf the subscription ultimately becomes unpaid or canceled, your restaurant is unpublished and your access to the Platform is suspended until payment is resolved. Continued non-payment may result in termination of your account in accordance with Section 14.",
  },
  {
    id: "fee-changes",
    number: "5.4",
    title: "Fee Changes",
    body: "Cenaiva reserves the right to modify the fee structure at any time. We will provide at least 30 days' written notice before any fee changes take effect. Your continued use of the Platform after the effective date of a fee change constitutes acceptance of the new fees. If you do not accept the new fees, you may cancel your subscription before the change takes effect.",
  },
  {
    id: "no-pause",
    number: "5.5",
    title: "No Pause Option",
    body: "Subscriptions are either active or scheduled for cancelation at the end of the current Billing Cycle. There is no option to pause a subscription. If you cancel, your access will continue until the end of the current paid Billing Cycle, after which it will be deactivated.",
  },
  {
    id: "cancellation-refunds",
    number: "5.6",
    title: "Cancellation and Refunds",
    body: "- You may cancel your subscription at any time by contacting help@cenaiva.com or by removing your restaurant from the Partner Dashboard.\n- Removing your restaurant unpublishes it immediately (it stops taking new bookings right away) and schedules your Stripe subscription to cancel at the end of the current Billing Cycle — you are not charged again after that cycle.\n- For 30 days after removal your restaurant is recoverable; contact help@cenaiva.com to restore it within that window. After the recovery window, your data is deleted on a rolling schedule, subject to any retention obligations required by law.\n- Monthly Subscription Fees already charged for the current Billing Cycle are non-refundable.\n- Per-Booking Platform Fees already incurred are non-refundable.\n- If Cenaiva terminates your account for a violation of this Agreement, no refund will be issued for any fees paid.\n- If Cenaiva terminates your account without cause under Section 14.7, Cenaiva will refund a pro-rata portion of any prepaid Subscription Fee for the unused portion of the current Billing Cycle. Refunds will be processed within 10 Business Days to the original payment method.",
  },
  {
    id: "deposits-chargebacks",
    number: "5.7",
    title: "Deposits, Refunds, Chargebacks, and Payment Disputes",
    body: "Cenaiva may collect Deposits from Diners on your behalf at the time of booking to enforce your stated no-show or late-cancellation policy. Deposits collected through the Platform are held by Cenaiva (via Stripe) and are refunded or retained according to your published policy. Refund requests submitted through the Platform are routed through Cenaiva's refund request queue and resolved by Cenaiva support.\n\nWhen a Pre-Order or Deposit is refunded, the refunded amount (the food amount and applicable tax) is returned from your connected Stripe account via a reversed transfer. The Diner-paid platform and processing fees are not refundable. Where a chargeback related to your restaurant is lost, the transferred amount (food and tax) is reversed from your connected account.\n\nIf a Diner disputes a charge, requests a refund, or initiates a chargeback related to a Booking, Pre-Order, Deposit, or restaurant-provided service, you are responsible for cooperating with Cenaiva and Stripe to resolve the dispute.\n\nWhere a refund, chargeback, or payment reversal is caused by your cancellation, failure to honor a Booking, failure to fulfill a Pre-Order, inaccurate pricing, or service issue, Cenaiva may recover the applicable amount by deducting it from amounts otherwise owed to you, by adjusting future invoices, or by charging the payment method on file.\n\nCenaiva platform fees remain payable except where the issue was caused by a verified technical error on Cenaiva's part or where required by applicable law.\n\nDispute fees. Stripe charges a per-dispute fee on each chargeback (currently CAD $15.00) regardless of the outcome. Where the chargeback is caused by your action or inaction, Cenaiva will recover the Stripe dispute fee from you in the same manner as other reversed amounts. Where the chargeback arises from a verified Cenaiva error, Cenaiva will absorb the dispute fee.",
  },
  {
    id: "merchant-of-record",
    number: "5.8",
    title: "Merchant of Record and Payouts",
    body: "Diner payments collected through the Platform — Pre-Orders and Deposits — are processed using Stripe Connect. The Diner pays Cenaiva's platform Stripe account, and Stripe routes your share (the food amount plus applicable tax) to your connected Stripe account as a destination transfer. Cenaiva retains only its platform fee plus the Diner-paid processing fee.\n\nTo receive these funds you must complete Stripe Connect onboarding (identity verification and bank details); a restaurant cannot be published until Stripe has enabled charges on your connected account.\n\nCenaiva is merchant of record for its own charges to you (the Subscription Fee and the Per-Booking Platform Fee). For Deposits and Pre-Order amounts collected from Diners, Cenaiva acts as your agent and transfers your share as described above.\n\nIn-venue payments (the meal paid at the table) are not processed by the Platform — you remain responsible for those through your own POS and merchant of record.",
  },
  {
    id: "referrals",
    number: "5.9",
    title: "Referrals — Refer & Earn",
    body: "Cenaiva may offer an owner-side referral program. The program is not active at this time. When active, you and a referred restaurant that signs up with your referral code will each receive a one-time credit of CAD $199.99 (about one month of Subscription Fee), applied to your Stripe subscription. Referral codes are issued by Cenaiva. Referral abuse — including self-referrals, fake businesses, or chained signups intended to evade billing — will result in forfeiture of credits and may result in termination under Section 14.",
  },
  {
    id: "restaurant-obligations",
    number: "6",
    title: "Restaurant Obligations",
    body: "As a restaurant partner, you agree to:\n\n- Maintain accurate, complete, and up-to-date menu information, pricing, allergen details, dietary labels, and operating hours on the Platform at all times.\n- Honor all Confirmed Bookings made through the Platform, including Pre-Orders and Deposits, in accordance with your published policy.\n- Treat Diners with respect and in compliance with all applicable laws, including the Ontario Human Rights Code and equivalent provincial legislation.\n- Comply with all applicable food safety, health, licensing, and regulatory requirements in your jurisdiction.\n- Maintain commercial general liability insurance with a minimum of CAD $2,000,000 per occurrence and CAD $5,000,000 aggregate, plus product liability coverage appropriate for food service, and provide a certificate of insurance on request.\n- Ensure that staff members with Platform access are aware of and comply with this Agreement, including any biometric-authentication or sensitive-action workflows.\n- Revoke Platform access immediately for any staff member who leaves your employ or whose access is no longer required. Cenaiva is not liable for unauthorized access by current or former staff that you failed to deprovision.\n- Respond to Diner complaints and disputes in good faith and in a timely manner.\n- Notify Cenaiva promptly of any issues that may affect your ability to honor Bookings, including closures, capacity changes, or technical problems.\n- Not use the Platform or Diner data for any purpose outside of legitimate restaurant operations, and not use Diner data accessed through the Platform to build or operate a competing reservation, booking, or restaurant-discovery platform.\n\nNo circumvention. You agree not to (a) divert Diners who first contacted you through the Platform to bookings made outside the Platform for the purpose of avoiding the Per-Booking Platform Fee or Pre-Order Fee, (b) discriminate against Diners booking through the Platform compared to other booking channels, or (c) use contact information shared by Cenaiva under Section 10.3 to solicit those Diners to book outside the Platform for the same restaurant. Cenaiva may audit transaction patterns and, where circumvention is identified, recover the corresponding platform fees by invoice or by charging the payment method on file.",
  },
  {
    id: "menu-allergen-liability",
    number: "7",
    title: "Menu Accuracy and Allergen Liability",
    body: "You are solely responsible for the accuracy, completeness, and currency of all menu content, ingredient lists, allergen information, dietary labels, and pricing that you provide to Cenaiva for display on the Platform.\n\nCenaiva displays this information as provided by you and does not independently verify its accuracy. You acknowledge and agree that:\n\n- Any harm, injury, allergic reaction, or loss suffered by a Diner as a result of inaccurate, incomplete, or misleading allergen or menu information is solely your responsibility.\n- Cenaiva is not liable for any claim arising from menu or allergen information provided by you.\n- You will indemnify and hold harmless Cenaiva from any claim, loss, liability, or expense arising from inaccurate food, allergen, or dietary information you have provided to the Platform.\n\nYou must update your menu and allergen information promptly whenever your offerings change in a way that could affect a Diner's safety or purchasing decision. If you become aware of an error in your listed information that could affect Diner safety, you must notify us immediately at help@cenaiva.com so that the relevant information can be flagged or removed pending correction.",
  },
  {
    id: "alcohol-restricted",
    number: "8",
    title: "Alcohol and Restricted Items",
    body: "You are solely responsible for complying with all applicable alcohol, liquor, age-verification, licensing, and restricted-product laws in your jurisdiction. This includes ensuring that Pre-Orders involving alcohol or other age-restricted products are only fulfilled in compliance with applicable law. Cenaiva does not independently verify a Diner's legal eligibility to purchase or consume alcohol or other restricted items unless a specific age-verification feature is expressly provided by the Platform.",
  },
  {
    id: "diner-relationships",
    number: "9",
    title: "Diner Relationships and Independent Responsibility",
    body: "Cenaiva is a technology platform that connects Diners with restaurants. Cenaiva is not a party to any agreement between you and a Diner. You are solely responsible for:\n\n- The dining experience you provide to Diners\n- Fulfilling Pre-Orders and honoring Deposits\n- Any dispute arising between you and a Diner regarding food, service, pricing, cancellations, or refunds\n- Your own cancellation, no-show, and refund policies, which must be clearly communicated to Diners at the time of booking\n\nCenaiva may facilitate communication between you and Diners but has no obligation to mediate or resolve disputes between you. Repeated failure to honor Bookings, excessive Diner complaints, or patterns of poor service may result in suspension or removal from the Platform.",
  },
  {
    id: "data-controller-structure",
    number: "10.1",
    title: "Data Controller Structure",
    body: "Each party is an independent data controller with respect to personal information it processes in connection with the Platform. Depending on the specific data and feature involved, the parties may also act as service providers or processors under applicable privacy laws. In summary:\n\n- Cenaiva is responsible for personal information it collects from Diners through the consumer app, including account data, voice and chat interactions, payment data, Deposits, AI-generated tags, no-show risk scores, lifetime value estimates, and platform activity.\n- You are responsible for personal information you collect, store, or process through the Partner Dashboard, including guest CRM data, staff information, guest notes, allergy incident records, and any notes or tags you create about Diners.\n\nThe provisions of Sections 10.2 through 10.12 constitute the data processing addendum between the parties for the purpose of PIPEDA, Quebec Law 25, and other applicable Canadian privacy laws. No separate signed DPA is required.",
  },
  {
    id: "privacy-obligations",
    number: "10.2",
    title: "Your Privacy Obligations",
    body: "As a data controller, you are responsible for complying with all applicable Canadian privacy laws — including PIPEDA, Quebec Law 25, Canada's Anti-Spam Legislation (CASL), and Alberta and BC PIPA where applicable — in connection with your handling of Diner and staff personal information accessed through the Platform. You must maintain your own privacy policy where required by law.",
  },
  {
    id: "booking-data-shared",
    number: "10.3",
    title: "Booking Data Shared by Cenaiva",
    body: "When a Diner makes a Booking through the Platform, Cenaiva shares relevant booking details with you — such as the Diner's name, party size, reservation time, contact information, special requests, allergy notes, any behavioural guest tags relevant to hosting the visit, and — as these features roll out — no-show-risk and lifetime-value signals — solely to enable you to fulfill the Booking and operate your venue.\n\nYou may use Diner information shared by Cenaiva only for managing the Diner's visit, responding to inquiries, and operating loyalty or service-recovery programs to which the Diner has separately consented in compliance with PIPEDA, CASL, and Quebec Law 25.\n\nYou may not add Diners to your own marketing lists, send promotional messages, profile Diners for purposes unrelated to their Booking, sell Diner information to third parties, train AI or analytics models for purposes unrelated to your operations, or contact Diners outside the Platform unless you have obtained separate valid consent directly from the Diner. You are solely responsible for obtaining and recording any consents required for your own use of Diner information.",
  },
  {
    id: "staff-biometric",
    number: "10.4",
    title: "Staff Accounts, Biometric Authentication, and Sensitive Actions",
    body: "The Platform offers staff sign-in via biometric authentication (Face ID and Touch ID on iOS, fingerprint on Android) and an optional biometric confirmation step for sensitive operations such as approving transfers and refunds. Biometric processing occurs on the device through Apple or Google APIs; raw biometric data is not transmitted to or stored by Cenaiva.\n\nIf your jurisdiction requires consent, notice, or a declaration for the use of biometric authentication by staff (including any declaration to the Commission d'accès à l'information of Quebec for systems Cenaiva makes available), the parties will cooperate to make any required filing. You remain responsible for obtaining staff consent and for any declaration required for biometric data you collect or use independently of the Platform.",
  },
  {
    id: "sub-processors",
    number: "10.5",
    title: "Sub-Processors",
    body: "Cenaiva engages Sub-Processors to deliver the Platform. The current list of Sub-Processors and the services they provide is set out in Schedule A. Cenaiva imposes contractual data-protection obligations on each Sub-Processor that are no less protective than those in this Agreement.\n\nCenaiva will give at least 30 days' notice (by email or in the Partner Dashboard) before adding or replacing a Sub-Processor that processes personal information in a materially new way. You may object in writing within 30 days; if the objection cannot be resolved, you may terminate this Agreement and receive a pro-rata refund of prepaid Subscription Fees as your sole remedy.",
  },
  {
    id: "data-residency",
    number: "10.6",
    title: "Data Residency",
    body: "Personal information processed under this Agreement is stored primarily in Canada and the United States. Several Sub-Processors may process data in additional jurisdictions, as noted in Schedule A. Cross-border transfers are made subject to contractual safeguards and any consent requirements under applicable law.",
  },
  {
    id: "personnel-access",
    number: "10.7",
    title: "Cenaiva Personnel Access",
    body: "Cenaiva personnel access to Partner data and Diner data accessible to your restaurant is logged in an append-only audit trail, role-restricted, and limited to support, compliance, security, and quality-review purposes. Cenaiva applies the principle of least privilege and reviews access on a periodic basis.",
  },
  {
    id: "data-security",
    number: "10.8",
    title: "Data Security",
    body: "You agree to implement and maintain reasonable technical and organizational measures to protect Diner and staff personal information accessible through the Partner Dashboard against unauthorized access, disclosure, or misuse.\n\nCenaiva enforces row-level security on Platform tables, logs sensitive staff actions to an append-only audit trail, sends new-device sign-in alerts to staff with Platform access, runs automated security scans against its database, and encrypts data in transit using TLS. Card data is collected and stored solely by Stripe, a PCI-DSS Level 1 service provider — Cenaiva does not see or store full card numbers, CVVs, or PIN data. Cenaiva will make summary security attestations available on request, subject to a mutual non-disclosure agreement.\n\nVulnerability disclosure. Suspected security vulnerabilities in the Platform may be reported in good faith to security@cenaiva.com. Cenaiva will not pursue legal action against good-faith security researchers who report vulnerabilities in accordance with this clause, do not access or modify other users' data, and give Cenaiva a reasonable opportunity to remediate before public disclosure.",
  },
  {
    id: "breach-notification",
    number: "10.9",
    title: "Breach Notification",
    body: "Each party shall notify the other party in writing without unreasonable delay, and in any case within 72 hours, of becoming aware of any actual or reasonably suspected breach of security safeguards affecting personal information processed under this Agreement.\n\nThe notification shall include, to the extent then known: the nature of the breach, the categories and approximate number of individuals and records affected, the likely consequences, and the measures taken or proposed to address the breach. The parties shall cooperate in good faith on investigation, mitigation, and any required notifications to individuals or regulators.",
  },
  {
    id: "ai-aggregated-data",
    number: "10.10",
    title: "AI and Aggregated Data",
    body: "Cenaiva may use aggregated, de-identified data derived from Partner Content and Platform usage to train, evaluate, and improve AI features, analytics, and benchmarking products. Partner-identifying information will not be used to train AI models offered to third parties. Diner personal information used in AI features is governed by the consumer Privacy Policy.",
  },
  {
    id: "data-subject-requests",
    number: "10.11",
    title: "Data Subject Requests",
    body: "If you receive a request from a Diner to access, correct, delete, or port personal information held by Cenaiva (as distinct from data held by you), you shall forward the request to privacy@cenaiva.com within five (5) Business Days. Cenaiva will respond to the Diner directly within the timelines required by applicable law. You may handle requests concerning data you control independently as the applicable controller.",
  },
  {
    id: "loyalty-program",
    number: "10.12",
    title: "Loyalty Program",
    body: "If and when Cenaiva activates loyalty features, the Diner's loyalty membership is held with Cenaiva, not with you. You may see your venue's contribution to a Diner's loyalty status but may not export, transfer, or independently market to a Diner based on their Cenaiva loyalty data without separate Diner consent obtained outside the Platform.",
  },
  {
    id: "ip-cenaiva",
    number: "11.1",
    title: "Cenaiva's Property",
    body: "All content, software, features, designs, branding, and materials associated with the Platform are owned by Cenaiva or its licensors and are protected by applicable intellectual property laws. This Agreement does not transfer any ownership rights to you. You may not copy, reproduce, modify, reverse-engineer, decompile, scrape, or create derivative works from any part of the Platform.",
  },
  {
    id: "ip-your-content",
    number: "11.2",
    title: "Your Content",
    body: "You retain ownership of all Partner Content. By uploading Partner Content, you grant Cenaiva a non-exclusive, worldwide, royalty-free licence to display, reproduce, host, modify (for formatting purposes), and use your Partner Content within the Platform and in connection with Cenaiva's marketing and promotional activities for the duration of this Agreement.\n\nYou represent that you own or have the right to use all Partner Content you upload, and that it does not infringe the rights of any third party.",
  },
  {
    id: "ip-name-marks",
    number: "11.3",
    title: "Use of Restaurant Name and Marks",
    body: "You grant Cenaiva a non-exclusive, worldwide, royalty-free licence to use your restaurant's name, logo, trade marks, and publicly available images for the purpose of identifying you as a Restaurant Partner and promoting the Platform during the term of this Agreement. Cenaiva will follow any reasonable brand guidelines you provide. This licence terminates upon expiration or termination of this Agreement, except for materials already produced and in distribution at the time of termination.\n\nPublicity opt-out. Cenaiva will obtain your written consent (email is sufficient) before publishing a case study, named press release, or named investor-relations material that features you. Inclusion in customer lists, \"logo walls,\" and aggregated press counts does not require separate consent.",
  },
  {
    id: "ip-feedback",
    number: "11.4",
    title: "Feedback",
    body: "If you provide feedback, suggestions, or ideas regarding the Platform, you grant Cenaiva a perpetual, irrevocable, worldwide, royalty-free licence to use them for any purpose without obligation to you.",
  },
  {
    id: "ip-indemnity",
    number: "11.5",
    title: "Cenaiva IP Indemnity",
    body: "Cenaiva will defend, indemnify, and hold you harmless from third-party claims that the Platform itself, as provided by Cenaiva and used in accordance with this Agreement, infringes a Canadian copyright, trade-mark, or patent, and will pay damages finally awarded by a court or agreed in settlement, subject to the cap in Section 16. This indemnity does not apply to claims arising from Partner Content, your modifications, or your combination of the Platform with materials not provided by Cenaiva.",
  },
  {
    id: "ip-content-moderation",
    number: "11.6",
    title: "Content Moderation",
    body: "Cenaiva may remove or refuse to display Partner Content that is unlawful, infringing, defamatory, hateful, sexually explicit, or otherwise inconsistent with Cenaiva's content standards. Cenaiva will notify you when content is removed and, where reasonably possible, give you an opportunity to cure.",
  },
  {
    id: "confidentiality",
    number: "12",
    title: "Confidentiality",
    body: "Each party agrees to keep confidential any non-public information received from the other party in connection with this Agreement that is reasonably understood to be confidential, including pricing, product roadmaps, business strategies, technical information, and personal information.\n\nNeither party will disclose such information to third parties without the other's prior written consent, except as required by law or to professional advisors bound by equivalent confidentiality obligations.\n\nThis obligation does not apply to information that is or becomes publicly available through no fault of the receiving party, was already known to the receiving party without restriction, or that the receiving party independently develops without reference to the confidential information.",
  },
  {
    id: "representations-warranties",
    number: "13",
    title: "Representations and Warranties",
    body: "You represent and warrant that:\n\n- You are duly authorized to operate your restaurant and to enter into this Agreement.\n- All information you provide to Cenaiva is accurate and complete.\n- Your restaurant holds all required licences, permits, and regulatory approvals to operate in your jurisdiction.\n- Your use of the Platform will comply with all applicable laws.\n- You have the right to grant the licences described in this Agreement with respect to your Partner Content.\n- You will comply with Canadian accessibility legislation applicable to your in-venue operations, including AODA where applicable.\n- You are not located in, ordinarily resident in, or operating from a country or region subject to comprehensive Canadian, U.S., or U.N. sanctions, and you are not listed on any Canadian, U.S., or U.N. restricted-party or sanctions list. You will notify Cenaiva immediately if your status changes.\n- Neither you nor any of your representatives has offered, given, or promised, or will offer, give, or promise, anything of value to any Cenaiva employee, contractor, or representative in connection with this Agreement, in violation of the Corruption of Foreign Public Officials Act or any other applicable anti-corruption law.",
  },
  {
    id: "termination-by-you",
    number: "14.1",
    title: "Termination by You",
    body: "You may cancel your subscription at any time by contacting help@cenaiva.com or by removing your restaurant from the Partner Dashboard. Removing your restaurant unpublishes it immediately and soft-deletes it, so it stops taking new bookings right away and your access is removed; your Stripe subscription is scheduled to cancel at the end of the current Billing Cycle, and you are not charged again after that cycle. For 30 days after removal your restaurant is recoverable; contact help@cenaiva.com to restore it within that window. After the recovery window, your data is deleted on a rolling schedule, subject to any retention obligations required by law. Subscription Fees already charged for the current Billing Cycle are non-refundable except as described in Section 5.6.",
  },
  {
    id: "termination-minor",
    number: "14.2",
    title: "Termination by Cenaiva — Minor Violations",
    body: "For minor violations of this Agreement — including repeated failure to update menu information, consistent failure to honor Bookings without cause, or late payment — Cenaiva will provide 14 days' written notice identifying the issue and requiring remediation. If the issue is not resolved within that period, Cenaiva may suspend or terminate your account.",
  },
  {
    id: "termination-serious",
    number: "14.3",
    title: "Termination by Cenaiva — Serious Violations",
    body: "Cenaiva may suspend or terminate your account immediately and without notice for serious violations, including but not limited to:\n\n- Fraud, misrepresentation, or deceptive practices toward Diners or Cenaiva\n- Misuse of Diner personal data\n- Providing false allergen or menu information that causes or risks harm to Diners\n- Harassment or abuse of Diners or Cenaiva staff\n- Illegal activity conducted through or in connection with the Platform\n- Referral program abuse or fee circumvention intended to evade billing\n- Breach of sanctions or anti-corruption representations\n- Actions that expose Cenaiva to legal, regulatory, or reputational harm",
  },
  {
    id: "termination-appeal",
    number: "14.4",
    title: "Appeal",
    body: "If your account is suspended or terminated under Section 14.2 or 14.3, you may submit a written appeal to legal@cenaiva.com within 14 days of the action. Cenaiva will review the appeal and respond in writing within 14 days of receipt. The decision on appeal is final.",
  },
  {
    id: "termination-effect",
    number: "14.5",
    title: "Effect of Termination",
    body: "Upon termination:\n\n- Your access to the Platform and Partner Dashboard ceases immediately or at the end of the notice period, as applicable.\n- Any outstanding fees owed to Cenaiva become immediately due and payable.\n- Refunds are handled as described in Section 5.6.\n- Pending Diner Bookings should be honored where possible — you are responsible for communicating directly with affected Diners regarding any Bookings that cannot be fulfilled.",
  },
  {
    id: "termination-survival",
    number: "14.6",
    title: "Survival",
    body: "The following sections survive termination of this Agreement: 1 (Definitions), 5.6, 5.7, 5.8, 7 (allergen liability), 10 (Data, Privacy, and Security, including 10.9 breach notification), 11 (Intellectual Property), 12 (Confidentiality), 14.5 and 14.6, 15 (Data Export and Deletion), 16 (Limitation of Liability), 17 (Indemnification), 19 (Dispute Resolution), 21 (Governing Law), 22 (Language), 23 (General Provisions), and any other provision that by its nature is intended to survive.",
  },
  {
    id: "termination-without-cause",
    number: "14.7",
    title: "Termination by Cenaiva — Without Cause",
    body: "Cenaiva may terminate this Agreement without cause on 60 days' written notice to you. In that event, Cenaiva will refund a pro-rata portion of any prepaid Subscription Fee for the unused portion of the current Billing Cycle as described in Section 5.6.",
  },
  {
    id: "data-export-deletion",
    number: "15",
    title: "Data Export and Deletion After Termination",
    body: "Following termination, you may request an export of your own business data — including your menu content, reservation history, Pre-Order history, and staff account records — by contacting help@cenaiva.com within 30 days of termination. Exports are produced manually by Cenaiva support and will be delivered in a structured, commonly used format such as CSV or JSON. Cenaiva does not currently offer a self-serve export from the Partner Dashboard.\n\nExported files are retained by Cenaiva for 30 days after delivery and then permanently deleted from Cenaiva systems; you are responsible for downloading and securing the file within that window.\n\nAfter the 30-day request window, your data will be deleted from our active systems on a rolling schedule, subject to any retention obligations required by law.\n\nYou may not request or export Diner personal information such as email addresses, phone numbers, payment data, voice recordings, or Cenaiva-generated profiling data — this information is controlled by Cenaiva under the data controller structure in Section 10 and will not be transferred to you upon termination.\n\nCenaiva may retain certain records following termination where required for legal, financial, tax, or dispute resolution purposes (generally six years under Canadian tax and consumer protection law), in accordance with applicable law.",
  },
  {
    id: "limitation-liability",
    number: "16",
    title: "Limitation of Liability",
    body: "To the fullest extent permitted by applicable law:\n\n- Neither party is liable for any indirect, incidental, special, punitive, exemplary, or consequential damages arising from this Agreement or use of the Platform.\n- Cenaiva is not responsible for lost revenue, lost Bookings, lost customers, or business interruption arising from Platform downtime, feature changes, or termination.\n- Cenaiva is not liable for disputes between you and Diners, including claims related to food quality, allergens, service, or cancellations.\n- Each party's total cumulative liability to the other for all claims arising out of or relating to this Agreement shall not exceed the total Subscription Fees you paid to Cenaiva in the 12 months prior to the event giving rise to the claim, or CAD $5,000, whichever is greater.\n\nExclusions from the cap. The cap above does not apply to: (a) your indemnification obligations under Section 17; (b) either party's breach of confidentiality under Section 12; (c) either party's IP indemnification obligations under Sections 11.5 and 17; (d) fees you owe to Cenaiva under Section 5; or (e) liability that cannot be excluded under applicable Canadian law, including liability for gross negligence or wilful misconduct.\n\nNothing in this Agreement limits liability that cannot be excluded under applicable Canadian law.",
  },
  {
    id: "indemnification",
    number: "17",
    title: "Indemnification",
    body: "You agree to indemnify, defend, and hold harmless Cenaiva, its officers, employees, contractors, and partners from and against any claims, liabilities, damages, losses, or expenses (including reasonable legal fees) arising from:\n\n- Your use of or inability to use the Platform\n- Your violation of this Agreement\n- Any claim by a Diner arising from your restaurant's food, service, allergen information, or failure to honor a Booking or Pre-Order\n- Any inaccurate, misleading, or harmful menu or allergen information you provided to the Platform\n- Your violation of any applicable law or third-party rights\n- Any misuse of Diner personal data by you or your staff\n- Any breach of Section 6 obligations regarding staff offboarding, competitive use of Diner data, or fee circumvention",
  },
  {
    id: "service-availability",
    number: "18.1",
    title: "Service Availability",
    body: "Cenaiva aims to provide a reliable platform. However:\n\n- We do not guarantee that the Platform will be available at all times or free from errors.\n- We may perform scheduled or emergency maintenance that temporarily affects access — we will endeavour to provide advance notice where reasonably possible.\n- We are not liable for losses arising from Platform downtime, outages, or third-party service failures.\n- Cenaiva does not offer a service level agreement (SLA), uptime guarantee, or downtime credit mechanism under this Agreement.",
  },
  {
    id: "support-tiers",
    number: "18.2",
    title: "Support Tiers",
    body: "Cenaiva provides email support at help@cenaiva.com seven days a week, with the following non-binding response targets:\n\n- Critical (Platform unreachable, payment processing down, security incident) — within 4 hours\n- High (significant feature broken affecting Bookings) — within 1 Business Day\n- Standard — within 2 Business Days\n\nCritical issues should be flagged with a subject line beginning \"URGENT —\". Response targets may be longer on statutory holidays observed in the Province of Ontario. Cenaiva does not offer phone support under this Agreement.",
  },
  {
    id: "force-majeure",
    number: "18.3",
    title: "Force Majeure",
    body: "Neither party is liable for any delay or failure to perform resulting from causes beyond its reasonable control, including internet or network outages, third-party service failures (including payment processors and infrastructure providers), natural disasters, acts of government, pandemics, or other events outside reasonable control. Obligations under this Agreement will be suspended for the duration of the event. This clause does not excuse payment obligations for fees already incurred.\n\nTermination for prolonged Force Majeure. If a Force Majeure event continues for more than 60 consecutive days, either party may terminate this Agreement on written notice, and Cenaiva will refund a pro-rata portion of any prepaid Subscription Fee for the unused portion of the current Billing Cycle.",
  },
  {
    id: "dispute-resolution",
    number: "19",
    title: "Dispute Resolution",
    body: "We encourage you to contact us first at help@cenaiva.com to resolve any concerns informally. We will make a genuine effort to respond within 30 days of receiving your complaint.\n\nIf a dispute cannot be resolved informally, both parties agree to attempt in good faith to resolve the matter through mediation administered by the ADR Institute of Canada before initiating formal legal proceedings. Quebec partners may instead elect mediation administered by the Institut de médiation et d'arbitrage du Québec. If mediation does not resolve the dispute within 60 days of a written request to mediate, either party may submit the dispute to the exclusive jurisdiction of the courts of the Province of Ontario, subject to any mandatory jurisdictional rights of Quebec partners under applicable Quebec law.",
  },
  {
    id: "changes-to-agreement",
    number: "20",
    title: "Changes to This Agreement",
    body: "Cenaiva may update this Agreement from time to time. For minor changes, we will update the \"Last Updated\" date at the top of this document. For material changes — including fee changes — we will provide at least 30 days' written notice via email or in-app notification before the changes take effect. Prior versions remain available at cenaiva.com/partners/agreement-history.\n\nA change is material if it increases fees, reduces or removes a feature you actively use, materially changes how Cenaiva uses Diner data shared with you, narrows your data rights, or reduces Cenaiva's data-protection commitments. Bug fixes, UI updates, security improvements, and the addition of optional features are not material changes.\n\nYour continued use of the Platform after the effective date of any changes constitutes acceptance of the updated Agreement. If you do not agree, you may cancel your account before the changes take effect.",
  },
  {
    id: "governing-law",
    number: "21",
    title: "Governing Law and Territory",
    body: "This Agreement is governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, except where the laws of another Canadian province apply mandatorily.\n\nThe Platform is currently offered only in Canada. If Cenaiva launches in jurisdictions outside Canada, separate terms will apply to those jurisdictions.",
  },
  {
    id: "language",
    number: "22",
    title: "Language / Langue",
    body: "This Agreement is available in both English and French. For restaurant partners located in Quebec, the French version will be made available first in accordance with the Charter of the French Language, and Quebec partners may request a written copy of the French version at no cost before being bound by the English version. In the event of any conflict between the two versions, the interpretation required by applicable law will apply.\n\nLe présent accord est disponible en anglais et en français. Pour les partenaires restaurateurs situés au Québec, la version française sera mise à disposition en premier, conformément à la Charte de la langue française, et les partenaires québécois peuvent demander une copie écrite de la version française, sans frais, avant d'être liés par la version anglaise. En cas de conflit entre les deux versions, l'interprétation requise par la loi applicable s'appliquera.",
  },
  {
    id: "general-provisions",
    number: "23",
    title: "General Provisions",
    body: "Severability. If any provision of this Agreement is found to be unlawful, void, or unenforceable, that provision will be severed and the remaining provisions will continue in full force and effect.\n\nAssignment. Cenaiva may assign this Agreement in connection with a merger, acquisition, financing, or sale of assets without notice to you. You may not assign your rights or obligations under this Agreement without Cenaiva's prior written consent.\n\nWaiver. Our failure to enforce any provision of this Agreement on any occasion does not constitute a waiver of our right to enforce that provision in the future.\n\nNotices. Legal notices to Cenaiva must be sent to legal@cenaiva.com. Notices to you will be sent to the email address associated with your account. Notices are deemed received 24 hours after sending unless a delivery failure is received.\n\nNo third-party beneficiaries. This Agreement is between Cenaiva and you only. No Diner or other third party has any right to enforce any provision of this Agreement, except as expressly stated for permitted assigns under this Section 23.\n\nEntire Agreement. This Agreement, together with Schedule A and any order forms or addenda, constitutes the entire agreement between you and Cenaiva with respect to your role as a Restaurant Partner and supersedes all prior agreements or understandings on the same subject matter. This Agreement does not affect or supersede the consumer Terms of Service or Privacy Policy that govern Diners.\n\nHeadings. Section headings are included for convenience only and have no interpretive effect.\n\nIndependent Contractors. The parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency, or employment relationship between Cenaiva and any restaurant partner, except as expressly stated regarding Cenaiva's role as agent for Deposit collection under Section 5.2.",
  },
  {
    id: "contact",
    number: "24",
    title: "Contact",
    body: "- Support: help@cenaiva.com\n- Privacy: privacy@cenaiva.com\n- Legal: legal@cenaiva.com\n- Security: security@cenaiva.com\n- Website: cenaiva.com/partners\n\nSupport is available in English and French. Le soutien est offert en anglais et en français.",
  },
];
