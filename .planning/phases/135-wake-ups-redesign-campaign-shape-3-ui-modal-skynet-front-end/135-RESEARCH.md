# Phase 135: wake-ups-redesign campaign shape 3 (UI modal) — Research

**Researched:** 2026-09-24
**Domain:** Skynet React front-end modal — consumer of shape-2 REST API
**Confidence:** HIGH (design settled, API contract read directly from shipped shape-2 code, chrome tokens read directly from sibling modals)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from 135-CONTEXT.md)

**API integration**
- **D-01:** Consumer of shape 2's endpoints, no new backend surface. GET `/wakeups` (fleet-wide fan-out), roles enumeration `GET /roles?hostId=...`. Writes: POST/PATCH/DELETE `/wakeups`, PATCH `/wakeups/<slug>/toggle-enabled`. Phase 135 owns zero backend routes.
- **D-02:** Nginx paired-blocks likely N/A. Shape 2 already delivered paired location blocks. Planner audits any incidental route additions.
- **D-03:** No client cache surviving beyond modal-open lifecycle. Refetch on open + after every successful write.

**Header button**
- **D-04:** Integration site is `PrettyConversationsPanel.tsx`'s header cluster (guarded fragment). Position: after "Edit global files" globe button, before "More" kebab. Same `.pv-pencil` chrome; clock/timer icon with dashed accent.
- **D-05:** Mobile — accept the squeeze; no special responsive treatment.

**Modal shell + shared chrome**
- **D-06:** Chrome mirrors `ConversationSearchModal`'s recipe. Glass-morphism (24px rounded, blue-hue gradient, backdrop blur, warm off-white text), Radix Dialog, ~640×720 centered / inset-4 mobile. One shell, two internal states.
- **D-07:** New component in `src/ui/features/pretty-conversations/`. Do NOT reuse `WakeupsTab.tsx` (still consumed by IdentityModal per phase 128 D-09).

**List view**
- **D-08:** Default state on open is the list. Row shape: name headline (bold) / metadata line (small dim: schedule kind + next-fire humanized + host chip) / prompt body (2-line clamp muted) / chip row (role chips magenta + skill chips blue if hand-edited) / right-side enable-toggle + kebab menu.
- **D-09:** Host indicator per row = small chip in the metadata line. Subtle styling.
- **D-10:** Filter bar: text search over name/prompt + role dropdown + host dropdown. Order left-to-right: search / role / host. No skill dropdown.
- **D-11:** Row click behavior — clicking anywhere on the row body (except toggle or kebab) opens edit mode. Toggle and kebab `event.stopPropagation`.
- **D-12:** Enable-toggle is pessimistic. Visual state waits for API ack; failure surfaces inline error banner at top of list view with API message verbatim.
- **D-13:** Kebab menu = Edit + Delete only.
- **D-14:** Delete confirmation = native `window.confirm(\`Delete wake-up "${name}"?\`)`.
- **D-15:** Loading state = reuse loading pattern `RoleModal.tsx` uses. **⚠️ RESEARCH FLAG:** the actual pattern in RoleModal / RoleFileTab / WakeupsTab is `<Skeleton>` skeleton bars — NOT loading text. See § Common Pitfalls #1 and § Assumptions Log for the resolution recommendation.
- **D-16:** Empty state — centered helper line. Fleet-wide zero: "No wake-ups on any host. Click + to create one." Filtered zero: "No wake-ups match this filter."
- **D-17:** Filter state resets on modal close.
- **D-18:** Footer = count of specs + how many enabled ("6 wake-ups · 5 enabled").

**Create / edit form**
- **D-19:** Same modal shell, header title swaps ("New wake-up" / "Edit wake-up"), footer swaps to Cancel (left) + Save (right, primary blue).
- **D-20:** Form fields (in order): Name (single-line) / Prompt (textarea) / Roles (chip-picker, multi-select) / Host (chip-picker, single-select mandatory; read-only on edit) / Schedule (segmented control). NO skills picker.
- **D-21:** Host is read-only on edit.
- **D-22:** Schedule segmented control: Daily / Weekly / Interval / One-shot with contextual detail fields per kind.
- **D-23:** Validation matches `wakeup-scheduler.py`'s parser exactly. Client-side validation is minimal — required fields only.
- **D-24:** Weekly day-picker shape — planner reads scheduler first. **RESEARCH ANSWER:** scheduler accepts `day: <single string>` (mon..sun 3-letter). NOT an array. Picker is single-select segmented control. See § Standard Stack and § Runtime State Inventory for exact wire shape.
- **D-25:** Save error UX = inline error banner at top of form body. Form stays open with field values intact.

**State semantics**
- **D-26:** Modal is Radix Dialog controlled state, lifted to `PrettyConversationsPanel` (same site as sibling modals).
- **D-27:** Two internal states — `list` (default on open) and `form` (create OR edit).
- **D-28:** No streaming affordances anywhere.

**Deploy**
- **D-29:** Container mutation required. Standard `docker build` + `docker compose up --force-recreate skynet` motion. No fleet-substrate changes. Bundled ship with shape 2.
- **D-30:** Standard fleet-rule serialization on container mutations — user coordinates manually. Full test suite is pre-deploy gate. `git pull --rebase` before every push AND before every docker build.
- **D-31:** Full test suite must be green pre-deploy.

### Claude's Discretion (8 items)

1. Exact URL for shape 2's endpoints — **RESEARCH ANSWER:** bare `/wakeups` prefix (mounted via `app.use("/wakeups", ...)` chained). See § Standard Stack § API Contract.
2. Exact icon choice — **RESEARCH RECOMMENDATION:** `AlarmClock` from lucide-react (already used at `src/ui/features/pretty-view/IdentityModal.tsx:30` for the existing "Wakeups" tab). Consistent with the prototype's clock+dashed-border aesthetic when styled via the `.new-wakeup-button` chrome variant.
3. Exact naming — **RESEARCH RECOMMENDATION:** `WakeupsModal.tsx` (mirrors sibling `ConversationSearchModal.tsx` / `NewConversationModal.tsx` naming).
4. Wave decomposition — see § Component Reuse Map for a proposed split.
5. Host-chip visual token — see § Chrome Token Dictionary.
6. Filter-narrowed count copy — **RESEARCH RECOMMENDATION:** "6 shown · 5 enabled" when unfiltered, "6 of 12 · 5 enabled" when filter narrows. Planner picks; both fit the token weight.
7. Cancel-form refetch discipline — **RESEARCH RECOMMENDATION:** always refetch on form close (simpler, matches D-03's "no client cache" spirit; single extra fan-out per Cancel is cheap).
8. `WakeupsSpec` type naming — **RESEARCH FLAG:** `WakeupSpecWire` at `claude-session-api.ts:719` is NOT reusable as-is. It has `instruction: string`, but shape 2's `GlobalWakeupSpec` uses `prompt: string` + `roles?: string[]` + `skills?: string[]`. CONTEXT D-30's implicit "reuse" won't compile. See § Common Pitfalls #3 and § Standard Stack § Frontend Types.

### Deferred Ideas (OUT OF SCOPE)

- "Fire now" / test-trigger button (needs new shape-2 endpoint)
- "Duplicate" affordance
- "Show last-fired info" / history view
- Session-persistent filter state
- Responsive header treatment
- Toast surface
- Deep-link / URL state
- Skills picker
- Templates library
- Cross-host wake-up management
- Server-side auto-suffix on slug collision
- Streaming / websocket for spec-change notifications
</user_constraints>

<phase_requirements>
## Phase Requirements

The phase has 30 D-XX decisions + 8 discretion items. This phase is not covered by REQUIREMENTS.md (patch-#43 pretty-view-era). The D-XX decisions ARE the requirements. Every plan task should trace back to at least one D-XX or one prototype section (A/B/C).
</phase_requirements>

## Summary

Phase 135 is a **pure frontend shipment** — one new modal component, one new header button, one new frontend API-helper file, one nginx audit (expected no-op). Zero backend routes. Zero fleet-substrate changes. The design is settled to an unusual degree: the prototype is code-quality HTML/CSS with exact tokens, the CONTEXT locks 30 decisions, and shape 2's REST endpoints are already shipped and exercised by 1417 scoped tests. This research audits the actual code (shape-2 routes files, sibling modals, WakeupFormShared) to give the planner **specific line numbers, exact type names, exact token values, and 3 landmines** worth flagging.

The three landmines: (1) **D-15's "loading text" description is inaccurate** — the actual RoleModal/WakeupsTab pattern is `<Skeleton>` bars, not text. Planner should match the shipped pattern, not the CONTEXT phrasing. (2) **`WakeupSpecWire` cannot be reused** — its `instruction` field is the retired per-identity shape; the new modal needs a fresh `GlobalWakeupSpecWire` type mirroring shape-2's server `GlobalWakeupSpec`. (3) **Shape 2 did NOT ship any frontend helpers** — a `src/ui/api/wakeups-api.ts` file must be written from scratch (5 helpers). CONTEXT D-30 vaguely says "reuse `WakeupSpecWire`" but the shape 2 wave that would have added helpers was never executed.

**Primary recommendation:** One plan, two waves: **Wave 1 = wakeups-api.ts + WakeupsModal.tsx skeleton with list view only (no form, no toggle) + header-button wire-in. Wave 2 = create/edit form + toggle/delete + inline errors + tests.** Rationale: wave 1 delivers a working shipping-shape (browsable list, no writes) fast — proves the API surface end-to-end. Wave 2 layers the mutation paths onto a proven read path. If the planner sees enough parallel-safety, split further; otherwise one plan is right per CONTEXT's "1-2 plans" guidance.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Modal chrome (Radix Dialog, glass-morphism) | Browser / Client | — | Pure UI; no server rendering in Skynet |
| List rendering + filter logic | Browser / Client | — | Client-side filter on already-fetched data; fits D-10 |
| Enable-toggle / Delete / Create / Update writes | API / Backend | Browser (form marshaling) | Backend owns file writes; browser just marshals HTTP |
| Fleet-wide LIST fan-out | API / Backend | — | SSH fan-out across managed hosts — always server-side |
| Roles enumeration for filter + form | API / Backend | Browser (dropdown render) | Backend enumerates via SSH `ls`; browser renders |
| Host list (dropdown + form) | Browser / Client | — | Panel-threaded `hostTree` prop already in DOM |
| Delete confirmation | Browser / Client | — | `window.confirm()` per D-14 — no server round-trip until user OKs |

## Standard Stack

### Core Libraries (already installed — no `npm install` needed)

| Library | Version | Purpose | Verified |
|---------|---------|---------|----------|
| `@radix-ui/react-dialog` | ^1.1.15 | Modal shell (Dialog.Root/Portal/Overlay/Content/Close/Title) | [VERIFIED: package.json:99] |
| `radix-ui` (umbrella) | (whatever pins Dialog) | Import path used in sibling modals: `import { Dialog as DialogPrimitive } from "radix-ui"` | [VERIFIED: ConversationSearchModal.tsx:48, NewConversationModal.tsx:27] |
| `lucide-react` | (bundled) | Icons — `AlarmClock`, `X`, `Search`, `MoreHorizontal` | [VERIFIED: IdentityModal.tsx:30, imports throughout] |
| `vitest` | (bundled) | Unit test framework | [VERIFIED: package.json:20 `"test": "vitest run"`] |
| `@testing-library/react` | ^16.3.2 | Component rendering + interaction | [VERIFIED: package.json:115] |
| `@testing-library/user-event` | ^14.6.1 | User event simulation | [VERIFIED: package.json:116] |
| `@testing-library/jest-dom` | ^6.9.1 | DOM matchers | [VERIFIED: package.json:114] |
| `@playwright/test` | ^1.63.0 | E2E smoke | [VERIFIED: package.json:95] |

### API Contract — shape 2's REST endpoints (exact wire, read from source)

**Base URL:** `/wakeups` — mounted bare via chained routers in `src/backend/database/database.ts:2036-2037`:
```
app.use("/wakeups", wakeupsListRoutes);
app.use("/wakeups", wakeupsWriteRoutes);
```
NOT `/api/wakeups`. [VERIFIED: database.ts:2036-2037]

Nginx paired blocks (both `docker/nginx.conf:465` and `docker/nginx-https.conf:467`):
```
location ~ ^/wakeups(/.*)?$ { ... client_max_body_size 64k; }
```
Method-agnostic regex covers GET/POST/PATCH/DELETE in one block. [VERIFIED: nginx.conf:465, nginx-https.conf:467]

#### GET `/wakeups` — fleet-wide LIST

- **Auth:** JWT (Authorization header via `authApi`).
- **Query params:** NONE. Fan-out is fleet-wide across all user-scoped hosts.
- **Response 200:**
  ```json
  { "items": WakeupListItem[] }
  ```
  Where `WakeupListItem` is (exported from `src/backend/database/routes/wakeups-list.ts:75-86`):
  ```typescript
  {
    slug: string;         // kebab-case, IDENTITY_SLUG_RE-validated
    host: string;         // human-readable hostname
    hostId: number;       // for write dispatch
    name: string;         // spec.name (falls back to slug)
    enabled: boolean;     // spec.enabled (default true)
    schedule: unknown;    // raw spec.schedule object
    scheduleHuman: string; // pre-humanized via humanizeWakeupSchedule()
    prompt: string;
    roles: string[];      // [] if missing
    skills: string[];     // [] if missing (populated only when hand-edited on disk)
  }
  ```
- **Response shape is FLAT ARRAY** (not grouped by host). [VERIFIED: wakeups-list.ts:384 `return res.json({ items: perHost.flat() })`]
- **Failure modes:** 500 `{error:"host_projection_failed"}` on DB failure; 500 `{error:"internal"}` catch-all. Individual host down → contributes `[]`, does NOT fail the whole response (per-host `Promise.race` with 15s timeout).

#### POST `/wakeups` — CREATE

- **Auth:** JWT.
- **Body cap:** 64kb (`express.json({limit:"64kb"})`).
- **Body:**
  ```json
  { "host": <positive integer>, "spec": GlobalWakeupSpec }
  ```
  Where `GlobalWakeupSpec` is (from `src/backend/database/routes/wakeups-write.ts:136-152`):
  ```typescript
  {
    name: string;              // REQUIRED — non-empty; derives slug via normalizeWakeupSlug
    enabled?: boolean;         // optional; must be boolean when present
    prompt: string;            // REQUIRED — non-empty
    schedule: {
      type: "interval" | "daily" | "weekly" | "one_shot";
      every?: string | number; // required for interval
      at?: string;             // required for daily / weekly / one_shot
      day?: string;            // required for weekly (single 3-letter code, lowercase)
      // NOTE: `days?: string[]` (weekly-day-array) is NOT part of the ACCEPT list —
      // the scheduler treats it as an optional day-of-week GATE separately. See Pitfall #6.
      timezone?: string;       // optional; IANA name; daily/weekly/one_shot only
    };
    roles?: string[];          // optional array of strings
    skills?: string[];         // optional array of strings (modal never populates)
  }
  ```
- **Response 201:** `{ slug: string, host: <hostId>, spec: GlobalWakeupSpec }`.
- **Response 400:** `{error: "<validationMsg>"}` — any of: bad body shape, name empty, prompt empty, invalid schedule type, missing type-specific required field, non-boolean enabled, non-string-array roles/skills.
- **Response 404:** `{error: "Host not found"}` — cross-user host or unknown hostId.
- **Response 409:** `{error: "wakeup with this name already exists"}` — slug collision.
- **Response 502:** `{error: "SSH connect failed" | "SSH exec failed" | "SFTP write failed"}` — transport/write failure.
- **Slug is server-derived** via `normalizeWakeupSlug(spec.name)`; client MUST NOT compute it.

#### PATCH `/wakeups/:slug` — UPDATE (full-spec overwrite)

- **Auth:** JWT.
- **Body:** same shape as CREATE: `{host, spec}`.
- **⚠️ NAME-VS-SLUG GATE:** the body's `spec.name` MUST kebab-normalize to the URL's `:slug`. If they diverge, server returns 400 `{error: "spec.name normalizes to a different slug than the URL — renames must go through DELETE + CREATE"}`. [VERIFIED: wakeups-write.ts:522-529] This means:
  - Form field "Name" is IMMUTABLE on edit-mode from the API's perspective (a rename is a delete+create workflow).
  - Planner must decide: disable the Name input in edit-mode, OR let user rename by triggering delete+create under the hood, OR let user rename freely and surface the 400 (worst UX).
  - **Recommendation:** disable the Name input in edit-mode with a helper text ("To rename, delete + recreate"). Matches D-21's host-read-only rationale of "visible-edits-without-an-action = wrong kind of wrong."
- **Response 200:** `{ slug, host, spec }`.
- **Errors:** 400 (bad body, invalid slug), 404 (host not found; note: NOT 404 for missing spec — UPDATE creates parent dir + writes), 502 (transport).

#### PATCH `/wakeups/:slug/toggle-enabled` — flip enabled

- **Auth:** JWT.
- **Body:**
  ```json
  { "host": <positive integer>, "enabled": <boolean> }
  ```
- **Response 200:** `{ slug, host, enabled }`.
- **Response 404:** `{error: "wakeup not found"}` — spec file missing on target host.
- **Errors:** 400 (bad body), 502 (transport).
- **Semantics:** reads-then-writes the spec on the target host, flips `spec.enabled` to the requested boolean. Per-slug mutex serializes concurrent writes. [VERIFIED: wakeups-write.ts:643-822]

#### DELETE `/wakeups/:slug` — hard delete

- **Auth:** JWT.
- **Body:**
  ```json
  { "host": <positive integer> }
  ```
  **⚠️ DELETE with a body** — non-standard but shape 2's chosen wire. The frontend helper must pass `data:{host:...}` to axios (not query params). [VERIFIED: wakeups-write.ts:840]
- **Response 204:** empty body.
- **Errors:** 400 (bad slug/host), 404 (host not found), 502 (transport). NOT 404 on missing spec — `rm -rf` is idempotent.
- **Side effect:** also removes `~/fleet/wakeups/.state/<slug>.fired` sentinel in the same exec, so a future spec with the same slug doesn't inherit "already fired" state.

#### GET `/roles?hostId=<n>` — roles enumeration (existing endpoint, reused)

- **Auth:** JWT.
- **Query params:** `hostId` (integer, required).
- **Response 200:** `RoleSummary[]` — each entry `{name, description, title?, displayName?, colorHue?, voice?, avatar?}`.
- **Frontend helper already exists** at `src/ui/api/identities-api.ts:321` — `listRolesForHost(hostId: number): Promise<RoleSummary[]>`. [VERIFIED: identities-api.ts:321-328]
- **Modal usage:** call once per selected host (or once fleet-wide by iterating hostTree — planner picks). The filter-bar's role dropdown behavior is Claude's discretion per CONTEXT — recommendation: dedupe across all hosts for the filter dropdown; scope to the form's currently-selected host for the form's roles chip-picker.

### Frontend Types (proposed additions to `wakeups-api.ts`)

**Do NOT reuse `WakeupSpecWire`** from `claude-session-api.ts:719`. It has `instruction: string` (retired per-identity shape), not `prompt: string`. Create new types in the new `src/ui/api/wakeups-api.ts` file:

```typescript
// Mirror of backend WakeupListItem (wakeups-list.ts:75-86)
export type WakeupListItem = {
  slug: string;
  host: string;
  hostId: number;
  name: string;
  enabled: boolean;
  schedule: unknown;         // raw — hydrate via WakeupFormShared.hydrateFormSchedule
  scheduleHuman: string;
  prompt: string;
  roles: string[];
  skills: string[];
};

// Mirror of backend GlobalWakeupSpec (wakeups-write.ts:136-152)
export type GlobalWakeupSpecWire = {
  name: string;
  enabled?: boolean;
  prompt: string;
  schedule: Record<string, unknown>;  // built via WakeupFormShared.buildSchedule
  roles?: string[];
  skills?: string[];
};

// Public API helpers:
export async function listWakeups(): Promise<WakeupListItem[]>;
export async function createWakeup(host: number, spec: GlobalWakeupSpecWire): Promise<{slug: string; host: number; spec: GlobalWakeupSpecWire}>;
export async function updateWakeup(slug: string, host: number, spec: GlobalWakeupSpecWire): Promise<{slug: string; host: number; spec: GlobalWakeupSpecWire}>;
export async function toggleWakeupEnabled(slug: string, host: number, enabled: boolean): Promise<{slug: string; host: number; enabled: boolean}>;
export async function deleteWakeup(slug: string, host: number): Promise<void>;
```

**Implementation pattern** (verified against `identities-api.ts:321-328`):
```typescript
import { authApi, handleApiError } from "@/main-axios";

export async function listWakeups(): Promise<WakeupListItem[]> {
  try {
    const response = await authApi.get("/wakeups");
    return (response.data as {items: WakeupListItem[]}).items;
  } catch (error) {
    handleApiError(error, "list wake-ups");
  }
}

export async function deleteWakeup(slug: string, host: number): Promise<void> {
  try {
    // DELETE with body — axios needs `data` on config object
    await authApi.delete(`/wakeups/${encodeURIComponent(slug)}`, { data: { host } });
  } catch (error) {
    handleApiError(error, "delete wake-up");
  }
}
```

`handleApiError` throws an `ApiError` carrying `.status` and `.code` — CreateProjectModal at `src/ui/features/pretty-conversations/CreateProjectModal.tsx:76-97` shows the pattern for mapping 409/400 to user-facing messages. Shape 3 reuses this shape for its inline error banner (D-25).

### Version Verification

Only established packages are added/consumed; no new npm installs required. Runtime dependencies (Radix, lucide, axios, testing libs) are all already declared in `package.json`. Package legitimacy audit is N/A for this phase (no external packages added).

## Package Legitimacy Audit

> This phase adds ZERO new npm packages. All dependencies (radix-ui, lucide-react, @testing-library/*, vitest, axios via main-axios wrapper) are already installed and used by sibling modals. Slopcheck / registry verification not applicable.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| *(none)* | — | — | — | — | — | No installs |

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────┐
                       │  PrettyConversationsPanel.tsx           │
                       │  ┌───────────────────────────────────┐  │
                       │  │  header cluster (7 buttons)       │  │
                       │  │  Search │ New │ Project │ Roles │ │  │
                       │  │  Globe │ WAKEUPS(new) │ Feedback │ │  │
Header click →         │  │  │ More                            │  │
setWakeupsModalOpen──────┼──▶ pv-header-wakeups-button          │  │
                       │  └───────────────────────────────────┘  │
                       │                                          │
                       │  (sibling modal mount alongside          │
                       │   ConversationSearchModal, etc.)         │
                       │                                          │
                       │  <WakeupsModal                           │
                       │     open={wakeupsModalOpen}              │
                       │     onOpenChange={setWakeupsModalOpen}   │
                       │     hostTree={hostTree}                  │
                       │  />                                      │
                       └─────────────────────────────────────────┘
                                       │
                                       ▼
       ┌──────────────────────────────────────────────────────────┐
       │   WakeupsModal.tsx (new — Radix Dialog shell)            │
       │                                                          │
       │   ┌────────────────────────────┐  ┌───────────────────┐  │
       │   │  view: "list" (default)    │  │ view: "form"      │  │
       │   │  ─ filter bar              │  │ ─ Name input      │  │
       │   │  ─ scrollable rows         │  │ ─ Prompt textarea │  │
       │   │    ─ toggle (pessimistic)  │  │ ─ Roles chip-pick │  │
       │   │    ─ kebab → edit/delete   │  │ ─ Host chip-pick  │  │
       │   │  ─ footer count            │  │   (edit=readonly) │  │
       │   │  + inline error banner     │  │ ─ Schedule seg    │  │
       │   │                            │  │ ─ Cancel │ Save   │  │
       │   └────────────────────────────┘  └───────────────────┘  │
       │                                                          │
       │  Refetch triggers: open(true), save success, delete,     │
       │  toggle. NO client cache.                                │
       └──────────────────────────────────────────────────────────┘
                                       │
                                       ▼
        ┌──────────────────────────────────────────────────────┐
        │   src/ui/api/wakeups-api.ts  (new — 5 helpers)       │
        │   listWakeups() → GET  /wakeups                      │
        │   createWakeup() → POST /wakeups                     │
        │   updateWakeup() → PATCH /wakeups/:slug              │
        │   toggleWakeupEnabled() → PATCH /wakeups/:slug/toggle-enabled │
        │   deleteWakeup() → DELETE /wakeups/:slug             │
        │                                                      │
        │   Plus existing:                                     │
        │   listRolesForHost() → GET /roles?hostId=<n>         │
        │       (from identities-api.ts, already exists)       │
        └──────────────────────────────────────────────────────┘
                                       │
                                       ▼ (unchanged nginx paired blocks)
        ┌──────────────────────────────────────────────────────┐
        │  Skynet backend — shape 2 endpoints (LIVE LOCAL)      │
        │  wakeups-list.ts  (GET /wakeups fan-out)             │
        │  wakeups-write.ts (POST/PATCH/DELETE + toggle)       │
        │  roles-list-for-host.ts (existing since phase 22)    │
        └──────────────────────────────────────────────────────┘
                                       │
                                       ▼ (SSH fan-out)
        ┌──────────────────────────────────────────────────────┐
        │  Managed hosts' filesystems:                          │
        │  ~/fleet/wakeups/<slug>/wakeup.json                  │
        │  ~/fleet/wakeups/.state/<slug>.fired                 │
        │  (scheduler polls these — shape 1)                   │
        └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/ui/features/pretty-conversations/
├── WakeupsModal.tsx                    # NEW — main modal shell + list view
├── WakeupsModal.test.tsx               # NEW — unit tests
├── WakeupsModalForm.tsx                # NEW OPTIONAL — extract form to sub-file
│                                         (planner picks — see Component Reuse Map)
├── WakeupsModalRow.tsx                 # NEW OPTIONAL — extract row to sub-file
│                                         (planner picks — good for testability)
├── PrettyConversationsPanel.tsx        # MODIFIED — add button + modal mount
│                                         (+ new-state hook + hostTree threading)
├── PrettyConversationsPanel.wakeups-button.test.tsx   # NEW — panel button test
│                                         (mirrors PrettyConversationsPanel.new-role-button.test.tsx)
└── (all other sibling files unchanged)

src/ui/api/
└── wakeups-api.ts                      # NEW — 5 helpers + 2 wire types
└── wakeups-api.test.ts                 # NEW — helper unit tests (mock authApi)

src/ui/features/pretty-view/
├── WakeupsTab.tsx                      # UNCHANGED — still consumed by IdentityModal per-identity
├── WakeupFormShared.tsx                # UNCHANGED — REUSABLE by WakeupsModal
│                                         (imports FormSchedule, hydrateFormSchedule,
│                                          buildSchedule, validateForm, RestrictToDaysChips,
│                                          detectBrowserTimezone, toIsoWithOffset)
└── RoleModal.tsx                       # UNCHANGED — reference for chip-picker pattern
                                         (planner audits whether chip-picker is extractable)
```

### Pattern 1: Radix Dialog Modal Shell (mirror ConversationSearchModal)

**What:** Portal-mounted modal with glass-morphism chrome, `onInteractOutside=preventDefault` (X + Escape are the only close paths).
**When to use:** Any new modal in Skynet. This is the fleet-wide chrome discipline.
**Example** (verbatim excerpt from `ConversationSearchModal.tsx:210-244`):
```tsx
import { Dialog as DialogPrimitive } from "radix-ui";

<DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "absolute inset-0 z-[110] bg-black/40",
        "supports-backdrop-filter:backdrop-blur-xs duration-100",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
      )}
    />
    <DialogPrimitive.Content
      onInteractOutside={(e) => { e.preventDefault(); }}
      className={cn(
        "absolute inset-4 z-[120] outline-none",
        "flex flex-col overflow-hidden rounded-[24px]",
        // shape 3 note: shape file says ~640x720, ConversationSearchModal uses 560x720.
        // Use 640x720 for shape 3 per prototype/CONTEXT.
        "md:max-w-[640px] md:max-h-[720px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
        "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
        "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
      )}
      style={{
        background: "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
        backdropFilter: "blur(28px) saturate(1.4)",
        WebkitBackdropFilter: "blur(28px) saturate(1.4)",
        border: "1px solid hsla(220, 65%, 55%, 0.32)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
        color: "#e8e4d8",
      }}
    >
      <DialogPrimitive.Title className="sr-only">Wake-ups</DialogPrimitive.Title>
      {/* ...header, body, footer... */}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```
[CITED: ConversationSearchModal.tsx:210-244]

### Pattern 2: Header button in `.pv-pencil` chrome (mirror existing 6)

**Location:** inside the `showPencilButton && (<>...</>)` guarded fragment at `PrettyConversationsPanel.tsx:2226-2286`. Insert AFTER the Globe button (`pv-header-global-files-button`, closes at :2284) and BEFORE the closing `</>` at :2285.
**Chrome class:** `pv-pencil` (mandatory — this is the shared button style).
**Icon size:** 18px (verified via `<Globe size={18} />` at :2283).
**testid convention:** `pv-header-wakeups-button` (mirrors `pv-header-search-button`, `pv-header-edit-roles-button`, etc.).

**Example (proposed insertion):**
```tsx
<button
  type="button"
  className="pv-pencil"
  aria-label="Wake-ups"
  title="Wake-ups"
  data-testid="pv-header-wakeups-button"
  onClick={() => setWakeupsModalOpen(true)}
>
  <AlarmClock size={18} />
</button>
```
[CITED: PrettyConversationsPanel.tsx:2226-2286]

**Prototype's dashed-blue chrome accent:** the prototype (`prototype.html` lines 146-154) defines a `.new-wakeup-button` variant class with `border: 1px dashed hsla(220, 65%, 55%, 0.35)` etc. This is a visual highlight for the *tasting* to draw the reviewer's eye — NOT necessarily meant to be permanent chrome. Planner picks: (a) ship without the accent (button looks like its neighbors — cleanest), (b) ship with a subtle dashed accent for discoverability during v1's first week, then bounty-remove. Recommendation: **(a) — no accent**. The prototype accent was a tasting artifact, not a production spec. If the user wants to keep discoverability, that's a follow-up bounty.

### Pattern 3: Host picker (mirror CreateProjectModal)

**File to mirror:** `CreateProjectModal.tsx:48-70` (host-tree flatten helper) + `:99-151` (host-picker state + auto-select-one-host affordance).
**Threading:** panel passes `hostTree={hostTree ?? null}` (verified for CreateProjectModal at PrettyConversationsPanel.tsx:3094). Shape 3's modal mount adds the same prop.
**Auto-select-single-host affordance** (Phase 84 pattern):
```tsx
const flatHosts = useMemo(
  () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
  [hostTree],
);
useEffect(() => {
  if (open && flatHosts.length === 1 && selectedHost === null) {
    setSelectedHost(flatHosts[0]);
  }
}, [open, flatHosts, selectedHost]);
```
[CITED: CreateProjectModal.tsx:114-151]

**Filter-bar host dropdown** — reuses the same `flatHosts` list; adds an "All hosts" sentinel option as the default (D-10). Recommendation: `selectedHostId: number | "ALL"` — "ALL" is a discriminated sentinel that means "no filter."

### Pattern 4: Reuse `WakeupFormShared.tsx` (found — heavily reusable)

**Import path:** `@/features/pretty-view/WakeupFormShared`.
**13 exports** — all reusable by WakeupsModal:
- `FormSchedule` (discriminated union) — replaces having to re-invent schedule form state.
- `WEEKDAY_VALUES` + `Weekday` + `isWeekday`.
- `hydrateFormSchedule(sched: unknown): FormSchedule` — converts a `WakeupListItem.schedule` (raw wire) into edit-mode form state. **Direct use in shape 3.**
- `buildSchedule(fs: FormSchedule, tz: string): Record<string, unknown>` — inverse; produces the schedule object shape 2's API accepts. **Direct use in shape 3.**
- `validateForm(fs: FormSchedule): string | null` — client-side pre-Save gate. **Direct use.**
- `detectBrowserTimezone(): string` — reads `Intl.DateTimeFormat().resolvedOptions().timeZone`. **Direct use.**
- `toIsoWithOffset(local: string): string` — datetime-local → ISO with offset for one_shot. Called inside `buildSchedule`; no direct use needed.
- `RestrictToDaysChips` — a chip-row component for the optional day-of-week gate (see Pitfall #6 for whether shape 3 exposes this).
- Helpers `cap`, `pad2`, `normalizeDays`.

**⚠️ Weekly form UX (D-24 answer):** the scheduler accepts `schedule.day: <single-string>` for weekly, but `WakeupFormShared`'s existing per-identity WakeupsTab surfaces the **optional day-of-week `days: string[]` gate** via `RestrictToDaysChips` (a separate concept — filters ANY schedule type to specific weekdays only). CONTEXT D-22 says Weekly should have a "day-of-week picker (single day or multi-select; planner picks based on scheduler parser — see D-24)". **The scheduler's Weekly `day` field is a SINGLE string.** Planner picks:
  - **Option A (simpler, matches shape file's prototype):** Weekly = single-day segmented control (Mon/Tue/…/Sun). No `RestrictToDaysChips`.
  - **Option B (feature-parity with WakeupsTab):** single-day + `RestrictToDaysChips` gate row (advanced power-user affordance).
  - **Recommendation: Option A for v1.** The prototype only shows a single day. `RestrictToDaysChips` is an advanced escape hatch that hand-editors on disk can still use — but the modal doesn't need to expose it in v1. Any spec that has `days: [...]` set on disk will still round-trip cleanly (hydrateFormSchedule preserves it; buildSchedule re-emits it) IF the form preserves the raw `days` field. **Simplest v1:** show only the single-day segment; don't render or mutate `days`; if a hand-edited spec has `days`, it survives the round-trip because we only WRITE the fields the form knows about (schedule.type + kind-specific + timezone). This is a NON-TRIVIAL DECISION and the planner MUST decide explicitly — see Runtime State Inventory § Stored data for the round-trip fidelity risk.

### Pattern 5: Inline error banner (mirror CreateProjectModal's error mapping)

**Error mapping helper** at `CreateProjectModal.tsx:76-97` (already read into research):
```typescript
function statusOf(err: unknown): number | undefined { ... /* ducks ApiError.status */ }

function interpretError(err: unknown, name: string): string {
  const status = statusOf(err);
  if (status === 409) return `A wake-up named "${name}" already exists on this host — pick a different name.`;
  if (status === 400) return "Wake-up schedule is malformed — check the fields.";
  return "Couldn't save wake-up — try again.";
}
```
**Banner render** (per D-25) — inline at top of form body:
```tsx
{error && (
  <p role="alert" className="text-xs text-center text-red-400">
    {error}
  </p>
)}
```
[CITED: NewConversationModal.tsx:429-436]

For the list view's toggle-error banner (D-12), the same pattern at the top of the list-scroll region. The banner dismisses automatically on next successful action; also add a manual dismiss X per D-25 ("Banner is dismissible; clears automatically on successful save").

### Anti-Patterns to Avoid

- **Do NOT reuse `WakeupSpecWire` from `claude-session-api.ts:719`** — its `instruction` field is the retired per-identity shape. Wire types must be fresh in `wakeups-api.ts`.
- **Do NOT modify `WakeupsTab.tsx`** — still consumed by `IdentityModal.tsx:1586` for per-identity wake-up management (unrelated to global wake-ups).
- **Do NOT use `Dialog.Close asChild`** for the X button in this modal — the sibling `ConversationSearchModal` uses `onClick={() => onOpenChange(false)}` directly (see :296-305); reusing this same pattern keeps behavior consistent (esp. with `onInteractOutside=preventDefault`).
- **Do NOT client-derive the slug** — the server derives it from `spec.name` via `normalizeWakeupSlug`. Client derivation risks divergence from the server's regex.
- **Do NOT client-cache the LIST across modal-open cycles.** D-03 is explicit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal chrome / focus trap / escape-to-close | Custom `<div>` with keydown listeners | Radix Dialog primitives already in use | A11y is subtle; Radix has it right; consistency with 5+ existing Skynet modals |
| Schedule form state (union type + hydrate/build/validate) | Fresh `useState` per schedule kind | `WakeupFormShared.tsx` — 13 exports ready to import | Battle-tested (12 tests), byte-shape-mirror of WakeupsTab, would just duplicate |
| Host list flattening | Fresh recursive walker | `collectAllHosts` from `CreateProjectModal.tsx:59-69` (or extract to a shared util) | Three copies exist already; use one of them |
| API error → user string mapping | Custom try/catch per handler | `statusOf` + `interpretError` from `CreateProjectModal.tsx:76-97` | Consistent 409/400/500 handling across modals |
| Schedule humanization for list rows | Client-side `humanizeWakeupSchedule` | Backend already emits `scheduleHuman: string` in the LIST response | Trip is free; the server's humanizer is the truth |
| Slug generation | Client-side kebab-case | Server does it via `normalizeWakeupSlug` | Divergence risk; server is truth |
| Delete confirmation modal chrome | Custom sub-modal | `window.confirm()` — D-14 explicit | User said so verbatim; zero build cost |
| Loading state | Custom spinner or text | `<Skeleton>` bars — matches WakeupsTab / RoleFileTab / IdentityFileTab | Fleet-consistency; see Pitfall #1 for D-15 phrasing correction |

**Key insight:** This phase's build-vs-borrow bar is unusually LOW because sibling modals (ConversationSearchModal, NewConversationModal, CreateProjectModal, RoleModal) collectively cover every pattern the wake-ups modal needs. The plan should be MOSTLY IMPORTS + assembly, with maybe 200-300 lines of new logic (row rendering, filter application, list ↔ form state machine).

## Runtime State Inventory

> Included because this phase modifies data-round-trip shape. Not a rename/refactor per se, but the "hand-edited-on-disk spec must round-trip through the modal without loss" contract is a runtime state concern.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | On-disk `~/fleet/wakeups/<slug>/wakeup.json` files across every managed host — the source of truth. May contain fields the modal never populates: `skills: [...]`, `schedule.days: [...]` (day-of-week gate), `schedule.timezone: "..."`. | The form must READ these fields, PRESERVE them across edit, and WRITE them back — even though the modal never exposes them for editing. Concretely: when hydrating for edit-mode, keep the full raw `WakeupListItem.schedule` object, mutate only the parts the form controls, re-emit via `buildSchedule` PLUS any preserved fields. Planner must decide the exact preservation strategy (see § Common Pitfalls #6). |
| Live service config | None — no external service (n8n, Datadog, task scheduler) touches wake-ups. The scheduler is a stdlib Python script polling filesystem paths; no config lives elsewhere. | None. |
| OS-registered state | None — the scheduler is spawned by `agent-supervisor.sh` at host boot. Wake-ups themselves are just JSON files. | None. |
| Secrets/env vars | None — no wake-up-specific secrets. JWT auth on all endpoints reuses existing Skynet session auth (`authApi`). | None. |
| Build artifacts | Frontend bundle inside `skynet-patched:local` Docker image. | Standard rebuild: `docker build` + `docker compose up --force-recreate skynet` per D-29. |

**Nothing found in category (verified):**
- **Live service config:** None — no external service integrates with `~/fleet/wakeups/`.
- **OS-registered state:** None — verified via reading `substrate/scripts/wakeup-scheduler.py` (which polls filesystem, no OS registration).
- **Secrets/env vars:** None — verified via searching `wakeups-*.ts` files for `process.env` (no matches).

## Common Pitfalls

### Pitfall 1: D-15's "loading text" phrasing is inaccurate — actual pattern is Skeleton bars

**What goes wrong:** Planner takes CONTEXT D-15 at face value ("reuse the same loading-text pattern `RoleModal.tsx` uses today") and writes a task like "render a centered dim 'Loading...' text block during first fetch." But the actual code doesn't do that.
**Why it happens:** The CONTEXT D-15 was drafted from a mental model of what RoleModal "feels like" during load, but the actual JSX at `IdentityFileTab.tsx:74-81`, `RoleFileTab.tsx:67-74`, and `WakeupsTab.tsx:137-144` all use `<Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />` bars — three stacked bars during loading.
**How to avoid:** Match the shipped code, not the CONTEXT phrasing. Use 3 `<Skeleton>` bars in the list scroll area during first fetch. Import from `@/components/skeleton` (or wherever `Skeleton` is imported in RoleFileTab).
**Warning signs:** Task description that says "loading text" without mentioning `<Skeleton>` — flag it in plan-check.
**Fallback if planner disagrees:** If user explicitly wanted centered text (unclear from CONTEXT phrasing), the tradeoff is chrome inconsistency with WakeupsTab, but small. Ask during plan-check if any doubt.

### Pitfall 2: `WakeupSpecWire` at `claude-session-api.ts:719` has `instruction`, not `prompt` — do NOT reuse

**What goes wrong:** CONTEXT § Claude's Discretion line 8 says "reuse `WakeupSpecWire`" but the compile will fail — the existing type's `instruction: string` doesn't match shape 2's `GlobalWakeupSpec.prompt: string`.
**Why it happens:** `WakeupSpecWire` was defined in phase 72 for per-identity wake-ups. Per-identity wake-ups use `instruction` (the retired schema). Global wake-ups (this phase's target) use `prompt` (phase 127 D-04). CONTEXT phrasing missed the field rename.
**How to avoid:** Add a fresh type `GlobalWakeupSpecWire` in `src/ui/api/wakeups-api.ts` — see § Standard Stack § Frontend Types. Keep `WakeupSpecWire` intact (still used by per-identity path).
**Warning signs:** Plan task that says "import WakeupSpecWire from claude-session-api" — that's wrong for the global path. Flag it.

### Pitfall 3: Shape 2 did NOT ship frontend API helpers — the phase must create `wakeups-api.ts` from scratch

**What goes wrong:** Planner assumes shape 2 wave 1 delivered helpers (per CONTEXT § Existing Code Insights integration point: "src/ui/api/claude-session-api.ts — new frontend helpers for the fleet-wide LIST + per-host CRUD if shape 2 wave 1 didn't already add them. Planner audits."). Grep confirms: **no such helpers exist**. `grep "wakeups\|/wakeups" src/ui` returns zero backend-facing helpers.
**Why it happens:** Shape 2's scope was primarily backend + retire the per-role WS surface; frontend helpers were left implicit for shape 3.
**How to avoid:** The plan MUST include creating `src/ui/api/wakeups-api.ts` from scratch (5 helpers + 2 wire types). Do NOT put them in `claude-session-api.ts` — that file is already 1400+ lines and its scope is WS/legacy per-identity wire; the new HTTP-REST global-wake-up surface belongs in its own file.
**Warning signs:** Plan task that says "add helpers to claude-session-api.ts" — redirect to new `wakeups-api.ts`.

### Pitfall 4: DELETE with a body (non-standard HTTP)

**What goes wrong:** Shape 2's DELETE `/wakeups/:slug` requires the `host` param in the request body, not query. Some HTTP clients drop body on DELETE by default.
**Why it happens:** REST-purists put path params in the URL; shape 2 chose consistency with POST/PATCH (host always in body). It works with axios but requires explicit `data:` config.
**How to avoid:** Frontend helper MUST use `authApi.delete(url, { data: { host } })` — the `data` config key is how axios attaches a body to DELETE.
**Warning signs:** Delete helper using `authApi.delete(\`/wakeups/${slug}?host=${host}\`)` — will 400 because query param `host` is not what the handler reads.

### Pitfall 5: PATCH name-vs-slug gate

**What goes wrong:** User edits wake-up "Morning triage" → renames to "Evening review" in the Name field → Save. Backend returns 400 `{error: "spec.name normalizes to a different slug than the URL — renames must go through DELETE + CREATE"}`. User sees a scary technical error.
**Why it happens:** Shape 2's PATCH intentionally rejects renames-via-patch (would leave folder `morning-triage/` containing `name: "Evening review"` — LIST vs scheduler drift).
**How to avoid:** In edit-mode, disable the Name input (per recommendation in § Standard Stack § PATCH endpoint above). Helper text: "To rename, delete this wake-up and create a new one." This mirrors D-21's read-only-host rationale.
**Warning signs:** Test that submits an edit-mode form with a renamed Name and expects 200 — will fail.

### Pitfall 6: Round-trip preservation of hand-edited fields (`skills`, `days`, `timezone`)

**What goes wrong:** Agent hand-edits `~/fleet/wakeups/foo/wakeup.json` on disk to add `skills: ["gmail"]` OR `schedule.days: ["mon","tue","wed","thu","fri"]` (weekdays-only gate) OR `schedule.timezone: "Europe/Berlin"`. User opens modal → edits the prompt → hits Save. Because the modal never populated these fields into its form state, `buildSchedule` doesn't emit them, and the PATCH silently drops them from disk.
**Why it happens:** The modal's form state is `FormSchedule` (from WakeupFormShared) plus a few new fields (name, prompt, roles, host); it doesn't carry the raw spec's every field. On UPDATE, whatever the modal sends is what disk receives (full-spec overwrite).
**How to avoid:** THREE options for the planner to pick from:
  - **Option A (simplest, some data loss risk):** Modal writes ONLY the fields it manages. `skills`, `schedule.days`, `schedule.timezone` are dropped on save. Document in a form-hint: "The modal only manages the fields shown. To use advanced options like weekday-only gates or custom timezones, hand-edit the file."
  - **Option B (correctness, +complexity):** When hydrating for edit-mode, stash the raw spec (`rawSpec: WakeupListItem`) in form state. On save, deep-merge form fields OVER the raw spec so untouched fields are preserved. Requires careful merge semantics for nested `schedule.*` keys.
  - **Option C (middle ground):** Preserve top-level `skills` array. Preserve nested `schedule.timezone` (since `buildSchedule` already emits `timezone` for daily/weekly/one_shot). Drop `schedule.days` (v1 feature choice — modal doesn't expose the gate).
  - **Recommendation: Option C for v1.** Preserves the fields most likely to be hand-edited (skills — an explicit "for hand-editors" per phase 128 D-04; timezone — every modal spec gets one). Drops the rarest field (`days`, which per Pattern 4 discussion the v1 form doesn't expose).
**Warning signs:** No task in the plan addresses hand-edited-preservation → default Option A silently. Ask the planner to make this decision explicit.

### Pitfall 7: Sibling modals use `onInteractOutside=preventDefault` — X + Escape are the ONLY close paths

**What goes wrong:** Planner writes a click-outside-to-close behavior, breaking the "patch #111f" discipline every other Skynet modal follows.
**Why it happens:** Radix's default is click-outside closes; every Skynet modal explicitly overrides this.
**How to avoid:** Always add `onInteractOutside={(e) => e.preventDefault()}` on the `DialogPrimitive.Content`. See ConversationSearchModal.tsx:223, NewConversationModal.tsx:289.
**Warning signs:** Missing `onInteractOutside` handler → modal will close mid-edit.

## Code Examples

### Fetching the LIST on modal open (mirror ConversationSearchModal's fetch pattern)

```tsx
// Source: ConversationSearchModal.tsx:107-137 + our shape-2 API
import { useEffect, useState } from "react";
import { listWakeups, type WakeupListItem } from "@/api/wakeups-api";

const [items, setItems] = useState<WakeupListItem[] | null>(null);
const [loadError, setLoadError] = useState<string | null>(null);

useEffect(() => {
  if (!open) {
    setItems(null);         // reset for next open (D-03)
    setLoadError(null);
    return;
  }
  const controller = new AbortController();
  listWakeups()
    .then((rows) => {
      if (!controller.signal.aborted) setItems(rows);
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setItems([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load wake-ups");
    });
  return () => controller.abort();
}, [open]);

// items === null → skeleton
// items !== null && items.length === 0 && no active filter → empty state
// items !== null && filter narrows to zero → filter-zero state
```

### Pessimistic toggle (D-12)

```tsx
async function handleToggle(row: WakeupListItem) {
  // Do NOT flip local state yet. Wait for server ack.
  setToggleError(null);
  try {
    await toggleWakeupEnabled(row.slug, row.hostId, !row.enabled);
    // Success — refetch (D-03: refetch after every write)
    const fresh = await listWakeups();
    setItems(fresh);
  } catch (err) {
    // Failure — toggle stays in original position (we never flipped it)
    setToggleError(err instanceof Error ? err.message : "Toggle failed");
  }
}
```

### Delete with native confirm (D-14)

```tsx
async function handleDelete(row: WakeupListItem) {
  // eslint-disable-next-line no-alert
  const ok = window.confirm(`Delete wake-up "${row.name}"?`);
  if (!ok) return;
  try {
    await deleteWakeup(row.slug, row.hostId);
    const fresh = await listWakeups();
    setItems(fresh);
  } catch (err) {
    setDeleteError(err instanceof Error ? err.message : "Delete failed");
  }
}
```

### Row-click-to-edit with stopPropagation on toggle + kebab (D-11)

```tsx
<div
  className="wakeup-row"
  onClick={() => handleRowEdit(row)}
  role="button"
  tabIndex={0}
>
  <div className="wakeup-name">{row.name}</div>
  <div className="wakeup-meta">
    <span className="kind">{row.scheduleHuman}</span>
    <span className="host-chip">{row.host}</span>
    {/* ... */}
  </div>
  <div className="wakeup-actions">
    <button
      onClick={(e) => {
        e.stopPropagation();      // D-11: don't bubble to row
        void handleToggle(row);
      }}
    >{/* switch */}</button>
    <button
      onClick={(e) => {
        e.stopPropagation();      // D-11: don't bubble to row
        setKebabOpen(row.slug);
      }}
    >{/* kebab */}</button>
  </div>
</div>
```

## Chrome Token Dictionary (verified via ConversationSearchModal.tsx + prototype.html)

| Token | Value | Where verified |
|-------|-------|----------------|
| Modal shell rounded | `rounded-[24px]` | CSM:229 |
| Modal shell size (desktop) | `md:max-w-[640px] md:max-h-[720px]` | CSM uses 560; prototype says 640 — use 640 |
| Modal shell background | `linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))` | CSM:236, prototype:173-174 |
| Modal shell backdrop | `blur(28px) saturate(1.4)` | CSM:237, prototype:175-176 |
| Modal shell border | `1px solid hsla(220, 65%, 55%, 0.32)` | CSM:239, prototype:177 |
| Modal shell shadow | `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)` | CSM:240, prototype:178-180 |
| Modal shell text color | `#e8e4d8` | CSM:242, prototype:181 |
| Overlay z-index | `z-[110]` | CSM:214 |
| Content z-index | `z-[120]` | CSM:228 |
| Header border-bottom | `1px solid rgba(220, 225, 245, 0.10)` | CSM:252 |
| Footer border-top | `1px solid rgba(220, 225, 245, 0.10)` | CSM:351 |
| Body scroll | `flex-1 min-h-0 overflow-y-auto` | CSM:310 |
| Row hover bg | `rgba(255,255,255,0.04)` | prototype:304-305 |
| Row hover border | `rgba(220,225,245,0.08)` | prototype:305 |
| Role chip magenta | `hsla(285, 55%, 55%, 0.14)` bg / `hsla(285, 55%, 60%, 0.30)` border / `hsla(285, 60%, 82%, 1)` text | prototype:369-372 |
| Skill chip blue | `hsla(200, 55%, 55%, 0.12)` bg / `hsla(200, 55%, 60%, 0.28)` border / `hsla(200, 60%, 82%, 1)` text | prototype:374-377 |
| Host chip (D-09 subtle) | Recommend `hsla(220, 25%, 55%, 0.12)` bg / `hsla(220, 25%, 60%, 0.24)` border / `hsla(220, 30%, 78%, 1)` text — desaturated grey-blue, visually quieter than role/skill chips | Derived from prototype; planner picks final tokens |
| Segmented control active | `hsla(220, 65%, 55%, 0.35)` bg / `#f4f1e8` text | prototype:576-578 |
| Primary button (Save) | `hsla(220, 65%, 45%, 0.75)` bg / `hsla(220, 65%, 55%, 0.7)` border / `#f4f1e8` text | prototype:449-452 |
| Focus ring on inputs | `hsla(220, 65%, 55%, 0.55)` border | prototype:506-508 |
| Muted body text | `--color-pv-fg-muted` (=`#a89a80`) | prototype:19 |
| Dim helper text | `--color-pv-fg-dim` (=`#7a6f60`) | prototype:19 |
| Warm off-white text | `--color-pv-fg` (=`#e8e4d8`) | prototype:18 |
| `.pv-pencil` size | `w-9 h-9` per Tailwind conversion of prototype `width: 32px; height: 32px` — actual class defined in `pretty-conversations.css` | prototype:126-128 |
| `.pv-pencil` hover | `background: rgba(220, 225, 245, 0.06); border-color: var(--color-pv-border-quiet); color: var(--color-pv-fg);` | prototype:139-144 |

**Legend:** CSM = `ConversationSearchModal.tsx`. Line numbers are approximate anchors; planner should verify against the file at plan-write time.

## Component Reuse Map

### Extract (build once, reuse)

Nothing new to extract from EXISTING code — `WakeupFormShared.tsx`, `CreateProjectModal.tsx`'s host-picker pattern, and `ConversationSearchModal.tsx`'s Dialog chrome all remain in place. Shape 3 just imports.

### Inline (write for this phase)

- **`WakeupsModal.tsx`** — the main component. Reasonable to keep as single file (~500-700 lines projected) if the code stays flat. Split-decision points:
  - **Split `WakeupsModalForm.tsx`** if the form view exceeds ~300 lines OR if the planner wants to test list-view and form-view separately. Recommendation: **KEEP INLINE for v1**, split later if pain emerges. Sibling ConversationSearchModal is 385 lines with two internal states in one file — the pattern scales.
  - **Split `WakeupsModalRow.tsx`** if planner wants to test row-click / toggle-stopPropagation independently. Recommendation: **SPLIT** — makes the row's `onClick` + `stopPropagation` behavior easier to unit-test in isolation, and the row has 4+ interactive elements (row body, toggle, kebab, chips) worth testing atomically.

### Leave alone (don't touch)

- **`WakeupsTab.tsx`** — per-identity mount inside IdentityModal, still live. Do NOT modify.
- **`IdentityModal.tsx`** — its WakeupsTab mount at :1586 is the only surviving live consumer of WakeupsTab. Leave alone.
- **`RoleModal.tsx`** — read for chip-picker reference, but do NOT extract a "shared chip-picker" — it's inline in RoleModal (or in RoleCosmeticEditBlock), and premature extraction risks breaking phase 128's cleanup. Reference-only.
- **`WakeupFormShared.tsx`** — import from it, don't modify. Any change here affects the per-identity WakeupsTab.
- **`claude-session-api.ts`** — WakeupSpecWire and the per-identity wire types stay untouched.

## Test Pattern Reference

**Framework:** vitest + @testing-library/react + userEvent + @testing-library/jest-dom (verified in package.json).

**Test file location convention:** sibling to component, named `<Component>.test.tsx` or `<Component>.<axis>.test.tsx` for narrow-scope test files.

**Existing modal-test patterns to mirror:**

1. **`ConversationSearchModal.test.tsx`** — the closest analog. Structure:
   - Global mocks BEFORE imports (vi.mock the API helpers).
   - `beforeEach`: reset mocks + reset store state.
   - Tests are numbered T-01..T-13 with a doc block at top describing coverage.
   - Uses `render()`, `screen.getByTestId(...)`, `screen.getByRole(...)`, `userEvent.type`, `userEvent.click`, `waitFor`.
   - Renders modal in-line with a small state wrapper if it needs live open/close.

2. **`PrettyConversationsPanel.new-role-button.test.tsx`** — the panel-button-test pattern. Structure:
   - Extensive vi.mock stubs for stores (i18next, identities-store, conversation-store, trapped-work-store, etc.) — ~150 lines of setup boilerplate.
   - Renders the panel, asserts the button by `data-testid`, fires click, asserts the modal is now visible.
   - Shape 3 needs a similar `PrettyConversationsPanel.wakeups-button.test.tsx` — the setup boilerplate is copy-paste from new-role-button.test with the new-role-specific mocks swapped for wakeup-modal mocks.

3. **`CreateProjectModal.test.tsx`** — read for the host-picker interaction pattern + the 409/400 error interpretation tests.

**Proposed test files for shape 3:**

- `src/ui/api/wakeups-api.test.ts` — 5-6 tests, one per helper + one error-mapping test. Mock `authApi` at module level.
- `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` — behavioral tests:
  - T-01: `open=false` mounts nothing visible.
  - T-02: `open=true` triggers `listWakeups` once + shows skeletons then rows.
  - T-03: Empty response → empty-state helper line.
  - T-04: Filter input filters over name+prompt (case-insensitive).
  - T-05: Role filter dropdown narrows to matching role.
  - T-06: Host filter dropdown narrows to matching host.
  - T-07: Row click → form view, edit mode, fields prefilled, Name disabled.
  - T-08: "+" button → form view, create mode, all fields empty.
  - T-09: Toggle click → PATCH toggle-enabled → refetch. Success flips state; failure surfaces banner + no state flip.
  - T-10: Kebab → Edit → same behavior as row click.
  - T-11: Kebab → Delete → `window.confirm` (mock) → DELETE + refetch.
  - T-12: Save success → refetch + return to list view.
  - T-13: Save 409 → inline banner with server message, form stays open.
  - T-14: Cancel → list view without refetch (or with refetch per Discretion #7).
  - T-15: Modal close → filter state resets on next open.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` — 3-4 tests:
  - Button renders with `data-testid="pv-header-wakeups-button"`.
  - Button position: after Globe, before feedback+kebab.
  - Click opens the WakeupsModal (mock the modal, assert prop change).

**Mock strategy for wakeups-api:**
```typescript
vi.mock("@/api/wakeups-api", () => ({
  listWakeups: vi.fn(),
  createWakeup: vi.fn(),
  updateWakeup: vi.fn(),
  toggleWakeupEnabled: vi.fn(),
  deleteWakeup: vi.fn(),
}));
```

**Playwright smoke:** the existing `tests/e2e/smoke.spec.ts` runs against `PLAYWRIGHT_BASE_URL` with `SKYNET_TEST_CREDS`. Shape 3 does NOT need to add a smoke — the pre-deploy full-suite gate exercises the whole panel. If the planner wants belt-and-suspenders coverage, add a minimal smoke: open modal via header button, assert at least one wake-up row visible (or empty-state if fresh install), close modal.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WS wire ops (`role:list-wakeups`, `identity:list-wakeups`) | HTTP REST (`GET /wakeups`) | Phase 134 (this branch) | Modal uses REST via `authApi`, not the WS multiplex |
| Per-identity + per-role wake-ups | Global per-host wake-ups | Phase 127 (shape 1) | Modal reads the global scope; per-identity WakeupsTab is unrelated |
| `WakeupSpecWire { instruction }` | `GlobalWakeupSpecWire { prompt, roles, skills }` | Phase 127 spec-field rename | New wire type needed — see Pitfall #2 |

**Deprecated/outdated:**
- Per-role wake-up UI (RoleModal's role-wakeups tab) — removed in phase 128 wave 2.
- The `role:*-wakeup` and `identity:*-role-wakeup` WS wire ops — removed in phase 128 wave 2.
- Client-side slug derivation for wake-ups — never should have existed; server derives from `spec.name`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Filter-bar role dropdown should dedupe across all hosts (fleet-wide roles) rather than scope to a selected host | Standard Stack § API Contract (roles enumeration) | Low — if user prefers per-host role filter, easy plan-check pivot |
| A2 | Icon choice `AlarmClock` from lucide-react matches "clock/timer with dashed accent" in prototype | Claude's Discretion #2 | Low — trivial icon swap during execution |
| A3 | Name field should be disabled (not just visually deemphasized) in edit-mode to avoid PATCH name-slug-mismatch 400s | Pattern 5 / Pitfall #5 | Medium — alternative is a "rename" affordance triggering delete+create under the hood, but that's a v2 idea |
| A4 | Weekly form should be single-day segmented (not multi-select via `RestrictToDaysChips`) for v1 | Pattern 4 § Weekly UX / Pitfall #6 | Medium — a power user who hand-edited `schedule.days` and re-opens the spec in the modal will see a Weekly form that doesn't reflect their gate; still round-trips cleanly if we preserve raw fields (Pitfall #6 Option B/C) |
| A5 | Round-trip preservation strategy is Option C (preserve top-level `skills` + nested `schedule.timezone`; drop `schedule.days`) | Pitfall #6 | Medium — Option A silently drops user hand-edits; Option B is safer but +complexity. Planner must decide. |
| A6 | Host chip in metadata line should be visually quieter than role/skill chips (subtle grey-blue) | Chrome Token Dictionary / D-09 | Low — visual token choice, easy adjustment |
| A7 | No dashed-border accent on the header button for production (v1 ships without the tasting-artifact discoverability accent) | § Pattern 2 | Low — user may want it back; trivial CSS toggle |
| A8 | Cancel-form always refetches (Discretion #7) | User Constraints § Discretion | Low — one extra network call per Cancel, negligible |
| A9 | Split `WakeupsModalRow.tsx` into its own file for testability; keep the rest of the modal inline in `WakeupsModal.tsx` | Component Reuse Map | Low — pure structural preference |

**If this table is empty:** it isn't — this table has 9 items, all Medium/Low risk. The planner should either accept these assumptions (recommended for A1, A2, A6, A7, A8, A9), OR pull user into discuss-phase-2 for A3, A4, A5 which are behaviorally consequential.

## Open Questions (RESOLVED)

1. **Round-trip preservation strategy for hand-edited fields** (A5 above).
   - What we know: shape 2 accepts partial specs; hand-editors may set `skills`, `schedule.days`, `schedule.timezone`.
   - What's unclear: how much of that survives a modal edit-and-save.
   - **RESOLVED:** Option C (preserve `skills` + `timezone`, drop `days`). Adopted in `135-02-PLAN.md` Task 1 acceptance criteria. If user disagrees during plan review, easy pivot.

2. **Weekly day-picker: single-select segment vs single-select + optional `RestrictToDaysChips` gate**.
   - What we know: scheduler parser accepts `day: <single string>` for weekly.
   - What's unclear: whether the modal should surface the additional `days: [...]` gate feature that WakeupsTab already exposes.
   - **RESOLVED:** v1 = single-select segmented only (matches CONTEXT D-24 + scheduler parser). Advanced `days: [...]` gate is hand-edit-only. Adopted in `135-02-PLAN.md` Task 1 acceptance criteria.

3. **Name field in edit-mode: fully disabled vs "rename via delete+create" UX**.
   - What we know: PATCH rejects name-vs-slug divergence with 400.
   - What's unclear: does user want a rename affordance, or is delete+create acceptable?
   - **RESOLVED:** v1 = disable Name in edit-mode with helper text "To rename, delete + recreate." Matches CONTEXT D-21's host-lock rationale (visible-edits-without-an-action is the wrong kind of wrong). Adopted in `135-02-PLAN.md` Task 1 acceptance criteria.

## Environment Availability

> Skipped — this phase has no external tool dependencies beyond what shape 1 + shape 2 already require (Docker, npm, node, vitest, playwright — all present, all exercised by 1417 shape-2 tests).

## Security Domain

> Required per `security_enforcement: true` (verified in `.planning/config.json`), ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT via `authApi` — every helper in `wakeups-api.ts` inherits from the axios wrapper that attaches the Authorization header. No new auth surface introduced. |
| V3 Session Management | no | Skynet's session cookie / JWT lifecycle is unaffected; the modal is a consumer of already-authenticated endpoints. |
| V4 Access Control | yes | Per-user host isolation is enforced at the backend (`resolveHostById(hostId, userId)` on every write; user-scoped host projection on the LIST). Frontend MUST NOT show hosts the panel-level `hostTree` doesn't already include — which is guaranteed because the hostTree is filtered per-user upstream in AppShell. **Verification:** the same panel prop threading powers `CreateProjectModal`'s host picker without a per-user leak; shape 3 inherits the same guarantee. |
| V5 Input Validation | yes | Client-side minimal validation (required fields, `HH:MM` format for time inputs via HTML5 `<input type="time">`). Server-side validation via `validateGlobalWakeupSpec` (mirrors `wakeup-scheduler.py`). NO client-side gates beyond what the scheduler accepts (per D-23). |
| V6 Cryptography | no | No new crypto surface. Wake-up specs are plaintext JSON on trusted filesystems. |
| V7 Error Handling | yes | Errors surface via inline banners with SERVER messages verbatim (per D-25). No `stderr` leak on the server side (T-128-08). Client MUST NOT log JWTs or session info to console when handling errors. |
| V13 API/Web Service | yes | HTTP REST; auth is JWT; body sizes are capped at 64kb server-side (matches nginx `client_max_body_size 64k` in the paired blocks). Frontend does NOT need to enforce this cap — server + nginx do. |

### Known Threat Patterns for React + REST Frontend

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via prompt / name field | Tampering | React text-children only; NO `dangerouslySetInnerHTML`. Prompt renders as `<div>{row.prompt}</div>` (2-line clamp via CSS `-webkit-line-clamp`). |
| CSRF on write endpoints | Spoofing | JWT (not cookies) as the auth mechanism — CSRF is structurally impossible (attacker's page can't read/set the Authorization header from a cross-origin request). |
| Reflected user input in error banner | Tampering | Server errors are React text-children (`{errorMessage}`), never `dangerouslySetInnerHTML`. Server errors are already sanitized (T-128-08 — generic 5xx bodies, no upstream detail). |
| Rapid double-click on Save creating duplicate specs | Repudiation / DoS | In-flight ref guard (verified pattern in `NewConversationModal.tsx:193-199, 262`). Save button `disabled` while inflight. Backend also enforces per-slug mutex (server-side race safety). |
| DoS via unbounded body | DoS | Server-side `express.json({limit:"64kb"})` + nginx `client_max_body_size 64k` — verified in shape 2 shipping code. Frontend inherits. |
| Cross-user host access | Escalation | Backend `resolveHostById(hostId, userId)` on every write. Frontend can't fake it — the hostId in the request body must resolve for the user's JWT. |
| Slug injection / path traversal | Tampering | Server-side `IDENTITY_SLUG_RE.test(slug)` gate before any shell interpolation. Frontend uses `encodeURIComponent(slug)` in the URL for defense-in-depth (matches CreateProjectModal). |

**Overall risk:** LOW. This phase adds no new backend surface, no new secrets, no new auth pathway. All threats above are already mitigated in shape 2's shipped code; shape 3 inherits the mitigations by using the endpoints as designed.

## Sources

### Primary (HIGH confidence)

- **`.planning/campaigns/wake-ups-redesign/shape-wake-ups-modal.md`** — design contract (settled 2026-09-23).
- **`.planning/phases/135-wake-ups-redesign-campaign-shape-3-ui-modal-skynet-front-end/135-CONTEXT.md`** — 30 D-XX decisions.
- **`.planning/phases/134-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-/134-CONTEXT.md`** — shape 2's decisions constraining the API surface.
- **`src/backend/database/routes/wakeups-list.ts`** — LIST endpoint (verified 406 lines; response shape, timeouts, security posture all read).
- **`src/backend/database/routes/wakeups-write.ts`** — CREATE/UPDATE/TOGGLE/DELETE (verified 958 lines; validator, name-slug gate, mutex, atomic write, DELETE-with-body, all HTTP status codes documented).
- **`src/backend/database/database.ts:2036-2037`** — route mount confirms bare `/wakeups` prefix.
- **`docker/nginx.conf:465` + `docker/nginx-https.conf:467`** — paired location blocks already shipped.
- **`src/ui/features/pretty-conversations/ConversationSearchModal.tsx`** — chrome pattern verbatim (verified 385 lines).
- **`src/ui/features/pretty-conversations/NewConversationModal.tsx`** — second chrome analog (verified 443 lines).
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2210-2326`** — header cluster and integration site.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2886-3094`** — sibling modal mount pattern.
- **`src/ui/features/pretty-conversations/CreateProjectModal.tsx:1-160`** — host picker + error interpretation pattern.
- **`src/ui/features/pretty-view/WakeupFormShared.tsx`** — 13 reusable exports (verified 246 lines).
- **`src/ui/features/pretty-view/RoleModal.tsx:225-303`** — TabState loading pattern (skeletons, not text).
- **`src/ui/features/pretty-view/RoleFileTab.tsx:67-91`** + **`IdentityFileTab.tsx:74-98`** — canonical skeleton loading pattern.
- **`src/ui/features/pretty-view/WakeupsTab.tsx:130-170`** — reference for field shape (do-not-modify).
- **`src/ui/api/claude-session-api.ts:634-750`** — WakeupSpecWire (do-not-reuse) + retired role-scope removal comments.
- **`src/ui/api/identities-api.ts:299-328`** — `listRolesForHost` helper + `authApi` usage pattern.
- **`src/backend/claude-session/identity-artifact-reader.ts:100-177`** — `humanizeWakeupSchedule` (backend-only; used by shape-2 to pre-humanize).
- **`substrate/scripts/wakeup-scheduler.py:14-40, 180-206`** — spec shape + parser (weekly single-day; days-gate optional).
- **`package.json`** — dependency versions.
- **`.planning/config.json`** — GSD config (nyquist off, security on).
- **`~/fleet/roles/box-maintainer/box-maintainer.md`** — standing directives (test discipline, ship discipline, banned-strings gate, `git pull --rebase` pre-build).
- **`~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`** — 920-line settled tasting prototype (visual reference).

### Secondary (MEDIUM confidence)

- **`src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx:1-80`** — test pattern reference.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx:1-90`** — panel-button test pattern.

### Tertiary (LOW confidence)

- None — every claim in this research traces to a specific source above.

## Project Constraints (from CLAUDE.md and role file)

**Note:** Skynet has no repo-root `CLAUDE.md`. Standing directives come from `~/fleet/roles/box-maintainer/box-maintainer.md` — treated with CLAUDE.md-level authority for this project.

- **Test discipline: scoped during dev, full suite ONLY before deploy** — executor tests use `npx vitest related --run <files>`; orchestrator runs `npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` as the FIRST step before `docker build`.
- **`git pull --rebase` before every push AND every `docker build`** — no exceptions.
- **Frontend `tsc --noEmit` doesn't catch backend TS errors** — pre-push typecheck for any backend-touching patch is `npm run build:backend && npm run build`. Shape 3 is frontend-only, so this is less pressing, but if any wire-type edit spills into `src/backend/`, the pre-push check applies.
- **Executors don't deploy** — plans MUST NOT include `docker build` / `docker compose up` / `git push` tasks assigned to executors. Deploy steps are orchestrator-only.
- **NO UAT check-ins** — after ship, do NOT ask "did it work?" Silence = success.
- **Banned-strings gate** — `~/fleet/roles/box-maintainer/banned-strings.txt` lists personal / deployment-specific strings that must not appear in the repo. Every commit touching docs/planning/tests should be scanned. The current active string is the user's first name (see banned-strings.txt line 1-3 comment) — do NOT hardcode names in code, tests, or docs.
- **Ship path:** commit + green scoped tests → orchestrator runs full suite + playwright smoke → `git pull --rebase` → `docker build` → `git pull --rebase` (yes, again) → `docker compose up --force-recreate skynet` → HTTPS 200 verify → `docker logs --since 60s skynet` sanity check.
- **Container mutations serialize on the user's manual coordination** — do NOT post coord announcements.
- **Deploy boundary = `git push`, not `docker compose up`** — user must give a fresh greenlight for the actual container motion. Per-phase pre-authorizations do NOT include the deploy motion.

## Metadata

**Confidence breakdown:**
- Standard stack + API contract: **HIGH** — read directly from shape 2's shipped source with line numbers.
- Architecture patterns + chrome tokens: **HIGH** — verified against 3 sibling modal source files + the settled prototype.
- Pitfalls + assumptions: **HIGH** — every pitfall has a code citation; every assumption is Medium/Low risk and labeled.
- Round-trip preservation strategy (A5): **MEDIUM** — a real design decision the planner must lock explicitly.
- Weekly form shape (A4): **MEDIUM** — decision surfaces the tension between prototype simplicity and WakeupsTab feature parity.

**Research date:** 2026-09-24
**Valid until:** 2026-10-24 (30 days — stable stack, shape 2 already shipped and won't move)
