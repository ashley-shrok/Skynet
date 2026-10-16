import * as React from "react";

import { cn } from "@/lib/utils";

// Kit choices: switch (on/off), checkbox (tick items in a list), round
// one-of-a-few choice, slider, segmented control, chips and pick-chips.
// All native inputs underneath — keyboard and screen readers come free.

export interface KitSwitchProps
  extends Omit<React.ComponentProps<"input">, "type" | "onChange" | "checked"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}

export const KitSwitch = React.forwardRef<HTMLInputElement, KitSwitchProps>(
  function KitSwitch({ checked, onCheckedChange, className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        data-slot="kit-switch"
        className={cn("k-switch", className)}
        {...props}
      />
    );
  },
);

export interface KitCheckboxProps
  extends Omit<React.ComponentProps<"input">, "type" | "onChange" | "checked"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  indeterminate?: boolean;
}

export const KitCheckbox = React.forwardRef<HTMLInputElement, KitCheckboxProps>(
  function KitCheckbox({ checked, onCheckedChange, indeterminate, className, ...props }, outerRef) {
    const ref = React.useRef<HTMLInputElement | null>(null);
    React.useEffect(() => {
      if (ref.current) ref.current.indeterminate = !!indeterminate;
    }, [indeterminate]);
    return (
      <input
        ref={(el) => {
          ref.current = el;
          if (typeof outerRef === "function") outerRef(el);
          else if (outerRef) outerRef.current = el;
        }}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        data-slot="kit-checkbox"
        className={cn("k-check", className)}
        {...props}
      />
    );
  },
);

export const KitRadio = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  function KitRadio({ className, ...props }, ref) {
    return <input ref={ref} type="radio" data-slot="kit-radio" className={cn("k-radio", className)} {...props} />;
  },
);

/** A control (switch, checkbox, radio) with its clickable label beside it. */
export function KitOption({
  control,
  label,
  description,
  disabled,
  className,
  "data-testid": testId,
}: {
  control: React.ReactElement;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}): JSX.Element {
  return (
    <label
      className={cn("k-opt", className)}
      data-disabled={disabled ? "true" : undefined}
      data-testid={testId}
    >
      {control}
      <span className="k-opt-text">
        <span>{label}</span>
        {description ? <span className="k-opt-desc">{description}</span> : null}
      </span>
    </label>
  );
}

export interface KitSliderProps
  extends Omit<React.ComponentProps<"input">, "type" | "onChange" | "value" | "min" | "max"> {
  value: number;
  min: number;
  max: number;
  onValueChange: (next: number) => void;
}

export const KitSlider = React.forwardRef<HTMLInputElement, KitSliderProps>(
  function KitSlider({ value, min, max, onValueChange, className, style, ...props }, ref) {
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        data-slot="kit-slider"
        className={cn("k-range", className)}
        style={{ ...style, ["--k-p" as string]: `${pct}%` }}
        {...props}
      />
    );
  },
);

export interface KitSegmentOption<V extends string> {
  value: V;
  label: React.ReactNode;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
  testId?: string;
}

export interface KitSegmentedProps<V extends string> {
  options: ReadonlyArray<KitSegmentOption<V>>;
  value: V;
  onValueChange: (next: V) => void;
  /** Stretch to full width with equal segments. */
  full?: boolean;
  "aria-label"?: string;
  className?: string;
  /** Each segment gets data-testid `<testIdPrefix>-<value>` unless it sets its own. */
  testIdPrefix?: string;
  "data-testid"?: string;
}

/** One choice among a few, all visible. Also the look of a modal's tabs. */
export function KitSegmented<V extends string>({
  options,
  value,
  onValueChange,
  full,
  className,
  testIdPrefix,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: KitSegmentedProps<V>): JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="kit-segmented"
      data-full={full ? "true" : undefined}
      data-testid={testId}
      className={cn("k-seg", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          data-testid={o.testId ?? (testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined)}
          onClick={() => onValueChange(o.value)}
        >
          {o.Icon ? <o.Icon size={14} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type KitChipTone = "neutral" | "accent" | "ok" | "warn" | "danger";

/** A status label. Not clickable. */
export function KitChip({
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: KitChipTone; dot?: boolean }): JSX.Element {
  return (
    <span
      data-slot="kit-chip"
      data-tone={tone === "neutral" ? undefined : tone}
      className={cn("k-chip", className)}
      {...props}
    >
      {dot ? <span className="k-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A chip you tap to toggle (hosts, weekdays, roles). */
export const KitPickChip = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentProps<"button">, "onChange"> & {
    pressed: boolean;
    onPressedChange: (next: boolean) => void;
    round?: boolean;
  }
>(function KitPickChip({ pressed, onPressedChange, round, className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      data-round={round ? "true" : undefined}
      data-slot="kit-pick-chip"
      className={cn("k-pick", className)}
      onClick={() => onPressedChange(!pressed)}
      {...props}
    />
  );
});

export function KitPickRow({ className, ...props }: React.ComponentProps<"div">): JSX.Element {
  return <div role="group" className={cn("k-pick-row", className)} {...props} />;
}
