import { describe, expect, it } from "vitest";
import { isReviewedString, localeFiles, resources, type LocaleTree } from "./resources";
import galleryEn from "../ui/gallery/locales/en.json";
import gallerySi from "../ui/gallery/locales/si.json";
import galleryTa from "../ui/gallery/locales/ta.json";

/** Every leaf of a locale tree as `path -> text`. */
function leaves(tree: LocaleTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else if (isReviewedString(value)) out.set(path, value.text);
    else for (const [p, text] of leaves(value, path)) out.set(p, text);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const english = localeFiles.en ?? {};
const fieldNamespaces = Object.keys(english).filter((ns) => /^(loader|driver|shared)\//.test(ns));

describe("locale files", () => {
  it.each(["si", "ta"])("preserves DEV gallery %s keys, placeholders and valid review states", (language) => {
    const tree = language === "si" ? gallerySi : galleryTa;
    const source = leaves(galleryEn);
    const target = leaves(tree);
    expect([...target.keys()].sort()).toEqual([...source.keys()].sort());
    for (const [path, text] of source) expect(placeholders(target.get(path)!)).toEqual(placeholders(text));
    const drafts = (node: LocaleTree) => {
      for (const value of Object.values(node)) {
        if (isReviewedString(value)) expect(["draft", "reviewed"]).toContain(value.review);
        else {
          expect(typeof value).toBe("object");
          drafts(value as LocaleTree);
        }
      }
    };
    drafts(tree);
    drafts(localeFiles[language]!["shared/ui"]!);
    // A native speaker may review leaves independently; key/placeholder coverage must keep passing.
    const reviewed = structuredClone(tree) as LocaleTree;
    const markReviewed = (node: LocaleTree) => {
      for (const value of Object.values(node)) {
        if (isReviewedString(value)) value.review = "reviewed";
        else if (typeof value === "object") markReviewed(value);
      }
    };
    markReviewed(reviewed);
    drafts(reviewed);
  });
  it("has English for every namespace, as plain strings", () => {
    expect(Object.keys(english).sort()).toEqual(
      [
        "dispatcher/login",
        "dispatcher/planning",
        "dispatcher/runs",
        "driver/login",
        "driver/run",
        "loader/login",
        "loader/dock",
        "shared/common",
        "shared/ui",
        "store/deliveries",
        "store/login",
        "store/notifications",
        "store/order",
        "store/receipt",
        "store/shell",
        "store/tracking",
      ].sort(),
    );
    // English is the source: plain strings, with no `{ text, review }` leaves. A key may still be called "review".
    const hasReviewState = (tree: LocaleTree): boolean =>
      Object.values(tree).some(
        (value) => typeof value !== "string" && (isReviewedString(value) || hasReviewState(value)),
      );
    for (const [namespace, tree] of Object.entries(english)) {
      expect(hasReviewState(tree), namespace).toBe(false);
    }
  });

  it.each(["si", "ta"])("has %s for every Loader, Driver and shared namespace, key for key", (language) => {
    const translated = localeFiles[language] ?? {};
    expect(Object.keys(translated).sort()).toEqual([...fieldNamespaces].sort());
    for (const namespace of fieldNamespaces) {
      const source = leaves(english[namespace]!);
      const target = leaves(translated[namespace]!);
      expect([...target.keys()].sort(), `${language} ${namespace}`).toEqual([...source.keys()].sort());
      for (const [path, text] of source) {
        expect(placeholders(target.get(path)!), `${language} ${namespace} ${path}`).toEqual(placeholders(text));
      }
    }
  });

  it.each(["si", "ta"])("gives every %s string a review state", (language) => {
    const check = (tree: LocaleTree, path: string) => {
      for (const [key, value] of Object.entries(tree)) {
        expect(typeof value, `${language} ${path}.${key} must be { text, review }`).toBe("object");
        if (typeof value === "object" && !isReviewedString(value)) check(value, `${path}.${key}`);
      }
    };
    for (const [namespace, tree] of Object.entries(localeFiles[language] ?? {})) check(tree, namespace);
  });

  it("hands i18next plain strings in every language", () => {
    expect(resources.ta?.["loader/login"]?.title).toBe("உள்நுழைக");
    expect(resources.si?.["driver/login"]?.title).toBe("පිවිසෙන්න");
    expect(resources.en?.["store/login"]?.title).toBe("Sign in");
  });
});
