import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { KitSearch } from "./fields";

// The one host picker: a search box over pickable rows, each with a status
// dot. Used wherever a single host is chosen (new role, new project, new
// session). Listbox semantics so keyboard users and tests can find options.

export interface KitHostOption {
  id: string;
  name: string;
  /** Dimmed text on the right (user name, "slow", "offline"…). */
  detail?: React.ReactNode;
  status?: "ok" | "warn" | "off";
  /** Unpickable (shown dimmed). */
  disabled?: boolean;
  /** Extra text the search also matches (user name, address…). */
  searchText?: string;
}

export interface KitHostPickerProps {
  hosts: ReadonlyArray<KitHostOption>;
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
  disabled?: boolean;
  /** Prefix for data-testids: `<p>-search`, `<p>-listbox`, `<p>-option-<id>`. */
  testIdPrefix?: string;
  searchId?: string;
  /** Hide the search box (few hosts). Defaults to hiding at ≤ 4 hosts. */
  searchable?: boolean;
  maxHeight?: number;
  emptyText?: React.ReactNode;
  className?: string;
}

export function KitHostPicker({
  hosts,
  selectedId,
  onSelect,
  disabled,
  testIdPrefix,
  searchId,
  searchable,
  maxHeight = 232,
  emptyText = "No hosts match your search.",
  className,
}: KitHostPickerProps): JSX.Element {
  const [query, setQuery] = React.useState("");
  const showSearch = searchable ?? hosts.length > 4;
  const q = query.trim().toLowerCase();
  const visible = q
    ? hosts.filter((h) => `${h.name} ${h.searchText ?? ""}`.toLowerCase().includes(q))
    : hosts;
  const tid = (s: string) => (testIdPrefix ? `${testIdPrefix}-${s}` : undefined);
  return (
    <div className={cn("flex flex-col gap-2 min-w-0", className)} data-slot="kit-host-picker">
      {showSearch ? (
        <KitSearch
          id={searchId}
          value={query}
          onValueChange={setQuery}
          placeholder="Search hosts"
          aria-label="Search hosts"
          disabled={disabled}
          data-testid={tid("search")}
        />
      ) : null}
      <div
        className="k-group overflow-y-auto"
        style={{ maxHeight }}
        role="listbox"
        aria-label="Hosts"
        data-testid={tid("listbox")}
      >
        {visible.length === 0 ? (
          <div className="k-row justify-center text-[13px]" style={{ color: "var(--k-t3)" }}>
            {emptyText}
          </div>
        ) : (
          visible.map((h) => {
            const selected = selectedId === h.id;
            const off = disabled || h.disabled;
            return (
              <button
                key={h.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={off || undefined}
                disabled={off}
                onClick={() => onSelect(h.id)}
                data-testid={tid(`option-${h.id}`)}
                className="k-row"
                data-disabled={h.disabled ? "true" : undefined}
              >
                <span
                  className="k-status"
                  data-status={h.status === "ok" ? "ok" : h.status === "warn" ? "warn" : undefined}
                  aria-hidden="true"
                />
                <span className="k-row-text">
                  <span className="k-row-label truncate">{h.name}</span>
                </span>
                {h.detail ? <span className="k-row-value truncate max-w-[45%]">{h.detail}</span> : null}
                <Check
                  aria-hidden="true"
                  className="shrink-0"
                  style={{ width: 15, height: 15, color: "var(--k-acc-text)", visibility: selected ? "visible" : "hidden" }}
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
