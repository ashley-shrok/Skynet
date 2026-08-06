---
phase: 260806-gig
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/sessions.ts
  - src/backend/database/routes/identities.ts
  - src/backend/database/routes/sessions.test.ts
  - src/ui/api/sessions-api.ts
  - src/ui/state/conversation-store.ts
autonomous: true
requirements:
  - HOTFIX-P25-01
must_haves:
  truths:
    - "GET /sessions/list returns a non-null `role` for every session-owning identity whose identity file has role: frontmatter on its home host (poppy, patricia, pixie, nicole, vicky, tina, etc)."
    - "One hung/failed per-identity frontmatter read on host X does NOT drop the other rows from host X (per-identity timeout guard mirrors PER_HOST_TIMEOUT_MS)."
    - "Hosts that error or time out at the connectOneShot / tmux list-sessions boundary are still silently dropped as a whole (pre-existing behavior preserved)."
    - "Session names that are not real identities (no identity file, or file lacks role: frontmatter) come back with role: null and fall through to label-alpha within their host tier — NOT a 500."
    - "identities.ts:82 no longer calls resolveRoleForIdentity(null, ...); the /identities response's role field is populated from an authoritative source (or is null) but is NEVER the LOCAL-only lookup that returned null for every non-tina identity."
    - "Frontend FleetSession type carries role: string | null, and rowFromTab + fleetSyntheticRows in conversation-store attach role from the session row (authoritative) rather than only from state.identitiesByKey."
    - "In production against tina admin, conversation list rows within a host tier cluster by role (compareByHostRoleLabel actually orders by role, not just label-alpha)."
  artifacts:
    - path: "src/backend/database/routes/sessions.ts"
      provides: "Per-host session enumeration with role resolution on same SSH conn"
      contains: "resolveRoleForIdentity(conn"
    - path: "src/backend/database/routes/sessions.test.ts"
      provides: "Un-mocked test exercising real fake ssh conn + real fake frontmatter files → role attached to row"
      contains: "resolveRoleForIdentity"
    - path: "src/ui/api/sessions-api.ts"
      provides: "RemoteTmuxSession.role field"
      contains: "role: string | null"
    - path: "src/ui/state/conversation-store.ts"
      provides: "FleetSession.role field + rowFromTab/fleetSyntheticRows read from session row"
      contains: "session.role"
  key_links:
    - from: "src/backend/database/routes/sessions.ts"
      to: "src/backend/claude-session/identity-artifact-reader.ts::resolveRoleForIdentity (REMOTE branch)"
      via: "already-open SSH conn from connectOneShot"
      pattern: "resolveRoleForIdentity\\(conn"
    - from: "src/ui/state/conversation-store.ts::fleetSyntheticRows"
      to: "FleetSession.role"
      via: "session.role attached at row construction"
      pattern: "session\\.role"
---

<objective>
Phase 25 (shipped 2026-08-05) added a (host, role, label) sort tuple so conversation rows cluster
by role within their host tier. In production the clustering silently does nothing: role
resolution goes through identities.ts:82 → `resolveRoleForIdentity(null, ...)` (LOCAL branch),
which reads role frontmatter from skynet-ec2's own filesystem. Only tina's identity file lives
on skynet-ec2 — poppy, patricia, pixie, nicole, vicky and every other fleet identity's file lives
on its home box. So every non-tina identity comes back with role=null and the (host, role, label)
comparator collapses to plain label-alpha. Confirmed 2026-08-06 hitting /identities as tina admin.

Fix (LOCKED by Ashley — not up for re-debate): fold role resolution into the per-host session
enumeration path at src/backend/database/routes/sessions.ts:38-129 (GET /sessions/list). That
handler already opens `connectOneShot` per SSH+autoTmux host and runs `tmux list-sessions`.
hostId + open SSH conn are already in scope. Read role frontmatter for each session-owning
identity on the SAME conn using the REMOTE branch of resolveRoleForIdentity, wrap each
per-identity call in its own timeout guard (mirror PER_HOST_TIMEOUT_MS), attach the resolved
role to each TmuxSessionRow. On per-identity error/timeout, role stays null — falls through to
label-alpha within host (correct — not clusterable). Retire the broken identities.ts:82
call site. Frontend types + sort comparator plumbing follows.

Purpose: Restore the Phase 25 role clustering that shipped visibly broken.
Output: A working /sessions/list that returns role per session, retired identities.ts:82 call
site, matched frontend types, and a real un-mocked test that would have caught the whole class
of bug the Phase 25 mocked tests missed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/backend/database/routes/sessions.ts
@src/backend/database/routes/identities.ts
@src/backend/claude-session/identity-artifact-reader.ts
@src/ui/api/sessions-api.ts
@src/ui/state/conversation-store.ts

**Key interface excerpts (do NOT re-derive — take these as authoritative):**

- `resolveRoleForIdentity(conn: SSHClientType | null, identityKey: string): Promise<string>`
  is defined at src/backend/claude-session/identity-artifact-reader.ts:227. When `conn` is a real
  SSHClientType it runs the REMOTE branch (execCommand on the passed conn, reads
  `$HOME/.claude/identities/<key>/<key>.md`, extracts YAML frontmatter `role:`).
  **It THROWS (never returns null)** when the identity file is missing, has no frontmatter,
  has no `role:` key, or the role fails the IDENTITY_KEY_RE gate. That throw is FINE for the
  sessions.ts use case — the executor's per-identity try/catch below converts the throw to
  `role: null` for that one row, which correctly falls through to label-alpha within host.

- `execCommand` is already imported at sessions.ts:12 from `../../ssh/tmux-helper.js` — the
  same helper resolveRoleForIdentity uses internally.

- `PER_HOST_TIMEOUT_MS = 3000` is defined at sessions.ts:18. Reuse the same constant for the
  per-identity Promise.race timeout inside the loop (a stuck cat should not exceed the same
  budget the whole tmux list-sessions call already respects).

- Frontend `FleetSession` shape at src/ui/state/conversation-store.ts:96 (four fields:
  hostId, hostName, sessionName, created). Adding `role: string | null` is additive —
  `computeSnapshot`'s existing `state.identitiesByKey.get(matchKey)?.role ?? null` fallback
  paths at lines 285 and 411 stay in place as a defense-in-depth secondary source (they were
  the ONLY source pre-fix; now they're the belt to the sessions.ts suspenders). But BOTH
  read paths should prefer the tab-side / session-side role when present.

- `readFleetSessionsCache` at conversation-store.ts:839 does `isFleetSession` shape validation
  and only copies the 4 canonical fields. Adding `role` requires updating BOTH the type guard
  AND the canonical copy in `writeFleetSessionsCache` (line 874) so the cached snapshot
  round-trips role too — else a refresh drops role for one paint cycle.

- `Phase 25 sort comparator (compareByHostRoleLabel)` at conversation-store.ts:355 already
  reads `a.role ?? null` — it needs NO change once role is populated authoritatively on rows.

**Non-goals (LOCKED):**
- Do NOT redesign resolveRoleForIdentity's LOCAL branch — identity-clone and other consumers
  still need `resolveRoleForIdentity(null, tinaKey)` for tina's own identity reads.
- Do NOT touch the sort comparator — it already ships correct.
- Do NOT touch other fields on the /identities endpoint.
- Do NOT alter the `IDENTITIES_LOCAL_HOST_IDS` env var or its parsing.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fold role resolution into per-host session enumeration + write real un-mocked test</name>
  <files>
    src/backend/database/routes/sessions.ts,
    src/backend/database/routes/sessions.test.ts
  </files>
  <behavior>
    - Test 1 (happy path): given a fake SSH conn where `tmux list-sessions` returns
      "poppy|1000\npatricia|2000", and `cat "$HOME/.claude/identities/poppy/poppy.md"` returns
      a body with `---\nrole: box-maintainer\n---\n` frontmatter, and same shape for patricia
      with role: chef, GET /sessions/list returns two rows with `role: "box-maintainer"` and
      `role: "chef"` respectively. The fake conn's execCommand is called for BOTH
      list-sessions AND per-identity cat commands on the SAME conn instance (no second
      connectOneShot per identity).
    - Test 2 (missing frontmatter): given a session named "ephemeral-work" whose identity file
      is missing OR has no `role:` frontmatter, that row comes back with `role: null` and the
      OTHER rows on the same host still return with their real roles (one bad frontmatter must
      not poison the whole per-host enum).
    - Test 3 (per-identity timeout): given a fake conn where the per-identity cat hangs past
      PER_HOST_TIMEOUT_MS for one identity but succeeds for another, the hung row comes back
      with `role: null`, the good row comes back with its role, and the whole /sessions/list
      response still returns within a bounded time (does NOT wait indefinitely).
    - Test 4 (host-level failure preserved): given a host whose connectOneShot itself
      throws, that host is still silently dropped entirely — no rows for it in the response
      (pre-existing behavior preserved by the outer try/catch at sessions.ts:108).
  </behavior>
  <action>
    Extend `TmuxSessionRow` (sessions.ts:20) with `role: string | null`.

    Inside the per-host `Promise.all` mapper at sessions.ts:63-117, AFTER the `output.split`
    → `rows` map on lines 88-100 completes and BEFORE the `return` at line 100, run one
    additional pass over the rows on the SAME already-open `conn`:

    - For each row, call `resolveRoleForIdentity(conn, row.sessionName)` from
      `../../claude-session/identity-artifact-reader.js`.
    - Wrap EACH per-identity call in its own `Promise.race` with a
      `setTimeout(..., PER_HOST_TIMEOUT_MS)` reject — mirroring the exact pattern used at
      sessions.ts:75-86 for the list-sessions call.
    - Wrap the whole per-identity resolve+timeout in try/catch. On ANY throw (timeout,
      missing frontmatter, SSH exec error, IDENTITY_KEY_RE gate failure), set that row's
      `role = null`. Do NOT bubble the error up — one bad row must not kill the host.
    - Log per-identity failures at debug level (mirror the sshLogger.debug pattern at
      sessions.ts:109-114) with `operation: "sessions_list_role_resolve_skip"`,
      `hostId`, `hostName`, `sessionName`, and `error`. Keep the log noise proportional
      to the pre-existing host-skip log density (single line, no stack).
    - Run per-identity role resolution in parallel across sessions on the same host via
      `Promise.all(rows.map(...))` — the SSH conn's execCommand is safe to fan out concurrently
      (same pattern as parallel bounty open+archive at identity-artifact-reader.ts:806).
      Do this BEFORE the `finally { conn.end() }` at sessions.ts:101-107 so the conn is still
      open for the frontmatter reads.

    Preserve the pre-existing "hosts that error or time out are silently dropped" behavior at
    the outer host-level try/catch (sessions.ts:108-116) — unchanged.

    Create `src/backend/database/routes/sessions.test.ts` (this file does not exist today per
    the pre-flight grep — full new test file, not additive). Use vitest. Mount an in-process
    Express app with the sessions router. Mock `resolveHostById` and `connectOneShot` to return
    a fake SSHClientType stub whose `execCommand` is driven by the tests themselves, NOT via
    `vi.mock("resolveRoleForIdentity")`. The whole point of this test is to exercise the REAL
    resolveRoleForIdentity → real execCommand path, so the fake must respond to two command
    shapes:
      1. `tmux list-sessions ...` → fake session enumeration
      2. `cat "$HOME/.claude/identities/&lt;key&gt;/&lt;key&gt;.md" ...` → fake identity file body
         (real YAML frontmatter, real js-yaml round-trip via extractRoleFromMarkdown).
    Also mock the auth middleware so authenticateJWT passes through with a canned userId, and
    mock SimpleDBOps.select + drizzle chain to return two candidate hosts with autoTmux: true.
    Assert on the JSON response shape: each returned row has `role` populated per the fake
    identity file's frontmatter, or null when it should be null.

    Add a top-of-file comment on the test file naming this bug's provenance:
    "Regression test for the 2026-08-06 hotfix — Phase 25's mocked resolveRoleForIdentity
    tests silently passed with the LOCAL-null-return behavior and missed the whole class of
    bug. This test uses a real un-mocked resolveRoleForIdentity + fake SSH conn to exercise
    the full 'list sessions → read frontmatter on same conn → attach role to row' path."
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/backend/database/routes/sessions.test.ts --reporter=default</automated>
  </verify>
  <done>
    - `TmuxSessionRow` extended with `role: string | null`.
    - Per-host loop resolves role on the same open conn for each session name, wrapped in
      per-identity Promise.race(PER_HOST_TIMEOUT_MS) + try/catch → role=null on failure.
    - `sessions.test.ts` exists with 4 tests covering happy path, missing frontmatter,
      per-identity timeout, host-level failure preserved. Tests pass with the real
      resolveRoleForIdentity (not mocked out).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Retire identities.ts:82 call site + plumb role through frontend</name>
  <files>
    src/backend/database/routes/identities.ts,
    src/ui/api/sessions-api.ts,
    src/ui/state/conversation-store.ts
  </files>
  <action>
    **Backend — src/backend/database/routes/identities.ts:**

    Remove the `resolveRoleForIdentity(null, row.identityKey)` call at line 82 and the
    surrounding `Promise.all(rows.map(async (row) => { ... }))` enrichment block at lines 78-92.
    Replace with the simple synchronous mapping the pre-Phase-22 code used:
    `const enriched = rows.map((row) => publicIdentity(row, null));`

    Per the pre-flight grep, TWO frontend sites consume `Identity.role`:
    src/ui/state/conversation-store.ts:285 and :411 — both use it as a secondary/defense-in-depth
    source for row-level role. With Task 1's sessions.ts fix, the AUTHORITATIVE source becomes
    FleetSession.role (per-host, per-session, resolved on the identity's home box). The
    identitiesByKey lookup was ALREADY broken for every non-tina identity (returning null
    because the /identities response's role was null), so continuing to return null from
    /identities preserves the exact same behavior the fallback path is already tolerating.

    Keep the `role: string | null` field on `publicIdentity`'s response shape (line 66) —
    do NOT remove the field from the wire shape. The frontend `Identity` interface at
    src/ui/api/identities-api.ts:10 declares `role: string | null` and removing the field
    would require synchronized frontend + backend deploys. Setting it to null preserves the
    wire contract while dropping the broken LOCAL-only lookup.

    Remove the now-unused `resolveRoleForIdentity` import at identities.ts:12.

    **Frontend — src/ui/api/sessions-api.ts:**

    Add `role: string | null` to the `RemoteTmuxSession` interface (currently 4 fields at
    lines 3-8). Field is a plain nullable string; no other logic change in this file.

    **Frontend — src/ui/state/conversation-store.ts:**

    1. Add `role: string | null` to the `FleetSession` type at line 96 (mirror
       RemoteTmuxSession's new field byte-for-byte). Keep the "shape mirrors
       RemoteTmuxSession verbatim" comment accurate.

    2. Update `isFleetSession` type guard at line 819 to also require
       `(r.role === null || typeof r.role === "string")` — mirrors the shape validation for
       the other 4 fields. Update the canonical copy at line 852 to include `role: item.role`.

    3. Update `writeFleetSessionsCache` at line 874 to include `role: s.role` in the canonical
       map at line 877 so the cache round-trips role too.

    4. Update `fleetSyntheticRows` construction at line 405-425: change the role source from
       `state.identitiesByKey.get(matchKey)?.role ?? null` to `session.role`. The
       identitiesByKey lookup was the pre-fix source that was returning null for every
       non-tina row — session.role is now authoritative from the backend.

    5. Update `rowFromTab` at line 283-294: LEAVE the identitiesByKey lookup as-is here.
       `rowFromTab` operates on `Tab` objects (openTabs — from the app's own click state,
       not fleet enum), so it does NOT have a FleetSession available. openTab rows already
       correctly resolve role via identitiesByKey when the tab's targetTmuxSession matches
       a known identity in the store — that path was NEVER broken (identitiesByKey is loaded
       from /identities which… will now always return role: null per the identities.ts
       change above).

       **Correction: with identities.ts returning role: null for all rows, `rowFromTab`'s
       role lookup will always return null too.** That's a regression for openTab rows that
       used to at least attempt a role lookup. To fix: in `rowFromTab`, ALSO check for a
       matching FleetSession by (hostId, sessionName) tuple and prefer its `role` field.
       The lookup is O(N) over `state.fleetSessions` but N is small (~20-30 sessions in
       Ashley's fleet); acceptable and mirrors the `openTabsSessionKeys` dedup pattern already
       in computeSnapshot at line 384-391. Concretely: build a `sessionRoleByKey` Map<string,
       string | null> once at the top of `computeSnapshot` keyed on
       `dedupKey(hostIdStr, sessionName)` before the Tier-1/2/3 loops run, then inside
       `rowFromTab` pass the tab's host+targetTmuxSession-derived key and look up the role.
       Refactor: change `rowFromTab(tab)` to `rowFromTab(tab, sessionRoleByKey)` and thread
       the Map through each call site inside computeSnapshot (all 3 sites: activeSetRows,
       pinned, byHostId).

       Fallback ordering inside rowFromTab: `sessionRoleByKey.get(key) ?? identitiesByKey.get(matchKey)?.role ?? null`.
       Authoritative-first (fleet), defense-in-depth-second (identity-store), null-final.

    6. Confirm compareByHostRoleLabel (line 355) needs NO change — it already reads
       `a.role ?? null` correctly.

    **DO NOT touch:**
    - The LOCAL branch of resolveRoleForIdentity in identity-artifact-reader.ts.
    - IDENTITIES_LOCAL_HOST_IDS env var parsing.
    - Any other consumer of resolveRoleForIdentity (identity-clone, readIdentityBounties,
      readIdentityHistory, readRoleFile — all keep their existing two-step semantics).
    - The Phase 25 sort comparator (compareByHostRoleLabel).
    - Any other field on the /identities response.

    **After edits:** run `npm run build:backend && npm run build` (both required —
    frontend-only `npx tsc --noEmit` will NOT catch backend errors on this project per
    CLAUDE.md constraints). Fix any type errors surfaced. Do NOT mask exit codes with
    `| tail` on the build commands.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npm run build:backend &amp;&amp; npm run build &amp;&amp; npx vitest run --reporter=default 2>&amp;1 | tail -60</automated>
  </verify>
  <done>
    - identities.ts:82 call site removed; `resolveRoleForIdentity` import dropped;
      `publicIdentity` still emits `role: null` on the wire (contract preserved).
    - `RemoteTmuxSession.role: string | null` added to sessions-api.ts.
    - `FleetSession.role: string | null` added to conversation-store.ts; `isFleetSession`
      guard updated; `writeFleetSessionsCache` canonical copy updated.
    - `fleetSyntheticRows` role source switched from identitiesByKey to session.role.
    - `rowFromTab` gets a `sessionRoleByKey` Map plumbed through computeSnapshot so
      openTab rows prefer fleet-authoritative role before falling back to identitiesByKey.
    - `npm run build:backend && npm run build` both exit clean (no `| tail` masking).
    - Full `npx vitest run` is green — no test left failing.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    - Backend `GET /sessions/list` now attaches `role` to every session row by reading
      role frontmatter on the SAME open SSH conn as the tmux list-sessions call.
    - `identities.ts:82` LOCAL-only role lookup retired; /identities still returns
      `role: null` on the wire (contract preserved).
    - Frontend `FleetSession.role` field added; conversation store row-construction
      prefers session.role over the pre-fix identitiesByKey source.
    - New un-mocked test `sessions.test.ts` exercises the real resolveRoleForIdentity
      + fake SSH conn path (catches the Phase 25 mocked-tests-passed class of bug).
  </what-built>
  <how-to-verify>
    Ashley: after committing (do NOT push/build/deploy — per your standing rule, "ship it"
    first before any post-commit deploy work), review the diff.

    Sanity-check items before you say "ship it":
    1. `git diff feat/tab-title-from-tmux -- src/backend/database/routes/sessions.ts`
       — confirm the per-identity resolveRoleForIdentity call happens on the SAME `conn`
       from `connectOneShot` (line ~70) and BEFORE the `finally { conn.end() }` block.
    2. `git diff feat/tab-title-from-tmux -- src/backend/database/routes/identities.ts`
       — confirm the resolveRoleForIdentity import is gone AND the async
       Promise.all/enrichment block is gone; `enriched` is now a plain sync `rows.map`.
    3. `git diff feat/tab-title-from-tmux -- src/ui/state/conversation-store.ts`
       — confirm `FleetSession.role` added, `sessionRoleByKey` Map threaded through
       `rowFromTab`, `fleetSyntheticRows` reads `session.role`.
    4. Confirm the new `sessions.test.ts` file exists and its 4 tests pass locally.
    5. Confirm `npm run build:backend && npm run build` was run and both exited clean
       (backend build is required because backend files changed).
    6. Confirm the full `npx vitest run` was run and is green — no leftover failing tests.

    Type "ship it" when the diff looks correct and both builds + full test suite are green.
    Then you'll deploy (deadman timer + Caddy nginx routes are unaffected by this change —
    no new backend routes, only response-shape additions to existing routes).

    Post-deploy verification (do this AFTER shipping):
    - Hit `https://term.gigaashley.click/sessions/list` as tina admin and confirm every
      session-owning identity comes back with a non-null `role` (poppy, patricia, pixie,
      nicole, vicky should all have their real role names now, not null).
    - Open the conversation panel and confirm rows within a host tier cluster by role
      (identities sharing a role appear adjacent).
  </how-to-verify>
  <resume-signal>Type "ship it" or describe issues</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tina admin browser → skynet backend (/sessions/list) | Existing auth boundary — unchanged |
| skynet backend → managed host via SSH | Existing SSH boundary — unchanged; role frontmatter reads use same conn as tmux list-sessions |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260806-01 | Denial of Service | per-host session enumeration loop | mitigate | Each per-identity `resolveRoleForIdentity` call is wrapped in Promise.race(PER_HOST_TIMEOUT_MS=3000ms) — one hung cat cannot block the whole host, and outer host-level timeout at line 108 catches whole-host hangs. |
| T-260806-02 | Denial of Service | one bad identity poisons per-host response | mitigate | Per-identity try/catch converts any throw (timeout, missing frontmatter, IDENTITY_KEY_RE gate failure) to `role: null` for that single row. Other rows on the same host return normally. |
| T-260806-03 | Tampering | shell interpolation of session name into cat command | accept | resolveRoleForIdentity's REMOTE branch validates identityKey via IDENTITY_KEY_RE before shell interpolation (already the case pre-fix — see identity-artifact-reader.ts:227-244 and the direct-interpolation-safe posture noted at patch #95 in the same file). tmux session names that violate IDENTITY_KEY_RE will throw in resolveRoleForIdentity → caught → role: null → no shell injection surface. |
| T-260806-04 | Information Disclosure | role names leaked in /sessions/list response | accept | Role names are non-sensitive (chef, box-maintainer, etc.) and already appear in every /identities response today for tina. The wire shape addition here does not expand the audience — same authenticated tina admin scope. |
</threat_model>

<verification>
- New test file `src/backend/database/routes/sessions.test.ts` exists and passes with the REAL
  (un-mocked) resolveRoleForIdentity + a fake SSH conn stub, covering: happy path, missing
  frontmatter, per-identity timeout, host-level failure preserved.
- Full `npx vitest run` is green — no tests left failing anywhere in the tree.
- `npm run build:backend && npm run build` both exit clean without `| tail` masking.
- Manual grep: `grep -n "resolveRoleForIdentity" src/backend/database/routes/identities.ts`
  returns NO matches (call site + import fully retired).
- Manual grep: `grep -n "resolveRoleForIdentity" src/backend/database/routes/sessions.ts`
  returns matches (call site added to per-host loop).
</verification>

<success_criteria>
- `curl -sH "Authorization: Bearer $TINA_JWT" http://localhost/sessions/list | jq '.[].role'`
  after deploy returns a mix of real role names (chef, box-maintainer, etc.) — NOT all null.
- The conversation panel in the browser shows rows clustered by role within each host tier
  (identities sharing a role appear adjacent), not just label-alpha within host.
- No regression on hosts that timeout / error — they're still silently dropped at the host
  level (pre-existing behavior preserved).
- Full test suite green: `npx vitest run` exits 0.
- Both backend and frontend builds green.
</success_criteria>

<output>
Create `.planning/quick/260806-gig-phase-25-role-clustering-hotfix-fold-rol/260806-gig-SUMMARY.md`
when done.
</output>
