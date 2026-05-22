import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en/common";
import frCommon from "@/locales/fr/common";
import enLegal from "@/locales/en/legal";
import frLegal from "@/locales/fr/legal";

// Locale picker order:
//   1. ?lang= query param (overrides everything, persists to localStorage)
//   2. localStorage 'cenaiva.locale'
//   3. navigator.language (fr-* → fr, otherwise → en)
//   4. Fallback: en
//
// Quebec users must be able to switch to French; per Charter of the French
// Language we also auto-detect fr-* browsers and offer the French banner
// rendered by MarketingShell.
const LOCALE_KEY = "cenaiva.locale";
type SupportedLocale = "en" | "fr";

function resolveInitialLocale(): SupportedLocale {
  if (typeof window === "undefined") return "en";

  // 1. URL ?lang=
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("lang");
    if (fromQuery === "fr" || fromQuery === "en") {
      window.localStorage?.setItem(LOCALE_KEY, fromQuery);
      return fromQuery;
    }
  } catch {
    // ignore
  }

  // 2. localStorage choice
  try {
    const stored = window.localStorage?.getItem(LOCALE_KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {
    // ignore
  }

  // 3. navigator.language fr-* → fr
  try {
    const nav = window.navigator?.language ?? "";
    if (nav.toLowerCase().startsWith("fr")) return "fr";
  } catch {
    // ignore
  }

  // 4. default
  return "en";
}

const initialLocale = resolveInitialLocale();

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, legal: enLegal },
    fr: { common: frCommon, legal: frLegal },
  },
  lng: initialLocale,
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "legal"],
  interpolation: { escapeValue: true },
  react: { useSuspense: false },
});

// Persist any future runtime change (e.g. footer toggle) so the choice
// sticks across reloads.
i18n.on("languageChanged", (next) => {
  try {
    if (typeof window !== "undefined" && (next === "en" || next === "fr")) {
      window.localStorage?.setItem(LOCALE_KEY, next);
    }
  } catch {
    // ignore
  }
});

export default i18n;
