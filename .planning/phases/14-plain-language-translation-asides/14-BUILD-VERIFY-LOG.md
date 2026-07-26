# Phase 14 Build Verification Log

**Captured:** 2026-07-26
**Executor:** Tina (sequential — main working tree, branch `feat/tab-title-from-tmux`)
**Tip commit at verify time:** `21358b5` (docs(14-05): complete plain-language-translation-asides Wave 5)
**Purpose:** Pre-deploy build verification per plan 14-06 Task 1 — captured output of tsc + vitest + Vite production build. If ANY of the three fails, Task 3's human-verify checkpoint STOPS the deploy.

---

## npx tsc --noEmit

**Command:** `npx tsc --noEmit` (from `/home/ubuntu/skynet`)
**Exit code:** `0`
**Output:** empty stdout, empty stderr — zero type errors across the whole codebase.

**Interpretation:** TypeScript is clean. Every symbol imported and consumed across the Phase 14 aside subsystem (WS wire types on the frontend, module-scope Map + primitives on the backend, AsideBubble + PrettyView wiring + ComposeBox morph on the frontend, integration test seams) type-checks against the rest of the codebase without emitting any error. Wave 5's `export const asideState` addition to `claude-session-server.ts` and the Task 1 test-observation seam did not introduce new type-shape mismatches.

---

## npx vitest run

**Command:** `npx vitest run` (from `/home/ubuntu/skynet`)
**Exit code:** `0`
**Summary:**

```
Test Files  49 passed (49)
     Tests  596 passed (596)
  Start at  19:16:54
  Duration  72.42s (transform 3.49s, setup 1.26s, import 18.15s, tests 9.35s, environment 32.71s)
```

**Interpretation:** 596/596 tests pass across the full suite. Zero failures, zero skips, zero flakes.

**Baseline delta note:** Pre-Phase-14 baseline was noted in 14-02-SUMMARY.md as "556/558 pass" (2 pre-existing ComposeBox.test.tsx failures). Those 2 failures were absorbed and fixed in Wave 4 (per commit `49bc643` — stale aria-label regex refresh from `/send 'yes'/i` → `/send 'let's go'/i`, deferred-items.md natural-touchpoint absorption). Wave 5 added 10 new integration tests (5 backend + 5 frontend) + 1 Task 1 RED-gate test that immediately GREENed on export addition. Full-suite delta from pre-Phase-14 baseline is a net gain of ~40 tests (+~2 test files: `claude-session-server.aside.test.ts` + `claude-session-server.aside.integration.test.ts` + `AsideBubble.test.tsx` + `ComposeBox.aside-props.test.tsx` + `ComposeBox.aside-morph.test.tsx` + `PrettyView.aside.test.tsx` + `claude-session-api.aside.test.ts`), zero regressions, all previously-deferred pre-existing failures resolved.

**Aside-subsystem coverage summary** (per prior wave SUMMARY.md files):

- **Wave 1 primitives** (5 unit tests + 4 shellQuote parity + 4 constant assertions) — 13 tests in `claude-session-server.aside.test.ts`
- **Wave 2 backend WS subsystem** (7 additional tests for module-scope Map identities + atomic BOTH-STEPS broadcast) — 7 tests appended to `claude-session-server.aside.test.ts`; 6 wire-type tests in `claude-session-api.aside.test.ts`
- **Wave 3 frontend rendering** (5 AsideBubble unit + 2 ComposeBoxProps interface + 5 PrettyView integration wiring) — 3 new test files
- **Wave 4 ComposeBox morph body** (15 aux disable + Send morph tests) — 1 new test file
- **Wave 5 integration** (5 frontend + 5 backend end-to-end pipeline tests + 1 Task 1 RED-gate for named export) — 2 test files touched, 1 new file created

**Total Phase 14 automated coverage:** ~50 aside-specific tests across 7 test files, all passing.

---

## npm run build

**Command:** `npm run build` (from `/home/ubuntu/skynet`)
**Exit code:** `0`
**Build tooling:** Vite v8.0.14 building for production; prebuild runs `scripts/write-electron-build-info.cjs`; postbuild runs `tsc -p tsconfig.node.json` + copies `src/backend/package.json` into `dist/backend/`.
**Build time:** `✓ built in 4.38s`
**Modules transformed:** 2395

**Key bundle sizes (post-Phase-14 tip):**

| Chunk | Size (raw) | Gzip |
|---|---:|---:|
| `dist/assets/index-C0XZuJ05.js` | 173.31 kB | 52.20 kB |
| `dist/assets/AppShell-D0oaydku.js` | 67.84 kB | 18.15 kB |
| `dist/assets/Terminal-CvCaRcn3.js` | 186.10 kB | 48.19 kB |
| `dist/assets/react-vendor-CCoUBvV1.js` | 181.79 kB | 57.19 kB |
| `dist/assets/index-fNY4EZmh.css` | 199.29 kB | 32.18 kB |

**Bundle-size delta note:** Phase 14 is additive on `PrettyView.tsx` (+152 lines Wave 3), `ComposeBox.tsx` (+~80 lines across Wave 3 interface + Wave 4 body), new `AsideBubble.tsx` (~130 lines), plus backend `claude-session-server.ts` (+~370 lines Wave 2 + 1 export word Wave 5). These land in whichever chunks Vite groups them into (frontend pretty-view code lands in a bundle Vite bundles alongside the pretty-view subsystem; new AsideBubble is a small addition). No new dependencies were added, so no new vendor chunks appeared. The build ran clean in 4.38s (comparable to prior Phase 13 baseline of 8.87s — no build-time regression).

**No warnings, no errors** in the Vite output above what has been captured; the full stdout ended with `✓ built in 4.38s` and exit code 0. No dynamic-import resolution warnings, no circular-dependency warnings, no chunk-size-limit warnings from Vite's Phase 14 additions.

---

## Nginx caveat check

**Contract (per CLAUDE.md § Nginx caveat):** Every new backend HTTP route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`.

**Phase 14 backend surface addition:** Zero new HTTP routes. Verified via:

```
git diff f4ae668..HEAD -- src/backend/claude-session/claude-session-server.ts \
  | grep -E "^\+.*app\.(get|post|put|delete|use)"
```

**Result:** empty (zero matches). Phase 14 added WS message dispatch handlers (`aside_arm`, `aside_dismissed`) and a WS event emit path (`aside_ready`, `aside_dismissed` server→client) on the EXISTING `WebSocketServer({ port: 30011 })` (per CONTEXT.md non-negotiable "no new port"). It also added the connect-time pane-probe and the extraction poller, both of which are internal timer/async logic driven from the existing WS connection handler — not HTTP routes.

**Conclusion:** N/A — Phase 14 adds no HTTP routes, only new WS event types on the existing port 30011 bridge (per CONTEXT.md non-negotiable no-new-port constraint). The `docker/nginx.conf` + `docker/nginx-https.conf` symmetry requirement does not apply. The existing `location` blocks for the port-30011 WS bridge (established Phase 1 Wave 5) already route these frames, since they're multiplexed on the same WSS connection as all other pretty-view WS traffic.

---

## Deploy safety

**Current deploy discipline** (authoritative source: `~/.claude/identities/tina/deploy-runbook.md`, post-2026-07-21):

- The 15-min deadman auto-revert regime was **RETIRED 2026-07-21** — Ashley's tmux-attach-via-SSH-over-SSM fallback replaced the deadman's catastrophic-loss-recovery role. Full retired-concept documentation lives at `bounties/archive/deadman-deploy-safety/` if the mechanism ever needs to be revisited.
- **Stale reference callout:** the fork's `CLAUDE.md` (this repo root) still contains a stale line under `Deploy safety` mentioning the "15-min deadman rollback timer (`/opt/skynet/.tmp-revert.sh`)". Also, the plan file (14-06-PLAN.md) references the same retired regime in its `<what-built>` block. **Both are documented stale references, not current process.** Ignore both; the authoritative source is `~/.claude/identities/tina/deploy-runbook.md`.
- **Current fallback:** when Ashley needs to reach Tina and Skynet is down, she has a durable fallback via `aws ssm start-session --target <ec2-id>` then `sudo -u ubuntu tmux attach -t tina`. This channel is why the deadman auto-revert regime was retired — the "she can't reach me because Skynet is dead" catastrophic-loss scenario has a working recovery path now.

**Deploy safety rules that DID survive the deadman retirement:**

1. **`git push` before build.** Deploy runbook Step 1: the build script clones from GitHub, so local-only commits cache-hit the frontend-builder layer. Trap that bit patches #43 and #69.
2. **Explicit go-ahead for THIS deploy window.** Ashley's greenlight for the code work does NOT carry over to authorize the deploy. Every build → deploy transition is a new "may I?" moment. Even when Ashley pre-authorized a multi-step task including a deploy, still stop AT the deploy boundary and ask.
3. **Check-before-recreate compose-image grep.** Before EVERY `docker compose up -d --force-recreate skynet`, run:
   ```
   grep 'image:' /opt/skynet/docker-compose.yml | grep -q skynet-patched:local || \
     sudo sed -i 's|image: ghcr.io/lukegus/skynet:latest|image: skynet-patched:local|' /opt/skynet/docker-compose.yml
   ```
   Idempotent — no-op when compose is already patched, corrects when it's been reverted. Catches manual sed mistakes + any lingering pre-retirement `sleep 900` background processes.
4. **Pre-warn Ashley about first-hard-refresh HTTP2_PROTOCOL_ERROR** (per tina.md § learned preferences 2026-07-23). After `docker compose up -d --force-recreate skynet`, the FIRST hard-refresh may white-screen with `net::ERR_HTTP2_PROTOCOL_ERROR` on chunk loads. Fix = close and reopen the tab (spawns a fresh H2 connection). NOT a deploy failure. Do NOT jump to rollback on the first PROTOCOL_ERROR report.
5. **Blast radius awareness.** A bad deploy loses Ashley access to her whole fleet (Skynet is the gateway to every managed box). Asymmetric risk drives all safety practices. Ashley SSM+tmux fallback exists but preventing a bad ship is still the primary safety strategy.

**Deploy bundle for this checkpoint:** Phase 14 patches + queued #150 A + C (per CONTEXT.md § Phase Boundary Ashley-verbatim: "there's no point in deploying until we get it in"). See `14-PATCHES-MD-ENTRY.md` for the full bundle-shape description. Deploy sequence documented in `14-UAT-CHECKLIST.md § Post-UAT deploy runbook`.

---

## Summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✓ exit 0, zero errors |
| `npx vitest run` | ✓ 596/596 pass (49 test files) |
| `npm run build` | ✓ exit 0, built in 4.38s, 2395 modules transformed, no warnings |
| Nginx caveat | ✓ N/A — no new HTTP routes; WS-only additions on port 30011 |
| Deploy safety | ✓ Discipline documented per current runbook (deadman retired 2026-07-21; check-before-recreate + `git push` first + Ashley pre-warn survive) |

**Verdict:** Pre-deploy build verification is CLEAN. Task 3's human-verify checkpoint is not blocked by any build-side failure. The deploy bundle (Phase 14 + #150 A + C) is ready for Ashley's greenlight decision.

---

*Phase: 14-plain-language-translation-asides*
*Log captured: 2026-07-26 by Tina*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)*
