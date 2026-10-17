// Phase 91 Plan 04 — ParticipantSearchInput.tsx
//
// Type-to-filter search input with clear-button affordance.
// Verbatim adaptation of PrettyConversationsPanel.tsx:1698-1729 search block.
//
// apple-ux: built on the kit's KitSearch (clear button + Esc-to-clear come
// with it).
//
// Changes from the panel analog:
//   - data-testid values use 'participant-search-*' prefix
//   - aria-label = 'Search participants'
//   - placeholder = props.placeholder (default 'Search participants')
//   - onChange calls props.onChange with e.target.value (controlled — no local state)
//   - Clear onClick calls onChange('') — no local state

import { KitSearch } from "@/components/kit";

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
    <div data-testid="participant-search-container">
      <KitSearch
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        data-testid="participant-search-input"
        clearTestId="participant-search-clear"
        aria-label="Search participants"
      />
    </div>
  );
}
