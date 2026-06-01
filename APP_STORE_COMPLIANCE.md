# App Store Compliance — Apple + Google Requirements for Cenaiva apps

**Status:** Research/reference. No build started. **Date compiled:** 2026-05-31.
**Method:** Pulled from the **live official Apple & Google docs** on 2026-05-31 (not from memory),
with section numbers + source URLs cited throughout. Where a point could **not** be verified from
an official page, it is explicitly flagged "⚠ verify" rather than guessed.

**Scope assumed:** Two Capacitor-wrapped apps — a **Diner app** (discover, book, pay refundable
deposits + per-booking fees + food via Stripe, Google/Apple OAuth + phone OTP, location for "near
me", camera, and a "snapshot" feature where diners post photos publicly to a restaurant's gallery)
and an **Owner app** (manage bookings, pay a $199.99 CAD/mo SaaS subscription via Stripe).
Publisher = a **registered company (Canada)**, organization developer accounts on both stores.

---

## 0. TL;DR — the handful of things that actually get a reservation app rejected

These are the real gates. Everything else is process/paperwork.

1. **User-generated content rules (the snapshot feature).** Because diner photos appear **publicly**,
   BOTH stores require: content **filtering/moderation**, an in-app **report/flag**, the ability to
   **block** abusive users, a **terms acceptance** before posting, and **published contact info**.
   This is the **biggest net-new build item** and the most common rejection cause for apps like this.
2. **"Sign in with Apple" on the Diner app.** Because it offers **Google Sign-In**, Apple **requires**
   an equivalent (Sign in with Apple). Phone OTP does **not** satisfy it.
3. **The $199.99/mo restaurant subscription** — the one ambiguous payment flow. Safest path: **sell it
   on the web, not in the app**; the Owner app only signs in an already-paid account (no in-app
   purchase UI, no in-app price). Diner deposits/fees/food on Stripe are **clearly fine**.
4. **Apple Privacy Manifest** (`PrivacyInfo.xcprivacy`) — a **hard gate since May 1, 2024**. Capacitor +
   Stripe + Google SDKs must declare required-reason APIs / data; SDKs must be manifest-bearing versions.
5. **Account deletion** — you already have in-app deletion; **Google also requires a public web URL**
   to request deletion, entered in the Data safety form.
6. **D-U-N-S number** — gates BOTH org accounts and takes up to ~2 weeks. **Start this first.**

---

## 1. APPLE — App Review Guidelines (acceptance)

Source for all of §1: **App Store Review Guidelines** — https://developer.apple.com/app-store/review/guidelines/
(verified verbatim against the live page and Apple's Copyright © 2026 PDF; last guideline revision noted **Feb 6, 2026**).

### 1.1 — Guideline 4.2 Minimum Functionality (the Capacitor / "is it just a website" risk)
> "Your app should include features, content and UI that elevate it beyond a repackaged website… If
> your app doesn't provide some sort of lasting entertainment value or adequate utility, it may not be
> accepted." (4.2)
> "Other than catalogues, apps shouldn't primarily be marketing materials, advertisements, web
> clippings, content aggregators or a collection of links." (4.2.2)
> "(i) Your app should work on its own without requiring installation of another app… (ii) If your app
> needs to download additional resources in order to function on initial launch, disclose the size of
> the download and prompt users before doing so." (4.2.3)

- **No rule bans WebView wrappers.** The bar is "elevate beyond a repackaged website" + "app-like."
- Note: 4.2.6 explicitly blesses the **"restaurant finder app with… separate customised entries… for
  each client restaurant"** pattern as an acceptable model (it concerns template/generator services
  submitting for clients — not a trigger for Cenaiva, which submits its own binary).
- **Action:** make the apps clearly native — native push, native location, native camera (snapshot),
  Apple Pay / native payment sheet, Sign in with Apple, haptics, offline handling. If the WebView
  pulls a meaningful bundle on first launch, disclose the size + prompt (4.2.3(ii)).

### 1.2 — Guideline 1.2 User-Generated Content (the snapshot gallery) — HARD GATE
> "apps with user-generated content or social networking services must include:
> • A method for filtering objectionable material from being posted to the app
> • A mechanism to report offensive content and timely responses to concerns
> • The ability to block abusive users from the service
> • Published contact information so users can easily reach you" (1.2)

- The diner snapshot photos are **public UGC**, so **all four** are mandatory and must be demonstrable
  to the reviewer (via the demo account). A photo that publishes instantly with **no moderation** fails
  the first bullet.
- **Action (Diner app):** (a) pre-publish image moderation or a review queue; (b) per-photo report +
  a response process; (c) block-user capability; (d) easily reachable contact info (in-app + support URL).

### 1.3 — Guideline 4.8 Login Services (Sign in with Apple) — REQUIRED on the Diner app
> "Apps that use a third-party or social login service (such as… Google Sign-In…) to set up or
> authenticate the user's primary account… must also offer, as an equivalent option, another login
> service with the following features: the login service limits data collection to the user's name and
> email address; allows users to keep their email address private…; and does not collect interactions
> with your app for advertising purposes without consent." (4.8)
> Exceptions include: "Your app exclusively uses your company's own account setup and sign-in systems…"

- Because the Diner app offers **Google Sign-In**, 4.8 triggers → must add **Sign in with Apple**.
- **Phone OTP does NOT satisfy it** (it collects a phone number, not name+email with private-email),
  and the "exclusively own account system" exception is **void once a social login is present**.
- **Owner app:** required **only if** it uses Google Sign-In. If the Owner app uses only Cenaiva's own
  email/password (no social login), the exception applies and Sign in with Apple is not required there.
  → **Verify which login methods each app actually ships.**

### 1.4 — Guideline 2.1 App Completeness + 2.3 Accurate Metadata (login-gated review)
> "include demo account info (and turn on your back-end service!) if your app includes a login… Ensure
> the demo mode exhibits your app's full features and functionality." (2.1(a))
> "All new features, functionality and product changes must be described with specificity in the Notes
> for Review section… (generic descriptions will be rejected)…" (2.3.1(a))
> "Screenshots should show the app in use, and not merely the title art, login page or splash screen…" (2.3.3)

- **Action:** provide a **working demo account** with the back-end live (Owner demo must show a
  **populated** dashboard). Document the deposits / fees / $199.99 subscription / location / snapshot
  in Notes for Review. Screenshots show the app **in use**, not the login screen. App name ≤30 chars,
  no Android/other-platform imagery (2.3.7, 2.3.10).

### 1.5 — Guideline 5.6 Developer Code of Conduct
Truthful developer identity (5.6.2); use Apple's review-prompt API only — no custom prompts (5.6.1);
**excessive refund requests** are a watched signal (5.6.4) — keep the deposit/refund UX transparent.

---

## 2. APPLE — Payments (Guideline 3.1)

Source: §3.1 of the guidelines above + Apple Developer News **May 1, 2025** (US-court compliance update)
— https://developer.apple.com/news/?id=9txfddzf

| Money flow | In-App Purchase required? | Controlling rule | Confidence |
|---|---|---|---|
| Diner refundable deposit + per-booking fee (Stripe) | **No — Stripe required; IAP prohibited** | 3.1.3(e) Goods/Services Outside of the App | **High** |
| Diner pre-order / paying the bill for food (Stripe) | **No — Stripe required; IAP prohibited** | 3.1.3(e) | **High** |
| Restaurant $199.99/mo B2B SaaS subscription (Stripe) | **Likely No — via "access-only" model**, but genuinely ambiguous | 3.1.3(c) Enterprise Services (primary); must escape the 3.1.1/3.1.2 IAP default | **Medium ⚠** |

- **3.1.3(e) (verbatim):** "If your app enables people to purchase physical goods or services that will
  be consumed outside of the app, you must use purchase methods other than in-app purchase to collect
  those payments, such as Apple Pay or traditional credit card entry." → A reservation, the refundable
  deposit, and paying for food are real-world dining services consumed outside the app. Stripe is not
  just allowed — IAP would be **wrong**. Same category as OpenTable/Resy/Uber Eats.
- **The subscription is the only risk.** Apple's default (3.1.1/3.1.2) is that subscriptions/SaaS use
  IAP. The escape is **3.1.3(c) Enterprise Services** ("sold directly by you to organizations… for
  their employees… allow enterprise users to access previously-purchased… subscriptions"). The safe,
  reviewer-proof posture: **buy/manage the subscription on the web; the iOS Owner app only signs in and
  grants access — no in-app purchase UI, no price, no buy button.**
- **Anti-steering / external links:** governs **digital** items only — it does **not** apply to the
  diner real-world flows (showing prices + taking Stripe in-app there is normal). Since May 1, 2025,
  **US storefront** apps may include external purchase links/CTAs without an entitlement; outside the US
  the default no-steering rule still applies absent an entitlement.
- **⚠ Not verified:** Apple has **no §3.1 rule** about running Apple Pay / Stripe.js **inside a WebView**.
  Apple Pay on the Web has separate *technical* requirements (verified merchant domain, HTTPS) and
  WebView content touches Guidelines 2.5/4.7 — **check those before finalizing the payment architecture.**

---

## 3. APPLE — Privacy & technical submission

### 3.1 — Privacy policy + account deletion (Guideline 5.1.1)
- **5.1.1(i):** privacy policy link required **in App Store Connect AND in-app**; must state what data is
  collected, uses, third-party sharing, retention, and how to revoke/delete.
- **5.1.1(v) + "Offering account deletion in your app"**
  (https://developer.apple.com/support/offering-account-deletion-in-your-app/): apps that support account
  creation **must let users initiate deletion in-app**, deleting the **entire account** (deactivation
  alone is insufficient); if a website finishes the process, link directly to it.
  → You already have `delete-account` + `delete_diner_account` RPC. **Confirm the entry point is reachable
  in the Capacitor build** (the Account menu) and deletes the full record.

### 3.2 — Permission purpose strings (Info.plist) — missing string = rejection (ITMS-90683)
Add **specific, non-blank** strings (refs: developer.apple.com Information Property List):
- `NSCameraUsageDescription` — snapshot + receipts.
- `NSPhotoLibraryUsageDescription` (read) and/or `NSPhotoLibraryAddUsageDescription` (save-only).
- `NSLocationWhenInUseUsageDescription` — "near me".
- `NSMicrophoneUsageDescription` — **only if** the build links a mic API. Voice is out of mobile scope →
  **omit** unless a plugin pulls the mic in (data minimization, 5.1.1(iii)).

### 3.3 — App Privacy "nutrition labels" (App Store Connect questionnaire)
Required to submit. Declare your AND third-party SDK collection (Stripe, Supabase, Google OAuth, any
analytics): likely **Contact Info** (name/email/phone), **Location**, **Financial Info/Purchases**
(Stripe), **User Content** (photos), **Identifiers**. Ref: https://developer.apple.com/app-store/app-privacy-details/

### 3.4 — App Tracking Transparency (ATT)
Only required **if you track** (cross-app/website ad targeting, IDFA, data brokers). A pure reservation
app with no ad SDKs **does not** prompt ATT and should answer "not used to track." Do **not** add it
gratuitously. Ref: https://developer.apple.com/app-store/user-privacy-and-data-use/

### 3.5 — Privacy Manifest (`PrivacyInfo.xcprivacy`) — HARD GATE since May 1, 2024
> "Starting May 1, 2024, apps that don't describe their use of required reason API in their privacy
> manifest file aren't accepted by App Store Connect." (https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- Capacitor/web-wrapper plugins commonly use **`UserDefaults`** and **file-timestamp** APIs → the app's
  own manifest will likely need `NSPrivacyAccessedAPICategoryUserDefaults` (+ possibly `FileTimestamp`,
  `DiskSpace`) with **approved reason codes**, plus `NSPrivacyCollectedDataTypes`, and
  `NSPrivacyTracking`/`NSPrivacyTrackingDomains` (false/empty if no tracking).
- **Update Stripe iOS SDK + Google Sign-In to manifest-and-signature-bearing versions.**
- **⚠ verify:** the exact approved-reason codes per category against Apple's per-category reason list.

### 3.6 — Encryption export compliance
Set **`ITSAppUsesNonExemptEncryption = NO`** — Cenaiva uses only OS HTTPS/TLS (exempt). Verify no linked
lib uses **proprietary** crypto. Ref: https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations

### 3.7 — Other technical gates
- **App icon:** opaque **1024×1024 PNG**, no alpha, no pre-rounded corners.
- **Build toolchain:** must build with the then-current required SDK/Xcode (iOS 18 SDK / Xcode 16+ was
  the floor from Apr 24, 2025) — **⚠ re-check the "upcoming requirements" page at build time.**
- **Screenshots:** 1–10 per size; **6.9″ iPhone required**; **13″ iPad required** if universal; must show
  the app in use.
- **Launch screen:** `LaunchScreen.storyboard` present + full-screen (Capacitor generates one). **⚠ confirm
  against the live HIG before submit.**

---

## 4. GOOGLE PLAY — policies (acceptance)

### 4.1 — Payments (Play Billing vs Stripe)
Sources: Payments policy — https://support.google.com/googleplay/android-developer/answer/9858738 ;
Understanding the Payments policy — https://support.google.com/googleplay/android-developer/answer/10281818
- **Play Billing required for:** in-app digital items; subscription services; **"Cloud software and
  services (such as data storage services, business productivity software, and financial management
  software)."**
- **Not required for physical/real-world:** "Purchases of physical services (such as transportation
  services, airfare, gym memberships, **or food delivery**)…" + "food delivery, tickets for live events."
- **US-only change (Oct 29, 2025):** for users in the **US**, Google "will not require the use of Google
  Play Billing" and won't prohibit external payment/links (Epic v. Google). https://support.google.com/googleplay/android-developer/answer/15582165
  — **This is US-only; your Canadian org is not auto-covered for non-US users.**

**Verdicts:**
- **Diner app — deposits/fees/food via Stripe = ALLOWED** (real-world services/food), globally. ✅
- **Owner $199.99/mo subscription** = the SaaS/"cloud software" case → would trigger Play Billing **if
  sold in-app**. **Safest: sell/manage it on the web; the app only authenticates a paid account (no
  in-app purchase UI/price).** ⚠ No official doc grants a blanket "B2B SaaS" exemption, and alternative
  billing eligibility for a **Canadian org** outside the US is **unconfirmed — verify in Play Console.**

### 4.2 — User Data policy + Data safety form (mandatory)
https://support.google.com/googleplay/android-developer/answer/10787469 — every app must complete the
**Data safety form** (incl. data sent off-device via WebViews/SDKs). Declare: location (approx/precise),
personal info (name/email/phone), **financial info**, **photos/videos**, identifiers; encryption in
transit; data-deletion availability. **Privacy policy** required at a public, non-geofenced HTTPS URL
(no PDF), linked in Console **and** in-app.

### 4.3 — Account / data deletion — needs a WEB URL too
https://support.google.com/googleplay/android-developer/answer/13327111 — apps with accounts must provide
**(a) an in-app deletion path AND (b) a public web URL** to request account+data deletion; the web URL
goes in the **Data safety form**. → You have the in-app path; **publish the web deletion URL.** Disclose
CRA/Law-25 retention of de-identified records in the privacy policy (allowed "regulatory compliance" retention).

### 4.4 — Permissions & sensitive APIs
- **Photos:** use the **Android Photo Picker** for snapshots — do **NOT** request broad `READ_MEDIA_IMAGES`
  (that needs a "gallery-app" justification + Play Console declaration; deadline was May 28, 2025).
  https://support.google.com/googleplay/android-developer/answer/14115180
- **Location:** request **foreground only** (`ACCESS_FINE/COARSE_LOCATION`); do **NOT** request
  **background location** (separate declaration + ~30s demo video review).
  https://support.google.com/googleplay/android-developer/answer/9799150
- **Prominent in-app disclosure** before the camera/location runtime prompt (not buried in the policy).
- Confirm no Capacitor plugin silently declares a **foreground service** that needs an FGS declaration.

### 4.5 — User-Generated Content policy (snapshot gallery) — HARD GATE
https://support.google.com/googleplay/android-developer/answer/9876937 — UGC apps must: require **ToS/user-
policy acceptance** before posting; **define objectionable content**; **moderate**; provide **in-app
report + block** for content and users with **timely action**. Public UGC needs **both report and block**.
→ Largest net-new build for the Diner app (mirrors Apple 1.2).

### 4.6 — Target API level (2026)
https://developer.android.com/google/play/requirements/target-sdk — new apps & updates must target
**Android 15 (API 35)+** (as of Aug 31, 2025). **⚠ verify in Play Console at build time** in case the
floor rose to API 36.

### 4.7 — Technical
- **Android App Bundle (`.aab`)** required for new apps (since Aug 2021); **enroll in Play App Signing**.
- **IARC content-rating questionnaire** required for both apps — disclose the UGC gallery truthfully.
- **Financial features declaration** is **mandatory to fill out** for every app; Cenaiva's commerce
  (Stripe for services/subscription) is **not** a listed financial-service category (not lending/wallet/
  money-transfer/crypto/trading) → expected answer **"no financial features"**, but the **form is required**.
  https://support.google.com/googleplay/android-developer/answer/13849271

---

## 5. ACCOUNTS & ENROLLMENT (organization)

### 5.1 — Apple Developer Program (Organization) — $99 USD/yr
https://developer.apple.com/programs/enroll/
- Must be a **legal entity** (no DBAs); org legal name shows as the App Store seller.
- **Account Holder** must have **legal authority to bind the company** (owner/exec or authorized employee
  with a reference who can confirm authority).
- **D-U-N-S Number required** (verifies identity/legal status/address). Free; **allow up to ~5 business
  days (D&B) + ~2 (Apple), can stretch to ~2 weeks.** https://developer.apple.com/help/account/membership/D-U-N-S/
- **Identity verification** = D-U-N-S + binding-authority check; may request **notarized business docs**.
  Also need: a **work email on the org domain**, a **public functional website on the org domain**, and an
  Apple Account with **2FA**. ⚠ No documented Apple "phone-call" step (any call is from D&B about the D-U-N-S).

### 5.2 — App Store Connect — agreements, TestFlight, review
- **Free apps need only the Apple Developer Program License Agreement** — the **Paid Apps Agreement
  (and its tax/banking forms) is NOT needed** since billing is external via Stripe and there's no Apple IAP.
  https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/
- **TestFlight:** internal testers up to 100; external up to 10,000; first build needs review; builds last 90 days.
- **Review time:** "on average, 90% of submissions are reviewed in less than 24 hours."

### 5.3 — Google Play Console (Organization) — $25 USD one-time
https://support.google.com/googleplay/android-developer/answer/6112435
- **D-U-N-S required for organizations** (legal name + address must **match the D&B record**; D-U-N-S/
  country/account-type **can't be changed later**). https://support.google.com/googleplay/android-developer/answer/13634885
- Provide org legal name/address, phone, **website (required)**, contacts; verify email + phone by OTP;
  complete **developer identity verification** (unverified → apps removed until verified).
- Google publicly displays your **legal name, address, email, phone**.

### 5.4 — Google closed-testing rule — does NOT apply to orgs
https://support.google.com/googleplay/android-developer/answer/14151465 — the **12 testers / 14 consecutive
days** closed test applies only to **new PERSONAL accounts created after Nov 13, 2023**. Registering as an
**organization** (which you must) **sidesteps it.** (Commonly confused — you're fine.)

### 5.5 — EU trader status (Digital Services Act) — required even if not shipping to the EU
- **Apple:** declare **trader = yes**, provide a public phone + email for the product page, certify EU-law
  compliance. Apps without trader status are being **removed in the EU**. https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
- **Google:** delivered via the mandatory **org identity + public store-listing contact details** (legal
  name, full address, phone, email, website). ⚠ No discrete Google "DSA trader" page like Apple's.

### 5.6 — Renewals / lapse
- **Apple:** annual **$99**; if it lapses, **apps are pulled** and you can't submit. Set auto-renew. (Free
  apps return within 24h on renewal, no resubmit.)
- **Google:** **no renewal fee**, but accounts can be **closed for inactivity** (>1 yr old + never shipped
  or <1,000 installs + unverified + unused 180 days). Keep contacts verified + publish/update.

### 5.7 — Enrollment order (do first → last); longest-lead items flagged ⏳
1. ⏳ **Get the D-U-N-S Number for the Canadian legal entity** (gates BOTH stores; ~up to 2 weeks; name/
   address must match legal registration). One D-U-N-S serves Apple + Google.
2. ⏳ **Stand up a public company website on the org domain + a work email on that domain** (both stores require).
3. **Apple:** Apple Account w/ 2FA for the binding-authority person → enroll Org ($99) → pass identity/
   binding verification (maybe notarized docs) → accept Developer Program License Agreement → declare DSA trader.
4. **Google:** create Org account ($25) → link Payments profile → enter D-U-N-S/legal name/address/phone/
   website/contacts → verify email+phone → complete ⏳ identity verification.
5. **Google:** prepare **AAB** + enroll **Play App Signing**; confirm closed-testing gate doesn't apply (org).
6. **Both:** build store listings; beta via TestFlight / Play internal testing; submit. Reuse the same org
   account for both apps.

---

## 6. Highest-risk / most-likely-to-block areas (watch list)

1. **UGC (snapshot)** — both stores; build moderation + report + block + ToS + contact **before submitting**.
2. **$199.99/mo subscription** — keep it **web-purchased, access-only in the app**; the riskiest payment call.
3. **Sign in with Apple** on the Diner app (Google login present).
4. **Apple Privacy Manifest** — hard gate; needs the right SDK versions + reason codes.
5. **Google web account-deletion URL** + **Data safety** accuracy.
6. **D-U-N-S lead time** — start now or it blocks everything.

---

## 7. Master pre-submission checklist

**Both apps — accounts/process**
- [ ] D-U-N-S obtained (matches legal entity) ⏳
- [ ] Apple Org Developer Program enrolled + identity verified; DSA trader declared
- [ ] Google Play Org account created + identity verified
- [ ] Org-domain website + work email live
- [ ] Privacy policy at public HTTPS URL; linked in both consoles **and** in-app

**Payments**
- [ ] Diner: deposits/fees/food on Stripe (no IAP / no Play Billing) ✅
- [ ] Owner: subscription **purchased on the web**, app is access-only (no in-app price/buy)
- [ ] (⚠ confirm Google alternative-billing eligibility if you ever want in-app subscription outside the US)

**UGC (Diner app — snapshot)**
- [ ] ToS/user-policy acceptance before posting
- [ ] Image moderation / pre-publish filter
- [ ] In-app report/flag on each photo + block-user; timely-action workflow
- [ ] Published, reachable contact info (in-app + support URL)

**Privacy / permissions**
- [ ] In-app account deletion reachable (full delete) + **web deletion URL** (Google)
- [ ] iOS purpose strings: camera, photo (read/add), location; mic only if used
- [ ] iOS App Privacy questionnaire (incl. Stripe/Supabase/Google) + ATT = not used to track (unless it is)
- [ ] iOS `PrivacyInfo.xcprivacy` + manifest-bearing Stripe/Google SDK versions
- [ ] `ITSAppUsesNonExemptEncryption = NO`
- [ ] Google Data safety form complete; Financial features declaration filed ("no financial features")
- [ ] Android: Photo Picker (no broad `READ_MEDIA_IMAGES`); foreground location only; prominent disclosures

**Auth**
- [ ] Sign in with Apple on Diner app (Google login present); verify Owner app's login methods

**Technical / store listing**
- [ ] iOS built with current required Xcode/SDK; opaque 1024² icon; 6.9″ (+13″ iPad) screenshots in-use
- [ ] Android targets API 35+ (⚠ verify floor); ship `.aab` + Play App Signing; IARC rating done
- [ ] Demo accounts with live back-end + populated owner dashboard; features documented in review notes
- [ ] Make the apps clearly native (push, location, camera, payment sheet) to clear Apple 4.2

---

## 8. Items explicitly NOT fully verified from official docs (do not treat as settled)

1. **Apple Pay / Stripe.js inside a WebView** — no §3.1 rule found; check Apple Pay on the Web docs +
   Guidelines 2.5/4.7.
2. **$199.99 B2B subscription** approval is **not guaranteed** by the text — validate the access-only build.
3. **Google alternative-billing eligibility for a Canadian org** (non-US) — verify in Play Console.
4. Whether **API 36** is already required for new Android apps in mid-2026 — verify at build.
5. Exact **privacy-manifest approved-reason codes** per category — confirm against Apple's per-category list.
6. Full **encryption exemption category list** + verbatim **launch-screen** requirement — confirm on the live pages.
7. A documented Apple **phone-call verification** step — none found (any call is D&B re: D-U-N-S).

---

## 9. STORE LISTING, SUPPORT & OPERATIONAL FIELDS (required to submit/publish)

These are separate from policy — they're the product-page fields and assets that **block
submission/publishing if missing**. Verified against official App Store Connect Help and Play
Console Help on 2026-05-31.

### 9.1 — Support / contact (the "support" requirement)
- **Apple — Support URL is REQUIRED.** From "Platform version information"
  (https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/):
  > "The URL of the support website… This URL **must lead to actual contact information (legal address,
  > email address, telephone number)**… so that users can reach you regarding app issues…"
  → You must stand up a **support page that actually contains a legal address, email, and phone** — a bare
  link isn't enough. **Marketing URL is optional.**
- **Google — a contact email is REQUIRED.** From "How to support your app's users"
  (https://support.google.com/googleplay/android-developer/answer/113477):
  > "A contact email address is **required**, but… we also highly recommend including a website…"
  Phone + website are **optional**. These display publicly on the listing (Store settings → Store listing
  contact details).

### 9.2 — Apple App Store Connect required fields (per app)
Source: "Required, localizable, and editable properties"
(https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties/)

| Field | Required? | Limit / spec |
|---|---|---|
| App **Name** | ✅ | 2–30 chars |
| **Subtitle** | optional | ≤30 chars |
| **Promotional text** | optional | ≤170 chars |
| **Description** | ✅ | ≤4000 chars (no HTML) |
| **Keywords** | ✅ | ≤100 **bytes** (no other app/company names) |
| **Primary Category** | ✅ | (Secondary optional) |
| **Copyright** | ✅ | e.g. "2026 Cenaiva Inc." |
| **Privacy Policy URL** | ✅ | required for iOS |
| **Support URL** | ✅ | must contain real contact info (9.1) |
| **Age rating** | ✅ | questionnaire — "An Unrated app can't be published" |
| **Content Rights** declaration | ✅ | whether app shows third-party content |
| **App Review contact** (name/email/phone) | ✅ | not shown to users |
| **Demo account** (Sign-In Info) | ✅ *(login-gated)* | "must not expire"; both apps need login → required |
| **Primary Language / Bundle ID / SKU / Version** | ✅ | set at record creation; Bundle ID & SKU unchangeable |
| **Pricing** (Free) | required in practice ⚠ | ⚠ docs don't literally say "blocks submit" |
| App icon **1024×1024 PNG** (opaque) | ✅ | delivered in the build's asset catalog |
| **Screenshots** | ✅ | 1–10 per size; **iPhone 6.9″ (or 6.5″) required**; **iPad 13″ required if app runs on iPad** |
| App preview video | optional | up to 3 per size |
| Routing coverage file | optional / N/A | navigation apps only |

### 9.3 — Google Play Console required fields (per app)
Sources: "Create and set up your app" (https://support.google.com/googleplay/android-developer/answer/9859152),
"Add preview assets" (https://support.google.com/googleplay/android-developer/answer/9866151),
"Prepare your app for review" (https://support.google.com/googleplay/android-developer/answer/9859455),
"Set up your app on the app dashboard" (https://support.google.com/googleplay/android-developer/answer/9859454).

**Main store listing**
- **App name/title** ✅ — ≤30 chars
- **Short description** ✅ — ≤80 chars
- **Full description** ✅ — ≤4000 chars
- **App icon** ✅ — 512×512, 32-bit PNG, ≤1024 KB ("You must provide an app icon to publish")
- **Feature graphic** ✅ — **1024×500**, JPEG/24-bit PNG, no alpha ("You must provide a feature graphic to
  publish") ← **commonly missed**
- **Phone screenshots** ✅ — **minimum 2** (max 8); each side 320–3840 px, longer ≤ 2× shorter
- Tablet/Chromebook screenshots, preview video, TV banner → optional / N/A
- **Application type + Category** — effectively required to finish store setup (⚠ not worded "mandatory")
- **Contact email** ✅ (9.1); **Tags** optional (max 5)

**"App content" declarations (the dashboard task-list gates release)** — "You must complete the mandatory
tasks before you can launch your app":
- **Privacy policy** ✅ — linked on the listing **and** in-app
- **App access** ✅ — for login-gated apps you must provide **reusable test/demo credentials** that are
  "accessible at all times, reusable, valid regardless of user location," **bypass any 2-Step/OTP**, and are
  **in English**. → Cenaiva uses **phone OTP** — you must supply test logins that **skip the OTP**, for both
  diner and owner apps. (https://support.google.com/googleplay/android-developer/answer/15748846)
- **Ads** ✅ — "You must declare whether or not your app contains ads" (incl. via SDKs)
- **Target audience and content** ✅ — declare the target age group
- **Content rating** ✅ — IARC questionnaire (also in §4.7)
- **COVID-19** ✅ — declare (answer No); **News app** ✅ — declare (answer No)
- Government / Financial-features / Health declarations — conditional ⚠ (verify in-Console)

### 9.4 — Listing/support checklist (per app, both diner + owner)
- [ ] **Apple Support URL** live, with legal address + email + phone on the page
- [ ] **Google contact email** set (consider adding website)
- [ ] Apple: Name, Description, Keywords, Primary Category, Copyright, Privacy Policy URL, Age rating,
      Content Rights, App Review contact, **non-expiring demo account**
- [ ] Apple assets: 1024² icon (in build, opaque), iPhone 6.9″ screenshots (+iPad 13″ if universal)
- [ ] Google: Title/Short/Full description, **512² icon + 1024×500 feature graphic + ≥2 screenshots**
- [ ] Google App content: privacy policy, **App access demo logins (OTP-bypass, English)**, Ads, Target
      audience, Content rating, COVID=No, News=No
- [ ] Bundle IDs / SKUs decided (unchangeable once set); pricing = Free on both

### 9.5 — Flagged (not literally stated as "required" in the docs checked)
- Apple **pricing** as a hard submit-blocker (practically true; not a verbatim quote).
- Apple icon **alpha/transparency** wording (1024×1024 PNG dimension is confirmed; the "no alpha" rule is in
  the HIG but the page body didn't render to quote).
- Google **category** worded as "mandatory"; Google **Government/Financial/Health** declaration mandatory-ness;
  exact current screenshot pixel bounds (confirm in-Console at upload).

---

## Appendix — primary sources
- Apple App Store Review Guidelines — https://developer.apple.com/app-store/review/guidelines/
- Apple News, US-court payments update (May 1, 2025) — https://developer.apple.com/news/?id=9txfddzf
- Offering account deletion — https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App privacy details — https://developer.apple.com/app-store/app-privacy-details/
- User Privacy and Data Use (ATT) — https://developer.apple.com/app-store/user-privacy-and-data-use/
- Privacy manifest files — https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Required-reason API — https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- Encryption export — https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations
- Apple Dev Program enroll / D-U-N-S — https://developer.apple.com/programs/enroll/ , https://developer.apple.com/help/account/membership/D-U-N-S/
- Apple DSA trader — https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
- Google Payments policy — https://support.google.com/googleplay/android-developer/answer/9858738
- Google US payments update (Oct 29, 2025) — https://support.google.com/googleplay/android-developer/answer/15582165
- Google Data safety — https://support.google.com/googleplay/android-developer/answer/10787469
- Google account deletion — https://support.google.com/googleplay/android-developer/answer/13327111
- Google Photo/Video permissions — https://support.google.com/googleplay/android-developer/answer/14115180
- Google background location — https://support.google.com/googleplay/android-developer/answer/9799150
- Google UGC — https://support.google.com/googleplay/android-developer/answer/9876937
- Google target API — https://developer.android.com/google/play/requirements/target-sdk
- Google account types / required info — https://support.google.com/googleplay/android-developer/answer/13634885 , answer/13628312
- Google new-personal-account testing (orgs exempt) — https://support.google.com/googleplay/android-developer/answer/14151465
- Google Play App Signing / AAB — https://support.google.com/googleplay/android-developer/answer/9842756 , https://developer.android.com/guide/app-bundle
- Google financial features declaration — https://support.google.com/googleplay/android-developer/answer/13849271
- Apple App Store Connect required properties — https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties/
- Apple Platform version info (Support URL) — https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
- Apple set an age rating — https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/
- Apple screenshot specifications — https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Google support your app's users (contact email) — https://support.google.com/googleplay/android-developer/answer/113477
- Google create & set up your app (listing) — https://support.google.com/googleplay/android-developer/answer/9859152
- Google preview assets (icon/feature graphic/screenshots) — https://support.google.com/googleplay/android-developer/answer/9866151
- Google prepare your app for review (App content) — https://support.google.com/googleplay/android-developer/answer/9859455
- Google App access login credentials — https://support.google.com/googleplay/android-developer/answer/15748846
- Google set up your app dashboard — https://support.google.com/googleplay/android-developer/answer/9859454
