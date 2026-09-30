/**
 * Conversation search modal.
 *
 * Locked behaviors (see .planning/phases/122-conversation-search-modal/
 * 122-CONTEXT.md decisions):
 *   D-01: Enter is the SOLE trigger for the network call. Typing only
 *         updates local input value + notifies the store via
 *         setSearchQuery.
 *   D-03: NO keyboard shortcut opens the modal — this component registers
 *         ZERO global keydown listeners. The parent panel's magnifying-
 *         glass button is the only open path.
 *   D-04: Clicking an active result closes the modal (via onOpenChange
 *         false) after invoking the parent's onOpenActiveConversation.
 *   D-05: Modal state (query + results) is persisted in the module-scoped
 *         search-store (not in local component state) so it survives
 *         unmount + remount.
 *   D-06: Empty-state placeholder is gated on `!hasEverOpened || (query
 *         === "" && results.length === 0 && localValue.length === 0)`.
 *         Once the user has searched at least once, the placeholder
 *         doesn't reappear on clear.
 *   D-11: Snippet + highlight rendered via ConversationSearchRow — React
 *         text children + <span> split, NO raw-HTML injection.
 *   D-12: Load more increments offset by results.length and appends the
 *         next page.
 *   D-14: Active-result click routes to onOpenActiveConversation + closes.
 *   D-15: Archived-result click fires window.alert with a blunt "coming
 *         soon" message; modal stays open (D-16 unarchiving out of scope).
 *
 * T-122-FE-03 mitigation: load-more button binds `disabled` to isFetching;
 * handler calls beginLoadMore() before the network hop (flips isFetching
 * true + bumps request-id), and appendResults() flips it back to false on
 * resolve. Rapid clicks are no-ops.
 *
 * Request-id stale-response guard: startNewSearch and beginLoadMore each
 * bump a monotonic id and return it. The handler snapshots the id before
 * awaiting the fetch and passes it to appendResults/setError. Stale
 * responses (from a superseded query or an unmounted modal) are silently
 * dropped, preventing "typed foo, then bar, then foo's results overwrite
 * bar's results" and React duplicate-key warnings from load-more races.
 *
 * Chrome (2026-09-29 modal-unification pass): composes from the canonical
 * <Modal> + <ModalHead> + <ModalBody> + conditional <ModalFoot>. Visible
 * title in the head; the search input lives in a distinct filter-bar row
 * BELOW the head (matches tasting anatomy — see modal-tasting.html
 * L2466-2515). Load more is inline at the end of the results list; the
 * foot is rendered ONLY when there's an error to surface. Backdrop click
 * never dismisses (unified rule at the Modal layer — no per-modal opt-in).
 */

import { useEffect, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { cn } from "@/lib/utils";
import {
  searchConversations,
  type ConversationSearchResult,
} from "@/api/conversation-search-api";
import {
  useSearchState,
  startNewSearch,
  beginLoadMore,
  clearSearch,
  appendResults,
  setError,
} from "@/state/search-store";
import { ConversationSearchRow } from "./ConversationSearchRow";

const PAGE_SIZE = 20; // D-12: 20 results per fetch

export interface ConversationSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called when the user clicks an ACTIVE (isArchived === false) result.
   * The parent (AppShell via PrettyConversationsPanel) resolves the hostId
   * to a Host object and calls openTab(host, "terminal", …). See
   * AppShell.tsx onSearchResultOpenActive.
   */
  onOpenActiveConversation: (result: ConversationSearchResult) => void;
}

export function ConversationSearchModal({
  open,
  onOpenChange,
  onOpenActiveConversation,
}: ConversationSearchModalProps): JSX.Element {
  const state = useSearchState();
  // Local controlled input value — separate from state.query so typing
  // doesn't fire the network (D-01) and so the input remains responsive
  // even when the store's query is stale (e.g. user typed "foo" but hasn't
  // pressed Enter yet — state.query is still the previous fired query).
  const [localValue, setLocalValue] = useState<string>(state.query);

  // On open→true transition, re-seed the local input from the store's
  // last-fired query. If the user closed the modal mid-edit (localValue
  // diverged from state.query), reopening restores the last FIRED query
  // (matches the "results correspond to state.query" invariant, per D-05).
  useEffect(() => {
    if (open) {
      setLocalValue(state.query);
    }
    // Deliberately only depend on `open` transitions — we do NOT want to
    // re-seed on every state.query update (that would fight the user's
    // typing while the modal is open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleEnter(): Promise<void> {
    const trimmed = localValue.trim();
    if (trimmed.length === 0) return;

    console.info({
      operation: "conversation_search_query_fire",
      queryLength: trimmed.length,
    });

    const reqId = startNewSearch(trimmed);
    try {
      const response = await searchConversations(trimmed, 0, PAGE_SIZE);
      appendResults(response.results, response.hasMore, reqId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown_error";
      console.info({
        operation: "conversation_search_query_error",
        error: msg,
      });
      setError(msg, reqId);
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (state.isFetching) return; // defense-in-depth against rapid clicks
    const reqId = beginLoadMore();
    const queryAtStart = state.query;
    const offsetAtStart = state.results.length;
    try {
      const response = await searchConversations(
        queryAtStart,
        offsetAtStart,
        PAGE_SIZE,
      );
      appendResults(response.results, response.hasMore, reqId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown_error";
      console.info({
        operation: "conversation_search_load_more_error",
        error: msg,
      });
      setError(msg, reqId);
    }
  }

  function handleClear(): void {
    clearSearch();
    setLocalValue("");
  }

  function handleRowClick(result: ConversationSearchResult): void {
    if (result.isArchived) {
      // D-15: blunt browser alert; modal stays open (D-16 unarchiving OOS).
      // NOTE: window.alert blocks the JS thread — that's fine for a modal
      // dead-end, matches the "no soft misdirection" intent in CONTEXT.md.
      // eslint-disable-next-line no-alert
      window.alert(
        "Opening archived conversations isn't wired up yet — coming soon.",
      );
      console.info({
        operation: "conversation_search_archived_click",
        identityKey: result.identityKey,
        hostId: result.hostId,
      });
      return;
    }
    console.info({
      operation: "conversation_search_active_click",
      identityKey: result.identityKey,
      hostId: result.hostId,
      tmuxSessionName: result.tmuxSessionName,
    });
    onOpenActiveConversation(result);
    onOpenChange(false);
  }

  // Empty-state gate (D-06): shown only if hasEverOpened is false OR if
  // the user has explicitly cleared (state.query === "" && no results &&
  // localValue empty).
  const showEmptyState =
    !state.hasEverOpened ||
    (state.query === "" &&
      state.results.length === 0 &&
      localValue.length === 0);

  const showSearching = state.isFetching && state.results.length === 0;
  const showNoResults =
    !state.isFetching &&
    !showEmptyState &&
    state.results.length === 0 &&
    state.query.length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="list"
      data-testid="conversation-search-modal"
    >
      <ModalHead title="Search conversations" />

      {/* Filter bar — search input + optional clear button. Sits directly
          below the head; tasting `.filter-bar` recipe (dark tint, hue-tinted
          bottom border, flex-shrink-0). autoFocus so the input takes focus
          on open. */}
      <div
        className={cn(
          "px-4 py-2.5 flex flex-row items-center gap-2 flex-shrink-0",
          "bg-black/25",
          "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
        )}
      >
        <Search size={16} className="shrink-0 text-[hsla(var(--pv-id-hue),22%,88%,0.6)]" />
        <input
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleEnter();
            }
          }}
          placeholder="Search conversations..."
          data-testid="conversation-search-input"
          /* eslint-disable-next-line jsx-a11y/no-autofocus */
          autoFocus
          className={cn(
            "flex-1 min-w-0 px-2 py-1 rounded-md text-[12.5px] outline-none",
            "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
            "text-[#fbf5e8]",
            "focus:border-[hsla(var(--pv-id-hue),70%,60%,0.5)]",
            "placeholder:text-[hsla(var(--pv-id-hue),22%,88%,0.45)]",
            "transition-colors duration-150",
          )}
        />
        {localValue.length > 0 && (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear"
            onClick={handleClear}
            data-testid="conversation-search-clear-button"
            className={cn(
              "shrink-0 cursor-pointer size-7 rounded-md flex items-center justify-center",
              "text-[hsla(var(--pv-id-hue),22%,88%,0.7)]",
              "hover:text-[#fbf5e8] hover:bg-black/25",
              "transition-colors duration-150",
            )}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body — results list / empty / searching / no-results, and the
          inline Load more anchor at the end of the list (tasting places
          Load more inside the list body, not in a distinct foot). */}
      <ModalBody
        className="p-0 overflow-y-auto flex flex-col gap-1.5 px-3 py-2.5"
        data-testid="conversation-search-body"
      >
        {showSearching && (
          <div
            className="flex items-center gap-2 px-2 py-4 text-[12.5px] text-[hsla(var(--pv-id-hue),22%,88%,0.7)]"
            data-testid="conversation-search-searching"
          >
            <Loader2 className="size-4 animate-spin" />
            Searching...
          </div>
        )}
        {showEmptyState && !showSearching && (
          <div
            className="px-2 py-4 text-[12.5px] text-[hsla(var(--pv-id-hue),22%,88%,0.6)]"
            data-testid="conversation-search-empty-state"
          >
            Type a query and press Enter
          </div>
        )}
        {showNoResults && (
          <div
            className="px-2 py-4 text-[12.5px] text-[hsla(var(--pv-id-hue),22%,88%,0.6)]"
            data-testid="conversation-search-no-results"
          >
            No results for &quot;{state.query}&quot;
          </div>
        )}
        {state.results.map((r) => (
          <ConversationSearchRow
            key={r.transcriptPath}
            result={r}
            onClick={() => handleRowClick(r)}
          />
        ))}
        {state.hasMore && (
          <div className="flex justify-center pt-2 pb-1">
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={state.isFetching}
              data-testid="conversation-search-load-more"
              className={cn(
                "px-3 py-1.5 rounded-md text-[12px]",
                "bg-[hsla(var(--pv-id-hue),65%,55%,0.20)]",
                "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
                "border border-[hsla(var(--pv-id-hue),65%,55%,0.30)]",
                "text-[#fbf5e8]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-colors duration-150",
              )}
            >
              {state.isFetching ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </ModalBody>

      {/* Foot — rendered ONLY when there's an error to surface. Tasting
          shows no ambient foot for this modal. */}
      {state.error && (
        <ModalFoot className="justify-center">
          <div
            role="alert"
            className="text-[11px] text-red-400"
            data-testid="conversation-search-error"
          >
            {state.error}
          </div>
        </ModalFoot>
      )}
    </Modal>
  );
}
