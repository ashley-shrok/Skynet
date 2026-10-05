import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Dropdown multi-select: a combobox-style trigger showing the picked options
 * as pills, opening a filterable list where each option toggles on click and
 * the list stays open for further picks. `value` is kept in pick order —
 * toggling an option on appends it.
 *
 * Styled for the dark modal surfaces (same palette as the old native
 * <select> option rows). The list is portaled, so it is never clipped by a
 * scrolling modal body; Modal already ignores outside interactions, so
 * clicks inside the list don't dismiss the dialog.
 */
export function MultiSelect({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  placeholder = "Pick…",
  disabled = false,
}: {
  id?: string;
  ariaLabel: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const labelOf = useMemo(() => {
    const m = new Map(options.map((o) => [o.value, o.label]));
    return (v: string) => m.get(v) ?? v;
  }, [options]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
      )
    : options;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open && !disabled}
          disabled={disabled}
          className="flex w-full min-h-[34px] items-center gap-1.5 rounded-sm border border-[color:var(--color-pv-border-quiet-strong)] bg-white/[0.06] px-2 py-1.5 text-left text-xs text-[color:var(--color-pv-fg)] outline-none disabled:opacity-50"
        >
          <span className="flex flex-1 flex-wrap gap-1 min-w-0">
            {value.length === 0 ? (
              <span className="px-1 text-[color:var(--color-pv-fg-muted)]">
                {placeholder}
              </span>
            ) : (
              value.map((v) => (
                <span
                  key={v}
                  data-selected-value={v}
                  className="rounded-full bg-white/[0.12] px-2 py-0.5"
                >
                  {labelOf(v)}
                </span>
              ))
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-1 border-[color:var(--color-pv-border-quiet-strong)] bg-[#1a1c26] text-[#f0ebe0]"
        // Keep focus on the trigger flow; the filter input takes it on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {options.length > 6 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label={`Filter ${ariaLabel.toLowerCase()}`}
            autoFocus
            className="mb-1 w-full rounded-sm bg-black/20 px-2 py-1.5 text-xs outline-none placeholder:text-[#f0ebe0]/50"
          />
        )}
        <div
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable="true"
          className="max-h-60 overflow-y-auto"
        >
          {visible.map((o) => {
            const selected = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-value={o.value}
                onClick={() => toggle(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none",
                  "hover:bg-white/[0.08] focus-visible:bg-white/[0.08]",
                )}
              >
                <Check
                  className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                {o.label}
              </button>
            );
          })}
          {visible.length === 0 && (
            <div className="px-2 py-3 text-center text-xs opacity-60">No matches</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
