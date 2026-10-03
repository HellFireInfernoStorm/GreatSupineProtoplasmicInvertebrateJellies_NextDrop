import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

// Every user-facing string is a key (apps/web/AGENTS.md). Screens call `useTranslation("<role>/<namespace>")`.
void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "shared/common",
  interpolation: { escapeValue: false },
});

export { i18n };
