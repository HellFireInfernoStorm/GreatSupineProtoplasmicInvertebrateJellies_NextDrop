import { cloneElement, type AriaAttributes, type ReactElement, type ReactNode } from "react";
import "./display.css";

type ControlProps = AriaAttributes & { id?: string; required?: boolean };
export interface FormFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactElement<ControlProps>;
}
export function FormField({ id, label, hint, error, required = false, children }: FormFieldProps) {
  const describedBy =
    [children.props["aria-describedby"], hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="nd-field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {cloneElement(children, {
        id,
        required: required || children.props.required,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        "aria-describedby": describedBy,
      })}
      {hint && (
        <div className="nd-field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
      {error && (
        <div className="nd-field-error" id={`${id}-error`}>
          {error}
        </div>
      )}
    </div>
  );
}
