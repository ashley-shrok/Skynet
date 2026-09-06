---
phase: 79-telegram-bridge-phase-b
plan: 07
subsystem: frontend/identity-modal-telegram-tab
tags: [telegram, react, identity-modal, tabs, authApi, W-3-closed]
requires:
  - 79-03 (backend /telegram/* routes — shipped Wave 2, commits a8f2a61b + 54c674c7)
  - 79-04 (bridge-config-writer + bot-token-file-writer — shipped Wave 2)
provides:
  - telegram-frontend-api-client (4 fetch wrappers over authApi)
  - telegram-tab-ui (six-variant TelegramState state machine)
  - identity-modal-telegram-slot (fourth NAV_SECTIONS_IDENTITY entry + TabsContent slot)
  - blocker-W-3-resolution (humanUserId sourced from getUserInfo(), no placeholder)
affects:
  - src/ui/api/telegram-api.ts (new)
  - src/ui/api/telegram-api.test.ts (new)
  - src/ui/features/pretty-view/TelegramTab.tsx (new)
  - src/ui/features/pretty-view/TelegramTab.test.tsx (new)
  - src/ui/features/pretty-view/IdentityModal.tsx (modified — 6 surgical edits)
  - src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx (modified — expected button count 3 → 4)
tech-stack:
  added: []
  patterns:
    - "Discriminated-union state machine for tab: loading/error/unconfigured/pending-start/connected/restart-failed"
    - "Local formatError helper (not main-axios.handleApiError, which throws)"
    - "\"error\" in x / \"status\" in x narrowing guards for TS strict:false"
    - "Dynamic import in useEffect body (getTelegramStatus) — matches other tab-scoped code paths"
    - "AlertDialog for destructive confirms (WakeupsTab-style pattern)"
    - "Bot token: password-type input + local useState + setToken(\"\") on state transition + never rendered post-transition"
key-files:
  created:
    - src/ui/api/telegram-api.ts
    - src/ui/api/telegram-api.test.ts
    - src/ui/features/pretty-view/TelegramTab.tsx
    - src/ui/features/pretty-view/TelegramTab.test.tsx
  modified:
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx
decisions:
  - "humanUserId sourced from getUserInfo().userId (blocker W-3 closed); passed through IdentityModal's authUserId state slot, populated once per modal open in a useEffect that mirrors AppShell.tsx:412"
  - "Bot token flows: browser useState → POST body to /telegram/{validate,activate} → encrypted at rest by Plan 03/04 backend. Never in URL query. Never logged. `setToken('')` scrubs after success."
  - "Local formatError helper in telegram-api.ts (NOT main-axios.handleApiError, whose signature is `(err, op) => never` — wrappers want a string for inline UI error rendering, not a throw)"
  - "AlertDialog confirm text (Disconnect flow) is CONTEXT § 3D VERBATIM — enforced by grep gate `grep -c 'The bot stays alive in Telegram'` = 2 (comment + template literal)"
  - "Retry button in `restart-failed` state re-attempts disconnect (safer default per CONTEXT § 3B recovery direction)"
  - "TabsContent slot placed directly after handoff — makes Telegram the last Identity-scope pill in the bottom nav, matching the discovery-order the plan spec calls for"
metrics:
  duration: "~90 min"
  completed: "2026-09-06"
  tasks: 3/3
  commits: 4 (feat T1 / test T2 RED / feat T2 GREEN / feat T3)
  files_created: 4
  files_modified: 2
requirements:
  - TGB-05
  - TGB-09
  - TGB-10
  - TGB-11
---

# Phase 79 Plan 07: Identity-modal Telegram tab — Summary

**One-liner:** Frontend Telegram bridge tab under Identity scope — 4 authApi fetch wrappers + 6-variant `TelegramState` React component (loading/error/unconfigured/pending-start/connected/restart-failed) + 6 surgical edits to IdentityModal.tsx wiring the tab, initial-status fetch, and `humanUserId={authUserId}` from `getUserInfo()` (blocker W-3 closed — no placeholder empty-string).

## What shipped

### Task 1 — `src/ui/api/telegram-api.ts` (+ test)

Four thin fetch wrappers over `authApi` (the JWT-attaching axios instance from `src/ui/main-axios.ts`):

| Export | Wire route | Success shape | Error shape |
|--------|-----------|---------------|-------------|
| `postTelegramValidate({botToken})` | POST /telegram/validate | `{ok:true, botUsername, botId, firstName}` | `{ok:false, error}` |
| `postTelegramActivate({identityKey, botToken, humanUserId, telegramChatId?})` | POST /telegram/activate | `{ok:true, botUsername}` | `{ok:false, error, status?}` |
| `postTelegramDisconnect({identityKey})` | POST /telegram/disconnect | `{ok:true}` | `{ok:false, error, status?}` |
| `getTelegramStatus(identityKey)` | GET /telegram/:identityKey | `{status:"unconfigured"}` \| `{status:"connected", botUsername, telegramChatId}` | `{status:"error", error}` |

All wrappers catch and return — they NEVER throw. Enables inline UI error rendering without try/catch at every call site.

**Note (deviation #1 below):** we do NOT reuse `main-axios.handleApiError` because its signature is `(err, operation) => never` (throws). Local `formatError` helper returns a string.

### Task 2 — `src/ui/features/pretty-view/TelegramTab.tsx` (+ test)

React component with the six-variant `TelegramState` union covering:
- **loading** — Skeleton x2 (mirror HandoffTab).
- **error** — "Couldn't load Telegram: {error}" branch (mirror HandoffTab).
- **unconfigured** — password-type input + Submit; on submit calls `validate` → `activate` → transitions to `pending-start`; bad token → inline "Telegram rejected that token…" + input cleared + refocused.
- **pending-start** — "Waiting for you to send /start to @<bot> …" + Copy bot link button (writes only the public `https://t.me/<bot>` URL — never the token) + Cancel button.
- **connected** — green dot + "Connected. Bot: @<botUsername>. Human: @<telegramHandle>." + Disconnect button (opens AlertDialog).
- **restart-failed** — "Bridge didn't come back up…" + Retry button (re-attempts disconnect per CONTEXT § 3B).

**AlertDialog confirm text (CONTEXT § 3D verbatim):**
```
This will unbridge <identityName> from Telegram. The bot stays alive in Telegram (you can reconnect anytime with the same token, or paste a new one). Confirm.
```
Enforced by `grep -c 'The bot stays alive in Telegram'` = 2 (block comment reference + template literal render).

### Task 3 — `src/ui/features/pretty-view/IdentityModal.tsx` (6 surgical edits)

| Edit | Location | Change |
|------|----------|--------|
| 1 | Line 2 (lucide-react import) | Add `Send` between `Pencil` and `Target` |
| 2 | Line 124-131 (component imports) | Add `TelegramTab, type TelegramState` + `getUserInfo` from `@/main-axios` |
| 3 | Lines 314-321 (NAV_SECTIONS_IDENTITY) | Append `{value:"telegram", label:"Telegram", Icon:Send}` |
| 4 | Lines 338-357 (state hooks) | Add `telegramState` (TelegramState) + `authUserId` (string) useState slots |
| 5 | Lines 363-394 (modal-open reset block) | `setTelegramState({status:"loading"})` + `setAuthUserId("")` |
| 6a | Lines 685-711 (new useEffect A) | `getUserInfo()` fetch on modal open — sets `authUserId` (blocker W-3 fix) |
| 6b | Lines 713-741 (new useEffect B) | `getTelegramStatus(identityKey)` fetch on modal open — sets initial `telegramState` |
| 7 | Lines 2189-2205 (new TabsContent slot) | Wire `<TelegramTab humanUserId={authUserId} state={telegramState} onStateChange={setTelegramState} .../>` |

Bottom icon-bar renderer (line 2198+) auto-picks-up the fourth Nav entry via `NAV_SECTIONS.map()` — no code change there.

## humanUserId source resolution (blocker W-3 evidence)

Per plan `<output>` requirement — exact answer:

- **Import site:** `src/ui/features/pretty-view/IdentityModal.tsx:131` — `import { getUserInfo } from "@/main-axios";`
- **useEffect body (Effect A):** `src/ui/features/pretty-view/IdentityModal.tsx:694-711`
  ```typescript
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await getUserInfo();
        if (cancelled) return;
        setAuthUserId(info.userId);
      } catch (err) {
        if (cancelled) return;
        console.warn("IdentityModal: getUserInfo failed", err);
        setAuthUserId("");
      }
    })();
    return () => { cancelled = true; };
  }, [open]);
  ```
- **Prop pass site:** `src/ui/features/pretty-view/IdentityModal.tsx:2202` — `humanUserId={authUserId}` inside `<TabsContent value="telegram">`

Mirrors AppShell.tsx:412 pattern exactly (same `getUserInfo().then(...)` shape). No placeholder empty-string in code. No STOP-and-consult required at execution time.

## Verification evidence

### Task 1 acceptance greps

```
$ test -f src/ui/api/telegram-api.ts && test -f src/ui/api/telegram-api.test.ts && echo OK
OK
$ grep -c '^export async function postTelegramValidate\|^export async function postTelegramActivate\|^export async function postTelegramDisconnect\|^export async function getTelegramStatus' src/ui/api/telegram-api.ts
4
$ grep -c 'authApi\.\(post\|get\)' src/ui/api/telegram-api.ts
4
# Token-leak grep (must be 0):
$ grep -v '^[[:space:]]*//\|^[[:space:]]*\*' src/ui/api/telegram-api.ts | grep -Ec 'log|console\.|botToken.*fetch|url.*\?botToken=|url.*&botToken='
0
```

### Task 2 acceptance greps

```
$ grep -c '^export function TelegramTab\|^export type TelegramState' src/ui/features/pretty-view/TelegramTab.tsx
2
# 6 state variants referenced (must be ≥6):
$ grep -c 'status: "loading"\|status: "unconfigured"\|status: "pending-start"\|status: "connected"\|status: "restart-failed"\|status: "error"' src/ui/features/pretty-view/TelegramTab.tsx
13
# 3 write endpoints wired (must be ≥3):
$ grep -c 'postTelegramValidate\|postTelegramActivate\|postTelegramDisconnect' src/ui/features/pretty-view/TelegramTab.tsx
9
# AlertDialog present:
$ grep -c 'AlertDialog\|Dialog' src/ui/features/pretty-view/TelegramTab.tsx
24
# CONTEXT § 3D verbatim (must be 1+):
$ grep -c 'The bot stays alive in Telegram' src/ui/features/pretty-view/TelegramTab.tsx
2
# Token-log grep (must be 0):
$ grep -v '^[[:space:]]*//\|^[[:space:]]*\*' src/ui/features/pretty-view/TelegramTab.tsx | grep -Ec 'console\.log.*token|log.*\${token}'
0
```

### Task 3 acceptance greps — including blocker W-3 anti-regression

```
$ grep -c 'Send, Target, User' src/ui/features/pretty-view/IdentityModal.tsx
1
$ grep -c 'import { TelegramTab, type TelegramState } from "./TelegramTab"' src/ui/features/pretty-view/IdentityModal.tsx
1
$ grep -c 'getUserInfo' src/ui/features/pretty-view/IdentityModal.tsx
6   # (import + useEffect body + narrowing + prose)  ≥2 required
$ grep -c 'authUserId\|setAuthUserId' src/ui/features/pretty-view/IdentityModal.tsx
7   # ≥4 required
$ grep -c '{ value: "telegram", label: "Telegram", Icon: Send }' src/ui/features/pretty-view/IdentityModal.tsx
1
$ grep -c 'value="telegram"' src/ui/features/pretty-view/IdentityModal.tsx
1
$ grep -c 'telegramState\|setTelegramState' src/ui/features/pretty-view/IdentityModal.tsx
7   # ≥4 required
$ grep -c 'getTelegramStatus' src/ui/features/pretty-view/IdentityModal.tsx
3
# ★ Blocker W-3 anti-regression — MUST return 0:
$ grep -c 'humanUserId={""}\|humanUserId={/\* thread' src/ui/features/pretty-view/IdentityModal.tsx
0
# ★ Blocker W-3 positive assertion — MUST return 1:
$ grep -c 'humanUserId={authUserId}' src/ui/features/pretty-view/IdentityModal.tsx
1
```

### TabsContent count in IdentityModal (pre/post)

- **Pre-plan:** 8 `<TabsContent value="...">` blocks (per `grep -c "<TabsContent" src/ui/features/pretty-view/IdentityModal.tsx` at HEAD~4 = 8).
- **Post-plan:** 9 `<TabsContent value="...">` blocks (`grep -c "<TabsContent" src/ui/features/pretty-view/IdentityModal.tsx` = 9).
- **Note:** overall `TabsContent` string count is 19 (each block has open + close tag; +1 open + close from the new slot = +2, so 17→19).

### Test suite results

**telegram-api.test.ts — 11/11 pass** (`npx vitest run src/ui/api/telegram-api.test.ts`):

- postTelegramValidate: success / rejected / network-error
- postTelegramActivate: success / 403-forbidden
- postTelegramDisconnect: success / 404-no-row
- getTelegramStatus: unconfigured / connected / error / URL-encodes identityKey path segment

**TelegramTab.test.tsx — 7/7 pass** (`npx vitest run src/ui/features/pretty-view/TelegramTab.test.tsx`):

| Test | Assertion |
|------|-----------|
| 1 | unconfigured + valid token → validate + activate called → onStateChange({status:"pending-start", botUsername, botLink:"https://t.me/…"}) |
| 2 | unconfigured + bad token → inline "Telegram rejected" error, input cleared, activate NOT called |
| 3 | pending-start + Cancel → disconnect called → onStateChange({status:"unconfigured"}) |
| 4 | connected + Disconnect → AlertDialog with verbatim "The bot stays alive in Telegram" text → Confirm → disconnect → onStateChange({status:"unconfigured"}) |
| 5 | connected + AlertDialog Cancel → no disconnect, no onStateChange |
| 6 | restart-failed + Retry → disconnect → onStateChange({status:"unconfigured"}) |
| 7 | raw bot token substring NOT in `document.body.innerHTML` after successful activation flow (T-79-07-02) |

**IdentityModal.role-tab.test.tsx — 6/6 pass** after test 22b button-count update (3 → 4 to account for the new Telegram entry).

**Full pretty-view suite — 852/864 pass** (`npx vitest run src/ui/features/pretty-view`):
- 852 passed
- 2 failed (1 caused by Plan 07 [test 22b] — FIXED; 1 pre-existing unrelated — see Deferred Issues)
- 9 skipped, 1 todo (pre-existing suite state)

### tsc check — zero errors on Plan 07 files

`npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "src/ui/api/telegram-api|TelegramTab\.tsx|IdentityModal\.tsx" | head` returns nothing. The 461 pre-existing tsc errors in unrelated files (compose-drafts-api.ts, message-queue-api.ts, ssh-file-operations-api.ts, etc.) are out of Plan 07 scope.

## Deviations from plan

### 1. [Rule 3 — TS strict:false narrowing quirk] Same pattern as Plan 03 deviation #2

- **Found during:** Task 1 tsc verification.
- **Issue:** Under `tsconfig.app.json`'s `strict: false`, `if (!result.ok) { result.error }` does NOT narrow discriminated-union return types from imported functions (produces `TS2339: Property 'error' does not exist on type '{...} | {...}'`). Same issue Plan 03's routes.ts hit at 3 sites.
- **Fix:** Use `"error" in result ? result.error : "unknown"` (or `"error" in result` guard). The `in` operator produces an unambiguous type predicate under strict:false. Applied in `telegram-api.test.ts` (3 sites) and `TelegramTab.tsx` (5 sites in handlers that observe wrapper return unions).
- **Files affected:** `src/ui/api/telegram-api.test.ts`, `src/ui/features/pretty-view/TelegramTab.tsx`.
- **Rationale:** Matches Plan 03's SUMMARY deviation #2 workaround. No new project-wide pattern; this is TS's known behavior under strict:false with cross-module unions.

### 2. [Rule 3 — handleApiError signature mismatch] Local formatError instead of main-axios import

- **Found during:** Task 1 implementation.
- **Issue:** Plan spec called for `handleApiError` from `@/main-axios` to be used in the catch branches. Real signature at `src/ui/main-axios.ts:1003` is `handleApiError(error, operation): never` — it **throws**. Our wrappers want a **string** to return via `{ok:false, error:...}` for inline UI error rendering.
- **Fix:** Added a local `formatError(err)` helper in `telegram-api.ts` that extracts `err.response?.data?.error ?? err.response?.data?.message ?? err.message ?? "Network error"` (same fields main-axios's handler inspects, minus the throw).
- **Files modified:** `src/ui/api/telegram-api.ts` (added `formatError`).
- **Rationale:** Preserves the plan's spirit (stable string in the error response) while matching the actual codebase contract.

### 3. [Rule 1 — bug in existing test caused by scope change] role-tab test 22b expected 3 buttons

- **Found during:** Task 3 full pretty-view test run.
- **Issue:** `IdentityModal.role-tab.test.tsx` test 22b asserted `navButtons!.length).toBe(3)` on the Identity-scope bottom nav. Plan 07 adds the fourth Telegram entry, making the correct expectation 4.
- **Fix:** Updated the test to expect 4 buttons AND assert `navButtons[3].textContent).toContain("Telegram")` as a positive discovery gate for the new tab. Test now serves double-duty: catches regressions in both the count and the ordering of the fourth pill.
- **Files modified:** `src/ui/features/pretty-view/IdentityModal.role-tab.test.tsx` (test 22b — 3 lines updated, 1 comment added).
- **Rationale:** Existing test is a legitimate coupling to `NAV_SECTIONS_IDENTITY` cardinality; updating it is the correct maintenance action, not a scope creep. Same wave as the change that broke it.

## Auth gates encountered

None. All three tasks were fully autonomous. `getUserInfo()` is called at runtime inside IdentityModal but is JWT-cookie-authenticated (mirroring existing usage); no interactive login required at build time.

## Deferred Issues

### PrettyView.hydration-cap.test.tsx test G fails in main tree (pre-existing)

`npx vitest run src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx --reporter=default`

- **Test:** "Test G: no yank when user scrolled up …" at `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx:658`
- **Assertion failure:** `expected 3000 to be less than or equal to 16` (`scrollContainer.scrollTop` didn't reach expected top position within the 16px slop).
- **Verified pre-existing:** ran the same test on HEAD before applying any Plan 07 changes (via `git stash`) — SAME 1/8 failure. Not caused by Plan 07.
- **Owner:** out of Plan 07 scope. The failure is in the auto-scroll state machine, which Plan 07 doesn't touch. Recommend a Quick task for the PrettyView owner to triage.

### Pre-existing tsc errors (out of scope)

`npx tsc --noEmit -p tsconfig.app.json` reports 461 errors, all in unrelated files (compose-drafts-api.ts, message-queue-api.ts, ssh-file-operations-api.ts, user-preferences-api.ts, identities-api.test.ts, several ChatMessage/PrettyView instrumentation files). Zero errors in Plan 07's new/modified files. Plan 07 does NOT touch a strict-tsc build gate, so this is stable status quo.

## Threat-model coverage

All `mitigate` dispositions from PLAN.md `<threat_model>` are addressed:

| Threat ID | Category | Mitigation shipped | Evidence |
|-----------|----------|-------------------|----------|
| T-79-07-01 | Info-Disclosure — bot token in dev-tools console | No `console.log(token)` anywhere; only `console.warn("IdentityModal: getUserInfo failed", err)` (no token in scope). | `grep -Ec 'console\.log.*token'` on TelegramTab.tsx = 0 |
| T-79-07-02 | Info-Disclosure — token persisted in DOM after state transition | `setToken("")` on successful activate; Test 7 asserts `document.body.innerHTML.includes(VALID_TOKEN) === false` post-flow. | TelegramTab.test.tsx Test 7 passes |
| T-79-07-03 | Info-Disclosure — token in URL query string | All calls use POST body via authApi; grep `url.*\?botToken=` on telegram-api.ts = 0 | 0 |
| T-79-07-04 | Tampering — AlertDialog bypass on Disconnect | Radix AlertDialog with distinct AlertDialogAction / AlertDialogCancel; Test 5 asserts Cancel does NOT call disconnect. | Tests 4 + 5 |
| T-79-07-05 | EoP — UI activates for identity not owned by user | Backend authz (Plan 03 T-79-03-01) enforces `req.userId === body.humanUserId` and returns 403 on mismatch; frontend passes the value the backend re-verifies via JWT. | Plan 03's routes.test.ts test coverage; postTelegramActivate returns `{ok:false, status:403}` in this path (Task 1 test 5) |
| T-79-07-06 | Spoofing — client sets wrong humanUserId | Backend Plan 03 always trusts `req.userId` from JWT; frontend's `authUserId` is UX-correctness only. | Plan 03's `mockUserId="different-user"` test at 403; unchanged in Plan 07 |
| T-79-07-SC | Supply-chain — package installs | Zero new npm dependencies. All UI primitives (AlertDialog, Button, Skeleton, lucide-react Send) already in-tree. | `git diff HEAD~4..HEAD -- package.json package-lock.json` returns empty |

## Known stubs

**`telegramHandle: "unknown"`** in the connected-state branch of the initial-status effect (IdentityModal.tsx:723-731). The Plan 03 GET /telegram/:identityKey wire response carries `{botUsername, telegramChatId}` but not the human's Telegram display handle. Filling this in requires a lookup against Telegram's `getChat` API — deferred to a follow-up plan (out of Plan 07 scope per CONTEXT § 3A "minimal connected state"; the "@unknown" placeholder still reads cleanly and is not misleading for the initial launch).

## Threat flags

None. No new security-relevant surface beyond what PLAN.md `<threat_model>` anticipated.

## Gotchas for downstream waves / plan 09 cutover

1. **`humanUserId` empty-string case is a real code path** — if `getUserInfo()` fails (e.g., cookie expired), TelegramTab renders "couldn't verify session" hint + disabled Submit. Plan 09 smoke test should include the logged-out flow: opening the modal without a session should NOT crash — it should show the disabled Submit.

2. **`telegramHandle: "unknown"` is a stub** — see § Known stubs. Do NOT market the connected-state view as "shows your Telegram handle" until this is wired.

3. **Bot token input is `type="password"`** — browser autofill won't offer to save it. This is intentional (T-79-07-01) but may surprise Ashley if she expects browser password-manager help. Not a bug.

4. **The `getTelegramStatus` effect uses dynamic import** — first modal open incurs a ~50ms one-time chunk load. Subsequent identity-switches reuse the resolved module. If the chunk load fails (offline), the effect leaves `telegramState={status:"loading"}` indefinitely — a small robustness gap, but acceptable given the modal is always opened online.

5. **Blocker W-3 lockdown:** the anti-regression grep `grep -c 'humanUserId={""}\|humanUserId={/\* thread' src/ui/features/pretty-view/IdentityModal.tsx` returning **0** should be added to a CI regression guard if Plan 79 lands a Plan-79-wide CI hook. Reintroducing the placeholder empty-string would silently break authz.

## Commits (per-task atomic)

| Commit | Type | Purpose |
|--------|------|---------|
| `fc98a6c1` | `feat(79-07)` | Task 1 — telegram-api client + 11 tests |
| `8496f866` | `test(79-07)` | Task 2 RED — 7 failing TelegramTab tests |
| `62c1362d` | `feat(79-07)` | Task 2 GREEN — TelegramTab component |
| `1461eca2` | `feat(79-07)` | Task 3 — IdentityModal wiring + role-tab test 22b fix |

## Self-Check: PASSED

- `src/ui/api/telegram-api.ts` exists — verified
- `src/ui/api/telegram-api.test.ts` exists — verified
- `src/ui/features/pretty-view/TelegramTab.tsx` exists — verified
- `src/ui/features/pretty-view/TelegramTab.test.tsx` exists — verified
- IdentityModal.tsx modified (6 edits) — verified via `grep -c '// Phase 79 Plan 07' src/ui/features/pretty-view/IdentityModal.tsx` = 9 (comments split across import + hooks + effects + slot)
- Commit `fc98a6c1` exists — verified via `git log --oneline -5`
- Commit `8496f866` exists — verified
- Commit `62c1362d` exists — verified
- Commit `1461eca2` exists — verified
- All Task 1 tests (11/11) pass — verified
- All Task 2 tests (7/7) pass — verified
- All Task 3 tests (role-tab 6/6) pass — verified
- Full pretty-view suite: 852/864 pass; 1 remaining failure is pre-existing (PrettyView.hydration-cap.test.tsx:658) — verified via `git stash` isolation
- Blocker W-3 anti-regression grep = 0; positive grep = 1 — verified
- CONTEXT § 3D verbatim string present in TelegramTab.tsx — verified via `grep -c 'The bot stays alive in Telegram'` = 2 (block comment + template literal)
- Zero tsc errors on Plan 07 files — verified
