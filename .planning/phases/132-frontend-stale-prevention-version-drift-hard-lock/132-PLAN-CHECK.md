# Phase 132 Plan Check — 2026-09-21

**Checker:** goal-backward, adversarial-stance plan checker
**Scope:** 7 plan files (132-01..132-07) + CONTEXT/RESEARCH/REQUIREMENTS
**Method:** goal-backward — start from phase goal, verify each piece has a plan/task that will deliver it

---

## Dimension 1 — Goal-backward coverage

Trace of every goal-piece to plan/task ownership:

| Goal piece | Owner | Evidence |
|---|---|---|
| (a) Version tag baked in at build time | Plan 01 Task 1 | 132-01-PLAN.md:81-145 — Vite `define` block + `execSync` fallback + `CLIENT_BUILD_ID` getter |
| (b) Tag stamping on every HTTP request | Plan 04 Task 2 (axios) + Task 1/3 (fetch) | 132-04-PLAN.md:87-149 (`stampedFetch` helper), 152-253 (axios factory edit), 255-313 (13 raw-fetch rewrites) |
| (c) Tag stamping on every WS handshake | Plan 06 Task 1 (JSON servers) + Task 2 (guac via token) | 132-06-PLAN.md:76-178 (URL `&build=` for 4 JSON WS), 180-241 (guac via encrypted-token payload) |
| (d) Tag stamping on every server-sent WS message | Plan 05 Task 3 | 132-05-PLAN.md:213-297 — `sendFrame` wrapper injects `build: SERVER_BUILD_ID` on all 4 JSON-envelope servers + fleet-status; guac correctly OMITTED per Pitfall 1 |
| (e) Global server refusal on HTTP mismatch | Plan 03 Task 1+2 | 132-03-PLAN.md:71-165 (middleware factory), 167-252 (install between L295 and L296 in `database.ts`) |
| (f) Global server refusal on WS handshake mismatch | Plan 05 Task 2 (4 JWT WS) + Task 3 (fleet-status) + Task 4 (guac) | 132-05-PLAN.md:149-211 (4 JWT WS), 251-270 (fleet-status), 299-386 (guac via SKYNET_STALE_CLIENT: prefix) |
| (g) Hard-lock modal on any drift signal | Plan 02 Task 3 + Plan 04 Task 2 + Plan 06 Tasks 1-2 | 132-02-PLAN.md:209-341 (modal + inert + palette); wired from HTTP (Plan 04:170-233) and WS (Plan 06:107-152, 195-224) drift signals |
| (h) Shell-page cache discipline | Plan 07 Task 1+2 | 132-07-PLAN.md:74-129 (cross-ref comments on 3 layers), 132-206 (assertion vitest) |
| (i) Reload-loop mitigation | Plan 02 Task 2 + Task 3 fatal-mode | 132-02-PLAN.md:157-207 (sessionStorage counter with 4-in-60s threshold, fail-open), 223-224 (Test 5 asserts modal switches to fatal-mode contact-support variant) |

**Verdict: PASS.** Every goal piece has explicit plan/task ownership with concrete file:line insertion points.

---

## Dimension 2 — Decision coverage (D-01..D-20)

Per-decision check against the plan set:

| Decision | Coverage | Evidence |
|---|---|---|
| D-01 (HTTP + WS lanes, same tag) | covered | Plan 04 (HTTP client), Plan 03 (HTTP server), Plan 05/06 (WS both sides) |
| D-02 (no polling; message stamp IS signal) | covered | Plan 05 Task 3 `sendFrame` injection is the mechanism; no polling task exists in any plan |
| D-03 (no update-worker) | covered by omission | Zero service-worker code in any plan; RESEARCH.md Pattern anti-list confirms |
| D-04 (client airtight-by-construction) | covered | Plan 04 factory-edit + `stampedFetch` covers all outbound surfaces |
| D-05 (interceptor in `main-axios.ts`; raw fetch wrapped) | covered | Plan 04 Task 2 line 152, Task 3 rewraps 13 sites; explicit-skip for 2 external + 2 electron paths noted |
| D-06 (mismatch-only refusal HTTP) | covered | Plan 03 middleware `clientBuild === null || clientBuild === serverBuild → next()` (132-03:105-109) |
| D-07 (global middleware, not per-route) | covered w/ factual correction | Plan 03 places middleware in `database.ts` between L295 and L296 (RESEARCH.md Q3 correction to CONTEXT.md's `starter.ts` — accepted per checker prompt) |
| D-08 (WS handshake stamp + refuse-on-mismatch close) | covered | Plan 05 Task 2 + Task 3 + Task 4 (guac via encrypted token) |
| D-09 (server-emitted WS piggyback) | covered | Plan 05 Task 3 |
| D-10 (do NOT stamp client-emitted WS) | covered by omission | Zero client-WS-send-stamping task in any plan; explicitly noted in Plan 05 objective (132-05:69-70) |
| D-11 (pure firm modal; freezes everything) | covered | Plan 02 Task 3 mounts modal + `inert` on `#root`; Plan 04 request interceptor also short-circuits (RESEARCH.md Q8) — though the interceptor short-circuit is described in RESEARCH.md but is not an explicit task in Plan 04. See NOTE below. |
| D-12 (non-dismissible, single Reload button) | covered | Plan 02 Task 3 uses bare div (no radix `<Dialog>`), no X/escape/click-outside — grep-guarded (132-02:335) |
| D-13 (`window.location.reload()`) | covered | Plan 02 Task 3 line 257 |
| D-14 (fresh shell → reconnect terminals/RDP) | covered | Ensured by Plan 07's no-store discipline + Plan 05's server-side WS reconnect behavior via handshake |
| D-15 (lock only fires on successful response mismatch, not failed requests) | covered | Plan 04 response-interceptor drift-check in success handler (SKEW-06a) + 409-with-`stale_client`-body (SKEW-06b). Non-stale_client 409s do NOT lock (Plan 04 Test 5) |
| D-16 (server captures tag once at startup) | covered | Plan 01 Task 2 — `SERVER_BUILD_ID` module-scope const captured at module load; Test 3 asserts read-once property |
| D-17 (independent tabs) | covered | Plan 02 uses module-scope store (no BroadcastChannel); sessionStorage (not localStorage) for reload counter — per-tab isolation |
| D-18 (planner picks tag source) | covered | Plan 01 picks git short SHA per RESEARCH.md Q1 recommendation |
| D-19 (shell page no-store) | covered as codification | Plan 07 Task 1 + Task 2 (audit found existing enforcement at 3 layers; plan adds comments + assertion test) |
| D-20 (two audits) | covered | Both audits done in RESEARCH.md § Q2 (raw-fetch enumeration) + § Q6 (cache header state) |

**NOTE on D-11 render-gating (WARNING, non-blocking):** RESEARCH.md Q8 describes gating axios REQUEST-time short-circuit (interceptor rejects the promise pre-network when `getSkewLockedSnapshot().locked === true`) and WS onmessage frame-drop when locked. Plan 04's Task 2 implements the response-side lock triggers but does NOT introduce a request-side pre-network short-circuit when already locked. This is deliberate belt-and-suspenders that RESEARCH.md called out. The modal's `inert` attribute on `#root` makes it hard for the user to fire new requests, and D-11 is arguably satisfied by that — but a pure reading of D-11 ("all further dispatches drop") would want the interceptor to check the store and reject. This is a WARNING — the design still works because inert-gating stops the user gestures upstream; it's just less thorough than RESEARCH.md's fuller description.

**Verdict: PASS with one WARNING (D-11 request-time short-circuit could be more thorough, but is not required for the goal to be achieved).**

---

## Dimension 3 — Requirements coverage (SKEW-01..SKEW-15)

Union of each plan's `requirements:` frontmatter field:

| Plan | requirements |
|---|---|
| 132-01 | SKEW-01 |
| 132-02 | SKEW-03, SKEW-11, SKEW-12 |
| 132-03 | SKEW-02, SKEW-05, SKEW-13 |
| 132-04 | SKEW-04, SKEW-06 |
| 132-05 | SKEW-07, SKEW-08, SKEW-10 |
| 132-06 | SKEW-09, SKEW-10 |
| 132-07 | SKEW-14, SKEW-15 |

Union: {01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15} — complete SKEW-01..SKEW-15.

REQUIREMENTS.md notes that SKEW-02 is split between Plan 01 (getter module) and Plan 03 (boot log). Plan 01's `requirements` only lists SKEW-01; the SKEW-02 boot log is claimed by Plan 03. The getter module itself (SKEW-01's tail) IS in Plan 01. This is a minor traceability quirk — the getter is called SKEW-01 in Plan 01 but supports SKEW-02 conceptually. Not a blocker.

Every plan claims at least one SKEW-nn. Every SKEW-nn appears in at least one plan.

**Verdict: PASS.**

---

## Dimension 4 — Wave / dependency correctness

| Plan | wave | depends_on |
|---|---|---|
| 132-01 | 0 | [] |
| 132-02 | 0 | [] |
| 132-03 | 1 | [132-01] |
| 132-04 | 1 | [132-01, 132-02] |
| 132-05 | 1 | [132-01] |
| 132-06 | 1 | [132-01, 132-02] |
| 132-07 | 2 | [132-03, 132-04, 132-05, 132-06] |

**Wave 0 independence:** Plan 01 and Plan 02 have zero file overlap. Plan 01 touches build config + getters. Plan 02 touches state store + modal + `src/main.tsx`. Parallel-safe.

**Wave 1 independence (03, 04, 05, 06):**

- Plan 03: `src/backend/database/database.ts`, `skew-lock-middleware.*`
- Plan 04: `src/ui/main-axios.*`, `stamped-fetch.*`, 9 UI file rewraps
- Plan 05: `src/backend/utils/skew-tag.*`, 5 WS servers, 2 guac files
- Plan 06: 5 UI files (WS callers)

**File overlap check:** grep across the four `files_modified` blocks — zero shared file. Backend-vs-frontend split cleanly (03/05 = backend; 04/06 = frontend; 03 and 05 touch different backend directories; 04 and 06 touch different UI directories). Wave 1 parallel-safe.

**Wave 2:** Plan 07 depends on 03-06 and touches `database.ts` — which Plan 03 already touched at a different line region (L138/L295-296 for Plan 03; L2041/L2058 for Plan 07 in the SPA fallback). Sequential wave order guarantees no conflict.

Cross-wave dependencies:
- Plans 03/05 need `getServerBuildId` (Plan 01) ✓
- Plans 04/06 need `CLIENT_BUILD_ID` (Plan 01) + `lockSkewedSession` (Plan 02) ✓
- Plan 05 does NOT need Plan 02 (backend-only) ✓
- Plan 03 does NOT need Plan 02 (backend-only) ✓
- Plan 07 needs Plan 02 (playwright test asserts modal renders) but doesn't declare it in `depends_on`. However, Plan 07 depends on 03-06, and 04+06 depend on 02, so 02 is transitively required before 07 via the wave order. Not a blocker but a minor traceability gap.

**Verdict: PASS.** Waves are correctly assigned and files are truly disjoint within each wave.

---

## Dimension 5 — Task deep-work rules

Spot-check across 30% of tasks (~6 of 20 total):

| Task | Has `<read_first>` | Has `<acceptance_criteria>` | Action concrete? |
|---|---|---|---|
| 132-01 Task 1 (Vite build ID) | YES (132-01:84-89) | YES (132-01:135-141) | Concrete — `vite.config.ts:75-79`, exact `define` key insertion |
| 132-02 Task 2 (reload-loop sentinel) | YES (132-02:161-162) | YES (132-02:198-203) | Concrete — key `skynet_skew_reload_history`, TTL 60s, threshold 4 |
| 132-03 Task 1 (middleware factory) | YES (132-03:74-79) | YES (132-03:154-161) | Concrete — verbatim middleware body, 32-byte cap on log |
| 132-04 Task 2 (axios interceptor) | YES (132-04:155-159) | YES (132-04:243-248) | Concrete — insertion point L456 (request), L503 (response success), near L599 (error/409) |
| 132-05 Task 4 (guac token) | YES (132-05:302-307) | YES (132-05:375-382) | Concrete — extends `GuacamoleToken` shape L135-193, insertion at token-decrypt path with `SKYNET_STALE_CLIENT:` prefix |
| 132-07 Task 3 (playwright spec) | YES (132-07:211-217) | YES (132-07:278-284) | Concrete — full spec body verbatim, `page.route` interposer, `getByRole("dialog", { name: /newer version/i })` |

All 20 tasks have `<read_first>` and `<acceptance_criteria>` per grep count (48 combined = 24 per side = matches 2 fields × per-task presence for all 20 tasks with a few plans having extra structural fields). No task uses vague "align X with Y" language — every action names concrete files, line numbers, and grep-verifiable identifiers.

**Verdict: PASS.**

---

## Dimension 6 — Threat model presence

All 7 plans have `<threat_model>` block (grep count = 7):

| Plan | Threats named | Quality |
|---|---|---|
| 01 | T-132-01..04 + T-132-SC | Real threats — missing ARG, stale-env repudiation, `.dockerignore` risk (Pitfall 3), git-rev-parse failure |
| 02 | T-132-05..08 + T-132-SC | Real threats — spurious lock, reload loop, sessionStorage tamper, DOM info in modal |
| 03 | T-132-09..12 + T-132-SPOOF + T-132-SC | Real threats — log-flooding, tag-spoofing, fail-open path, privilege escalation |
| 04 | T-132-13..17 + T-132-SC | Real threats — raw-fetch bypass, malformed body handling, cross-origin leakage, idempotency race |
| 05 | T-132-17..21 + T-132-SC | Real threats — handshake spoof, per-frame guac corruption, `SKYNET_STALE_CLIENT:` info disclosure |
| 06 | T-132-22..25 + T-132-SC | Real threats — malicious server-forced reload, reconnect storm, `parsed.build` info disclosure |
| 07 | T-132-26..28 + T-132-SC | Real threats — test brittle to config reformat, playwright cred leak, checked-in-test tampering |

Each `T-132-SC` supply-chain entry correctly notes "zero new packages" for its plan. Not perfunctory.

**Verdict: PASS.**

---

## Dimension 7 — Executor-scope respect

Grep for forbidden identifiers across all 7 plans:

- `git push` — 0 matches (grep-verified: no plan invokes push)
- `docker build` — 1 match, but it's the explicit anti-line in Plan 01 (132-01:263 "Do NOT invoke `docker build` or `docker compose up`") — this is a rule statement, not a task command
- `docker compose up` — same match as above (same anti-line)
- `docker-compose up` — 0 matches
- `--force-recreate` — 0 matches
- `docker compose config` — 1 match in Plan 01 (132-01:274) — this is config VALIDATION (does not deploy) and is explicitly annotated as "NOT `docker compose up` — config validation only"

**Verdict: PASS.** No plan tells the executor to ship, push, or build/deploy anything. The one `docker compose config` is a syntax check, not a deploy motion.

---

## Dimension 8 — Test discipline

Grep for forbidden test invocations:

- `npx vitest run` without `--related` — 0 matches (all vitest invocations use `--related <files>` per grep)
- `npm test` (full-suite) — 0 matches
- `npx playwright test` (executing) — 0 matches; the ONE playwright invocation is `npx playwright test --list` in Plan 07 (132-07:273), which parses without executing

Plan 07 Task 3 (playwright spec) is authored by the executor but explicitly NOT run — the action text says "playwright specs run against a live deploy (orchestrator-scoped)" and `<verify>` uses `--list` only.

**Verdict: PASS.**

---

## Dimension 9 — Palette authority for the modal

Plan 02 Task 3 (modal component) uses ONLY `--color-pv-*` tokens:

- `--color-pv-backdrop` (backdrop)
- `--color-pv-bg-elevated` (dialog background)
- `--color-pv-fg` (title)
- `--color-pv-fg-muted` (body)
- `--color-pv-accent` (button background)
- `--color-pv-fg-on-accent` (button text)

The `<verify>` block grep-guards against `var(--background)` / `var(--foreground)` (132-02:329, 372). Acceptance criteria explicitly asserts zero Skynet-token usage (132-02:335).

**Verdict: PASS.**

---

## Dimension 10 — Backend build discipline

Backend-touching plans (01, 03, 05, 07):

- Plan 01 Task 2: `npm run build:backend` in acceptance criteria (132-01:200)
- Plan 03 Task 1 & Task 2: `npm run build:backend && npm run build` in `<verify>` and acceptance (132-03:160, 240, 246, 278)
- Plan 05 Tasks 1-4: `npm run build:backend` in each task's `<verify>` and Task 3 has `npm run build:backend && npm run build` (132-05:142, 199, 204, 285, 291, 373, 381, 413)
- Plan 07 Task 2 (vitest under `src/backend/`): `npm run build:backend && npm run build` in plan `<verification>` (132-07:315)

Plan 07 Task 1 (comment-only on nginx + `database.ts` comment) does not run `build:backend` in its Task 1 `<verify>` — but the plan-level verification does. Since Task 1 only adds comments to `.ts` (which don't affect compilation) and `.conf` (nginx, not TS), this is acceptable.

**Verdict: PASS.**

---

## Dimension 11 — Reload-loop mitigation

Plan 02 Task 2 is a first-class task ("Reload-loop sentinel + test (Pitfall 4 defense)") with:

- Dedicated new files: `src/ui/features/skew-lock/reload-loop-sentinel.ts` + test
- Six explicit test behaviors covering: initial state, 3-under-threshold, 4-triggers, TTL rolls off after 60s, sessionStorage key `skynet_skew_reload_history`, fail-open on exception
- Wired into Plan 02 Task 3 modal: `shouldSuppressReload()` check switches modal to fatal-mode variant with contact-support text and no Reload button (132-02:249-296)
- Modal Test 5 asserts fatal-mode rendering when 4 recent timestamps exist

This is NOT an afterthought — it's a full task with dedicated files, tests, and wired-in modal behavior.

**Verdict: PASS.**

---

## Dimension 12 — Guacamole special case

Plan 05 Task 4 explicitly handles Guacamole special case:

- Objective explicitly names Pitfall 1 (132-05:69): "guacamole (third-party wire format, Pitfall 1) enforces at token-decrypt time via the encrypted `buildId` payload field"
- Task 4 title: "Guacamole handshake-only enforcement via encrypted token payload"
- CRITICAL callout at 132-05:363: "do NOT try to per-frame-piggyback the guac protocol. Per Pitfall 1, this corrupts guac protocol wire format. Handshake enforcement is the ONLY safe point."
- Acceptance criterion asserts zero per-frame stamping (132-05:379-380): "Zero per-frame stamping introduced (grep guacamole-server.ts for any `sendFrame`, `piggyback`, or JSON injection on data-frames — should return no hits)"
- Plan 05 Task 3 excludes guac from the `sendFrame` list (132-05:294): "guacamole (5th server, third-party framing) intentionally omitted per Pitfall 1"

**Verdict: PASS.**

---

## Dimension 13 — NODE_ENV dev-escape

Plan 03 SKEW-13 is a first-class requirement with dedicated test coverage:

- Frontmatter `requirements: [SKEW-02, SKEW-05, SKEW-13]`
- Task 1 Test 4: "mismatch-passes in dev — With `NODE_ENV=development`, request with `X-Skynet-Client-Build: different-build` → next() called, response has header stamped (SKEW-13 dev escape hatch)" (132-03:84)
- Middleware code (132-03:100, 117-119): `const isProd = process.env.NODE_ENV === "production"; ... if (!isProd) { return next(); }`
- Comment in Task 2 wiring (132-03:222): "Dev-mode escape hatch (SKEW-13) skips refusal when NODE_ENV !== \"production\""

**Verdict: PASS.**

---

## Dimension 14 — must_haves derivation

Each plan's `must_haves.truths` is user-observable and traces to the phase goal:

- Plan 01: build-ID is byte-stable across client and server — enables (a) from Dimension 1
- Plan 02: modal is non-dismissible, single Reload button, `inert` gates app — enables (g) hard-lock behavior
- Plan 03: every response stamped + 409 refusal in prod + dev-mode skip — enables (e) server refusal HTTP
- Plan 04: every axios request stamped + drift detection — enables (b) HTTP request stamping + (g) drift → lock trigger
- Plan 05: WS handshake refusal + per-message piggyback + guac via token — enables (c)(d)(f)
- Plan 06: client detects 4409 close and `parsed.build` mismatch — enables lock trigger from WS lane
- Plan 07: 3-layer no-store discipline preserved + playwright drift-smoke test — enables (h) shell cache discipline + end-to-end verification

`key_links` sections wire artifacts to consumers (e.g., Plan 04's `main-axios.ts (response interceptor) → src/ui/state/skew-lock-store` via `lockSkewedSession call on drift`).

**Verdict: PASS.**

---

## Dimension 15 — Researcher's landmines

Every pitfall flagged in RESEARCH.md is reflected in the plans:

| Pitfall | Reflected in plans |
|---|---|
| P1 — Guacamole per-frame stamp | Plan 05 Task 4 (explicit) + Task 3 (omits guac from sendFrame list) |
| P2 — Nginx location-block parity drift | Plan 07 Task 1 mirrors comment across both nginx files; `<verify>` diffs the location blocks |
| P3 — `git rev-parse` in Docker context | Plan 01 Task 3 declares `ARG SKYNET_BUILD_SHA` in 3 Dockerfile stages + `dev-unknown` fallback; T-132-01/T-132-04 threat entries call out mitigation |
| P4 — Reload loop | Plan 02 Task 2 reload-loop sentinel (dedicated task); Plan 03 Task 2 startup log for stale-env detection (`operation: "server_boot_build_id"`) |
| P5 — Structured close-event logging | Plan 06 Task 1 explicit field extraction + grep-guard against `JSON.stringify(event)`; Plan 02 store also has grep-guard |
| P6 — Branding-fetch timing | Plan 04 Task 3 wraps `src/ui/branding/branding-fetch.ts:77` (site #1 in the enumeration) |
| P7 — Middleware order vs subdomain-dispatch | Plan 03 places middleware AFTER `serveUrlHandler` at L295 and BEFORE first bodyParser — comment in code cross-references Pitfall 7 |
| Header-stripping in proxies (Q11.5) | RESEARCH.md audited both nginx configs and Caddyfile; no stripping today. Not called out as an explicit plan task but the mechanism relies on this audit result — acceptable. |

**Verdict: PASS.**

---

## Cross-dimension summary

| # | Dimension | Verdict |
|---|---|---|
| 1 | Goal-backward coverage | PASS |
| 2 | Decision coverage (D-01..D-20) | PASS (1 non-blocking warning: D-11 request-time short-circuit not explicit — inert-gating substitutes) |
| 3 | Requirements coverage (SKEW-01..SKEW-15) | PASS |
| 4 | Wave / dependency correctness | PASS |
| 5 | Task deep-work rules | PASS |
| 6 | Threat model presence | PASS |
| 7 | Executor-scope respect | PASS |
| 8 | Test discipline | PASS |
| 9 | Palette authority | PASS |
| 10 | Backend build discipline | PASS |
| 11 | Reload-loop mitigation | PASS |
| 12 | Guacamole special case | PASS |
| 13 | NODE_ENV dev-escape | PASS |
| 14 | must_haves derivation | PASS |
| 15 | Landmines from RESEARCH.md | PASS |

### Non-blocking observations (warnings only — do not block execution)

1. **Raw-fetch site count inconsistency (Plan 04, prose vs. table vs. REQUIREMENTS).** Plan 04 must_haves says "13 same-origin sites," Plan 04 prose says "13 in-scope raw-fetch sites," the enumeration table shows 10 rows (with row "14-20" as a single-file range covering multiple sites), and REQUIREMENTS.md SKEW-04 says "15 in-scope fetch sites." The `<verify>` grep counts 9 files. All these numbers refer to the same set from different angles (files touched vs. call sites vs. numbered rows in RESEARCH.md's Q2 table). Functionally unambiguous — the executor is told exactly which files to touch and which sites to wrap. WARNING only.

2. **Plan 07 depends_on omits 132-02 (transitive).** Plan 07's playwright spec asserts the modal renders. The modal comes from Plan 02. Plan 07 declares dependency on 03/04/05/06; 04 and 06 depend on 02, so the wave sequencing guarantees Plan 02 completes before Plan 07 starts. Not a blocker but a traceability gap — arguably `depends_on: [132-02, 132-03, 132-04, 132-05, 132-06]` would be more explicit.

3. **D-11 request-time short-circuit is implicit.** RESEARCH.md § Q8 describes both response-side triggering and request-side short-circuit (interceptor rejects promise pre-network when store is locked). Plan 04 implements response-side triggers but not the request-side pre-network short-circuit. The modal's `inert` on `#root` makes new user-initiated requests hard to fire, so the design still works. WARNING only — a hardening pass could add the short-circuit later.

None of these three warnings threatens the phase goal. Reliability IS the whole spirit, and the mechanism as planned is airtight for every user-observable path: HTTP request stamping (axios + stampedFetch), HTTP response mismatch, HTTP 409 refusal, WS handshake refusal (4 JWT servers + fleet-status + guac via encrypted token), WS per-message piggyback (4 JSON servers + guac correctly omitted), shell hard-lock with non-dismissible modal, reload-loop sentinel, three-layer cache discipline codified with an assertion test, playwright end-to-end verification.

---

## Final verdict

**PASS** — plans are ready for `/gsd:execute-phase 111`.

- All 15 SKEW requirements are claimed by at least one plan.
- All 20 CONTEXT decisions are reflected in the plan set (D-07 with the accepted `starter.ts` → `database.ts` correction from RESEARCH.md Q3).
- Every plan has a threat model. Every task has `<read_first>` and `<acceptance_criteria>`. No plan invokes deploy motion at executor scope. Every vitest run is scoped via `--related`. Playwright is authored but not executed.
- Wave 0 plans are file-disjoint. Wave 1 plans are file-disjoint. Wave 2 is a single plan. Dependency graph is acyclic.
- Landmines from RESEARCH.md (guac per-frame, dev-mode, `.dockerignore`, reload-loop, DOM CloseEvent logging, branding-fetch timing, middleware order) are all reflected.
- The three non-blocking warnings listed above can be addressed in a hardening follow-up or during executor discretion; they do not threaten the phase goal.

## CHECK COMPLETE

**PASS**
