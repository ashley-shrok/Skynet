import * as React from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { KitIconButton } from "./buttons";

// Kit fields. One filled shape for single-line, dropdown and multi-line
// input; label above, help or error below, outline only on focus. KitField
// wires the label/help/error ids onto its control so callers don't have to.

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useFieldControl(
  id: string | undefined,
  describedBy: string | undefined,
  invalid: boolean | undefined,
) {
  const ctx = React.useContext(FieldContext);
  return {
    id: id ?? ctx?.id,
    "aria-describedby": describedBy ?? ctx?.describedBy,
    "aria-invalid": invalid ?? ctx?.invalid ? true : undefined,
  };
}

export interface KitFieldProps {
  label?: React.ReactNode;
  help?: React.ReactNode;
  /** Shown instead of help, in the problem colour; marks the control invalid. */
  error?: React.ReactNode;
  /** Id for the control. Generated when omitted. */
  htmlFor?: string;
  /** Extra content on the label line, right-aligned (e.g. a reset link). */
  labelAction?: React.ReactNode;
  /** The child is a group of controls (chips, radios), not one form
   *  control: the label names the group instead of pointing at an input. */
  group?: boolean;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

export function KitField({
  label,
  help,
  error,
  htmlFor,
  labelAction,
  group,
  className,
  children,
  "data-testid": testId,
}: KitFieldProps): JSX.Element {
  const autoId = React.useId();
  const id = htmlFor ?? `kf-${autoId}`;
  const noteId = `${id}-note`;
  const hasNote = !!(error || help);
  return (
    <FieldContext.Provider
      value={{ id, describedBy: hasNote ? noteId : undefined, invalid: !!error }}
    >
      <div
        className={cn("k-field", className)}
        data-testid={testId}
        role={group ? "group" : undefined}
        aria-labelledby={group && label ? `${id}-label` : undefined}
        aria-describedby={group && hasNote ? noteId : undefined}
      >
        {label || labelAction ? (
          <div className="flex items-center justify-between gap-2">
            {label && group ? (
              <span className="k-label" id={`${id}-label`}>
                {label}
              </span>
            ) : label ? (
              <label className="k-label" htmlFor={id}>
                {label}
              </label>
            ) : (
              <span />
            )}
            {labelAction}
          </div>
        ) : null}
        {children}
        {error ? (
          <span id={noteId} className="k-err" role="alert">
            {error}
          </span>
        ) : help ? (
          <span id={noteId} className="k-help">
            {help}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export interface KitInputProps extends Omit<React.ComponentProps<"input">, "size"> {
  size?: "md" | "sm";
  mono?: boolean;
  invalid?: boolean;
}

export const KitInput = React.forwardRef<HTMLInputElement, KitInputProps>(
  function KitInput({ className, size = "md", mono, invalid, id, "aria-describedby": db, ...props }, ref) {
    const a = useFieldControl(id, db, invalid);
    return (
      <input
        ref={ref}
        data-slot="kit-input"
        data-size={size === "sm" ? "sm" : undefined}
        data-mono={mono ? "true" : undefined}
        className={cn("k-input", className)}
        {...a}
        {...props}
      />
    );
  },
);

export interface KitTextareaProps extends React.ComponentProps<"textarea"> {
  mono?: boolean;
  invalid?: boolean;
}

export const KitTextarea = React.forwardRef<HTMLTextAreaElement, KitTextareaProps>(
  function KitTextarea({ className, mono, invalid, id, "aria-describedby": db, ...props }, ref) {
    const a = useFieldControl(id, db, invalid);
    return (
      <textarea
        ref={ref}
        data-slot="kit-textarea"
        data-mono={mono ? "true" : undefined}
        className={cn("k-textarea", className)}
        {...a}
        {...props}
      />
    );
  },
);

export interface KitSelectProps extends Omit<React.ComponentProps<"select">, "size"> {
  size?: "md" | "sm";
  invalid?: boolean;
}

/** Native dropdown in the kit's shape. Options/optgroups are children. */
export const KitSelect = React.forwardRef<HTMLSelectElement, KitSelectProps>(
  function KitSelect({ className, size = "md", invalid, id, "aria-describedby": db, ...props }, ref) {
    const a = useFieldControl(id, db, invalid);
    return (
      <select
        ref={ref}
        data-slot="kit-select"
        data-size={size === "sm" ? "sm" : undefined}
        className={cn("k-select", className)}
        {...a}
        {...props}
      />
    );
  },
);

export interface KitSearchProps extends Omit<React.ComponentProps<"input">, "size" | "onChange" | "value"> {
  value: string;
  onValueChange: (next: string) => void;
  /** Shows a clear button while there is text. Esc also clears (and the
   *  modal stays open). Default true. */
  clearable?: boolean;
  wrapperClassName?: string;
  clearTestId?: string;
}

export const KitSearch = React.forwardRef<HTMLInputElement, KitSearchProps>(
  function KitSearch(
    { value, onValueChange, clearable = true, wrapperClassName, className, clearTestId, onKeyDown, placeholder = "Search", ...props },
    ref,
  ) {
    const showClear = clearable && value.length > 0;
    return (
      <div className={cn("k-search", wrapperClassName)} data-slot="kit-search">
        <SearchIcon aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && clearable && value) {
              e.preventDefault();
              e.stopPropagation();
              onValueChange("");
            }
            onKeyDown?.(e);
          }}
          // While there's text to clear, Esc belongs to the field, not the modal.
          {...(clearable && value ? { "data-modal-esc-local": "" } : {})}
          data-has-clear={showClear ? "true" : undefined}
          className={cn("k-input", className)}
          {...props}
        />
        {showClear ? (
          <KitIconButton
            label="Clear search"
            size="sm"
            data-testid={clearTestId}
            onClick={() => onValueChange("")}
          >
            <XIcon />
          </KitIconButton>
        ) : null}
      </div>
    );
  },
);
