## Patch #172 — pin-toggle + global pinned sort in identity modal

Paired atomic commit on `feat/tab-title-from-tmux` closing two Tina bounties in one shot:
`pin-toggle-ui-in-identity-modal` and `identity-modal-sort-bounties-by-priority`. Both fall
out of the post-#168 fleet migration where Nelly split `pinned` off from the `status` enum
into an independent boolean field — the modal needed both a write path AND a display
treatment for that new schema.

Four surfaces touched: (1) backend `writeIdentityBountyPinned` at
`identity-artifact-reader.ts` §8b — byte-shape mirror of `writeIdentityBountyStatus`
covering both local and remote (python3-over-SSH) branches; folder deliberately untouched
same as the status writer's resurrect-safe pattern. (2) WS server dispatch
`identity:update-bounty-pinned` → `identity:bounty-pinned-updated` with
IDENTITY_KEY_RE / IDENTITY_SLUG_RE / typeof-boolean validation gates. (3) Wire types
`Bounty.pinned:boolean` + `IdentityUpdateBountyPinnedPayload` +
`IdentityBountyPinnedUpdatedEvent` in `claude-session-api.ts`; `normalizeBounty` on
the backend defaults absent `pinned` to `false` so both open and archive payloads
always carry the flag. (4) Frontend: `BountyCard` gains a header-row star toggle
(filled amber when pinned, hollow muted when not) with stopPropagation so clicks
don't trigger the disclosure expand; `IdentityModal` prepends `"pinned"` to
`OPEN_STATUS_ORDER` so a new "Pinned" group renders above the in_progress fence
regardless of a bounty's `status`, while the existing within-group priority-asc /
updated_at-desc sort is preserved for the new group. Vitest coverage on the backend
writer (round-trip true + false, non-boolean rejection, folder untouched, remote-branch
slug validation) plus the existing status-writer regression tests all pass.

**Draft — do NOT paste into skynet-patches.md until same-turn as deploy per fleet inline-docs rule.**
