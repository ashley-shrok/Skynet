---
title: "Patch #119 — drafts belt-and-suspenders localStorage mirror"
task_id: 260722-ddg
slug: patch-119-drafts-belt-and-suspenders-loc
description: >
  Add a client-side localStorage mirror for compose-box and message-queue
  drafts so they survive Skynet container restarts regardless of any
  server-side failure mode. Diagnostic console.warns on save/load help
  narrow the still-unknown root cause of post-restart draft loss.
created: 2026-07-22
status: planned
---

## Task Summary

Compose-box and message-queue drafts vanish when the Skynet container recreates on deploy, even though the 400ms debounced saves reach SQLite. Ashley (maintainer) explicitly authorized a "sync irresponsibly, personal tool max ~20 sessions" belt-and-suspenders: mirror every keystroke to `localStorage` in both surfaces, hydrate from `localStorage` on mount when the server returns an empty body, and emit a one-line `console.warn` on save and load so the next post-restart repro reveals whether the server or the load-key is at fault. No debounce, no root-cause fix, no deploy — Ashley is stacking bounties for a batch deploy later.

## Files to modify

- `src/ui/features/pretty-view/ComposeBox.tsx`
  - Add `composeDraftLsKey(hostId, tmuxSessionKey)` helper.
  - Mirror every `latestBodyRef.current = ...` assignment to `localStorage`.
  - On mount / key-change hydrate: if server seed is empty and localStorage has a body, restore it and schedule an autosave.
  - Mirror on successful `putComposeDraft` and clear on submit-clear.
  - Two diagnostic `console.warn` lines (one per save, one per load).
- `src/ui/features/terminal/MessageQueueDrawer.tsx`
  - Add `messageQueueDraftLsKey(itemId)` helper.
  - Mirror every `dirtyBodiesRef.current.set(id, body)` to `localStorage`.
  - On `listMessageQueueItems` hydrate: per-item, if localStorage has content that server doesn't, restore into `items` state and schedule the existing debounced PATCH.
  - Mirror on successful debounced PATCH, clear on successful `deleteMessageQueueItem`.
  - Two diagnostic `console.warn` lines (one per save, one per load).
- `~/.claude/identities/tina/skynet-patches.md` (NOT in the repo, NOT git-tracked — plain file edit)
  - Bump patch count 118 → 119.
  - Add full entry for #119.
  - Add both `.tsx` files to the patch-drift caveat list if not already present.

## Detailed change list

Executor: line numbers below are current-as-of-this-plan. **Re-grep before editing** — the files drift patch-by-patch.

### 1. `src/ui/features/pretty-view/ComposeBox.tsx`

**1a. Add the localStorage key helper at module scope**

Near the top of the file (below imports, above the component), add:

```ts
// Patch #119 — draft-loss belt-and-suspenders: localStorage mirror for the
// compose draft body. Single-user-per-browser tool, so no userId in the key.
// Survives any server-side failure mode (bad load key, DB not ready, auth, …).
function composeDraftLsKey(
  hostId: string,
  tmuxSessionKey: string | null | undefined,
): string {
  return `skynet:compose-draft:${hostId}:${tmuxSessionKey ?? ""}`;
}
```

**1b. Mirror on every keystroke**

Find `latestBodyRef.current = text;` (currently line ~262, inside the change handler that also calls `scheduleAutosave(next)` around line 497). Immediately after that assignment, add:

```ts
try {
  localStorage.setItem(composeDraftLsKey(hostId, tmuxSessionKey), text);
} catch {
  // localStorage can throw on quota / private browsing — non-fatal.
}
```

Note: the `latestBodyRef.current = text` at line ~262 is the primary keystroke-time update. There are two other `latestBodyRef.current = ""` sites (lines ~318 and ~412) that represent clears — handle those in step 1f, not here.

**1c. Mount / key-change hydrate**

The mount effect calls `getComposeDraft(hostId, tmuxSessionKey)` around line 320. In the `.then(seed => { ... })` handler that follows (the block where `latestBodyRef.current = seed;` currently lives at ~line 325), extend the logic:

```ts
.then((seed) => {
  let hydratedBody = seed;
  let lsBody: string | null = null;
  try {
    lsBody = localStorage.getItem(composeDraftLsKey(hostId, tmuxSessionKey));
  } catch {
    lsBody = null;
  }

  if (seed !== "") {
    // Server wins — mirror seed into localStorage so ls stays fresh.
    try {
      localStorage.setItem(composeDraftLsKey(hostId, tmuxSessionKey), seed);
    } catch {}
  } else if (lsBody && lsBody.length > 0) {
    // Server empty, ls has content — belt-and-suspenders restore.
    hydratedBody = lsBody;
  }

  setText(hydratedBody);
  latestBodyRef.current = hydratedBody;

  // Patch #119 diagnostic — one line per load.
  console.warn(
    "[compose-draft] load hostId=%s tmuxSession=%s serverLen=%d lsLen=%d",
    hostId,
    tmuxSessionKey ?? "(null)",
    seed.length,
    lsBody?.length ?? 0,
  );

  // If we restored from localStorage, kick off an autosave so the server
  // catches up on the next 400ms tick.
  if (seed === "" && lsBody && lsBody.length > 0) {
    scheduleAutosave(hydratedBody);
  }
})
```

Preserve any existing loading-state / error-catch bookkeeping in that block — do NOT delete the existing `.catch(...)` or any surrounding refs (e.g. `didHydrateRef`) if they exist.

**1d. Mirror on successful autosave**

Inside `flushDirty` (currently line 279–290 ish), the body is:

```ts
const flushDirty = useCallback(async () => {
  // ... snapshot body, clear dirty ref ...
  const body = latestBodyRef.current;
  await putComposeDraft(hostId, tmuxSessionKey, body);
  // ...
}, [...]);
```

Immediately BEFORE the `await putComposeDraft(...)` line, add the diagnostic:

```ts
console.warn(
  "[compose-draft] save hostId=%s tmuxSession=%s bodyLen=%d",
  hostId,
  tmuxSessionKey ?? "(null)",
  body.length,
);
```

Immediately AFTER the `await putComposeDraft(...)` resolves (before any surrounding catch), add:

```ts
try {
  localStorage.setItem(composeDraftLsKey(hostId, tmuxSessionKey), body);
} catch {}
```

**1e. Clear localStorage on submit-clear**

Find `putComposeDraft(hostId, tmuxSessionKey, "").catch(...)` at line ~413 (inside the submit handler). Immediately before or after that call, add:

```ts
try {
  localStorage.removeItem(composeDraftLsKey(hostId, tmuxSessionKey));
} catch {}
```

Do the same for the OTHER `latestBodyRef.current = "";` site at line ~318 IF and only if that site represents a submit-style clear (verify by reading its enclosing block). If it's a mount/init default-zeroing before hydrate resolves, do NOT clear localStorage there — that would defeat the whole mechanism.

**1f. Sanity check**

After editing, `grep -n "localStorage" src/ui/features/pretty-view/ComposeBox.tsx` should show roughly 5-6 hits:
- 1 in the helper definition
- 1 in the keystroke mirror
- 1 in the mount hydrate `getItem`
- 1 in the mount hydrate `setItem` (server-wins branch)
- 1 in the flushDirty post-save mirror
- 1 in the submit-clear `removeItem`

If you have significantly more or fewer, re-audit.

### 2. `src/ui/features/terminal/MessageQueueDrawer.tsx`

**2a. Add the localStorage key helper at module scope**

Near the top of the file (below imports, above the component), add:

```ts
// Patch #119 — draft-loss belt-and-suspenders: per-item localStorage mirror
// for queued-message bodies. Keyed by itemId (server-generated UUID).
function messageQueueDraftLsKey(itemId: string): string {
  return `skynet:message-queue-draft:${itemId}`;
}
```

**2b. Mirror on every keystroke**

The keystroke-time update is `dirtyBodiesRef.current.set(id, body)` at line ~209 inside `handleBodyChange`. Immediately after that call, add:

```ts
try {
  localStorage.setItem(messageQueueDraftLsKey(id), body);
} catch {}
```

**2c. Hydrate on load**

The hydrate path is `listMessageQueueItems({ hostId, tmuxSession }).then((rows) => { setItems(rows); ... })` starting line ~77. Extend it to per-item cross-check localStorage:

```ts
listMessageQueueItems({ hostId, tmuxSession })
  .then((rows) => {
    const hydrated: MessageQueueItem[] = rows.map((item) => {
      let lsBody: string | null = null;
      try {
        lsBody = localStorage.getItem(messageQueueDraftLsKey(item.id));
      } catch {
        lsBody = null;
      }

      console.warn(
        "[message-queue-draft] load itemId=%s serverLen=%d lsLen=%d",
        item.id,
        item.body.length,
        lsBody?.length ?? 0,
      );

      // Server-empty + ls-has-content → restore from ls and schedule PATCH
      // so the server catches up. Otherwise server wins and we mirror it.
      if (item.body === "" && lsBody && lsBody.length > 0) {
        // Reuse the same debounced sync path used by keystroke changes.
        dirtyBodiesRef.current.set(item.id, lsBody);
        // Schedule the debounced PATCH the same way handleBodyChange does.
        // Inline here because we need to fire after setItems commits — see
        // note below.
        return { ...item, body: lsBody };
      }

      if (item.body !== "") {
        try {
          localStorage.setItem(messageQueueDraftLsKey(item.id), item.body);
        } catch {}
      }
      return item;
    });

    setItems(hydrated);

    // For any items where we restored from ls, kick the debounce timer so
    // the server catches up. Use the same timer machinery handleBodyChange
    // uses (lines ~210-223). If that logic is not extracted into a helper,
    // extract it into a local `scheduleItemAutosave(id, body)` and call
    // both from here and from handleBodyChange.
    for (const item of hydrated) {
      const dirty = dirtyBodiesRef.current.get(item.id);
      if (dirty !== undefined && dirty === item.body && item.body !== "") {
        scheduleItemAutosave(item.id, item.body);
      }
    }
  })
  // ... preserve existing catch / then chain (e.g. the auto-create-empty
  //     branch around line 86 that calls setItems([created])) ...
```

**Extraction sub-step:** the debounce-schedule block currently lives inline inside `handleBodyChange` (lines ~210-223). Extract it into:

```ts
const scheduleItemAutosave = useCallback((id: string, body: string) => {
  const existing = debounceTimersRef.current.get(id);
  if (existing) {
    clearTimeout(existing);
    debounceTimersRef.current.delete(id);
  }
  const timer = setTimeout(() => {
    debounceTimersRef.current.delete(id);
    dirtyBodiesRef.current.delete(id);

    console.warn(
      "[message-queue-draft] save itemId=%s bodyLen=%d",
      id,
      body.length,
    );

    updateMessageQueueItem(id, { body }).catch((e) => {
      // Preserve existing failure re-queue: put body back in dirty ref,
      // no timer, so the next keystroke or unmount-flush catches it.
      dirtyBodiesRef.current.set(id, body);
      // Preserve any existing error logging.
      console.error(e);
    });

    // On success, mirror to ls (step 2d).
    // NOTE: because updateMessageQueueItem is async, do the ls-mirror
    // inside a .then() chained on the same call. See 2d for the exact
    // shape — do NOT keep the .catch-only form above.
  }, 400);
  debounceTimersRef.current.set(id, timer);
}, [/* debounceTimersRef, dirtyBodiesRef */]);
```

Then replace the inline debounce block in `handleBodyChange` with `scheduleItemAutosave(id, body);` and call the same helper from the hydrate loop.

**2d. Mirror on successful debounced PATCH**

Inside `scheduleItemAutosave`, adjust the `updateMessageQueueItem(id, { body })` call so both success and failure branches are handled:

```ts
updateMessageQueueItem(id, { body })
  .then(() => {
    try {
      localStorage.setItem(messageQueueDraftLsKey(id), body);
    } catch {}
  })
  .catch((e) => {
    dirtyBodiesRef.current.set(id, body);
    console.error(e);
  });
```

The pre-await `console.warn` from step 2c stays where it is (before the fetch fires).

**2e. Clear localStorage on delete**

The two `deleteMessageQueueItem` call sites are lines ~246 and ~256. Immediately after each successful call (i.e. after the `await` returns, before any UI-state update that removes the item), add:

```ts
try {
  localStorage.removeItem(messageQueueDraftLsKey(id));
} catch {}
```

Also handle the auto-cleanup-on-unmount branch at line ~186 that calls `deleteMessageQueueItem(item.id).catch(...)` for empty-body items — mirror the removeItem there too. That branch deletes the SERVER row for empty-body items; the ls key for those items is either absent or empty, but `removeItem` on absent keys is a no-op so belt-and-suspenders removal is safe.

**2f. Sanity check**

After editing, `grep -n "localStorage" src/ui/features/terminal/MessageQueueDrawer.tsx` should show roughly 6-8 hits:
- 1 in the helper definition
- 1 in the keystroke mirror
- 1 in the hydrate `getItem`
- 1 in the hydrate `setItem` (server-wins branch)
- 1 in the debounced-save success `setItem`
- 2-3 in the delete-site `removeItem` calls (2 delete sites + 1 auto-cleanup)

### 3. `~/.claude/identities/tina/skynet-patches.md`

Plain file edit — NOT a git commit, NOT in the repo.

- Bump the header patch count from **118 → 119**.
- Add a full entry for **#119**:
  - **Motivation:** compose-box and message-queue drafts vanish after Skynet container restart (20+ min old drafts confirmed lost). Debounced 400ms server writes DO reach SQLite; the failure is somewhere between save and post-restart load (suspected: `(userId, hostId, tmuxSession)` load-key mismatch, but root cause not diagnosed). Ashley auth'd "sync irresponsibly" client-side belt-and-suspenders.
  - **Fix summary:** localStorage mirror in both compose and message-queue surfaces. Every keystroke and every successful debounced save writes to `localStorage`. On mount, if the server returns empty but ls has content, restore from ls and schedule a debounced save so the server catches up. Two `console.warn` diagnostic lines per surface (save + load) reveal the actual `serverLen` vs `lsLen` next repro.
  - **Files touched:** `src/ui/features/pretty-view/ComposeBox.tsx`, `src/ui/features/terminal/MessageQueueDrawer.tsx`.
  - **Rebase risk:** MEDIUM. Both files are heavily patched (60+ patches on ComposeBox). Changes are additive and localized but sit right on top of the debounce/hydrate machinery. Comment WHY (draft-loss belt-and-suspenders, patch #119) at each insertion site so upstream conflicts are self-explanatory.
- Add `src/ui/features/pretty-view/ComposeBox.tsx` and `src/ui/features/terminal/MessageQueueDrawer.tsx` to the "Patch drift caveat" list if not already present.

### 4. Commit

- Read recent commit messages: `git log --oneline -20` in `~/skynet` — match the fork's format.
- Commit message (adjust to fork style, e.g. `feat(skynet-composebox):` vs `fix:` vs conventional):
  - `feat(skynet-composebox): patch #119 — localStorage mirror for compose + message-queue drafts`
- Single commit for both `.tsx` files. The `skynet-patches.md` edit is out-of-repo and does not participate in the commit.

## Verification steps

1. **`cd ~/skynet && npx tsc --noEmit`** — must be clean. Zero errors, zero warnings introduced.
2. **grep audit on both files** (see 1f and 2f above). Numbers roughly match — a large deviation means a mirror was missed or duplicated.
3. **Manual diff eyeball:** Ensure `console.warn` count is exactly 4 across both files (2 per file: one `[*-draft] load` and one `[*-draft] save`). More than 4 means a debug leftover; fewer means a diagnostic is missing.
4. **Diff eyeball on non-goals:** `git diff --stat` should show exactly two files changed. Any third file in the stat is a non-goal violation and must be reverted.
5. **Line number sanity:** the `grep -n "latestBodyRef.current =" src/ui/features/pretty-view/ComposeBox.tsx` output should still show 3 assignment sites (post-edit) — this plan did not add or remove any `latestBodyRef.current =` writes; it only added `localStorage.setItem` calls beside them.
6. **NO `docker compose up`**, NO deploy, NO push. Local commit only.

## Non-goals

- Root cause diagnosis (tmuxSession mismatch, auth, etc.) — separate follow-up bounty.
- Debounce timing (400ms stays).
- UI indicator (invisible on success).
- Any file outside `ComposeBox.tsx` and `MessageQueueDrawer.tsx` (and their test files if mocks need updating, though prefer NOT touching tests — the mocks are stable).
- Schema/DB changes.
- New dependencies.
- Deploy.

## Rebase risk

MEDIUM. `ComposeBox.tsx` has been touched by 60+ patches on the fork branch `feat/tab-title-from-tmux`; `MessageQueueDrawer.tsx` is similarly patched (queue-drawer autosave, keepalive, auto-delete-empty-on-unmount, and several UI-affordance patches all live here). Every insertion in this patch sits directly adjacent to those load-bearing patches — the mount-hydrate `.then` (line ~320 in ComposeBox), the `flushDirty` `putComposeDraft` call (line ~284), the `handleBodyChange` `dirtyBodiesRef` set (line ~209 in MessageQueueDrawer), and the `listMessageQueueItems` hydrate (line ~77).

Mitigation: every insertion is additive (no deletions of existing patched code), wrapped in `try/catch`, and prefixed with a `// Patch #119 — draft-loss belt-and-suspenders` comment so upstream rebase conflicts are self-explanatory. The `console.warn` sites are the most visually noisy and the easiest for future rebases to accidentally drop — keep them as the LAST statement before their respective `await` / `setItems` calls so they're structurally obvious.

No schema, no dependency, no API changes — so back-end drift cannot break this patch. Frontend-only means the blast radius on a bad rebase is confined to draft-persistence UX regression, not data corruption.
