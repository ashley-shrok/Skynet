# Patch #169 — Pretty-View Relay Bubbles — Skynet Integration (Phase 17)

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`
**Paste timing:** Only after Ashley greenlights the Phase 17 deploy AND UAT passes on all
RELAYBUB-01..06 items in `17-UAT-CHECKLIST.md`. Deploy behind current fleet DEPLOY
DISCIPLINE per `~/.claude/identities/tina/deploy-runbook.md`. Claude does NOT deploy.

**Ordinal position on paste:** Verify current count first with
`grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3`.
Current tip is ONE HUNDRED SIXTY-EIGHT. Bump to ONE HUNDRED SIXTY-NINE on paste.
Recommended commit message: `docs(patches): pin patch #169 — Phase 17 pretty-view relay bubbles`.

**No Co-Authored-By trailer** — fork convention.

---

## Draft (paste-ready)

   169. `feat(pretty-view,backend): patch #169 — pretty-view relay bubbles
        (Phase 17 — Matrix relay send/receive rendered as distinct glass
        bubbles in PrettyView alongside normal conversation turns; backend
        relay detection + SSRF-safe /relay-pointer file-fetch endpoint;
        purely additive on fork-local pretty-view + backend
        session-tail infrastructure; no upstream Skynet surfaces touched)`
        (committed 2026-07-28 to `feat/tab-title-from-tmux`)

        * **Motivating gap** (Ashley 2026-07-28 design session, prototype
          validated 6/6 in acceptance battery):
          Ashley's fleet identity sessions frequently interleave with Matrix
          relay activity — outbound `curl -X PUT` room sends (direct
          messages to fleet-ops contacts via the Matrix bridge) and inbound
          `recv.sh` events (replies arriving via the bridge). In the
          old pretty-view, both appeared as raw Bash tool-use turns and
          task-notification banners: indistinguishable from normal agent
          work, buried in the conversation stream. Ashley wanted them
          surfaced immediately as distinct visual events so she can follow
          relay round-trips without scrolling back and parsing raw command
          text.
          Design source-of-truth: `~/.claude/identities/tina/bounties/
          pretty-view-relay-bubble-prototype/prototype.html` (6/6
          acceptance battery passed with Ashley 2026-07-28 — outbound blue,
          inbound orange, sender-hue chain, extraction-failure graceful
          fallback, file-pointer fetch, no-regression on normal turns).

        * **Fix summary — backend relay detection + WS emission (Plan
          17-01, commits `7251d6d` + `4a74ebd`).**
          Extended `src/backend/claude-session/session-file-parser.ts`
          (+265 lines, 303→568) with two new exports: `detectRelayOutbound`
          (3-way conjunction: OUTBOUND_CURL_RE + OUTBOUND_PUT_RE +
          OUTBOUND_URL_RE — byte-for-byte from prototype to prevent the
          false-positives the prototype's 6/6 battery caught) and
          `detectRelayInbound` (INBOUND_REGEX with task-notification wrapper
          strip — fires on recv.sh event lines only, not wakeup fires or
          scheduled self-checks). Added 9 new relay detection tests
          (28 total, up from 19). Refactored the `parsed.kind` consumer
          in `claude-session-server.ts` from if-chains to a `switch`
          with `case "relay_outbound"` + `case "relay_inbound"` branches
          (extensibility + grep-gate compliance). Extended
          `claude-session-api.ts` with `RelayOutboundEvent` and
          `RelayInboundEvent` discriminated union types (+39 lines).

        * **Fix summary — SSRF-safe /relay-pointer backend endpoint (Plan
          17-02, commits `7e31e69` + `1649446`).**
          New file `src/backend/database/routes/relay-pointer.ts` — Express
          router with GET handler, `WHITELIST_REGEX = /^\/tmp\/relay-msg-
          [A-Za-z0-9._-]+\.txt$/` path validation (SSRF mitigation: only
          recv.sh temp-file paths pass; dot-dot traversal, non-tmp paths,
          wrong suffix all rejected), `resolveHostById` per-user host
          ownership check (unauthorized hosts return 400 UNAUTHORIZED_HOST),
          `readRelayPointerFile` SSH adapter using `head -c 16384` bounded
          remote read (CLAUDE.md fleet-availability: oversized files cannot
          exhaust backend RAM), sentinel-line `echo "__RELAY_EXIT_$?"`
          exit-status capture with `.endsWith("__RELAY_EXIT_1")` detection
          and `replace(/\n?__RELAY_EXIT_0$/)` body strip. Mounted at
          `app.use("/relay-pointer", ...)` in `database.ts` (NOT at the
          stale earlier-revision paths that pre-date plan 17-02's route mount).
          Route covered by 11 unit tests (all 11 pass: whitelist accept/
          reject × 4 patterns, unauthorized host, file-not-found,
          happy-path 200, size-cap 400, missing hostId 400, non-integer
          hostId 400, sentinel-trim-tolerance × 2 forms).
          Both `docker/nginx.conf` AND `docker/nginx-https.conf` updated
          with matching `location ~ ^/relay-pointer(/.*)?$ { proxy_pass
          http://127.0.0.1:30001; ... }` blocks (CLAUDE.md nginx caveat:
          every new backend route needs both configs or it 200s with
          index.html). Used regex `~` location form (NOT exact-match `=`
          form — see nginx caveat). Byte-identical blocks verified via
          awk block-matcher drift gate with non-empty-extraction preflight
          (NGINX-DRIFT-GATE-OK confirmed at build-verify time in
          `17-BUILD-VERIFY-LOG.md`).

        * **Fix summary — frontend relay bubble components + PrettyView
          dispatch (Plan 17-03, commits `e3c8dd0` + `53379ef`).**
          Four new files in `src/ui/features/pretty-view/`:
          - `RelayOutboundBubble.tsx` (72 lines): right-aligned blue glass
            bubble (`bg-[rgba(64,_96,_160,_0.28)]` + backdrop-blur + 1px
            `rgba(96,128,200,0.42)` top-rim; text `#e8e4d8`). Header
            `▸ relay send → {room}`. Body: extracted text or `⚠ extraction
            failed — {reason}` with raw-command source toggle (collapsed
            default, click to expand/collapse).
          - `RelayInboundBubble.tsx` (133 lines): left-aligned orange glass
            bubble (`bg-[rgba(200,_128,_64,_0.28)]` + backdrop-blur + 1px
            `rgba(220,148,80,0.42)` top-rim; text `#e8e4d8`). Header:
            identity-avatar-dot in resolved colorHue + sender name + room.
            Body: inline text or file-pointer fetch via `/relay-pointer?
            hostId=...&path=...` (main backend mount per plan 17-02).
            Fetch 4-state machine (idle/loading/done/error); fetch-fail
            shows `📄 fetch failed ({code})` indicator.
          - `relay-mxid-resolve.ts` (64 lines): mxid → identity resolver
            (reuses `useIdentities` hook + colorHue chain; unresolved mxids
            fall back to neutral grey `hsl(210, 8%, 50%)`).
          - `relay-pointer-detect.ts` (56 lines): file-pointer body
            recogniser (detects `body written to /tmp/relay-msg-*.txt`
            pattern in recv.sh inbound messages).
          Three new test files (14 new tests total):
          - `relay-mxid-resolve.test.ts` (82 lines, 6 tests)
          - `RelayOutboundBubble.test.tsx` (67 lines, 3 tests)
          - `RelayInboundBubble.test.tsx` (186 lines, 5 tests)
          `PrettyView.tsx` wired with relay_outbound + relay_inbound
          dispatch cases in WS switch + render dispatch routing to the
          two new bubble components (+41 lines, additive-only — zero
          existing ChatMessage/ComposeBox/IdentityBadge bytes changed).

        * **Emitted CSS color note.** Tailwind v4 uses Lightning CSS
          internally, which normalizes `rgba()` colors to 8-digit hex in
          the emitted CSS bundle. The blue glass `rgba(64, 96, 160, 0.28)`
          emits as `#4060a047`; the orange glass `rgba(200, 128, 64, 0.28)`
          emits as `#c8804047`. Both are byte-exact equivalents; the colors
          are pixel-identical to the prototype. Source-level arbitrary-value
          classes (`bg-[rgba(64,_96,_160,_0.28)]`) pass the source-level
          grep gate; hex-equivalent grep confirms correct colors in bundle.

        * **Deploy verification** (per `17-BUILD-VERIFY-LOG.md`).
          `npx tsc --noEmit` exits 0 (zero type errors). `npx vitest run`
          reports **758 / 758 passing** across 66 test files (0 failures,
          6 pre-existing skips). `npm run build` succeeds in 3.73s (2407
          modules). Relay components bundled in `Terminal-D2IKuRvs.js`.
          NGINX-DRIFT-GATE-OK (awk block-matcher, both configs non-empty,
          zero diff). Post-deploy curl smoke documented in
          `17-BUILD-VERIFY-LOG.md § 9` — primary + unauthenticated variants
          MUST return `{400, 401}` NOT `200` after deploy.

        * **Scope fence held (RELAYBUB-06 lock).**
          `ChatMessage.tsx`, `ComposeBox.tsx`, `IdentityBadge.tsx`,
          `WipBubble.tsx`, `PlanPendingBubble.tsx`, `AsideBubble.tsx`
          UNCHANGED. `git diff HEAD~6..HEAD -- src/ui/features/pretty-view/
          {ChatMessage,ComposeBox,WipBubble,PlanPendingBubble,AsideBubble}.
          tsx src/ui/features/terminal/IdentityBadge.tsx` returns 0 lines.
          Zero touches to docker/caddy config, schema, guacd/RDP/VNC paths,
          xterm.js chrome, message-queue drawer, identity-store, or
          session-hue store. Only files under `src/` modified in Phase 17
          (outside `.planning/`):
          - `src/backend/claude-session/session-file-parser.ts`
          - `src/backend/claude-session/session-file-parser.test.ts`
          - `src/backend/claude-session/claude-session-server.ts`
          - `src/ui/api/claude-session-api.ts`
          - `src/backend/database/routes/relay-pointer.ts` (created)
          - `src/backend/database/routes/relay-pointer.test.ts` (created)
          - `src/backend/database/database.ts`
          - `docker/nginx.conf`
          - `docker/nginx-https.conf`
          - `src/ui/features/pretty-view/RelayOutboundBubble.tsx` (created)
          - `src/ui/features/pretty-view/RelayInboundBubble.tsx` (created)
          - `src/ui/features/pretty-view/relay-mxid-resolve.ts` (created)
          - `src/ui/features/pretty-view/relay-pointer-detect.ts` (created)
          - `src/ui/features/pretty-view/RelayOutboundBubble.test.tsx` (created)
          - `src/ui/features/pretty-view/RelayInboundBubble.test.tsx` (created)
          - `src/ui/features/pretty-view/relay-mxid-resolve.test.ts` (created)
          - `src/ui/features/pretty-view/PrettyView.tsx`

        * **Requirements closed.** RELAYBUB-01 (outbound blue bubble),
          RELAYBUB-02 (inbound orange bubble), RELAYBUB-03 (sender-hue
          chain on inbound header), RELAYBUB-04 (long-inbound file-pointer
          fetch via /relay-pointer), RELAYBUB-05 (extraction-failure ⚠
          graceful fallback + source toggle), RELAYBUB-06 (no-regression
          on normal pretty-view surfaces). All six closed per Ashley's
          prototype 6/6 acceptance battery 2026-07-28.

        * **15-min deadman deploy discipline observed.** Per fork DEPLOY
          DISCIPLINE (CLAUDE.md), `docker compose up -d --force-recreate
          skynet` runs behind Ashley's 15-min deadman rollback timer, no
          exceptions. Claude does not execute the deploy. Ashley's
          greenlight (post-UAT per `17-UAT-CHECKLIST.md`) is the sole
          authorize signal.

        * **Nginx caveat honored.** `docker/nginx.conf` AND
          `docker/nginx-https.conf` both updated with matching
          `/relay-pointer` location blocks (CLAUDE.md nginx caveat:
          missing block in either file = 200 with index.html = silent
          SPA fallback). Awk block-matcher drift gate with non-empty
          preflight confirms byte-identical blocks: NGINX-DRIFT-GATE-OK.

        * **Rebase risk**: LOW. Purely additive on fork-local pretty-view
          + backend claude-session/session-file-parser infrastructure.
          The two new nginx location blocks are in fork-owned config files
          (upstream Skynet does not have a relay-pointer endpoint). The
          two new bubble component files are fork-only additions; no
          upstream collision possible. The PrettyView.tsx additions are in
          fork-local pretty-view territory. `relay-pointer.ts` and its
          test are new files, zero upstream collision. `database.ts` mount
          is an additive `app.use(...)` call with no overlap on upstream
          routes. `session-file-parser.ts` additions are in the fork-local
          relay detection section, well-separated from any upstream turn
          parsing logic.

        * **Bounty reference.** `~/.claude/identities/tina/bounties/
          pretty-view-relay-bubble-prototype/` — closes on Ashley UAT
          sign-off. Prototype `prototype.html` remains the design source-
          of-truth (6/6 acceptance battery passed 2026-07-28).

---

## Post-Paste Bookkeeping

After pasting into skynet-patches.md:

1. Verify the count line: `grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3`. Should now read ONE HUNDRED SIXTY-NINE.
2. Commit: `docs(patches): pin patch #169 — Phase 17 pretty-view relay bubbles`.
3. Close the Phase 17 bounty: `/close pretty-view-relay-bubble-prototype` at `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/`.
4. Update `~/.claude/identities/tina/tina.md` compact overview if warranted — the pretty-view section may want to reflect relay bubbles as shape-complete for future mental-model anchoring.

---

*Phase: 17-pretty-view-relay-bubbles-skynet-integration*
*Draft authored: 2026-07-28 by Tina (Plan 17-04 Task 1)*
*Design source-of-truth: `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html` (LOCKED)*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md`*
