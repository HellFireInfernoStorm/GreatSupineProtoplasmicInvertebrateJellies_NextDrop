import type { HumanRole } from "@nextdrop/contracts";
import { useEffect } from "react";
import { create } from "zustand";
import { readStored, writeStored } from "../lib/storage";
import { i18n } from "./index";
import { LANGUAGES, type Language } from "./resources";

// Loader and Driver ship en, si and ta and remember the choice on the device. Store and Dispatcher are English
// (spec/frontend/design-system.md, Localization).

const LANGUAGE_KEY = "nextdrop.language";

/** Endonyms for the language chips. A language's own name is never translated. */
export const LANGUAGE_LABELS: Record<Language, string> = { en: "EN", si: "සිංහල", ta: "தமிழ்" };

function storedLanguage(): Language {
  const stored = readStored(LANGUAGE_KEY);
  return LANGUAGES.find((language) => language === stored) ?? "en";
}

const useFieldLanguageStore = create<{ language: Language }>(() => ({ language: storedLanguage() }));

export function isFieldRole(role: HumanRole): boolean {
  return role === "LOADER" || role === "DRIVER";
}

export function setFieldLanguage(language: Language): void {
  writeStored(LANGUAGE_KEY, language);
  useFieldLanguageStore.setState({ language });
}

/**
 * The language a role's screens render in, applied to i18next while they are mounted.
 * Put the returned value on the screen root's `lang` attribute.
 */
export function useRoleLanguage(role: HumanRole): Language {
  const fieldLanguage = useFieldLanguageStore((s) => s.language);
  const language = isFieldRole(role) ? fieldLanguage : "en";
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language]);
  return language;
}
