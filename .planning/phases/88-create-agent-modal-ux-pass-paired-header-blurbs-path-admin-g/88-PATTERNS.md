# Phase 88: create-agent-modal-ux-pass — Pattern Map

**Mapped:** 2026-09-08
**Files analyzed:** 8 (5 source, 5 test — all EXISTING file modifications, no new files)
**Analogs found:** 8 / 8 (every surface has an in-repo precedent)

Every change in this phase modifies an existing file. The strongest analogs are:
1. **`CreateRoleDialog.tsx`** as the sibling dialog + Phase 84 blurb precedent.
2. **`PrettyConversationsPanel.tsx:1651`** as the in-repo canonical `{isAdmin && …}` admin-gate.
3. **Phase 84 commits** (`993843ef` on CreateRoleDialog) which set the "revise `<DialogDescription>` slot only, don't add a new element" pattern.
4. **`identity-birth.ts:206`** which already contains a `typeof path === "string" ? path : "~"` narrow — the exact seam where a `~/<name>/` default can be substituted backend-side.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/ui/sidebar/CreateRoleDialog.tsx` | dialog (component) | request-response | itself (revise Phase-84 slot) | exact (same file, same slot) |
| `src/ui/sidebar/NewSessionDialog.tsx` | dialog (component) | request-response + SSE stream | `CreateRoleDialog.tsx` (sibling) | exact-sibling |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | container/provider | prop-forward | itself (`isAdmin` at L1651 → `<WeeklyUsageMeter />`) | exact (forward another prop through same call site pattern) |
| `src/backend/database/routes/identity-birth.ts` | route (Express handler) | request-response (opens SSE) | itself L206 (`parsedPath` narrow) | exact (extend existing empty-branch fallback) |
| `src/ui/sidebar/NewSessionDialog.test.tsx` | test | RTL component test | itself (Test D, Test S, `renderDialog`) | exact |
| `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` | test | RTL component test | `NewSessionDialog.test.tsx` (shared helper shape) | role-match |
| `src/ui/sidebar/NewSessionDialog.chain.test.tsx` | test | RTL component test | `NewSessionDialog.test.tsx` | role-match |
| `src/ui/sidebar/NewSessionDialog.task-input.test.tsx` | test | RTL component test | `NewSessionDialog.test.tsx` | role-match |
| `src/ui/sidebar/CreateRoleDialog.test.tsx` | test | RTL component test | itself (Test 11 blurb assertion) | exact |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | test | RTL component test | itself (Tests at L4722-4743 — `isAdmin={true}` / `isAdmin` default false) | exact |

---

## Pattern Assignments

### 1. `src/ui/sidebar/CreateRoleDialog.tsx` — revise blurb text only

**Analog:** itself, `CreateRoleDialog.tsx:527-529` (the Phase-84 slot).

**Current shape** (`CreateRoleDialog.tsx:512-530`):
```tsx
<DialogHeader>
  <DialogTitle>{startTitle}</DialogTitle>
  {/*
   * Phase 84 (D-CONTEXT item 1): one-sentence header blurb explaining
   * what a role IS. Paired vocabulary with the future create-agent
   * blurb (create-agent-modal-ux-pass bounty carries the sibling copy:
   * "An agent is one specific worker doing a role, with its own name
   * and history."). Product language, not engineering terms — see
   * shape file §Philosophy.
   *
   * Phase 84 (D-CONTEXT item 2): the prior <DialogDescription> that
   * said "Provision a new role folder on the picked host. Name and
   * description are required." is DELETED — the fields themselves
   * already signal required state, no separate caption needed.
   */}
  <DialogDescription>
    A role is what an agent does and how it thinks — many agents can share one.
  </DialogDescription>
</DialogHeader>
```

**Change required (LOCKED verbatim from `88-CONTEXT.md §Verbatim copy`):**

Replace text at L528 with the two-sentence blurb:
```
Roles are the expertise your agents adopt. Every agent using this role inherits its goals, rules, and knowledge.
```

**Landmines:**
- **Preserve `<DialogDescription>` wrapper element** — Phase 84 Plan 01 §CHANGE F.1 (84-01-SUMMARY.md L54-55) locked this decision: keep the shadcn `DialogDescription` wrapper for `aria-describedby` a11y wiring; do NOT swap for `<p>` or `<span>`.
- **Update or replace the Phase 84 rationale block above** (L514-525). The old "future create-agent blurb" comment is now obsolete because the sibling blurb lands in the same commit. Either delete the two comment blocks and add a fresh Phase 88 one, or leave a small marker comment.
- **Verbatim copy** — the sentence text (including the period after "adopt.") is greenlit by Alice and must land byte-exact.

---

### 2. `src/ui/sidebar/NewSessionDialog.tsx` — multi-edit

**Analog for the blurb slot** — `CreateRoleDialog.tsx:512-530` (sibling dialog just gained one four hours earlier; Phase 84).

**Analog for admin-conditional rendering** — `PrettyConversationsPanel.tsx:1651` (`{isAdmin && <WeeklyUsageMeter />}`) — same box, same idiom.

**Analog for a submit-path invariant** — `identity-birth.ts:206` server-side, or the frontend seam at `NewSessionDialog.tsx:631,645,719,1137,1146`.

#### 2a. Blurb: revise `<DialogDescription>` at L816-819

**Current shape** (`NewSessionDialog.tsx:816-819`):
```tsx
<DialogHeader>
  <DialogTitle>{startTitle}</DialogTitle>
  <DialogDescription>{startDescription}</DialogDescription>
</DialogHeader>
```

`startDescription` is bound at L781-783:
```tsx
const startDescription = t("nav.newSessionDescription", {
  defaultValue: "Pick a host and (optionally) name the agent.",
});
```

**Change required (LOCKED verbatim from `88-CONTEXT.md §Verbatim copy`):**

Replace the `defaultValue` string in `startDescription` (L781-783) with:
```
Agents are the workers you chat with. Each one adopts a role that shapes what they know and how they help.
```

Do NOT create a new i18n key — Phase 84 Copy-guard (84-CONTEXT.md L61-64) locks in-place `defaultValue` edits only. Sibling change on CreateRoleDialog follows same rule.

#### 2b. Path field admin-gate at L926-942

**Current shape** (`NewSessionDialog.tsx:926-942`):
```tsx
{/* Path field — visible in BOTH modes, below host list + above identity-mode checkbox */}
<div className="flex flex-col gap-1.5">
  <label htmlFor="new-session-path" className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
    Path
  </label>
  <Input
    id="new-session-path"
    aria-label="Path"
    value={path}
    onChange={(e) => setPath(e.target.value)}
    placeholder="~/"
    disabled={formDisabled}
  />
</div>
```

**Admin-gate pattern to mirror** — from `PrettyConversationsPanel.tsx:1651`:
```tsx
{isAdmin && <WeeklyUsageMeter />}
```

**Change required:** wrap the entire `<div>…</div>` (L927-942) in `{isAdmin && (…)}`. Non-admin: field does NOT render.

Also see Phase 84 Plan 01 CHANGE F.2 (84-01-SUMMARY.md L58) — an inline single-guard wrap, `{flatHosts.length !== 1 && (<>…</>)}`, is the sibling precedent for gating a whole render block. Same idiom shape.

#### 2c. Identity-mode checkbox admin-gate at L944-960

**Current shape** (`NewSessionDialog.tsx:944-960`):
```tsx
{/* Identity-mode checkbox — below the path field */}
<div className="flex items-center gap-2">
  <input
    type="checkbox"
    id="new-session-identity-mode"
    checked={identityMode}
    onChange={(e) => !formDisabled && setIdentityMode(e.target.checked)}
    disabled={formDisabled}
    className="w-3.5 h-3.5 rounded disabled:opacity-50"
  />
  <label
    htmlFor="new-session-identity-mode"
    className="text-xs text-[color:var(--color-pv-fg)] cursor-pointer select-none"
  >
    Create with new identity
  </label>
</div>
```

**Changes required:**
1. Wrap block in `{isAdmin && (…)}` — same admin-gate idiom as 2b.
2. Flip label text at L958 from `Create with new identity` → `Just a shell — no agent` (Alice verbatim greenlit — 88-CONTEXT.md L34-36).
3. See semantic-drift note under 2e.

#### 2d. `identityMode` state default flip at L326

**Current** (`NewSessionDialog.tsx:324-326`):
```tsx
// Identity-mode checkbox (defaults ON per IDUI-01).
// When on, reveals the identity-birth field cluster.
const [identityMode, setIdentityMode] = useState(true);
```

**Change:** `useState(true)` → `useState(false)`.

**Also update the modal-close reset** at `NewSessionDialog.tsx:436`:
```tsx
setIdentityMode(true);
```
must become `setIdentityMode(false)` to match the new default (otherwise reopen doesn't match fresh mount).

#### 2e. Semantic drift trap — rename `identityMode` OR pin invariant with a comment

**Landmine locked in shape file §What would make it wrong item #5** (shape-create-agent-modal-ux-pass.md L44) and 88-CONTEXT.md L52-53:

> The state var name is `identityMode` which historically meant "checkbox is checked = identity mode ON." After the inversion, `identityMode: false = checkbox unchecked = agent (default)`, `identityMode: true = checkbox checked = shell (opt-out)`. Executor MUST either rename the variable (candidates: `shellOnly`, `isRawShell`, `agentDisabled`) OR add a header comment locking the new invariant.

**Enumerated references** (from `grep -n 'identityMode' NewSessionDialog.tsx`):
- L27 (comment)
- L123, L139, L144, L151 (Three-way discriminated union `NewSessionOnCreateOpts` — the `identityMode: false | true | "existing"` discriminant on the callback payload).
- L326 (state hook — default flip target)
- L405, L416, L417, L418, L419 (chain-prefill open-effect)
- L436 (close-reset — default-flip target)
- L485, L529 (roles-fetch effect)
- L546, L556, L581 (pickPoolName effect)
- L712, L720 (birth-success onCreate payload — the discriminant literal `identityMode: true`)
- L747, L751 (canOpen predicate)
- L898 (regular-session name-input render gate: `{!identityMode && (…)}`)
- L949 (checkbox `checked` binding)
- L963 (identity-cluster render gate: `{identityMode && (…)}`)
- L967, L1036 (comments)
- L1138 (submit-onclick branch)
- L1147 (regular-session `onCreate` payload)

**Rename recommendation:** if renaming state var, DO NOT rename the callback-payload discriminant `identityMode` in `NewSessionOnCreateOpts` (L138-158) — that's a public contract consumed by `AppShell.tsx:2040-2044` narrowing (see 88-CONTEXT.md L130-133 rationale). Only the local state var flips semantics. Renaming reveals the drift; keeping the same name for both would be the trap.

If NOT renaming, add an invariant comment right above `useState(false)` locking:
```tsx
// INVARIANT (Phase 88): the local `identityMode` state variable is SEMANTICALLY
// INVERTED from the callback payload discriminant of the same name.
//   state.identityMode === true  → checkbox CHECKED → user opting into raw shell
//   state.identityMode === false → checkbox UNCHECKED → user is spawning an agent (default)
// The onCreate payload discriminant (NewSessionOnCreateOpts) still uses
// identityMode: true = agent, identityMode: false = shell. Read every use of
// this variable through the "state vs payload" lens.
```

#### 2f. `isAdmin` prop with fail-closed default

**Analog:** `PrettyConversationsPanel.tsx:285` + `:368`:
```tsx
// Line 285 — destructure:
isAdmin = false,

// Line 368 — type:
isAdmin?: boolean;
```

The full comment block at 363-368 explaining fail-closed:
```tsx
// Feature 09 (per-user usage meter) collapsed 2026-09-04 to an admin-only
// visibility gate on the existing single-source WeeklyUsageMeter. Non-admin
// users don't see anyone's usage — not their own, not the box aggregate.
// Sourced from /users/me.is_admin (AppShell state); default false so tests
// and any non-AppShell caller render as non-admin (meter hidden).
isAdmin?: boolean;
```

**Apply to NewSessionDialog prop signature** (currently at L277-312):
```tsx
export function NewSessionDialog({
  open,
  onClose,
  hostTree,
  onCreate,
  initialHost,
  initialRole,
  initialBrief: _initialBrief,
  // ADD:
  isAdmin = false,
}: {
  open: boolean;
  ...
  initialBrief?: string | null;
  /** Phase 88: admin-gate for Path field (L926-942) + identity-mode checkbox
   *  (L944-960). Default false = fail-closed: non-admin behavior applies when
   *  the caller forgets to pass the prop. Sourced from
   *  PrettyConversationsPanel.tsx L285 → forwarded from AppShell state
   *  (users.is_admin). Matches the sibling gate at
   *  PrettyConversationsPanel.tsx:1651 for the WeeklyUsageMeter. */
  isAdmin?: boolean;
}) {
```

#### 2g. Submit-path invariant (defense-in-depth)

**Analog:** the existing branch at `NewSessionDialog.tsx:1131-1153` (onClick handler on the Create button):

Current:
```tsx
<Button
  variant="outline"
  disabled={!canOpen}
  className="text-[color:var(--color-pv-code-fg)] hover:opacity-90 disabled:opacity-50"
  onClick={() => {
    if (!canOpen || !selectedHost) return;
    const normalizedPath = normalizePath(path);
    if (identityMode) {
      // Identity-mode ON: start birth stream
      void handleBirth();
    } else {
      // Identity-mode OFF: existing regular-session contract + path
      onCreate({
        host: selectedHost,
        sessionName: sessionName.length > 0 ? sessionName : undefined,
        path: normalizedPath,
        identityMode: false,
      });
    }
  }}
>
  {birthing ? "Creating..." : openLabel}
</Button>
```

**Change (per 88-CONTEXT.md L53 "Non-admin invariant: enforce in the submit path, not just via the render gate — defense-in-depth"):**

The branch `if (identityMode)` above uses the local state var (now flipped-semantic per 2e). The non-admin submit-path invariant is: **when `!isAdmin`, treat as agent-mode regardless of local state** — force the identity/birth branch.

Recommended shape (independent of whether 2e renames the state var):
```tsx
onClick={() => {
  if (!canOpen || !selectedHost) return;
  const normalizedPath = normalizePath(path);

  // Phase 88 invariant: non-admin can never spawn a raw shell. The checkbox
  // is admin-gated (never renders for non-admin), but enforce again at
  // submit time so a bug in the render gate cannot leak shell access.
  const effectiveShellOnly = isAdmin && identityMode; // if renamed to shellOnly, use `isAdmin && shellOnly`

  if (!effectiveShellOnly) {
    // Agent mode: start birth stream
    void handleBirth();
  } else {
    // Admin explicitly opted into raw shell
    onCreate({ ... identityMode: false });
  }
}}
```

Adapt the local-var name for whichever choice 2e makes. The invariant is `isAdmin === false ⇒ agent branch`.

#### 2h. Path default substitution for non-admin (frontend OR backend — planner picks)

**Frontend seam:** `handleBirth` at L631 + submit-onclick at L1137:
```tsx
const normalizedPath = normalizePath(path);
```
Frontend can compute `~/${name.toLowerCase()}/` when `!isAdmin` before this line, then thread the substituted value into `openBirthStream(...)` at L645.

**Backend seam (recommended per shape §Scope):** `identity-birth.ts:206`:
```tsx
const parsedPath = (typeof path === "string" ? path : "~") as string;
```

Extend to:
```tsx
// Phase 88: when the request omits path (or sends empty string), substitute
// ~/<name>/ where <name> is the identity's name from the same payload —
// non-admin users don't get the Path field UI (NewSessionDialog admin-gate)
// and every non-admin agent gets its own working directory named after itself.
// Admin submits still send an explicit `path` value ("~/" or an override).
const parsedPath = (
  typeof path === "string" && path.trim()
    ? path.trim()
    : `~/${(typeof name === "string" ? name.trim().toLowerCase() : "")}/`
) as string;
```

**Landmines:**
- If frontend substitutes, backend contract stays unchanged. Simpler test surface (test the frontend condition only). But the `normalizePath()` function at L97 currently maps `""` → `"~"` and `"~"` → `"~"` unchanged — so an empty path submitted from the UI does NOT become `~/<name>/`, it becomes `~`. If frontend approach is chosen, either (a) skip `normalizePath` for the non-admin default (compute directly), or (b) change `normalizePath` behavior conditionally.
- If backend substitutes, both admin ("~/") and non-admin ("" or absent) submits must be tested — validate the empty-branch fallback isn't accidentally hit by an admin who typed nothing (defense: admin's UI defaults to "~/" via `useState("~/")` at L322 + is a required-looking field with visible placeholder).
- The `<name>` in `~/<name>/` is the identity's name — kebab-case-lowercased. `name.toLowerCase()` matches what the client already sends at L644 (`name: name.toLowerCase()`).

---

### 3. `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — forward `isAdmin`

**Analog:** the panel already has the prop wired in (L285, L368) and consumes it at L1651. Just add one more consumer — the `<NewSessionDialog>` render.

**Current call site** (`PrettyConversationsPanel.tsx:1935-1958`):
```tsx
{showPencilButton && (
  <NewSessionDialog
    open={newSessionDialogOpen}
    onClose={() => {
      setNewSessionDialogOpen(false);
      setChainPrefill(null);
    }}
    hostTree={hostTree ?? null}
    onCreate={(opts) => {
      onCreateSession!(opts);
      setNewSessionDialogOpen(false);
      setChainPrefill(null);
    }}
    initialHost={chainPrefill?.host ?? null}
    initialRole={chainPrefill?.role ?? null}
    initialBrief={chainPrefill?.description ?? null}
  />
)}
```

**Change:** add `isAdmin={isAdmin}` prop-forward. The value is already in scope (destructured at L285).

Same pattern one line at a time — just like `isAdmin={isAdmin}` gets forwarded from `AppShell.tsx:2025` to `<PrettyConversationsPanel>` (see AppShell L2021-2025):
```tsx
<PrettyConversationsPanel
  variant={isMobile ? "mobile" : "desktop"}
  sidebarToggleOverlaps={isMobile && !isTouchDevice && sidebarOpen}
  visibleInSplitTreeTabIds={visibleInSplitTreeTabIds}
  isAdmin={isAdmin}
```

**Landmines:**
- The prop-forward is trivial. Do NOT need to touch `CreateRoleDialog` render (L1968-1981) — the shape file explicitly notes create-role is admin-only-visible upstream anyway; this bounty is the first to add admin-gating INSIDE a dialog (84-CONTEXT L78-79 + 88-CONTEXT L78-79).

---

### 4. `src/backend/database/routes/identity-birth.ts` — accept empty/absent path (backend option)

**Analog:** same file, L206. Current shape:
```tsx
const parsedPath = (typeof path === "string" ? path : "~") as string;
```

Compare the Phase 86 Plan 86-04 pattern nearby (L213-214) which already handles absent-⇒-empty gracefully:
```tsx
const parsedTitle =
  typeof title === "string" && title.trim() ? title.trim() : "";
```

Where `name` is validated + trimmed at L111-114 and L330 (passes `name.trim()` to orchestrator). By the time we hit L206, we know `name` is a non-empty string.

**Change (if backend approach chosen):** see 2h above for the exact shape.

**Landmines:**
- The orchestrator uses `parsedPath` on L336 (threaded into `birthIdentity` opts as `path`). Downstream consumers of `opts.path` include the tmux `-c` argument (step 2 of birth) and the SFTP write target for step 2.5 role frontmatter. Both accept `~` and `~/<name>/`; the shell + SFTP interpret `~` as `$HOME`. `~/<name>/` is safe.
- Do NOT change the wire contract of the frontend `BirthRequest` interface at `identities-api.ts:495-527` if backend-substituting. `path: string` stays; empty string is a valid value the backend now substitutes. But the frontend still normalizes via `normalizePath` at L631/1137 which maps `""` → `"~"`, which would defeat the backend substitution. See 2h landmine — either (a) don't call `normalizePath` on the empty-non-admin submit, or (b) send `""` explicitly on non-admin path.
- If frontend approach chosen instead, the backend stays UNCHANGED. Simpler test-surface argument.

---

### 5. `src/ui/sidebar/NewSessionDialog.test.tsx` — 16 references to `identityMode`

**Analog:** the file itself. The existing Test D (L620-626) asserts the current default:
```tsx
describe("NewSessionDialog: Test D — identity-mode defaults ON", () => {
  it("Test D: initial render → identity-mode checkbox is checked", () => {
    const { getByRole } = renderDialog();
    const checkbox = getByRole("checkbox", { name: /create with new identity/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
```

**Test-fixture pattern** — `renderDialog` helper at L542-559 (no isAdmin param yet, defaults must therefore drive non-admin behavior). To exercise admin, tests will pass `isAdmin={true}` inline.

**Existing admin-conditional test pattern to mirror** — from `PrettyConversationsPanel.test.tsx:4722-4743`:
```tsx
describe("PrettyConversationsPanel: WeeklyUsageMeter admin gate (feature 09)", () => {
  it("mounts .pv-usage-meter when isAdmin is true", () => {
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        isAdmin={true}
        onDeactivateRow={() => {}}
      />,
    );
    expect(container.querySelector(".pv-usage-meter")).not.toBeNull();
  });

  it("hides .pv-usage-meter when isAdmin is false (default)", () => {
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );
    expect(container.querySelector(".pv-usage-meter")).toBeNull();
  });
});
```

**Changes required to this test file:**

1. **Update `renderDialog` helper** (L542-559) to accept `isAdmin?: boolean` override; forward to `<NewSessionDialog isAdmin={overrides.isAdmin ?? true} />` so most existing tests still exercise the admin path (they were written when path + checkbox were universal). This is the least-churn migration.

2. **Update Test D** (L620-626) to test the flipped default AND the new label text. Suggested rewrite:
   ```tsx
   describe("NewSessionDialog: Test D — identity-mode defaults OFF (checkbox unchecked, admin-only)", () => {
     it("Test D: initial render with isAdmin=true → 'Just a shell — no agent' checkbox is unchecked", () => {
       const { getByRole } = renderDialog({ isAdmin: true });
       const checkbox = getByRole("checkbox", { name: /just a shell.*no agent/i }) as HTMLInputElement;
       expect(checkbox.checked).toBe(false);
     });
   });
   ```

3. **Update all 16 `identityMode` references** (grep list under 2e above — L286, L327, L358, L575-576, L601-602, L623, L638-639, L801-806, L811-815, L848-849, L920-936 in the test file). Every place that does `fireEvent.click(getByRole("checkbox", { name: /create with new identity/i }))` needs the label updated to `/just a shell.*no agent/i` AND the semantic-inverted intent — clicking now OPTS INTO shell (was: OPTS OUT of shell).

4. **Add 3 new tests per 88-CONTEXT.md §Scope-in tests:**
   - `NewSessionDialog with isAdmin={false}` (or absent) → no Path input, no checkbox visible.
   - `NewSessionDialog with isAdmin={true}` → both visible, defaults match spec (path = "~/", checkbox unchecked).
   - Submit path with `isAdmin={false}` + absent-path-in-state → `openBirthStream` (or `onCreate`) called with `path: "~/<name>/"` (front-side substitution) OR with `path: ""` (backend-side substitution) depending on planner's choice.

**Landmines:**
- 5 previously-passing tests will break on the label-regex change alone — factor to a shared `IDENTITY_MODE_CHECKBOX_RE = /just a shell.*no agent/i` const at file top.
- The default-checked assumption is baked deep — Tests 5, 6, 7 (L300-302, L342-343, L379) explicitly click the checkbox to toggle OFF the (then-default-ON) identity mode to reach the regular-session path. After Phase 88, the default is OFF (agent = default in the flipped semantic). Those tests should REMOVE the click (or invert it, depending on 2e rename).

---

### 6. `NewSessionDialog.role-dropdown.test.tsx`, `NewSessionDialog.chain.test.tsx`, `NewSessionDialog.task-input.test.tsx`

**Analog:** each shares the `renderDialog` helper shape and the `create with new identity` checkbox interaction pattern with `NewSessionDialog.test.tsx`. Update each independently.

**role-dropdown.test.tsx** — grep says 0 refs to `identityMode`. BUT the test suite exercises the role dropdown which is `identityMode`-gated in render (see NewSessionDialog L963 `{identityMode && (…)}`). Any test that expects the role dropdown to appear must ensure identity-mode is ON (in the NEW semantic where default is agent-mode = identityMode=false = agent-cluster visible). If the rename in 2e happens, this file's behavior is unchanged (agent cluster is still on-by-default). If NOT renamed, this file just needs a mental-model update.

**chain.test.tsx** — grep says 0 refs to `identityMode` local var. BUT Test 1-9 header (L6-17) documents `identity-mode ON` as an assumption. Test 5/9 references need audit — Test 9 "identity-mode OFF → initialRole is IGNORED" needs the checkbox interaction to trigger shell-mode, and the checkbox label + click semantics have flipped.

**task-input.test.tsx** — 5 refs to `identityMode` (L236, L246, L428, L445, L455). Each is a describe/it string, not a runtime check. Grep to update the surface:
- Task 1a: "task textarea is rendered when identityMode=true" — after Phase 88, task textarea renders when agent-mode is on (default), i.e. `identityMode === false` in the flipped state. Rewrite the test title + the setup (no checkbox click needed to reach agent-mode; it's default).
- Task 1b: "task textarea is absent when identityMode is toggled off" — after Phase 88, task textarea absent when shell-mode is opted in via checkbox check. The click at L249-252 remains but the interpretation inverts.

**Landmines:**
- These three sibling test files each construct their own `renderDialog` helper (task-input at L127-144 uses `oneHostTree` default; check chain + role-dropdown). Each needs the same `isAdmin?: boolean` override + `isAdmin={true}` default to keep existing coverage passing.
- The `oneHostTree` fixture in task-input.test.tsx auto-picks the sole host on open (per `flatHosts.length === 1` branch at NewSessionDialog:422-424), so tests never render the host listbox. Unaffected by Phase 88.

---

### 7. `src/ui/sidebar/CreateRoleDialog.test.tsx` — audit for blurb text assertion

**Analog:** itself. Test 11 at L297-304 asserts the current one-sentence blurb text:
```tsx
// Phase 84 (Plan 84-01 CHANGE F.1): the header blurb renders below
// the title, above the fields. Exact string from D-CONTEXT item 1
// (LOCKED for planning; user may redirect during execute).
expect(
  screen.getByText(
    /A role is what an agent does and how it thinks — many agents can share one\./,
  ),
).toBeTruthy();
```

**Change:** replace the regex with the new two-sentence text:
```tsx
expect(
  screen.getByText(
    /Roles are the expertise your agents adopt\. Every agent using this role inherits its goals, rules, and knowledge\./,
  ),
).toBeTruthy();
```

**Landmines:**
- The em-dash in the OLD blurb was verbatim-escaped in the regex. The NEW blurb has two periods (mid-sentence + terminal); each must be `\.`-escaped.
- Test 11 also asserts the OLD required-caption is absent (L310-312). That assertion stays valid — the caption never returns.
- Update the surrounding Phase 84 comment (L297-299) to note the Phase 88 revision.

---

### 8. `PrettyConversationsPanel.test.tsx` — no changes required for the isAdmin forward

The panel-side `isAdmin` gate at L1651 is unchanged; existing tests at L4722-4743 still hold. The new `isAdmin={isAdmin}` prop-forward to `<NewSessionDialog>` renders identical output for tests that don't open the dialog. Only add a test IF the planner wants to assert the forward explicitly — otherwise coverage comes from the sibling `NewSessionDialog.test.tsx` §5 above.

**Optional new test** (nice-to-have, per shape "defense-in-depth"):
```tsx
it("forwards isAdmin=true to NewSessionDialog", () => {
  const { container } = render(
    <PrettyConversationsPanel
      variant="desktop"
      isAdmin={true}
      hostTree={someTree}
      onCreateSession={vi.fn()}
      onDeactivateRow={() => {}}
    />,
  );
  // Click pencil to open NewSessionDialog
  fireEvent.click(container.querySelector('[data-testid="new-session-pencil"]')!);
  // Path field visible when admin
  expect(screen.getByLabelText(/^path$/i)).toBeTruthy();
});
```

---

## Shared Patterns

### Admin gating (fail-closed default)
**Source of truth:** `PrettyConversationsPanel.tsx:1651` + prop signature at L285/L368.
**Apply to:** every new admin-only render block in `NewSessionDialog.tsx` (§2b Path, §2c checkbox).
**Idiom:**
```tsx
{isAdmin && (
  <div>…</div>
)}
```
Prop default is `isAdmin = false` at destructuring. Fail-closed: caller-forgot → non-admin behavior wins.

### In-place i18n `defaultValue` edit (no new key)
**Source of truth:** Phase 84 Plan 01 CHANGE D + G (84-01-SUMMARY.md L48-49) + 84-CONTEXT.md L61-64 Copy-guard.
**Apply to:** §1 role blurb, §2a agent blurb.
**Idiom:** edit the second-arg `defaultValue` string in `t("some.key", { defaultValue: "…" })`. Existing translations continue rendering old English until re-translated; source-of-truth locale is English.

### Sibling dialog paired-vocabulary blurb
**Source of truth:** Phase 84 shipped `CreateRoleDialog.tsx:527-529` with the intent to be paired with a future create-agent blurb; comment at L516-519 names the future sibling text explicitly.
**Apply to:** BOTH §1 and §2a in the same commit (or contiguous commits, one deploy) — 88-CONTEXT.md §Risks locks this: "Ship agent blurb without revising role blurb" = visible inconsistency.

### Backend "absent-⇒-default" fallback
**Source of truth:** `identity-birth.ts:206` for path, L213-214 for title, L218-221 for avatarCandidateId. Phase 86 Plan 86-04 established the pattern for cosmetics.
**Apply to:** §2h backend option — extend the L206 `parsedPath` narrow to substitute `~/<name>/` when empty/absent.

### Test-fixture `renderDialog` helper
**Source of truth:** `NewSessionDialog.test.tsx:542-559` + `NewSessionDialog.task-input.test.tsx:127-144` + `NewSessionDialog.chain.test.tsx` + `NewSessionDialog.role-dropdown.test.tsx` (each defines its own).
**Apply to:** all four test files. Add `isAdmin?: boolean` override with default `true` (preserves existing coverage which was written when admin surface was universal). Explicit `isAdmin: false` tests then exercise the new non-admin non-render branch.

---

## No Analog Found

None. Every surface has a strong in-repo precedent.

## Metadata

**Analog search scope:** `src/ui/sidebar/`, `src/ui/features/pretty-conversations/`, `src/ui/AppShell.tsx`, `src/backend/database/routes/`, all `.test.tsx` siblings.
**Files scanned:** 12 (5 modified sources + 5 test files + AppShell + identities-api).
**Pattern extraction date:** 2026-09-08.
