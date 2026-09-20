/**
 * Phase 122 Plan 122-03 Task 2 — Conversation search modal.
 *
 * Radix DialogPrimitive shell lifted verbatim from NewConversationModal.tsx
 * (L268-441 — the glass-morphism chrome recipe). Body holds a search
 * input, results list, and a Load more button. Footer surfaces the result
 * count / error.
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
 * handler calls setFetching(true) before the network hop, and
 * appendResults() flips it back to false on resolve. Rapid clicks are
 * no-ops.
 */

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchConversations,
  type ConversationSearchResult,
} from "@/api/conversation-search-api";
import {
  useSearchState,
  startNewSearch,
  clearSearch,
  appendResults,
  setFetching,
  setError,
} from "@/state/search-store";
import { ConversationSearchRow } from "./ConversationSearchRow";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20; // D-12: 20 results per fetch

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

    startNewSearch(trimmed);
    try {
      const response = await searchConversations(trimmed, 0, PAGE_SIZE);
      appendResults(response.results, response.hasMore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown_error";
      console.info({
        operation: "conversation_search_query_error",
        error: msg,
      });
      setError(msg);
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (state.isFetching) return; // defense-in-depth against rapid clicks
    setFetching(true);
    try {
      const response = await searchConversations(
        state.query,
        state.results.length,
        PAGE_SIZE,
      );
      appendResults(response.results, response.hasMore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown_error";
      console.info({
        operation: "conversation_search_load_more_error",
        error: msg,
      });
      setError(msg);
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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogPrimitive.Portal>
        {/* Overlay — same z-index ladder as NewConversationModal L272-278 */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        {/* Content — mobile inset-4, desktop centered 560×720 (same recipe) */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Patch #111f pattern: X + Esc are the only close paths.
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "md:max-w-[560px] md:max-h-[720px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Search conversations
          </DialogPrimitive.Title>

          {/* ─── Header (search input + clear + close) ─────────────────── */}
          <div
            className="px-4 py-3 shrink-0 flex flex-row items-center gap-2"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <Search size={18} className="shrink-0 text-[#a89a80]" />
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
                "flex-1 px-2 py-1.5 rounded-md text-sm text-[#e8e4d8]",
                "bg-black/20 border border-white/10 outline-none",
                "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
                "placeholder:text-[color:var(--color-pv-fg-dim)]",
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
                className="shrink-0 cursor-pointer size-8 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-colors duration-150"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
              >
                <X className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              title="Close"
              onClick={() => onOpenChange(false)}
              data-testid="conversation-search-close-button"
              className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-colors duration-150"
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(220, 225, 245, 0.10)",
              }}
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ─── Body (results list / empty / searching) ─────────────── */}
          <div
            className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2 py-2 gap-1"
            data-testid="conversation-search-body"
          >
            {showSearching && (
              <div
                className="flex items-center gap-2 px-4 py-6 text-sm text-[color:var(--color-pv-fg-muted)]"
                data-testid="conversation-search-searching"
              >
                <Loader2 className="size-4 animate-spin" />
                Searching...
              </div>
            )}
            {showEmptyState && !showSearching && (
              <div
                className="px-4 py-6 text-sm text-[color:var(--color-pv-fg-muted)]"
                data-testid="conversation-search-empty-state"
              >
                Type a query and press Enter
              </div>
            )}
            {showNoResults && (
              <div
                className="px-4 py-6 text-sm text-[color:var(--color-pv-fg-muted)]"
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
          </div>

          {/* ─── Footer (Load more + error) ──────────────────────────── */}
          {(state.hasMore || state.error) && (
            <div
              className="px-4 py-3 shrink-0 flex flex-col gap-2"
              style={{ borderTop: "1px solid rgba(220, 225, 245, 0.10)" }}
            >
              {state.hasMore && (
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={state.isFetching}
                  data-testid="conversation-search-load-more"
                  className={cn(
                    "w-full px-3 py-2 rounded-md text-sm",
                    "bg-black/20 border border-white/10 outline-none",
                    "text-[#e8e4d8] hover:bg-black/30 transition-colors duration-150",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {state.isFetching ? "Loading..." : "Load more"}
                </button>
              )}
              {state.error && (
                <div
                  role="alert"
                  className="text-xs text-center text-red-400"
                  data-testid="conversation-search-error"
                >
                  {state.error}
                </div>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
