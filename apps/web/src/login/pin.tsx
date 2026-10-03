import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, setFieldLanguage } from "../i18n/language";
import { LANGUAGES, type Language } from "../i18n/resources";
import { PIN_KEY_ATTRIBUTE, PIN_LENGTH } from "./usePinLogin";

// The pieces the Loader and Driver sign-in share. Sizes differ per role, so each takes the classes for its targets.

interface LanguageChipsProps {
  language: Language;
  /** Classes for one chip: its height, padding and text size. */
  chipClassName: string;
}

export function LanguageChips({ language, chipClassName }: LanguageChipsProps) {
  const { t } = useTranslation("shared/common");
  return (
    <div role="group" aria-label={t("language.label")} className="flex gap-2">
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === language}
          onClick={() => setFieldLanguage(option)}
          className={`rounded-full font-semibold ${chipClassName} ${
            option === language ? "bg-primary text-on-primary" : "bg-surface text-muted"
          }`}
        >
          {LANGUAGE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

interface PinDotsProps {
  filled: number;
  /** Changes on every failed attempt and replays the shake. */
  attempt: number;
  label: string;
  /** Classes for the box: its height, radius, border width, padding and gap. */
  className: string;
  /** Classes for one dot: its size and border width. */
  dotClassName: string;
}

export function PinDots({ filled, attempt, label, className, dotClassName }: PinDotsProps) {
  return (
    <div
      key={attempt}
      role="img"
      aria-label={label}
      className={`flex items-center border-border bg-surface ${className} ${
        attempt > 0 ? "animate-shake motion-reduce:animate-none" : ""
      }`}
    >
      {Array.from({ length: PIN_LENGTH }, (_, index) => (
        <span
          key={index}
          className={`rounded-full ${dotClassName} ${index < filled ? "border-text bg-text" : "border-border"}`}
        />
      ))}
    </div>
  );
}

interface KeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  backspaceLabel: string;
  /** Classes for the grid: its gap. */
  className: string;
  /** Classes for one key: its size, radius and text size. */
  keyClassName: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", null, "0", "back"] as const;

export function Keypad({ onDigit, onBackspace, backspaceLabel, className, keyClassName }: KeypadProps) {
  return (
    <div className={`grid grid-cols-3 ${className}`}>
      {KEYS.map((key) => {
        if (key === null) return <span key="blank" />;
        const isBack = key === "back";
        return (
          <button
            key={key}
            type="button"
            {...{ [PIN_KEY_ATTRIBUTE]: "" }}
            aria-label={isBack ? backspaceLabel : undefined}
            onClick={() => (isBack ? onBackspace() : onDigit(key))}
            className={`flex items-center justify-center bg-surface-2 font-bold text-text active:bg-border ${keyClassName}`}
          >
            {isBack ? "⌫" : key}
          </button>
        );
      })}
    </div>
  );
}
