import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { toast } from "sonner";
import { shareIdentity } from "@/api/identities-api";
import { getUsersListBasic, type BasicUser } from "@/api/user-management-api";

// ─── Phase 38 Wave 2 (plan 38-02): ShareIdentityPicker ──────────────────────
// Header-strip picker that lists other Skynet users and hands the current
// identity over to a selected recipient.
//
// Locked behaviors (per .planning/phases/38-identity-sharing.../38-CONTEXT.md):
//   - Empty list (single-user deployment) → render nothing. No dead affordance.
//   - Already-shared recipients get a subtle marker BUT remain selectable.
//     Backend detects the (targetUserId, identityKey) repeat and returns
//     shared:false; picker still updates the marker set for that user.
//   - Self-exclusion is server-side (backend /users/list-basic filters via
//     ne(users.id, requester)). Component does NO frontend re-filtering — if
//     the backend contract regresses, the failure is visible in tests instead
//     of masked by defense-in-depth.
//   - Lightweight visible confirmation on successful share via sonner toast.
//   - Errors in the users fetch degrade to "render nothing" (same visual as
//     the empty-list case) — MUST NOT crash IdentityModal render tree.
//
// State ownership boundary:
//   - Component owns: the loaded users list + unmount guard.
//   - Parent (IdentityModal) owns: alreadySharedUserIds Set. Component reads
//     it as a prop and reports back via onShareSuccess so the parent can
//     update the Set so the marker appears without a refetch.
//
// Structured logging (per Ashley 2026-08-11 fleet directive on new
// interaction paths): errors from getUsersListBasic are swallowed here
// because handleApiError inside the API client has already toasted; we
// only need the resolved-users signal to decide render-vs-hide.

export interface ShareIdentityPickerProps {
  /** Skynet identity row id (identity.id from useIdentities()). Passed to
   *  shareIdentity as the :id path param. */
  identityId: string;
  /** identityKey of the current identity — accepted so the parent can key
   *  its alreadySharedUserIds Set consistently. Not used by the picker's
   *  own render logic today; keeps the API future-proof if we later add a
   *  cross-user "who has this identityKey" query to seed the Set on open. */
  identityKey: string;
  /** Set of userIds who already have this identityKey per the parent's
   *  session-scoped knowledge. Owned by IdentityModal; the picker only
   *  reads it to render the per-row marker. */
  alreadySharedUserIds: Set<string>;
  /** Called after any successful share (shared:true OR shared:false).
   *  Parent uses this to add targetUserId to its alreadySharedUserIds Set
   *  so the marker updates on the next picker open without a refetch. */
  onShareSuccess: (result: {
    targetUserId: string;
    shared: boolean;
    resultingIdentityId: string;
  }) => void;
}

export function ShareIdentityPicker({
  identityId,
  identityKey: _identityKey,
  alreadySharedUserIds,
  onShareSuccess,
}: ShareIdentityPickerProps) {
  // null = still loading OR errored → hide (empty-state contract).
  // BasicUser[] = resolved list; [] on happy-empty (single-user deployment).
  const [users, setUsers] = useState<BasicUser[] | null>(null);

  // Unmount guard so a late-resolving fetch does not dispatch state and
  // trigger a React "state update on unmounted component" warning.
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const list = await getUsersListBasic();
        if (cancelled || !isMountedRef.current) return;
        setUsers(list);
      } catch {
        // handleApiError inside the client has already surfaced the failure
        // to the user; we just fall through to the "hide" path. Prefer
        // "render nothing" per CONTEXT.md philosophy over an inline error.
        if (cancelled || !isMountedRef.current) return;
        setUsers(null);
      }
    })();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
    };
  }, []);

  // Empty-state contract: hide entirely when there is no one to share to
  // (either the fetch is still loading, errored, OR the deployment has one user).
  if (users === null || users.length === 0) {
    return null;
  }

  const handleSelect = async (user: BasicUser) => {
    try {
      const result = await shareIdentity(identityId, user.id);
      // Component may have unmounted between click and resolve (e.g., modal
      // closed). Skip the toast + callback in that case — but do not swallow
      // the API call, it is already committed on the backend by now.
      if (!isMountedRef.current) return;
      onShareSuccess({
        targetUserId: user.id,
        shared: result.shared,
        resultingIdentityId: result.identityId,
      });
      toast.success(
        result.shared
          ? `Shared with ${user.username}`
          : `Already shared with ${user.username}`,
      );
    } catch {
      // Client-level toast via handleApiError already fired. No re-throw
      // needed — the DropdownMenu closed itself on onSelect return, so the
      // unhandled-rejection warning is our only concern and we swallowed it.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Share identity"
          title="Share identity"
          className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center transition-[color,background-color,border-color,box-shadow] duration-200"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(220, 225, 245, 0.10)",
            color: "#a89a80",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
            e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
            e.currentTarget.style.color = "#f0ebe0";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
            e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.10)";
            e.currentTarget.style.color = "#a89a80";
          }}
        >
          <Share2 className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[12rem] max-w-[18rem] rounded-md border border-[rgba(220,225,245,0.14)] bg-[rgba(30,28,36,0.96)] text-[#e8e4d8] p-1 shadow-xl"
      >
        {users.map((user) => {
          const already = alreadySharedUserIds.has(user.id);
          return (
            <DropdownMenuItem
              key={user.id}
              onSelect={(event) => {
                // Radix DropdownMenu closes automatically on onSelect return.
                // Prevent default only if we needed to keep it open — we don't.
                void event;
                void handleSelect(user);
              }}
              className="flex flex-row items-center gap-2 px-2 py-2 text-sm cursor-pointer focus:bg-[rgba(255,255,255,0.08)]"
              aria-label={
                already
                  ? `${user.username} (already shared)`
                  : `Share with ${user.username}`
              }
            >
              <span className="flex-1 truncate">{user.username}</span>
              {already && (
                <span
                  className="flex flex-row items-center gap-1 text-xs text-[#8a8070]"
                  aria-hidden="true"
                >
                  <Check className="size-3 opacity-70" />
                  shared
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
