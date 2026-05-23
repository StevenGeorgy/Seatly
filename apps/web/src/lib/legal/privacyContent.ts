// Cenaiva — Privacy Policy v1.1
// Source of truth for the legal text rendered on /privacy.
// Do NOT edit punctuation, casing, or wording without legal review.

import type { LegalSection } from "@/components/legal/LegalSection";

export const PRIVACY_VERSION = "1.1";
export const PRIVACY_EFFECTIVE_DATE = "May 21, 2026";
export const PRIVACY_LAST_UPDATED = "May 21, 2026";

export const PRIVACY_INTRO =
  "This Privacy Policy explains how Cenaiva (\"Cenaiva\", \"we\", \"us\") collects, uses, shares, and protects personal information when you use the Cenaiva mobile app (iOS and Android), our website at cenaiva.com, and related services (collectively, the \"Services\") as a diner. Restaurant partners and staff are covered by a separate Restaurant Partner Agreement.\n\nThis Policy is incorporated by reference into the Cenaiva Terms of Service. Capitalized terms not defined here have the meaning given in the Terms. If you do not agree with this Policy, do not use the Services, and contact us to delete any account you have created.\n\nThis Policy is available in English and French. Cette politique de confidentialité est disponible en anglais et en français.";

export const PRIVACY_PLAIN_LANGUAGE_SUMMARY: string[] = [
  "We collect the information needed to take your bookings, run Cenaiva AI, and keep your account safe — and nothing more.",
  "We never sell your information and never use it for cross-context behavioural advertising.",
  "Your card details live with Stripe, not with us.",
  "You can delete your account at any time from your account settings (Profile → Privacy on mobile, Account → Preferences → Privacy on web), and request access, correction, or human review of automated decisions by emailing privacy@cenaiva.com.",
  "We use third-party AI providers (OpenAI, Deepgram, ElevenLabs) to run Cenaiva AI. They process your voice and chat only to return responses to us, and do not use your data to train their models.",
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "responsible-for-data",
    number: "1",
    title: "Who is responsible for your data",
    body: "Cenaiva is the controller of the personal information described in this Policy, except where data is processed on behalf of a restaurant partner — in which case the restaurant is the controller of its own guest records and Cenaiva acts as a processor for that restaurant.\n\nPrivacy questions, complaints, and rights requests: privacy@cenaiva.com. General support: help@cenaiva.com. Intellectual property and legal: legal@cenaiva.com. Security vulnerability reports: security@cenaiva.com.",
  },
  {
    id: "info-you-provide",
    number: "2",
    title: "Information you provide directly",
    body: "We collect only the information we need to provide and improve the Services, in the categories below.\n\nAccount information: your name, email address, phone number, password (stored only as a salted hash by our auth provider), preferred language, and — if you choose — date of birth, anniversary, profile photo, and dining preferences such as cuisines, dietary restrictions, and vibe preferences.\n\nReservation information: party size, requested time, special requests, allergy notes, occasion, and any pre-order selections you submit.\n\nPayment information: when you save a card or pay a deposit, your card is collected directly by Stripe. Cenaiva never sees or stores your full card number or CVV. We store only a tokenized reference, the card brand, the last four digits, and the expiry month and year. Stripe processes the payment under its own privacy policy.\n\nContent you submit: reviews, star ratings, visit photos, \"Snap\" social posts (including any in-app story filter applied), survey responses, allergy incident reports, in-app messages to support, and any image you submit to the receipt or photo scanner.\n\nVoice and chat input: when you use Cenaiva AI, the words you speak or type, the audio of your voice while a session is active, and the conversation context needed to answer you.\n\nReferral information: when you invite someone using a referral code, we record that you sent the invite and whether the invitee signed up so the bonus can be granted to the right account.",
  },
  {
    id: "info-collected-automatically",
    number: "3",
    title: "Information collected automatically",
    body: "Device and app data: device model, operating system and version, app version, language and region, time zone, and a non-resettable device fingerprint used for fraud prevention and new-device security alerts.\n\nSign-in events: each successful and failed sign-in is logged with the device fingerprint, platform, app version, IP-derived approximate location, and timestamp. This log powers the new-device security alert you receive by push or email when we see a sign-in we don't recognize.\n\nUsage and product analytics: screens viewed, actions taken (for example, \"viewed restaurant\", \"started booking\", \"voice session started\"), feature interactions, and session duration. We use PostHog for product analytics and apply pseudonymization where feasible.\n\nCrash and error data: when the app crashes or hits an unhandled error, we capture the current screen, app version, platform, and a stack trace via Sentry and our internal crash log. Crash records are typically retained for 30 days and then purged automatically.\n\nRate limiting and abuse prevention: we log per-user counts of paid AI and voice calls (transcription, language model, text-to-speech) so we can enforce per-minute and per-day usage limits and a per-user daily AI budget.\n\nApproximate location: when you grant location permission, we use your device location only while the app is in the foreground to surface nearby restaurants and to show your position on the map. We do not track your location in the background.\n\nLocal storage on mobile: equivalent on-device storage (such as AsyncStorage) is used for session, authentication, and preferences. Optional analytics and marketing communications are governed by your in-app notification preferences (Profile → Privacy) and any marketing consent you give to individual restaurants, which we record in a consent log.\n\nCookies on the web: our website uses essential storage for session and authentication, and — only with your consent — optional analytics and marketing storage. You can change your preferences any time in the cookie banner on the web app.\n\nWe do not currently respond to \"Do Not Track\" or \"Global Privacy Control\" signals; you can achieve the same outcome by turning off optional analytics and marketing in your Profile → Privacy settings on mobile or in the cookie banner on the web.",
  },
  {
    id: "cenaiva-ai",
    number: "4",
    title: "Cenaiva AI — voice, chat, and automated decisions",
    body: "Cenaiva AI lets you discover restaurants and book tables by voice or chat. It relies on third-party AI providers: OpenAI for language understanding, Deepgram for speech-to-text, ElevenLabs for text-to-speech, and — for receipt and photo scanning — OpenAI vision. On some devices, speech recognition may be handled on-device by Apple or Google in accordance with their own policies.\n\nWhen you use a voice session, we capture audio from your microphone, transcribe it to text, send the text and recent conversation context to the AI provider, and play the generated response back as audio. Chat sessions follow the same flow without the audio step.\n\nRetention. We do not retain voice recordings or transcripts in our own systems beyond the active conversation. AI providers (OpenAI, Deepgram, ElevenLabs) process your input solely to return a response to us, under API terms that prohibit them from using your data to train their models and require deletion or anonymization of any retained material on a short rolling window. Chat messages may be retained briefly to preserve conversation context within a session and are not persisted across sessions in identifiable form. You may request review or deletion of any data we hold at privacy@cenaiva.com; verified requests are completed within 30 days.\n\nQuality monitoring. We automatically score a sample of AI conversations and, in limited cases, have staff review individual exchanges so we can detect errors, unsafe responses, and policy violations. Reviewers see only the conversation, not your account password or payment data.\n\nReceipt and photo scanning. Images you submit to the receipt or photo scanner are sent to OpenAI's vision model to extract structured data (merchant, total, line items, date). The extracted data is stored on your account; the image itself is retained only as long as needed to validate the scan and is then deleted on a rolling schedule.\n\nAutomated profiling. We derive a no-show risk score, behavioural tags (for example, \"frequent diner\"), and a lifetime value estimate from your booking and visit history. Each of these signals is shared only with a restaurant when you actively book or visit that restaurant — it is not shared across the network. Restaurants may use the no-show risk score to decide whether to require a deposit. Cenaiva does not use these signals to refuse you access to the app. You can ask us to review or correct an automated tag or score at privacy@cenaiva.com; we maintain a data correction request log so we can track and respond to every request.\n\nUse for AI improvement. We use aggregated, de-identified data derived from your interactions to evaluate and improve our own AI features. We do not use the content of your conversations to train AI models that we offer to third parties, and we do not sell your conversations to AI providers. Third-party providers (OpenAI, Deepgram, ElevenLabs) process your input solely to return a response to us, under API terms that prohibit them from using your data to train their own models.",
  },
  {
    id: "how-we-use",
    number: "5",
    title: "How we use your information",
    body: "To deliver the Services: create and authenticate your account, hold and confirm reservations, process deposits and payments, run Cenaiva AI, send booking reminders and waitlist notifications, and operate the receipt and photo scanner.\n\nTo keep you and the platform safe: detect fraud and abuse, enforce rate limits and per-user AI budgets, log new-device sign-ins, send security alerts, and maintain an internal audit trail of sensitive actions.\n\nTo improve the Services: aggregate analytics, A/B test new features, diagnose crashes, and review a sample of AI conversations for accuracy and safety.\n\nTo communicate with you: send transactional messages (booking confirmations, one-time passcodes, security alerts, refund updates) by push, email, or SMS. We send promotional messages only where you have separately opted in, and you can withdraw consent at any time without affecting transactional messages.\n\nTo meet legal and tax obligations: keep records required by tax, accounting, payments, and consumer protection law, respond to lawful requests from regulators or courts, and enforce our Terms.",
  },
  {
    id: "legal-bases",
    number: "6",
    title: "Legal bases (where applicable)",
    body: "For users in jurisdictions that require a legal basis (for example, Quebec under Law 25), we rely on: your consent (for voice capture, optional analytics, marketing communications, and the optional sharing of your data with individual restaurants); performance of our contract with you (account, reservations, payments, support); compliance with a legal obligation (tax, financial record-keeping, regulator requests); and our legitimate interests in operating, securing, and improving the Services in a way that does not override your fundamental rights.",
  },
  {
    id: "how-we-share",
    number: "7",
    title: "How we share your information",
    body: "With restaurants you book or visit: your first and last name, contact details, party size, time, special requests, allergy notes, visit history at that restaurant, the no-show risk score, lifetime value estimate, and any behavioural tags relevant to hosting you. Restaurants act as independent controllers of the guest records they keep about you and are bound by data-use restrictions in the Restaurant Partner Agreement.\n\nWith other guests in a group deposit: when a booking organizer invites you to contribute to a deposit, we share the organizer's name, restaurant, booking time, and amount due, and we process your individual contribution through Stripe.\n\nWith service providers we rely on to run the Services: Supabase (database, authentication, edge functions), Stripe and Stripe Canada (payment processing, saved cards via tokenization, deposit collection on behalf of restaurants), OpenAI (language and vision), ElevenLabs (text-to-speech), Deepgram (speech-to-text), Twilio (SMS and one-time passcodes), Resend (transactional email), Expo / EAS (mobile delivery and push notifications), PostHog (product analytics), Sentry (error monitoring), Amazon Web Services (web hosting), Google (OAuth sign-in, Maps Platform, and on Android, push and on-device speech), and Apple (Sign in with Apple and on iOS, push and on-device speech). Each provider is contractually limited to using your data to deliver its service to us.\n\nA current and dated list of our sub-processors is published at cenaiva.com/legal/sub-processors and also appears in Schedule A below. We will give at least 30 days' notice in the app or by email before adding a sub-processor that processes personal information in a materially new way.\n\nFor legal reasons: where we believe in good faith that disclosure is required by law, court order, or regulator request, or is necessary to investigate fraud, protect the safety of users, or enforce our Terms.\n\nIn a corporate transaction: if Cenaiva is involved in a merger, acquisition, financing, or sale of assets, your information may be transferred to the surviving or acquiring entity, subject to this Policy or a notice of any material change.\n\nWe do not sell your personal information. We do not share your personal information with third-party advertisers for cross-context behavioural advertising.",
  },
  {
    id: "international-transfers",
    number: "8",
    title: "International data transfers",
    body: "Cenaiva is based in Canada. Several of our service providers process personal information outside Canada, including in the United States and the European Union. This includes OpenAI, ElevenLabs, Deepgram, Stripe, Twilio, Resend, PostHog, Sentry, Amazon Web Services, Google, and Apple.\n\nData transferred outside Canada may be subject to the laws of the receiving jurisdiction, which may differ from Canadian privacy law. We require each provider to maintain commercially reasonable safeguards, including contractual data protection terms, and we evaluate the privacy practices of new providers before adding them.\n\nBy using the Services — and in particular Cenaiva AI — you consent to these transfers.",
  },
  {
    id: "data-retention",
    number: "9",
    title: "Data retention",
    body: "- Account, reservations, visit history, reviews, and visit photos: retained while your account is active, and deleted or anonymized when you delete your account, except where retention is required by law (for example, tax and financial records).\n- Snap social posts: retained while your account is active and you have not removed the Snap. When you delete a Snap from the app, it is removed from your account within 30 days. Account deletion removes all your Snaps.\n- Voice recordings, transcripts, and chat messages: retained while your account is active so you can review past conversations, with up to 90 days of additional safety review for sampled material. You may request earlier deletion at any time.\n- Sign-in events, audit logs, and security findings: retained for up to 24 months to investigate fraud and security incidents, then deleted or further aggregated.\n- Crash and error reports: typically retained for 30 days and then purged automatically.\n- Payment records and tax-related transaction history: retained for the period required by Canadian tax and consumer protection law (generally six years).\n- Backups: encrypted point-in-time backups are typically retained for up to 7 days, until the backup itself is overwritten.\n- Aggregated and anonymized data — meaning data from which it is no longer possible, in light of reasonably foreseeable means, to identify you — may be retained indefinitely for analytics and product improvement. Depersonalized data that may still allow re-identification is treated as personal information for retention purposes.",
  },
  {
    id: "your-rights",
    number: "10",
    title: "Your rights and choices",
    body: "Depending on where you live — including under Canada's PIPEDA and Quebec Law 25 — you may have the right to:\n\n- Access the personal information we hold about you.\n- Correct information that is inaccurate or incomplete.\n- Withdraw consent for processing that is based on consent (such as voice capture, optional analytics, marketing communications, or sharing with a specific restaurant).\n- Request portability of your personal data in a structured, commonly used format.\n- Request review or correction of an automated decision or profile (no-show risk, lifetime value, behavioural tags).\n- Request deletion of your account and associated personal information.\n\nRight of human review (Quebec Law 25). Where a decision concerning you is made exclusively on the basis of automated processing of your personal information (for example, a no-show risk score that triggers an automatic deposit requirement), you may, on request, obtain a human review of that decision and the opportunity to present your observations.\n\nHow to exercise these rights. Contact privacy@cenaiva.com. We respond within 30 days, with extension as permitted by law. We may ask you to verify your identity by confirming details associated with your account before we act. We may refuse or limit a request that is manifestly unfounded, excessive, or that would reveal personal information about another person — where we refuse, we will tell you why and how to escalate.\n\nIn-app privacy controls. You can also manage your data directly in the app:\n\nOn mobile:\n- Profile → Privacy — delete account, download account data, personalized recommendations toggle, ad personalization toggle, analytics & crash reporting toggle.\n- Profile → Notifications — push, email, and SMS preferences by category.\n- Profile → Restaurant Communications — per-restaurant marketing preferences.\n\nOn web:\n- Account → Preferences → Privacy — analytics tracking and marketing communications toggles, and the Delete my account control.\n- Account → Preferences → My data — download your data, see what restaurants see, or request a correction.\n- Account → Preferences → Sign-in history — review recent sign-ins and sign out of every device.\n\nYou can also disable location, microphone, camera, or photo access in your device settings, reply STOP to opt out of transactional SMS, and adjust cookie preferences from the banner on the web app.\n\nIf you have an unresolved concern, you may contact the Office of the Privacy Commissioner of Canada (priv.gc.ca) or, if you live in Quebec, the Commission d'accès à l'information du Québec (cai.gouv.qc.ca).",
  },
  {
    id: "account-deletion",
    number: "11",
    title: "Account deletion — what happens",
    body: "When you delete your account — on mobile, navigate to Profile → Privacy → Delete Account; on web, navigate to Account → Preferences → Privacy → Delete my account — we permanently remove your account record, detach saved payment methods at Stripe, cancel any active subscriptions, and delete or scrub your personal data across reservations, visits, chats, orders, surveys, Snaps, and other linked records. Deletion is irreversible — once you confirm, your booking history, conversation history, and personal data cannot be restored.\n\nUnredeemed in-app rewards and any prepaid wallet balance are forfeited at deletion — withdraw or use any remaining balance first if you want to keep it.\n\nIn-progress dining exception. If you are currently seated or arriving at a restaurant at the moment you delete your account, that reservation row is retained with your identity removed so the restaurant can close the bill. The reservation is no longer linked to you afterward and is not used for any other purpose.\n\nInformation we are required to retain by law (for example, tax and payments records) is preserved for the minimum period required and is not used for any other purpose.\n\nAccount merges. If you sign in using two different methods that we determine belong to the same person (for example, an email and a phone number), we may offer to merge the accounts. A minimal audit record of any merge is retained for fraud prevention.",
  },
  {
    id: "security",
    number: "12",
    title: "Security",
    body: "Personal information is stored in Supabase Postgres with row-level security policies enforcing per-user access. Passwords are stored only as salted hashes by our auth provider. Payment cards are stored only as tokens at Stripe, a PCI-DSS Level 1 service provider. Transport is encrypted with TLS.\n\nWe log sensitive actions to an append-only audit trail, monitor unusual sign-in behaviour, and send a security alert when we detect a sign-in from a new or unrecognized device. We run automated security scans against our database and review findings on a regular cadence.\n\nCenaiva personnel access to your personal information is logged in an append-only audit trail, role-restricted under the principle of least privilege, and limited to support, safety, security, and quality-review purposes. Access is reviewed on a periodic basis.\n\nBreach notification. No system is perfectly secure. Where an incident creates a real risk of significant harm, we will notify affected users and the relevant regulators (the Office of the Privacy Commissioner of Canada and, where applicable, the Commission d'accès à l'information du Québec) without unreasonable delay, and in any event within 72 hours of becoming aware of the breach.\n\nReporting a vulnerability. If you discover a security vulnerability in the Services, please report it in good faith to security@cenaiva.com. We will not pursue legal action against good-faith security researchers who report vulnerabilities responsibly and do not access or modify other users' data.",
  },
  {
    id: "children",
    number: "13",
    title: "Children",
    body: "Cenaiva is intended for users 16 and over. We do not knowingly collect personal information from children under 16. Users between 16 and 18 may use the Services only with parental or guardian consent, and users who make payments, hold a wallet balance, or buy event tickets must be 18 or have express parental authorization.\n\nIf you believe a child under 16 has provided us personal information without parental consent, contact privacy@cenaiva.com and we will promptly investigate and, where appropriate, delete the information.",
  },
  {
    id: "marketing-communications",
    number: "14",
    title: "Marketing and communications",
    body: "Transactional messages (booking confirmations, one-time passcodes, security alerts, refund and waitlist updates) are sent by push, email, or SMS as needed to operate your account. Disabling these may break booking, sign-in, or security features.\n\nPromotional emails and per-restaurant marketing messages are only sent where you have opted in. Each marketing opt-in (per restaurant, per channel) is recorded in our subscription consent log so we have a verifiable record of when and how you consented, as Canada's Anti-Spam Legislation (CASL) requires. You can opt out at any time in the app, by replying STOP to an SMS, or by using the unsubscribe link in an email — this does not affect transactional messages.\n\nWe do not sell your contact information to advertisers and do not use it for cross-context behavioural advertising.",
  },
  {
    id: "third-party-links",
    number: "15",
    title: "Third-party links and services",
    body: "The Services may link to third-party websites or services we do not control (for example, when you share a Snap to Instagram, TikTok, Snapchat, or YouTube, or open a restaurant's own website). This Policy does not apply to those third parties, and we are not responsible for their privacy practices. Review their privacy policies before using them.",
  },
  {
    id: "changes-to-policy",
    number: "16",
    title: "Changes to this Policy",
    body: "We may update this Policy from time to time. For minor changes, we will update the \"Last updated\" date at the top. For material changes, we will give at least 30 days' notice by in-app message or email before the change takes effect, and where required by law we will ask for your renewed consent. Prior versions are available on request at privacy@cenaiva.com.",
  },
  {
    id: "related-documents",
    number: "17",
    title: "Related documents",
    body: "- Consumer Terms of Service: cenaiva.com/terms\n- Restaurant Partner Agreement (the contract every restaurant on Cenaiva accepts): cenaiva.com/partners/agreement\n- Sub-processor list: cenaiva.com/legal/sub-processors",
  },
  {
    id: "contact",
    number: "18",
    title: "Contact",
    body: "- Privacy questions and rights requests: privacy@cenaiva.com\n- General support: help@cenaiva.com\n- Legal and intellectual property complaints: legal@cenaiva.com\n- Security vulnerability reports: security@cenaiva.com\n\nCenaiva is operated from Canada. Support is available in English and French. Le soutien est offert en anglais et en français.",
  },
];
