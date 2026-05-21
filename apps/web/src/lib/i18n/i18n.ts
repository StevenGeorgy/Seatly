import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en/common";
import frCommon from "@/locales/fr/common";
import enLegal from "@/locales/en/legal";
import frLegal from "@/locales/fr/legal";

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, legal: enLegal },
    fr: { common: frCommon, legal: frLegal },
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "legal"],
  interpolation: { escapeValue: true },
  react: { useSuspense: false },
});

export default i18n;
