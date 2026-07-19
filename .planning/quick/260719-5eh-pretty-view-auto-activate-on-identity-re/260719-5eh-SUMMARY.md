---
phase: quick-260719-5eh
status: complete
completed_at: 2026-07-19T03:56:00Z
commit: 21089f3
files_modified:
  - src/ui/features/terminal/Terminal.tsx
---

# Quick Task 260719-5eh: pretty-view auto-activate on identity resolution

**Patch #73** — Auto-activate pretty view once per tab when the tab's tmux
session name resolves to a registered identity. Pretty view is now mature
enough (patches #43-72 shipped) that identity-aware tabs should default to
it instead of requiring a manual Ctrl+Shift+O.

## What shipped

Two additions in `src/ui/features/terminal/Terminal.tsx`:

1. **`hasAutoActivatedPrettyRef`** — a `useRef<boolean>` (initial `false`)
   declared immediately after the existing `isPrettyMode` useState.
   Tracks the one-shot flag so a later Ctrl+Shift+O off is respected
   forever after — auto-activate never fights the manual toggle.

2. **Auto-activate `useEffect`** — placed after the existing
   `identityKey` / `identitiesByKey` / `identityColorHue` / `sessionHue`
   block. Guards in order: (a) return if ref already true, (b) return
   if `identityKey == null`, (c) return if
   `!identitiesByKey.has(identityKey)`, (d) flip the ref, (e)
   `setIsPrettyMode(true)`. Dependency array `[identityKey,
   identitiesByKey]` so a late-hydrating identities store still
   triggers auto-activate when the map populates.

Non-identity tabs (raw shells, unknown tmux names) stay in raw terminal
as today — the effect early-returns before touching state.

## Explicitly out of scope (per Ashley)

- No localStorage flag (`autoActivatePrettyModeOnIdentity` or similar).
- No `UserProfilePanel` settings switch.
- No i18n / locale changes.
- Manual Ctrl+Shift+O toggle stays the escape valve — the per-tab manual
  override IS the safety net.

## Verification

- `npx tsc --noEmit` exits 0.
- `git diff` scoped to `src/ui/features/terminal/Terminal.tsx` only.
- 12 insertions, no deletions.
- Commit `21089f3` on `feat/tab-title-from-tmux`.

## Deploy status

**Not yet deployed.** Patch #73 joins the queue on top of the pre-baked
#70 image → deploy needs a rebuild covering patches #70 + #71 + #72 +
#73 together. Ashley greenlights deploys per-batch per tina.md deploy
discipline.

## Live smoke plan (for post-deploy verification)

- Attach any pane whose tmux session name matches a registered identity
  (e.g. `tina`, `nelly`, `vicky`) — pretty view should appear on
  connect without a Ctrl+Shift+O press.
- Attach a pane with an unregistered/raw tmux name — should stay in
  raw terminal.
- On an auto-activated pane, press Ctrl+Shift+O — pretty view toggles
  off. Continue using the pane; pretty view should NOT re-flip on
  (ref is sticky for the tab lifetime).
- Reload the browser tab — auto-activate fires again on the fresh
  mount when identity resolves.
