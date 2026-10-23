/**
 * Conversation search modal.
 *
 * Phase 143 Plan 143-08: retires the archived-row blunt-alert (D-11),
 * wires Un-archive kebab (D-12/D-13/D-14) with endpoint-first sequence,
 * kit notice (kitAlert) success/failure with distinct missing_roles copy (D-16/D-17),
 * modal stays open after un-archive (D-19).
 * See .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md
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
 * Chrome (apple-ux shape-creation-and-search-dialogs): <Modal> + "Search"
 * head + <ModalBody>, no foot. The kit search box sits in its own row BELOW
 * the head, with "Press Return to search." under it while what's typed
 * hasn't been searched yet; then a count line, the results as KitListRows,
 * Load more at the end. An error shows as a banner at the top of the body.
 * The empty state says what is searched. Backdrop click
 * never dismisses (unified rule at the Modal layer — no per-modal opt-in).
 * Size "wide-list" (2026-10-10): grows wide + full 85vh on big screens so
 * the multi-passage rows have room to read.
 */

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Modal, ModalHead, ModalBody } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitList,
  KitLoading,
  KitSearch,
  kitAlert,
} from "@/components/kit";
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
  removeResultByIdentity,
} from "@/state/search-store";
import { unarchiveIdentity, UnarchiveError } from "@/api/identity-unarchive-api";
import { clearPendingArchive } from "@/state/conversation-store";
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

function unarchivingKey(r: ConversationSearchResult): string {
  return `${r.hostId}:${r.identityKey}`;
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
  // Archived rows whose un-archive is in flight (keyed by host + identity).
  const [unarchiving, setUnarchiving] = useState<ReadonlySet<string>>(new Set());

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
      // phase-143 D-11: retired the blunt left-click alert. The kebab-menu Un-archive
      // path is the sole visible action on archived rows. Left-click on the
      // row is a no-op — the identity's conversation surface doesn't exist
      // while archived. See .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md
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

  // Phase 143 D-11 / D-16 / D-17 / D-19 — endpoint-first un-archive handler.
  //
  // CRITICAL SEQUENCE (CONTEXT.md Risk Summary): the row MUST NOT be removed
  // until the endpoint reports "restored". The endpoint drops the flag and
  // waits for the supervisor's outcome (shape-unarchive-one-path-supervisor-
  // reactivation.md); the row shows a spinner meanwhile.
  //
  // restored → remove the row, then "<name> is back." alert.
  // pending  → row stays, "still un-archiving" alert (it keeps going).
  // reject   → row stays, failure alert (refused reason, missing roles, ...).
  //
  // Modal stays open in all branches (D-19): no onOpenChange(false) call here.
  async function handleUnarchive(result: ConversationSearchResult): Promise<void> {
    if (!result.isArchived) return; // defensive guard
    const rowKey = unarchivingKey(result);
    if (unarchiving.has(rowKey)) return; // already in flight

    setUnarchiving((prev) => new Set(prev).add(rowKey));
    try {
      // Step 1: call endpoint FIRST — row untouched while request is in flight.
      // The backend drops the flag and waits (up to ~2 min) for the
      // supervisor's outcome; the row shows a spinner meanwhile.
      const { outcome } = await unarchiveIdentity(result.hostId, result.identityKey);
      console.info({
        operation: "conversation_search_unarchive_outcome",
        identityKey: result.identityKey,
        hostId: result.hostId,
        outcome,
      });

      if (outcome === "pending") {
        await kitAlert({
          title: `Still un-archiving ${result.identityKey}`,
          body: "Check back shortly.",
        });
        return;
      }

      // Release any optimistic-archive mark this tab still holds, so the
      // reconciler's restore re-surfaces the row here too.
      clearPendingArchive(result.hostId, result.identityKey);

      // Step 2: restored — now remove the row from the store.
      removeResultByIdentity(result.hostId, result.identityKey);

      // Step 3: fire success notice (D-16).
      await kitAlert({ title: `${result.identityKey} is back.` });
    } catch (err) {
      // Failure path: row was NEVER removed (no restore branch needed —
      // by construction the row is still present). Fire failure notice (D-17).
      console.info({
        operation: "conversation_search_unarchive_failed",
        identityKey: result.identityKey,
        hostId: result.hostId,
        reason: err instanceof UnarchiveError ? err.reason : "error",
      });
      if (err instanceof UnarchiveError && err.reason === "missing_roles") {
        // D-17: names the still-archived role(s) inline.
        await kitAlert({
          title: `Un-archive role ${err.missingRoles?.join(", ") ?? "(unknown)"} first`,
          body: "This conversation depends on it.",
        });
      } else if (err instanceof UnarchiveError && err.reason === "refused") {
        await kitAlert({
          title: `Couldn't un-archive ${result.identityKey}`,
          body: err.message,
        });
      } else if (err instanceof UnarchiveError && err.reason === "name_collision") {
        await kitAlert({
          title: `Couldn't un-archive ${result.identityKey}`,
          body: "A live conversation with the same key already exists.",
        });
      } else if (err instanceof UnarchiveError && err.reason === "archive_not_found") {
        await kitAlert({
          title: `Couldn't un-archive ${result.identityKey}`,
          body: "The archive may have already been reactivated. Try again in a moment.",
        });
      } else {
        // Generic fallback for non-UnarchiveError or unknown reason (D-17).
        await kitAlert({
          title: `Couldn't un-archive ${result.identityKey}`,
          body: "Try again in a moment.",
        });
      }
    } finally {
      setUnarchiving((prev) => {
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
    }
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
  // Not after a failed search (the error banner says what happened), and not
  // while there are more pages — an un-archive can empty the loaded page
  // without the search having come up empty.
  const showNoResults =
    !state.isFetching &&
    !showEmptyState &&
    !state.error &&
    !state.hasMore &&
    state.results.length === 0 &&
    state.query.length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="wide-list"
      data-testid="conversation-search-modal"
    >
      <ModalHead title="Search" />

      {/* Search row — the kit search box, directly below the head.
          autoFocus so the input takes focus on open. Enter fires the
          search (D-01); the clear button / Esc reset the stored search. */}
      <div
        className="px-6 pb-2 flex-shrink-0 max-sm:px-5"
        onClickCapture={(e) => {
          if ((e.target as Element).closest("[data-testid='conversation-search-clear-button']")) {
            handleClear();
          }
        }}
      >
        <KitSearch
          value={localValue}
          onValueChange={setLocalValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleEnter();
            } else if (e.key === "Escape" && e.defaultPrevented) {
              // KitSearch already emptied the field; reset the stored search too.
              handleClear();
            }
          }}
          placeholder="Search every conversation"
          aria-label="Search conversations"
          data-testid="conversation-search-input"
          clearTestId="conversation-search-clear-button"
          /* eslint-disable-next-line jsx-a11y/no-autofocus */
          autoFocus
        />
        {/* Return is the only thing that searches (D-01) — say so once
            something new has been typed. */}
        {localValue.trim() !== "" && localValue.trim() !== state.query && (
          <p className="m-0 mt-2 px-1 text-[12.5px] text-[var(--k-t3)]" data-testid="conversation-search-hint">
            Press Return to search.
          </p>
        )}
      </div>

      {/* Body — results list / empty / searching / no-results, and the
          inline Load more at the end of the list. */}
      <ModalBody className="flex flex-col pt-1" data-testid="conversation-search-body">
        {state.error && (
          <KitBanner tone="danger" className="mb-3" data-testid="conversation-search-error">
            {state.error}
          </KitBanner>
        )}
        {showSearching && (
          <KitLoading
            label="Searching every conversation — this can take a few seconds…"
            lines={3}
            data-testid="conversation-search-searching"
          />
        )}
        {showEmptyState && !showSearching && (
          <KitEmpty
            icon={<Search aria-hidden="true" />}
            title="Search every conversation"
            body="What you, your agents and their tools said — archived conversations too. Type, then press Return."
            data-testid="conversation-search-empty-state"
          />
        )}
        {showNoResults && (
          <KitEmpty
            title={<>No results for &quot;{state.query}&quot;</>}
            body="Try fewer or different words."
            data-testid="conversation-search-no-results"
          />
        )}
        {state.results.length > 0 && (
          <p className="m-0 mb-2 px-1 text-[13px] text-[var(--k-t2)]" data-testid="conversation-search-count">
            {/* The results listed right now (an un-archive takes its row out);
                "+" while there are more pages to load. */}
            {state.results.length}
            {state.hasMore ? "+" : ""} {state.results.length === 1 && !state.hasMore ? "conversation" : "conversations"}
          </p>
        )}
        {state.results.length > 0 && (
          <KitList>
            {state.results.map((r) => (
              <ConversationSearchRow
                key={r.transcriptPath}
                result={r}
                query={state.query}
                onClick={() => handleRowClick(r)}
                onUnarchive={r.isArchived ? handleUnarchive : undefined}
                unarchiving={r.isArchived && unarchiving.has(unarchivingKey(r))}
              />
            ))}
          </KitList>
        )}
        {state.hasMore && (
          <div className="flex justify-center pt-2 pb-1">
            <KitButton
              variant="plain"
              onClick={() => void handleLoadMore()}
              disabled={state.isFetching}
              data-testid="conversation-search-load-more"
            >
              {state.isFetching ? "Loading..." : "Load more"}
            </KitButton>
          </div>
        )}
      </ModalBody>

    </Modal>
  );
}
