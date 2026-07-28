# Phase 17 Build Verification Log

**Captured:** 2026-07-28
**Executor:** Tina (sequential — main working tree, branch `feat/tab-title-from-tmux`)
**Tip commit at verify time:** `53379ef` (feat(17-03): wire relay bubble dispatch into PrettyView render loop)
**Phase 17 commits landed:**
- `7251d6d` feat(17-01): extend session-file-parser with relay detection + unit tests
- `4a74ebd` feat(17-01): emit relay WS frames + add client-side wire types
- `7e31e69` feat(17-02): /relay-pointer Express router + bounded SSH adapter + unit tests + mount
- `1649446` feat(17-02): add nginx location ~ ^/relay-pointer blocks to both nginx configs
- `e3c8dd0` feat(17-03): relay bubble components + mxid resolver + file-pointer detect helpers
- `53379ef` feat(17-03): wire relay bubble dispatch into PrettyView render loop

**Note on 17-03 commit hash:** 17-03-SUMMARY.md records commit `cffda07` for Task 2
(PrettyView dispatch wiring). After the worktree merge-back, that commit was cherry-picked
to `53379ef` on `feat/tab-title-from-tmux`. Code content is byte-identical; only the commit
hash differs. This log records the canonical tip hash `53379ef` per `git rev-parse HEAD`.

**Purpose:** Pre-deploy build verification per plan 17-04 Task 1. If ANY check below
fails, the Task 2 human-verify checkpoint is BLOCKED and the deploy does not proceed.

---

## 1. npx tsc --noEmit

**Command:** `npx tsc --noEmit` (from `/home/ubuntu/skynet`)
**Exit code:** `0`
**Output:** empty stdout, empty stderr — zero type errors across the whole codebase.

**Interpretation:** TypeScript is clean. Every new symbol introduced across Phase 17
(RelayOutboundEvent, RelayInboundEvent, RelayOutboundBubble, RelayInboundBubble,
relay-mxid-resolve.ts, relay-pointer-detect.ts, /relay-pointer Express route with
WHITELIST_REGEX and readRelayPointerFile) type-checks without errors. PrettyView's
StreamEvent discriminated union correctly handles the two new relay_* discriminators.

---

## 2. npx vitest run

**Command:** `npx vitest run` (from `/home/ubuntu/skynet`)
**Exit code:** `0`
**Summary:**

```
Test Files  66 passed (66)
     Tests  758 passed | 6 skipped (764)
  Start at  18:50:46
  Duration  94.70s (transform 4.52s, setup 1.44s, import 22.97s, tests 13.41s, environment 41.25s)
```

**Interpretation:** 758/758 tests pass across the full suite (6 pre-existing skips,
zero failures). Zero regressions to any pre-Phase-17 surface. The 3 HTMLCanvasElement
console warnings are pre-existing jsdom infrastructure notes, not test failures.

**Phase 17 test coverage summary:**
- Plan 17-01 added 9 relay detection tests (28 total in session-file-parser suite, up from 19)
- Plan 17-02 added 11 unit tests for /relay-pointer route (11 passed, all paths covered)
- Plan 17-03 added 14 new tests (relay-mxid-resolve: 6, RelayOutboundBubble: 3, RelayInboundBubble: 5)
- Total new Phase 17 tests: ~34 across 66 test files

**Phase 17 specific tests confirmed passing:**
- `session-file-parser.test.ts` — relay detection 3-way conjunction (OUTBOUND) + INBOUND_REGEX strip
- `relay-pointer.test.ts` — WHITELIST_REGEX accept/reject, dot-dot path rejection, unauthorized host, file-not-found, happy-path 200, size cap, missing hostId, non-integer hostId, sentinel-trim tolerance
- `relay-mxid-resolve.test.ts` — 4 resolver tests + 2 regex edge cases
- `RelayOutboundBubble.test.tsx` — 3 render tests (header line, body, extraction-failure ⚠ path)
- `RelayInboundBubble.test.tsx` — 5 tests (header, sender-hue data-avatar-color attribute, file-pointer fetch, fetch-failure indicator, inline body)

---

## 3. npm run build

**Command:** `npm run build` (from `/home/ubuntu/skynet`)
**Exit code:** `0`
**Build tooling:** Vite v8.0.14 building for production; prebuild runs `scripts/write-electron-build-info.cjs`; postbuild runs `tsc -p tsconfig.node.json` + copies `src/backend/package.json`.
**Build time:** `✓ built in 3.73s`
**Modules transformed:** 2407

**Key bundle sizes (post-Phase-17 tip):**

| Chunk | Size (raw) | Gzip |
|---|---:|---:|
| `dist/assets/Terminal-D2IKuRvs.js` | 206.21 kB | 53.11 kB |
| `dist/assets/index-BQtncdFl.js` | 173.34 kB | 52.21 kB |
| `dist/assets/react-vendor-CCoUBvV1.js` | 181.79 kB | 57.19 kB |
| `dist/assets/AppShell-D-4JHzSc.js` | 72.32 kB | 19.47 kB |
| `dist/assets/index-BIt3YJ8Y.css` | 205.66 kB | 33.30 kB |

**No warnings, no errors.** Full stdout ended with `✓ built in 3.73s` and exit code 0.

---

## 4. Relay Component Bundle Confirmation

**Command:** `grep -l 'relay_outbound\|relay_inbound\|via curl\|via recv' dist/assets/*.js`
**Result:**
```
dist/assets/Terminal-D2IKuRvs.js
```

RelayOutboundBubble + RelayInboundBubble code is present in `Terminal-D2IKuRvs.js`
(Vite groups the pretty-view + session subsystem into the Terminal chunk).
Both relay bubble components are bundled and will be served to the browser.

---

## 5. Emitted CSS Color Verification (Tailwind v4 Lightning CSS normalization)

**Context:** Tailwind v4 uses Lightning CSS internally, which normalizes all `rgba()`
color values to their 8-digit hex equivalent during compilation. This is documented
in 17-03-SUMMARY.md as an expected deviation from the plan's literal-string grep gate.
The source `.tsx` files use `bg-[rgba(64,_96,_160,_0.28)]` and
`bg-[rgba(200,_128,_64,_0.28)]` (Tailwind arbitrary-value syntax with underscore-space
escaping). Emitted CSS contains the hex equivalents, which are byte-exact:
- `#4060a047` = `rgba(64, 96, 160, 0.28)` (RR=40=64, GG=60=96, BB=a0=160, AA=47≈0.278)
- `#c8804047` = `rgba(200, 128, 64, 0.28)` (RR=c8=200, GG=80=128, BB=40=64, AA=47≈0.278)

**Source-level grep (passes — confirms correct value in source):**
```
grep -Eq 'rgba\(64,[[:space:]_]*96,[[:space:]_]*160,[[:space:]_]*0\.28\)' \
  src/ui/features/pretty-view/RelayOutboundBubble.tsx
→ OUTBOUND-RGBA-OK

grep -Eq 'rgba\(200,[[:space:]_]*128,[[:space:]_]*64,[[:space:]_]*0\.28\)' \
  src/ui/features/pretty-view/RelayInboundBubble.tsx
→ INBOUND-RGBA-OK
```

**Emitted CSS hex-equivalent check (passes — confirms correct colors reach the browser):**
```
grep -Fq '#4060a047' dist/assets/*.css && grep -Fq '#c8804047' dist/assets/*.css
→ BUILD-CSS-HEX-EQUIV-OK
```

**BUILD-CSS-SPACED-OK:** The prototype byte-shape acceptance intent (correct colors in
the browser) IS satisfied. Per 17-03-SUMMARY.md documented deviation: the literal
`rgba(64, 96, 160, 0.28)` string does not appear in the emitted CSS (Tailwind v4
normalizes it to `#4060a047`), but the color value IS present and pixel-identical.
The gate is semantically satisfied; the hex-equivalent grep above is the binding proof.

---

## 6. Regex Verbatim Confirmation (from 17-01 acceptance battery)

All four byte-verbatim regex checks pass:

```
REGEX-CURL-VERBATIM-OK   — /\bcurl\b/ in OUTBOUND_CURL_RE
REGEX-PUT-VERBATIM-OK    — /-X\s+PUT\b/ in OUTBOUND_PUT_RE
REGEX-URL-VERBATIM-OK    — /rooms\/[^\/\s'"]+\/send\/m\.room\.message\/[^\/\s'"`]+/ in OUTBOUND_URL_RE
REGEX-INBOUND-VERBATIM-OK — INBOUND_REGEX present verbatim in session-file-parser.ts
```

Exact strings in `src/backend/claude-session/session-file-parser.ts`:
```typescript
const OUTBOUND_CURL_RE = /\bcurl\b/;
const OUTBOUND_PUT_RE = /-X\s+PUT\b/;
const OUTBOUND_URL_RE = /rooms\/[^\/\s'"]+\/send\/m\.room\.message\/[^\/\s'"`]+/;
const INBOUND_REGEX = /\[room\s+(\S+)\]\s*\[(\@\S+)\]\s*\(event\s+(\S+)\):\s*([\s\S]*?)(?:<\/event>|$)/;
```

---

## 7. Nginx Block Drift Gate

**Technique:** awk block-matcher with non-empty-extraction preflight (same as 17-02 Task 2).
Uses REGEX `~` form matching `/relay-pointer` — NOT the stale exact-match `=` form.

**Commands run:**
```bash
awk '/^[[:space:]]*location ~ \^\/relay-pointer/{flag=1} flag{print; if(/^[[:space:]]*}/){flag=0}}' \
  docker/nginx.conf > /tmp/17-04-relay-http.txt

awk '/^[[:space:]]*location ~ \^\/relay-pointer/{flag=1} flag{print; if(/^[[:space:]]*}/){flag=0}}' \
  docker/nginx-https.conf > /tmp/17-04-relay-https.txt

[ -s /tmp/17-04-relay-http.txt ] || { echo "FATAL: /relay-pointer block missing from nginx.conf"; exit 1; }
[ -s /tmp/17-04-relay-https.txt ] || { echo "FATAL: /relay-pointer block missing from nginx-https.conf"; exit 1; }

diff /tmp/17-04-relay-http.txt /tmp/17-04-relay-https.txt || { echo "FATAL: nginx block drift"; exit 1; }
echo "NGINX-DRIFT-GATE-OK"
```

**Result:** `NGINX-DRIFT-GATE-OK`

**Extracted block (identical in both nginx.conf and nginx-https.conf — non-empty, zero diff):**
```nginx
        location ~ ^/relay-pointer(/.*)?$ {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 30s;
        }
```

**Non-empty preflight:** Both `/tmp/17-04-relay-http.txt` and `/tmp/17-04-relay-https.txt`
are non-empty (both `-s` checks passed). The silent-pass-on-empty-extraction failure mode
is impossible — an empty file would have triggered `FATAL` before the diff ran.

**Nginx exact-match regression gate (per 17-02 pattern lock):**
Confirmed: neither `docker/nginx.conf` nor `docker/nginx-https.conf` contains the
exact-match `=` form for the relay-pointer location block. Both configs use only the
regex `~` form (`location ~ ^/relay-pointer(/.*)?$`), matching plan 17-02's nginx block
decision. Exact-match `=` form count in both files: `0` (per `grep -c` run at verify time).

---

## 8. Source + Docker File Integrity (RELAYBUB-06 defensive posture)

**Command:** `git status --short src/ docker/ | wc -l`
**Result:** `0`

This plan touches ZERO source files and ZERO docker files. Plans 17-01/17-02/17-03
are fully committed and the working tree is clean.

---

## 9. Post-Deploy Smoke Commands

**Context (from 17-02-SUMMARY.md):** The end-to-end curl smoke was deferred from 17-02
because the live instance (term.gigaashley.click) had the OLD nginx configs deployed at
Wave 1 time. Pre-deploy, `curl .../relay-pointer` correctly returns HTTP 200 with
index.html (SPA fallback — nginx routes everything to React before the new blocks land).
After `docker compose up -d --force-recreate skynet`, the new nginx blocks go live and
these smokes MUST be run.

**Ashley (or Tina post-deploy): run these BEFORE starting the UAT walkthrough.**

### Primary smoke (path-rejection + auth-rejection):
```bash
curl -sS -o /tmp/relay-smoke-body.txt -w '%{http_code}\n' \
  'https://term.gigaashley.click/relay-pointer?hostId=1&path=/etc/passwd'
head -c 40 /tmp/relay-smoke-body.txt
```

**Expected outcomes:**
- HTTP code MUST be in `{400, 401}`:
  - `401` = `authenticateJWT` middleware short-circuits the unauthenticated request (most likely — JWT middleware runs before the route handler)
  - `400` = WHITELIST_REGEX rejects `/etc/passwd` (if auth ordering ever shifts)
  - Either code proves the request reached the Express backend router and was rejected
- HTTP code MUST NOT be `200`:
  - `200` = BLOCKING FAILURE — the nginx SPA fallback caught the request, meaning the new `location ~ ^/relay-pointer` block is NOT live. Deploy is HOT. Roll back immediately.
- `head -c 40` MUST NOT print `<!DOCTYPE html>` or `<!doctype html>`:
  - HTML body confirms SPA fallback (even if curl reported a non-200 code due to response weirdness). Both checks together are required.

### Unauthenticated variant (no cookie):
```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'https://term.gigaashley.click/relay-pointer'
```

**Expected:** MUST print `{400, 401}`, NOT `200`.
(No cookie = no JWT = authenticateJWT returns 401 immediately; or if path-only is checked first, 400.)

### Failure protocol:
If either smoke returns `200` with HTML:
1. DO NOT proceed to UAT walkthrough
2. This is the CLAUDE.md silent-index.html failure mode (route not wired in nginx)
3. Roll back: `docker compose up -d --force-recreate skynet` (restores prior image)
4. Route the fix to plan 17-02 (nginx block missing or misrouted on the deployed instance)
5. Check that `/opt/skynet/skynet-patches/build-skynet.sh` pulled the latest `feat/tab-title-from-tmux` tip (git push before build, per deploy-runbook.md)

---

## Summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, zero type errors |
| `npx vitest run` | 758/758 pass, 66 test files, zero failures |
| `npm run build` | exit 0, built in 3.73s, 2407 modules transformed |
| Relay bundle confirmation | `Terminal-D2IKuRvs.js` contains relay component code |
| Emitted CSS colors | `#4060a047` + `#c8804047` present in CSS (hex-equiv of prototype rgba values) |
| REGEX-CURL-VERBATIM-OK | confirmed |
| REGEX-PUT-VERBATIM-OK | confirmed |
| REGEX-URL-VERBATIM-OK | confirmed |
| REGEX-INBOUND-VERBATIM-OK | confirmed |
| NGINX-DRIFT-GATE-OK | zero diff, both blocks non-empty |
| Nginx exact-match = form | 0 occurrences in both configs (correct) |
| Source + docker file changes | 0 (RELAYBUB-06 gate) |
| Post-deploy curl smoke | documented above — run AFTER `docker compose up` |

**READY FOR ASHLEY GREENLIGHT**

Phase 17 code side is clean. All six RELAYBUB requirements are code-complete on
`feat/tab-title-from-tmux` at tip `53379ef`. Awaiting Ashley's deploy + UAT walkthrough
per `17-UAT-CHECKLIST.md`.

---

*Phase: 17-pretty-view-relay-bubbles-skynet-integration*
*Log captured: 2026-07-28 by Tina*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md`*
