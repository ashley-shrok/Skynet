// Phase 91 Plan 04 — ParticipantSearchInput.tsx
//
// Type-to-filter search input with clear-button affordance.
// Verbatim adaptation of PrettyConversationsPanel.tsx:1698-1729 search block.
//
// CSS class reuse: .pv-search-container / .pv-search-input / .pv-search-icon /
// .pv-search-clear — defined in pretty-conversations.css. NO new CSS defined here.
//
// Changes from the panel analog:
//   - data-testid values use 'participant-search-*' prefix
//   - aria-label = 'Search participants'
//   - placeholder = props.placeholder (default 'Search participants')
//   - onChange calls props.onChange with e.target.value (controlled — no local state)
//   - Clear onClick calls onChange('') — no local state

import { Search, X } from "lucide-react";

export function ParticipantSearchInput({
  value,
  onChange,
  placeholder = "Search participants",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div
      className="pv-search-container"
      data-testid="participant-search-container"
    >
      <Search
        className="pv-search-icon"
        aria-hidden="true"
        width={16}
        height={16}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pv-search-input"
        data-testid="participant-search-input"
        aria-label="Search participants"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="pv-search-clear"
          data-testid="participant-search-clear"
          aria-label="Clear search"
        >
          <X width={14} height={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
