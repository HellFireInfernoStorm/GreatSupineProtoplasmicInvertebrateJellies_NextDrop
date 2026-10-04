import { useState } from "react";

interface PasswordFieldProps {
  id: string;
  label: string;
  placeholder: string;
  showLabel: string;
  hideLabel: string;
  value: string;
  onChange: (value: string) => void;
  /** The message under the field (the Figma rationale's "red line under the field"), if any. */
  error?: string;
  /** Classes for the input box: its height and radius. */
  inputClassName: string;
}

/** The password field of the Store and Dispatcher logins, with its show or hide toggle and its error line. */
export function PasswordField({
  id,
  label,
  placeholder,
  showLabel,
  hideLabel,
  value,
  onChange,
  error,
  inputClassName,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name="password"
          type={shown ? "text" : "password"}
          autoComplete="current-password"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${inputClassName} pr-16 ${error ? "border-danger" : "border-border"}`}
        />
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          className="absolute inset-y-0 right-3.5 text-sm font-semibold text-info"
        >
          {shown ? hideLabel : showLabel}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
