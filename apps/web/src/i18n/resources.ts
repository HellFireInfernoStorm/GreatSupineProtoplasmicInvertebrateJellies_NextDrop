// Locale files: `locales/<language>/<role>/<namespace>.json`, one file per role and namespace so two roles' strings
// never share a file (agent-docs/process/collisions.md). The i18next namespace is `<role>/<namespace>`.
//
// `en` is the source and holds plain strings. `si` and `ta` hold `{ "text": …, "review": "draft" | "reviewed" }`
// for every string, so the strings still waiting for a native review can be listed
// (spec/frontend/design-system.md, Localization).

export const LANGUAGES = ["en", "si", "ta"] as const;
export type Language = (typeof LANGUAGES)[number];

export type ReviewState = "draft" | "reviewed";
export interface ReviewedString {
  text: string;
  review: ReviewState;
}

export interface LocaleTree {
  [key: string]: string | ReviewedString | LocaleTree;
}
export interface StringTree {
  [key: string]: string | StringTree;
}

const files = import.meta.glob<LocaleTree>("./locales/*/*/*.json", { eager: true, import: "default" });

export function isReviewedString(value: unknown): value is ReviewedString {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReviewedString).text === "string" &&
    ((value as ReviewedString).review === "draft" || (value as ReviewedString).review === "reviewed")
  );
}

/** Drop the review state: i18next wants plain strings. */
export function toStrings(tree: LocaleTree): StringTree {
  const out: StringTree = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out[key] = value;
    else if (isReviewedString(value)) out[key] = value.text;
    else out[key] = toStrings(value);
  }
  return out;
}

/** Every locale file as written, keyed by language then namespace. */
export const localeFiles: Record<string, Record<string, LocaleTree>> = {};
for (const [path, tree] of Object.entries(files)) {
  const match = /^\.\/locales\/([^/]+)\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, language, role, namespace] = match as unknown as [string, string, string, string];
  (localeFiles[language] ??= {})[`${role}/${namespace}`] = tree;
}

/** The i18next resources: language, then namespace, then plain strings. */
export const resources: Record<string, Record<string, StringTree>> = Object.fromEntries(
  Object.entries(localeFiles).map(([language, namespaces]) => [
    language,
    Object.fromEntries(Object.entries(namespaces).map(([namespace, tree]) => [namespace, toStrings(tree)])),
  ]),
);
