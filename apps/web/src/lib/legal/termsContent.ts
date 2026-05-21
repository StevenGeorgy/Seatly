// Cenaiva — Terms of Service (Consumer)
// Source of truth for the legal text rendered on /terms.
// Do NOT edit punctuation, casing, or wording without legal review.

export type TermsSection = {
  id: string;
  number: string;
  title: string;
  body: string;
};

export const TERMS_VERSION = "2026-05-21";
export const TERMS_EFFECTIVE_DATE = "May 10, 2026";
export const TERMS_LAST_UPDATED = "May 21, 2026";

export const TERMS_INTRO =
  "Welcome to Cenaiva. These Terms of Service (\"Terms\") govern your access to and use of the Cenaiva mobile application and related services (\"Services\") as a consumer or diner. Restaurant partners and operators are subject to a separate Restaurant Partner Agreement. By creating an account or using the Services, you agree to be bound by these Terms. If you do not agree, you must stop using the Services immediately.";

export const TERMS_SECTIONS: TermsSection[] = [
  {
    id: "eligibility",
    number: "1",
    title: "Eligibility",
    body: "You must be at least 16 years old to use Cenaiva. If you are between 16 and 18 years of age, you confirm that you have obtained consent from a parent or legal guardian, and that your parent or guardian agrees to these Terms on your behalf.\n\nUsers who make payments, use wallet features, redeem rewards with monetary value, or purchase event tickets must be at least 18 years old, or have express parental authorization to do so.\n\nBy using the Services, you confirm that you meet the applicable eligibility requirements and that you are not prohibited from using the Services under the laws of any applicable jurisdiction.",
  },
  {
    id: "account-registration",
    number: "2",
    title: "Account Registration",
    body: "To access certain features, you must create an account. You agree to:\n\n- Provide accurate, complete, and up-to-date information, including your name, email address, and phone number where requested\n- Keep your login credentials confidential and secure\n- Be solely responsible for all activity that occurs under your account\n- Notify us immediately at help@cenaiva.com if you suspect unauthorized access to your account\n\nWe reserve the right to suspend or terminate accounts that provide false information, violate these Terms, or have been inactive for an extended period.\n\nYou may sign in using email/password, phone number (OTP), or Google OAuth. By using a third-party sign-in method, you authorize us to access and use certain information from that provider in accordance with our Privacy Policy.\n\nIf you have previously created an account using a different sign-in method (for example, once with email and once with a phone number), Cenaiva may detect and offer to merge duplicate accounts associated with the same identity. An audit record of any account merge is retained for fraud prevention and support purposes. You may contact us at help@cenaiva.com if you believe an account merge occurred in error.",
  },
  {
    id: "account-deletion",
    number: "3",
    title: "Account Deletion",
    body: "You may delete your Cenaiva account at any time directly within the app by navigating to Profile → Privacy → Delete Account. You may also request account deletion by contacting us at help@cenaiva.com.\n\nUpon deletion:\n\n- Your account and personal profile information will be permanently removed from our active systems\n- Any unused wallet balance will be handled in accordance with applicable law and Section 11.3 (Refunds and Cancellations) prior to deletion — we recommend withdrawing or using any remaining balance before initiating deletion\n- Any unredeemed rewards, loyalty points, or Snap rewards are forfeited upon deletion and cannot be recovered\n- Saved payment methods (tokenized references stored by Stripe) will be detached from your account\n- Account deletion is irreversible. Once deleted, your account, booking history, conversation history, and associated data cannot be restored\n\nCertain data may be retained for a limited period following deletion where required by law, including for tax, financial record-keeping, fraud prevention, or legal compliance purposes. Such retained data will not be used for any other purpose and will be deleted once the applicable retention period expires. Anonymized or aggregated data derived from your usage may be retained indefinitely as it cannot be used to identify you.",
  },
  {
    id: "bookings-how-it-works",
    number: "4.1",
    title: "How Bookings Work",
    body: "Cenaiva allows users to browse restaurants and make reservation requests through the platform. Reservations are requests and are subject to confirmation by the restaurant. You are responsible for arriving on time and honouring your reservation. Repeated no-shows or cancellations without reasonable notice may result in account restrictions or suspension.\n\nCenaiva is a technology platform connecting diners with restaurants and is not a party to any agreement between you and a restaurant. Restaurants listed on Cenaiva operate independently under their own Restaurant Partner Agreement. Any disputes regarding dining experiences, service, or food quality should be directed to the restaurant directly.",
  },
  {
    id: "reservation-holds",
    number: "4.2",
    title: "Reservation Holds (Cart System)",
    body: "To secure your preferred time slot during the booking process, Cenaiva temporarily reserves (\"holds\") your selected slot for a limited period while you complete your booking details and any required payment. During this hold period:\n\n- The slot is reserved exclusively for you and is unavailable to other users\n- A Stripe payment intent may be created to facilitate any required deposit\n- If you do not complete your booking before the hold expires, the hold is automatically released and the slot becomes available to others — no charge is made\n- Completing the booking converts the hold into a confirmed reservation\n\nCenaiva is not liable for a slot becoming unavailable if your hold expires before you complete the booking.",
  },
  {
    id: "availability-alerts",
    number: "4.3",
    title: "Availability Alerts",
    body: "Cenaiva allows you to sign up for availability alerts for specific restaurants, dates, party sizes, or time windows. If availability opens that matches your criteria, we will notify you via push notification. Availability alerts expire automatically once the requested date has passed, do not guarantee that availability will open, and can be cancelled at any time in the app.",
  },
  {
    id: "group-deposit-invitations",
    number: "4.4",
    title: "Group Deposit Invitations",
    body: "For certain bookings requiring a deposit, Cenaiva may allow the booking organizer to invite other members of their party to contribute to the deposit payment. When deposit invitations are sent:\n\n- Invited guests receive a secure link to contribute their portion of the deposit\n- Each participant's contribution is processed independently through Stripe\n- You are responsible for ensuring that any phone numbers or email addresses you provide for invitations belong to the intended recipients\n- Cenaiva is not responsible for uncollected deposit contributions from invited guests",
  },
  {
    id: "ai-risk-scoring",
    number: "4.5",
    title: "AI-Assisted Risk Scoring",
    body: "Cenaiva uses automated systems to calculate a no-show risk score for reservations based on your historical booking behaviour on the platform. This score is visible to restaurant partners and may be used by them to make decisions about your reservation, including whether to require a deposit. Cenaiva does not use this score to deny access to the platform. If you believe your score is inaccurate, you may contact us at privacy@cenaiva.com.",
  },
  {
    id: "restaurant-responsibility",
    number: "5",
    title: "Restaurant Responsibility and Food Safety",
    body: "Restaurants listed on Cenaiva are independent businesses solely responsible for:\n\n- Food preparation, safety, allergen management, and ingredient accuracy\n- Menu content, pricing, and availability\n- Service quality, wait times, and seating\n- Honouring bookings, deposits, and pre-orders\n- Cancellations or changes to reservation availability\n\nCenaiva may display menu items, ingredients, dietary labels, allergen information, or other restaurant-provided content. Cenaiva does not verify or guarantee the accuracy of this information. Users with allergies, dietary restrictions, or specific health requirements must confirm all relevant details directly with the restaurant before ordering or consuming any food or beverage. Reliance on information displayed in the app without independent confirmation is at your own risk.\n\nCenaiva is strictly a technology intermediary. We are not a party to any transaction between you and a restaurant, and we bear no responsibility for anything that occurs at or in connection with a restaurant venue, including cancellations, service failures, food quality, allergen incidents, or pricing disputes.\n\nNote: Allergy incident reports submitted through the platform are logged for restaurant record-keeping purposes only and are not a substitute for emergency medical care. If you experience a medical emergency, call 911 immediately.",
  },
  {
    id: "cenaiva-ai-how",
    number: "6.1",
    title: "Cenaiva AI — How It Works",
    body: "Cenaiva offers an AI-powered assistant (\"Cenaiva AI\") that allows you to discover restaurants, make reservations, join waitlists, and interact with the platform through natural voice conversation and text chat. Cenaiva AI uses third-party artificial intelligence and voice services, including OpenAI (language processing), ElevenLabs (text-to-speech), and Deepgram (speech-to-text), or your device's built-in speech recognition processed by Apple or Google in accordance with their respective privacy policies.\n\nWhen you use Cenaiva AI:\n\n- Your voice input is captured via your device's microphone\n- Your speech is transcribed to text and sent to our AI processing services\n- Voice recordings, transcripts, and chat messages are stored while your account is active so you can review past conversations; up to 90 days of additional safety review applies for sampled material, after which it is deleted or anonymized. All voice and chat data is deleted upon account deletion or upon your verified request\n- Responses are generated by AI and delivered as synthesized voice or text\n- Some AI providers process your data outside Canada, including in the United States — see Section 18 for details\n\nBy using voice features, you consent to the capture, transcription, processing, and storage of your voice interactions as described above. An in-app notice will be displayed before your first voice interaction confirming this consent. You may select your preferred AI voice in app settings. Users may change their preferred language in app settings.",
  },
  {
    id: "ai-accuracy",
    number: "6.2",
    title: "AI Accuracy, Hallucinations, and Limitations",
    body: "Cenaiva AI can and does make mistakes. AI systems — including ours — can produce incorrect, incomplete, or entirely fabricated outputs, commonly referred to as \"hallucinations.\" You acknowledge and agree that:\n\n- AI-generated responses may contain errors, omissions, or factually incorrect information — including incorrect restaurant details, availability, pricing, hours, or menu content\n- You should always verify any booking, restaurant detail, or reservation confirmation directly in the app or with the restaurant before relying on it\n- Reservations, waitlist entries, or other actions taken through Cenaiva AI are subject to the same confirmation and availability requirements as manual bookings\n- Cenaiva is not liable for any losses or inconveniences arising from AI errors, hallucinated information, misunderstood instructions, or automated actions taken on your behalf\n- AI-generated menu suggestions, dietary information, or allergen details are not verified by Cenaiva and must always be confirmed directly with the restaurant",
  },
  {
    id: "ai-quality-monitoring",
    number: "6.3",
    title: "AI Quality Monitoring",
    body: "Cenaiva monitors the quality of AI responses to improve the platform. A sample of AI conversations may be scored and reviewed by automated systems or Cenaiva staff for accuracy, safety, and compliance with our policies. This review is used solely for service improvement and is governed by our Privacy Policy.",
  },
  {
    id: "ai-auto-tagging",
    number: "6.4",
    title: "AI Auto-Tagging and Guest Profiling",
    body: "Cenaiva uses automated AI systems to analyse your booking history, preferences, and behaviour to generate guest tags and a lifetime value score. These are used to personalize your experience and are visible to restaurant partners when you make a reservation at their venue. Tags reflect general behavioural categories only (for example, \"frequent diner\") and do not include sensitive personal characteristics. You may contact us at privacy@cenaiva.com to request a review or correction of automated profiling associated with your account.",
  },
  {
    id: "voice-data-deletion",
    number: "6.5",
    title: "Voice Data Deletion",
    body: "You may request deletion of your stored voice recordings and transcripts at any time by contacting us at privacy@cenaiva.com. Requests will be processed within 30 days. Deletion of voice data does not delete your account or booking history.",
  },
  {
    id: "receipt-photo-scanning",
    number: "6.6",
    title: "Receipt and Photo Scanning",
    body: "Cenaiva may allow you to scan receipts or photos using your device camera. Images submitted for scanning are processed via AI vision services. By submitting an image, you confirm you have the right to share it and consent to its processing.",
  },
  {
    id: "post-visit-photo-prompts",
    number: "7.1",
    title: "Post-Visit Photo Prompts",
    body: "After a completed dining session, Cenaiva may send you a push notification or in-app prompt inviting you to share a photo or review from your visit. These prompts are optional and can be disabled in your notification settings.",
  },
  {
    id: "visit-photos",
    number: "7.2",
    title: "Visit Photos and Story Filters",
    body: "Cenaiva allows you to upload photos from your dining visits, optionally enhanced with in-app story filters. By uploading a visit photo:\n\n- Your image is stored on Cenaiva's servers and associated with your reservation record\n- You grant Cenaiva a non-exclusive, royalty-free licence to display the photo in connection with your account and, where you choose to share it publicly, on the platform\n- You confirm you have the right to share the image and, where it features other people, that you have obtained any necessary consent\n- Story filter metadata (filter type and timestamp) is stored alongside the image",
  },
  {
    id: "restaurant-reviews",
    number: "7.3",
    title: "Restaurant Reviews",
    body: "After a completed visit, you may be prompted to leave a star rating and written review. Reviews are shared with the restaurant and may be displayed on the restaurant's Cenaiva profile. Cenaiva reserves the right to remove reviews that violate Section 13 (User Conduct) or that we reasonably believe are false, misleading, or submitted in bad faith.",
  },
  {
    id: "surveys",
    number: "7.4",
    title: "Surveys",
    body: "Cenaiva may invite you to complete optional in-app surveys about your dining experience. Survey responses are used for service improvement. Participation is entirely voluntary.",
  },
  {
    id: "social-posts-snaps",
    number: "8.1",
    title: "Social Posts and Snaps",
    body: "Cenaiva allows you to create and share social content (\"Snaps\") including photos, captions, and dining moments. When you submit a Snap:\n\n- Your content is stored on Cenaiva's servers\n- You grant Cenaiva a non-exclusive, worldwide, royalty-free, sublicensable licence to display, reproduce, and promote your Snap within the platform and in connection with Cenaiva's marketing and promotional activities, for so long as the Snap remains on the platform plus a reasonable period thereafter for backup and archival purposes\n- You represent that you own or have the right to share any content you submit, including photos featuring other people\n- You may not submit content that is defamatory, obscene, misleading, hateful, violates the privacy of others, or that infringes the rights of any third party\n\nWhen you share a Snap to third-party platforms such as Instagram, TikTok, Snapchat, or YouTube, those platforms' terms of service govern your content once it leaves Cenaiva. We are not responsible for how third-party platforms handle, display, or distribute your content.",
  },
  {
    id: "content-moderation",
    number: "8.2",
    title: "Content Moderation and Removal",
    body: "Cenaiva may remove, restrict, or refuse any content at its sole discretion, with or without notice, where we determine that content violates these Terms, is inappropriate, misleading, unsafe, potentially unlawful, or infringes the rights of any third party. Users may request removal of their own content at any time by contacting legal@cenaiva.com.",
  },
  {
    id: "ip-complaints",
    number: "8.3",
    title: "Intellectual Property Complaints",
    body: "If you believe that content on Cenaiva infringes your copyright, violates your privacy rights, or is otherwise unlawful, submit a complaint to legal@cenaiva.com. Your complaint must include: your full name and contact information; identification of the content at issue and its location within the app; a description of the right you claim is being infringed; a statement of good faith belief that the use is not authorized; and a statement that the information in your notice is accurate. Upon receipt of a valid complaint, Cenaiva will review the content and may remove it, notify the posting user, and take further action as appropriate.",
  },
  {
    id: "snap-rewards",
    number: "8.4",
    title: "Snap Rewards",
    body: "Cenaiva may award rewards, points, or credits for completing Snaps or other in-app activities. Rewards are granted at Cenaiva's sole discretion and subject to verification of the underlying activity. Rewards have no cash value unless explicitly stated otherwise. Submitting false, duplicate, or fabricated content to earn rewards constitutes abuse and may result in forfeiture of all rewards and account suspension. Rewards are non-transferable and may not be combined with other offers unless specified.",
  },
  {
    id: "loyalty-tiers",
    number: "9.1",
    title: "Loyalty Tiers",
    body: "Cenaiva offers a loyalty program with tiered benefits based on activity. Tier status, benefits, and qualification criteria are set by Cenaiva and may be updated from time to time with reasonable notice. Tier status is non-transferable and has no monetary value.",
  },
  {
    id: "loyalty-waitlist",
    number: "9.2",
    title: "Loyalty Waitlist",
    body: "Certain loyalty program features may be in limited release. If a feature is not yet available to your account, you may join a waitlist. Joining the waitlist does not guarantee access. Cenaiva will notify you via email if and when access becomes available.",
  },
  {
    id: "referrals",
    number: "9.3",
    title: "Referrals",
    body: "Cenaiva may offer referral incentives for inviting new users. Both the referring user and the referred user must meet eligibility requirements. Referred users must be genuinely new to the platform. Referral abuse — including the creation of fake accounts or self-referrals — will result in forfeiture of rewards and may result in account termination. Cenaiva reserves the right to modify or discontinue the referral program at any time.",
  },
  {
    id: "wallet",
    number: "10",
    title: "Wallet (Prepaid Balance)",
    body: "Cenaiva may offer a digital wallet feature that allows you to maintain a prepaid balance for use within the platform. Wallet balances:\n\n- May be loaded via Stripe-processed payments\n- Are non-transferable between accounts\n- Are not redeemable for cash unless required by applicable law\n- Do not expire and are handled in accordance with applicable provincial gift-card and prepaid balance legislation, including the laws of Ontario, British Columbia, and Quebec where applicable\n\nIf your account is terminated for a violation of these Terms, we may restrict access to wallet features while we investigate. If your account is terminated by Cenaiva without cause, we will make reasonable efforts to refund any unused prepaid balance. We are not responsible for unauthorized use of your wallet balance where your account credentials are compromised due to your own negligence.",
  },
  {
    id: "pricing-transparency",
    number: "11.1",
    title: "Pricing Transparency",
    body: "Cenaiva will display all applicable charges — including platform fees, per-booking fees, pre-order fees, deposits, service fees, and restaurant-specific charges — before checkout. You will have an opportunity to review and confirm the total amount, including applicable taxes (GST/HST/QST/PST as indicated at checkout), before completing any payment. We do not add mandatory fees after you have confirmed your order.",
  },
  {
    id: "payment-processing",
    number: "11.2",
    title: "Payment Processing and Saved Cards",
    body: "All payments are processed securely through Stripe. By making a payment, you agree to Stripe's Terms of Service.\n\nWhen you save a payment method in Cenaiva:\n\n- Your card is tokenized and securely stored by Stripe — Cenaiva stores only a tokenized reference, your card brand, the last 4 digits of your card number, and the expiry month and year\n- Cenaiva never stores your full card number, CVV, or any other sensitive card data on our servers — this information never touches our systems\n- Your full payment card information is handled entirely by Stripe\n\nCenaiva is the merchant of record for all charges processed through the Platform. Cenaiva may earn a platform fee on transactions as disclosed at checkout. Cenaiva is not liable for any issues arising from Stripe's systems — any concerns about payment processing should be raised with us at help@cenaiva.com and we will investigate promptly.",
  },
  {
    id: "refunds-cancellations",
    number: "11.3",
    title: "Refunds and Cancellations",
    body: "Refunds for restaurant-specific charges (deposits, pre-orders, event tickets) are subject to that restaurant's refund policy, which will be displayed at the time of booking where applicable. Cenaiva platform fees are non-refundable except where required by applicable law or where the booking failure is due to a verified technical error on our part. In the event of a restaurant cancellation, Cenaiva will make reasonable efforts to facilitate a refund of any pre-paid amounts processed through the platform. For duplicate charges or verified failed transactions, contact help@cenaiva.com and we will investigate and resolve within 5 business days. Wallet top-ups are non-refundable except as required by applicable law.",
  },
  {
    id: "gift-cards",
    number: "11.4",
    title: "Gift Cards",
    body: "Cenaiva may offer digital gift cards for use within the platform. Gift cards are issued with a set initial value and can be applied at checkout. They are non-transferable, cannot be redeemed for cash unless required by applicable law, and cannot be replaced if lost or stolen — treat gift card codes as you would cash. Gift cards may have expiry dates as indicated at the time of purchase.",
  },
  {
    id: "events-ticketing",
    number: "11.5",
    title: "Events and Ticketing",
    body: "Cenaiva may allow restaurants to list events and sell tickets through the platform. When you purchase an event ticket:\n\n- Payment is processed through Stripe and subject to the event's specific refund and cancellation policy, displayed at checkout\n- Tickets are linked to your Cenaiva account and cannot be transferred unless the event specifically permits it\n- Cenaiva is not responsible for event cancellation, changes to event details, or failure by the restaurant to deliver the event as described — such disputes must be directed to the restaurant directly\n- Cenaiva will make reasonable efforts to facilitate refunds where an event is cancelled by the restaurant",
  },
  {
    id: "chargebacks",
    number: "11.6",
    title: "Chargebacks",
    body: "In the event of a disputed charge, please contact us at help@cenaiva.com before initiating a chargeback. Chargebacks initiated in bad faith, without prior contact, may result in account suspension.",
  },
  {
    id: "restaurant-communications",
    number: "12",
    title: "Restaurant Communications and Guest Data Sharing",
    body: "By making a reservation or becoming a guest at a restaurant through Cenaiva, certain information about you — including your name, contact details, dining preferences, allergy information, visit history, and AI-generated tags associated with your account — is shared with that restaurant. Restaurants may use this information to:\n\n- Manage your reservations and dining experience\n- Send you birthday or anniversary messages if you have provided relevant dates and opted in to communications from that restaurant\n- Send you targeted marketing messages through Cenaiva's platform, subject to your notification preferences\n\nYou may manage your communication preferences with individual restaurants in the app. Opting out of marketing communications from a restaurant does not affect transactional messages related to your active reservations with that restaurant.\n\nCenaiva does not sell your personal information to restaurants or third parties. Data shared with restaurants through the platform is used solely to facilitate your dining experience and communications as described above.",
  },
  {
    id: "user-conduct",
    number: "13",
    title: "User Conduct",
    body: "You agree not to use the Services to:\n\n- Engage in unlawful, fraudulent, or deceptive activity\n- Interfere with or disrupt the security or operation of the Services\n- Abuse, harass, threaten, or harm other users or restaurant partners\n- Post false, misleading, defamatory, or infringing content, including reviews\n- Submit fabricated Snaps, fake bookings, or manipulate rewards or referral systems\n- Interact with Cenaiva AI in a manner intended to manipulate, deceive, or extract harmful outputs from the system\n- Attempt to gain unauthorized access to any part of the platform, servers, or databases\n- Scrape, copy, or reverse-engineer any part of the Services\n- Use automated tools, bots, or scripts to interact with the platform\n- Impersonate any person or entity or misrepresent your affiliation with any person or entity\n- Manipulate the reservation hold system to block availability without genuine intent to book\n\nViolation of these conduct standards may result in immediate account suspension or termination without notice, forfeiture of earned rewards, and restriction of wallet access while we investigate. Any unused wallet balance will be handled in accordance with applicable law and Section 11.3.",
  },
  {
    id: "account-security",
    number: "14",
    title: "Account Security and Device Monitoring",
    body: "To protect you from unauthorized access, Cenaiva:\n\n- Records sign-in events including device fingerprint, platform, app version, and sign-in time\n- Sends a security alert via push notification or email when we detect a sign-in from a new or unrecognized device\n- May temporarily lock your account following multiple failed sign-in attempts\n\nYou are responsible for maintaining the security of your credentials. If you receive a new device sign-in alert that you do not recognize, contact us immediately at help@cenaiva.com.\n\nCenaiva maintains a comprehensive audit log of actions taken within the platform for security, fraud prevention, and compliance purposes. This log is not used for any purpose beyond security and legal compliance.\n\nVulnerability disclosure. If you believe you have discovered a security vulnerability in the Services, please report it in good faith to security@cenaiva.com. Cenaiva will not pursue legal action against good-faith security researchers who report vulnerabilities responsibly and do not access or modify other users' data.",
  },
  {
    id: "device-permissions",
    number: "15",
    title: "Device Permissions and Data Collection",
    body: "To provide the full Cenaiva experience, the app may request access to:\n\n- Microphone and Speech Recognition — required for the Cenaiva AI voice agent\n- Camera and Photo Library — required for Snaps, visit photos, and receipt scanning\n- Location (when-in-use only) — used to surface nearby restaurants and provide mapping features. Cenaiva does not access your location in the background\n- Push Notifications — used to send booking confirmations, reminders, availability alerts, security alerts, and post-visit prompts. You may disable these at any time in your device settings\n\nYou may revoke any permission at any time through your device settings. Revoking certain permissions may limit the functionality of the Services.\n\nCenaiva also collects crash and error data — including device platform, app version, current screen, and error details — to diagnose and fix technical issues. This data is associated with your user account where available and handled in accordance with our Privacy Policy.",
  },
  {
    id: "sms-communications",
    number: "16",
    title: "SMS Communications",
    body: "Cenaiva uses SMS (powered by Twilio) solely for transactional purposes, including booking confirmations, one-time passcodes, waitlist notifications, and service alerts directly related to your use of the platform. By providing your phone number, you consent to receive these transactional messages. Standard messaging and data rates may apply.\n\nWe do not send promotional or marketing SMS messages without your separate express consent. You may opt out of transactional SMS at any time by replying STOP to any message, using your in-app notification settings, or contacting us at help@cenaiva.com. Reply HELP for assistance. If you opt out of transactional SMS, some account, booking, security, or verification features may not function properly.",
  },
  {
    id: "push-notifications",
    number: "17",
    title: "Push Notifications",
    body: "Cenaiva uses Expo Notifications to deliver push notifications to your device. By enabling notifications, you consent to receiving alerts related to your bookings, rewards, availability alerts, platform activity, post-visit prompts, and account security. You may disable push notifications at any time through your device settings or in-app notification preferences, though this may affect your ability to receive time-sensitive booking updates and security alerts.",
  },
  {
    id: "cross-border-data",
    number: "18",
    title: "Cross-Border Data Transfers",
    body: "Some third-party providers used by Cenaiva process personal data outside of Canada, including in the United States. This includes OpenAI, ElevenLabs, Deepgram, Stripe, PostHog, Sentry, and Vercel. By using the Services — and in particular the AI voice and chat features — you consent to the transfer of your data to these jurisdictions. Data transferred outside Canada may be subject to the laws of the receiving country, which may differ from Canadian privacy law. We require all third-party providers to maintain appropriate safeguards for your personal information.",
  },
  {
    id: "data-rights",
    number: "19",
    title: "Your Data Rights",
    body: "Depending on where you live and the laws that apply to you, including PIPEDA and Quebec Law 25 where applicable, you may have the right to:\n\n- Access the personal information we hold about you\n- Correct inaccurate or incomplete information\n- Request portability of your personal data in a structured, commonly used format, where required by applicable law\n- Withdraw consent for certain types of data processing, subject to legal and contractual limitations\n- Request review or correction of automated profiling associated with your account, including AI-generated tags, no-show risk scores, and lifetime value scores\n- Request deletion of your account and personal data, as described in Section 3\n\nTo exercise any of these rights, contact us at privacy@cenaiva.com. We will respond within 30 days. We may need to verify your identity before processing a request.\n\nData Breach Notification. If we become aware of a breach of security safeguards involving your personal information, we will assess the incident in accordance with applicable privacy laws. Where the incident creates a real risk of significant harm, Cenaiva will notify affected users and applicable regulators without unreasonable delay, and in any event within 72 hours of becoming aware of the breach.",
  },
  {
    id: "third-party-services",
    number: "20",
    title: "Third-Party Services",
    body: "Cenaiva relies on trusted third-party providers to deliver the Services. Your use of Cenaiva may involve data being processed by:\n\n- Supabase — Database infrastructure and authentication\n- Stripe — Payment processing and saved payment methods\n- OpenAI — AI language processing for Cenaiva AI\n- ElevenLabs — Text-to-speech voice synthesis\n- Deepgram — Speech-to-text transcription\n- Apple and Google — Device speech recognition, mobile operating system services, and app platform services\n- Google Maps Platform — Location and mapping features\n- Twilio — SMS communications\n- Resend — Transactional email communications\n- Expo (EAS) — Mobile app delivery and push notifications\n- PostHog — Product analytics and usage insights\n- Sentry — Error monitoring and crash reporting\n- Vercel — Web infrastructure and hosting\n\nWe are not responsible for the performance, availability, or independent data practices of these providers. We encourage you to review their terms and privacy policies.",
  },
  {
    id: "analytics-error-monitoring",
    number: "21",
    title: "Analytics and Error Monitoring",
    body: "We use PostHog to collect product usage data, which may include device information, session data, event data, and usage patterns. Where possible, we use aggregated, pseudonymized, or anonymized data. We use Sentry to monitor application errors and crashes. Data collected through these tools is used solely for service improvement.",
  },
  {
    id: "ai-usage-limits",
    number: "22",
    title: "AI Usage Limits and Rate Limiting",
    body: "To ensure fair access to Cenaiva AI features for all users and to manage platform costs, Cenaiva may apply usage limits or rate limits on AI-powered features. If you reach a usage limit, you will be notified in the app and may need to wait before using AI features again. Cenaiva reserves the right to adjust usage limits at any time. Excessive or automated use of AI features beyond normal usage patterns may result in temporary throttling or account review.",
  },
  {
    id: "app-store-terms",
    number: "23",
    title: "App Store Terms (Apple and Google)",
    body: "- These Terms are between you and Cenaiva only, not Apple Inc. or Google LLC (\"App Store Providers\")\n- App Store Providers have no obligation to provide maintenance, support, warranty, or other services with respect to Cenaiva\n- App Store Providers are not responsible for any claims by you or any third party relating to Cenaiva or your use of it\n- Apple is a third-party beneficiary of these Terms and, upon your acceptance, will have the right to enforce these Terms against you as a third-party beneficiary\n- Your use of Cenaiva must comply with the applicable App Store Terms of Service\n- You represent and warrant that you are not located in a country subject to a Canadian, US, or applicable government embargo, and that you are not listed on any government list of prohibited or restricted parties\n- In the event of a third-party claim that Cenaiva infringes intellectual property rights, Cenaiva — not Apple or Google — will be solely responsible for the investigation, defence, settlement, and discharge of any such claim",
  },
  {
    id: "privacy",
    number: "24",
    title: "Privacy",
    body: "Your use of Cenaiva is also governed by our Privacy Policy, available at cenaiva.com/privacy, which is incorporated into these Terms by reference. The Privacy Policy explains how we collect, use, store, and protect your personal information, including voice recordings, chat messages, photos, location data, device identifiers, and automated profiling data.",
  },
  {
    id: "intellectual-property",
    number: "25",
    title: "Intellectual Property",
    body: "All content, design, branding, software, features, and materials associated with Cenaiva are owned by us or our licensors and are protected by applicable Canadian and international intellectual property laws. You may not copy, reproduce, modify, distribute, reverse-engineer, decompile, or create derivative works from any part of the Services. User-generated content (such as Snaps and visit photos) remains your property, subject to the licences granted in Sections 7.2 and 8.1.",
  },
  {
    id: "service-availability",
    number: "26",
    title: "Service Availability",
    body: "We aim to provide a reliable and uninterrupted experience. However, we do not guarantee that the Services will be available at all times or free from errors. We may perform scheduled or emergency maintenance that temporarily affects access and will endeavour to provide advance notice where reasonably possible. We reserve the right to modify, suspend, or discontinue any part of the Services at any time.",
  },
  {
    id: "disclaimer-warranties",
    number: "27",
    title: "Disclaimer of Warranties",
    body: "The Services are provided \"as is\" and \"as available\" without warranties of any kind, either express or implied. To the fullest extent permitted by applicable law, Cenaiva expressly disclaims all warranties including: implied warranties of merchantability or fitness for a particular purpose; warranties that the Services will be uninterrupted, error-free, or secure; warranties regarding the accuracy, completeness, or reliability of any content, including AI-generated content, restaurant-provided information, and automated scoring or tagging; and warranties that any reservation, hold, booking, or AI-initiated action will be fulfilled as expected.",
  },
  {
    id: "limitation-liability",
    number: "28",
    title: "Limitation of Liability",
    body: "To the fullest extent permitted by applicable law:\n\n- Cenaiva is not liable for any indirect, incidental, special, punitive, or consequential damages arising from your use of the Services\n- We are not responsible for any issues related to restaurant services, including cancellations, food quality, allergens, or disputes between you and a restaurant — Cenaiva is a technology intermediary only and is not a party to any transaction with a restaurant\n- We are not liable for losses arising from errors, hallucinations, inaccuracies, or failures of the Cenaiva AI assistant, including incorrect bookings, misunderstood instructions, or fabricated information\n- We are not liable for losses arising from unauthorized access to your account where such access results from your own failure to secure your credentials\n- We are not liable for expired reservation holds resulting in lost availability\n- We are not liable for failures of third-party providers, including Stripe, OpenAI, ElevenLabs, Deepgram, or Twilio\n- Our total liability to you for any claim arising out of or relating to these Terms or the Services shall not exceed the greater of CAD $100 or the total amount you paid to Cenaiva in the 12 months prior to the event giving rise to the claim\n\nNothing in these Terms limits liability that cannot be excluded under applicable Canadian law, including liability for gross negligence or wilful misconduct. If you are a resident of Quebec, nothing in these Terms limits any rights you have under the Quebec Consumer Protection Act.",
  },
  {
    id: "indemnification",
    number: "29",
    title: "Indemnification",
    body: "You agree to indemnify, defend, and hold harmless Cenaiva, its officers, employees, contractors, and partners from and against any claims, liabilities, damages, losses, or expenses (including reasonable legal fees) arising from: your use of or inability to use the Services; your violation of these Terms; your interactions with restaurants or other users; any content or information you submit through the platform, including Snaps, voice interactions, and photos; and your violation of any third-party rights.",
  },
  {
    id: "dispute-resolution",
    number: "30",
    title: "Dispute Resolution",
    body: "We encourage you to contact us first at help@cenaiva.com to resolve any concerns informally. We will make a genuine effort to respond to and resolve disputes within 30 days. If a dispute cannot be resolved informally, both parties agree to submit to the exclusive jurisdiction of the courts of the Province of Ontario, and to attempt in good faith to resolve the matter through mediation before initiating formal legal proceedings. If you are a resident of Quebec, you retain the right to bring proceedings before the courts of Quebec in accordance with applicable law.",
  },
  {
    id: "force-majeure",
    number: "31",
    title: "Force Majeure",
    body: "Cenaiva is not liable for any delay or failure to perform resulting from causes beyond our reasonable control, including internet or network outages; third-party service failures (including AI providers, payment processors, and infrastructure providers); natural disasters; acts of government; pandemics; or other events outside our reasonable control.",
  },
  {
    id: "termination",
    number: "32",
    title: "Termination",
    body: "We may suspend or terminate your access to Cenaiva at any time, with or without notice, if you violate any provision of these Terms, misuse the platform, harm other users or restaurant partners, or engage in conduct that exposes Cenaiva to legal risk or reputational harm. Upon termination, your right to use the Services ceases immediately. Wallet balances following termination are handled as described in Section 11.3. The following sections survive termination: 3, 8.1, 10, 11.3, 13, 17, 18, 19, 24, 25, 27, 28, 29, 30, 33–39.",
  },
  {
    id: "changes-to-terms",
    number: "33",
    title: "Changes to These Terms",
    body: "We may update these Terms from time to time. For minor changes, we will update the \"Last Updated\" date at the top of this document. For material changes, we will provide at least 30 days' notice via email or in-app notification before the changes take effect. Your continued use of the Services after the effective date of any changes constitutes your acceptance of the revised Terms. If you do not agree, you must stop using the Services.",
  },
  {
    id: "governing-law",
    number: "34",
    title: "Governing Law",
    body: "These Terms are governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, without regard to conflict of law principles.",
  },
  {
    id: "language",
    number: "35",
    title: "Language / Langue",
    body: "Cenaiva is available in both English and French. These Terms, our Privacy Policy, checkout disclosures, account notices, and other consumer-facing legal documents are made available in both English and French where required by applicable law.\n\nFor users located in Quebec, the French version of these Terms will be made available first, at no cost, before the user chooses to be bound by the English version. A Quebec user may choose to use the English version only after having been given access to the French version and clearly expressing their wish to proceed in English. In the event of any conflict between the English and French versions, the interpretation most favourable to the consumer will prevail where required by law.\n\nCenaiva est disponible en anglais et en français. Les présentes conditions et autres documents juridiques destinés aux consommateurs sont disponibles en anglais et en français lorsque la loi applicable l'exige. Pour les utilisateurs situés au Québec, la version française sera mise à disposition en premier, sans frais. En cas de conflit entre les versions, l'interprétation la plus favorable au consommateur prévaudra, lorsque la loi l'exige.",
  },
  {
    id: "severability",
    number: "36",
    title: "Severability",
    body: "If any provision of these Terms is found to be unlawful, void, or unenforceable under applicable law, that provision will be deemed severed from these Terms and will not affect the validity and enforceability of the remaining provisions.",
  },
  {
    id: "assignment",
    number: "37",
    title: "Assignment",
    body: "We may assign or transfer these Terms in connection with a merger, acquisition, reorganization, or sale of all or substantially all of our assets, without notice to you. You may not assign or transfer your rights or obligations under these Terms without our prior written consent.",
  },
  {
    id: "waiver",
    number: "38",
    title: "Waiver",
    body: "Our failure to enforce any provision of these Terms on any occasion does not constitute a waiver of our right to enforce that provision or any other provision in the future.",
  },
  {
    id: "entire-agreement",
    number: "39",
    title: "Entire Agreement",
    body: "These Terms, together with our Privacy Policy (cenaiva.com/privacy) and, where applicable, the Restaurant Partner Agreement, constitute the entire agreement between you and Cenaiva with respect to your use of the Services as a consumer and supersede all prior agreements, representations, or understandings relating to the same subject matter. Section headings are included for convenience only and have no interpretive effect.",
  },
  {
    id: "contact",
    number: "40",
    title: "Contact",
    body: "- General Support: help@cenaiva.com\n- Privacy Inquiries: privacy@cenaiva.com\n- Legal / IP Complaints: legal@cenaiva.com\n- Security Vulnerability Reports: security@cenaiva.com\n- Website: cenaiva.com/terms\n\nSupport is available in English and French. Le soutien est offert en anglais et en français.",
  },
];
