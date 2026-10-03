import type { HumanRole } from "@nextdrop/contracts";
import { create } from "zustand";
import { isFieldRole } from "../lib/fieldRoles";
import { readStored, writeStored } from "../lib/storage";
import { i18n } from "./index";
import { LANGUAGES, type Language } from "./resources";

// Loader and Driver ship en, si and ta and remember the choice on the device. Store and Dispatcher are English
// (spec/frontend/design-system.md, Localization).
//
// i18next has one current language for the whole app, so it is set by the route loaders before a screen renders
// (applyRoleLanguage). A Loader's Tamil therefore never shows on the Store login, and nothing paints in the
// previous screen's language first.

const LANGUAGE_KEY = "nextdrop.language";

/** Endonyms for the language chips. A language's own name is never translated. */
export const LANGUAGE_LABELS: Record<Language, string> = { en: "EN", si: "සිංහල", ta: "தமிழ்" };

function storedLanguage(): Language {
  const stored = readStored(LANGUAGE_KEY);
  return LANGUAGES.find((language) => language === stored) ?? "en";
}

const useFieldLanguageStore = create<{ language: Language }>(() => ({ language: storedLanguage() }));

/** The language a role's screens render in. */
export function languageForRole(role: HumanRole): Language {
  return isFieldRole(role) ? useFieldLanguageStore.getState().language : "en";
}

/** Make i18next render in the role's language. Route loaders await this before the role's screen shows. */
export async function applyRoleLanguage(role: HumanRole): Promise<void> {
  const language = languageForRole(role);
  if (i18n.language !== language) await i18n.changeLanguage(language);
}

/** The Loader or Driver picked a language on a chip. The chips exist on field screens only. */
export function setFieldLanguage(language: Language): void {
  writeStored(LANGUAGE_KEY, language);
  useFieldLanguageStore.setState({ language });
  void i18n.changeLanguage(language);
}

/** The role's language, for the `lang` attribute of the screen root and the pressed language chip. */
export function useRoleLanguage(role: HumanRole): Language {
  const fieldLanguage = useFieldLanguageStore((s) => s.language);
  return isFieldRole(role) ? fieldLanguage : "en";
}
