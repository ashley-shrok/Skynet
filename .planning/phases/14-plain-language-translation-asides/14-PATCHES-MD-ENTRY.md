# Patch #151 — Plain-Language Translation Asides — Phase 14

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`
**Paste timing:** Only after Ashley greenlights the bundled Phase 14 + queued #150 A + C deploy AND UAT passes on the items in `14-UAT-CHECKLIST.md`. Post-deadman-retirement flow per current `~/.claude/identities/tina/deploy-runbook.md` (the 15-min deadman regime was retired 2026-07-21).
**Batch context:** Patch #151 is the Phase 14 aside subsystem — one conceptual patch (even though it landed as 22+ commits across Waves 1-6). Ships BUNDLED with queued patches #150 A (pruner fleet-aware — `7f63a4b`) + #150 C (URL-restore multi-tab glow — `162dc1c`) per CONTEXT.md § Phase Boundary (Ashley 2026-07-26 verbatim: "there's no point in deploying until we get it in"). The three ship together in ONE Ashley-verified deploy window on `feat/tab-title-from-tmux`. Tina pins all three at the PIN moment. The solo-deploy carveout for #150 A (per tina.md — actively-broken-in-production trigger) is now MOOT because #150 A is bundled with Phase 14 in the same deploy event.

Explicit contract line for the fork-catalog integrity gate: **patch #151 batches with queued patches #150 A + #150 C as the Phase-14-completion deploy** (one deploy, three separate patch entries in skynet-patches.md).

**Ordinal position on paste:** Verify current count first with `grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3`. If patches #150 A + C are unpinned at deploy time (likely — per quick task `260726-l1p` and the earlier #149 workflow, deploy was deferred pending Ashley greenlight), pin all three together: bump from N (current baseline) to N+3. Recommended combined pin commit message: `docs(patches): pin patches #150 A + #150 C + #151 — Phase 14 aside subsystem bundled with queued pruner + URL-restore fixes`.

**No Co-Authored-By trailer** — fork convention (per 260723-bbt quick task pattern and Phase 10 + Phase 11 + Phase 12 + Phase 13 patches-md-entry precedents).

---

## Draft (paste-ready — matches the multi-commit-under-one-pin convention from patches #104, #105, #128, #138, #139, #140)

   151. `feat(pretty-view,claude-session): patch #151 — plain-language
        translation asides (Phase 14 — new AsideBubble pretty-view bubble
        type + PrettyView isIdle-transition arm emitter + ComposeBox
        Send→X morph + backend BTW-inject-and-extract WS subsystem on the
        existing port 30011 bridge; purely additive on fork-local pretty-
        view + backend session-tail infrastructure; no upstream Skynet
        surfaces touched)`
        (committed 2026-07-26 to `feat/tab-title-from-tmux`; deploy
        BUNDLED with queued patches #150 A (pruner fleet-aware) + #150 C
        (URL-restore multi-tab glow) per CONTEXT.md § Phase Boundary
        Ashley-verbatim: "there's no point in deploying until we get it
        in"; the three-patch bundle tells the "Phase 14 shipped with the
        two queued fleet-list fixes it was blocking" story = one deploy
        event, three catalog entries).

        * **Motivating gap** (Ashley's direct call-outs, 2026-07-26 design
          session, full timeline at `~/.claude/identities/tina/bounties/
          plain-language-translation-asides/bounty.json`):
          Ashley bounces between ~5 active identity sessions doing "answering
          questions and explaining things." She frequently comes back to a
          tab later to find several agent bubbles have accumulated since her
          last message (the agent got woken by monitors + relay pings + the
          like). She wants to walk into the tab and immediately understand
          what the agent has been saying, without scrolling back and
          mentally parsing dev-jargon-heavy replies. Verbatim direction this
          session:
          - "There's no point in deploying until we get it in" — the deploy
            queue for #150 A + C is blocked until Phase 14 is code-complete,
            so the three ship together.
          - "I am not going to set up our own custom pipeline for this when
            the stuff that we need is sitting right there" — rejected the
            parallel-Anthropic-call design; mechanism uses Claude Code's own
            `/btw` slash-command via `tmux send-keys` + `tmux capture-pane`.
          - "We might just take whatever's inside the explain skill and put
            it into the prompt for this btw thing rather than talk about the
            explain skill" — the prompt inlines the /explain skill body
            verbatim.
          - "Fewer moving pieces is better" — no aside store anywhere. The
            tmux BTW overlay itself is the sole source of truth; backend is
            a pure translator.
          - "Let's just ignore the new turn's aside until the current one is
            dismissed and we'll see how that goes" — v1 overlap policy;
            revisit if too much translation coverage is lost.
          - "Play arrow is too close to the send icon already that's there"
            — X icon (not play-arrow) for the Resume affordance; hover
            tooltip "Resume".
          Design source-of-truth: `~/.claude/identities/tina/bounties/plain-
          language-translation-asides/bounty.json` (2026-07-26 design
          session with Ashley, full spec locked) + `~/.claude/identities/
          tina/bounties/plain-language-translation-asides/aside-visual-
          snippet.js` (DevTools recipe Ashley signed off on 2026-07-26,
          defaults at 10px border + glow multiplier 1.0 + three-layer glow
          at 12/32/64px in the identity hue).

        * **Fix summary — backend primitives (Wave 1).** Added 3 module-
          scope helpers + 2 constants + local shellQuote to `src/backend/
          claude-session/claude-session-server.ts` (+156 lines). Constants:
          `BTW_PROMPT` (byte-for-byte from CONTEXT.md § Injection including
          U+2014 em-dash), `ASIDE_END_MARKER` (`Esc to close`). Helpers:
          `injectBtw(conn, tmuxSession)` (execCommand-wraps `tmux send-keys
          -t <target> "/btw <prompt>" Enter` via local shellQuote parity-
          mirror of terminal.ts L123 — NOT JSON.stringify, per plan-checker
          W2 grep-negative gate), `sendEscapeToBtw(conn, tmuxSession)`
          (execCommand-wraps `tmux send-keys -t <target> Escape` for
          dismiss), `extractBtwAnswer(paneOutput, marker)` (pure string
          extractor with LAST-occurrence anchoring on BOTH end marker AND
          /btw echo — so prior BTW invocations still visible in the -S -200
          scrollback don't spoof the current answer per ASIDE-04). Test-
          only re-exports: `__asideShellQuoteForTests` locks byte-parity
          with terminal.ts. 13 vitest cases pass (5 cases A-E for
          extractBtwAnswer, 4 shellQuote parity, 4 constant assertions).

        * **Fix summary — backend WS subsystem (Wave 2).** Added ~370
          lines to claude-session-server.ts: module-scope `asideState =
          new Map<WebSocket, {armed, displayed}>()` (per CONTEXT.md §
          Backend per-connection state LOCK 2026-07-26 + plan-checker B3:
          MUST be module-scope, NOT closure-scoped `let` — cross-tab
          dismiss coherence requires broadcast to flip peer state) +
          module-scope `activeViewers = new Map<sessionKey, Set<WebSocket>>
          ()` fan-out registry + `broadcastAsideDismissed(key)` atomic
          BOTH-STEPS primitive (ONE function that (a) sends dismiss frame
          to each peer AND (b) flips each peer's asideState.get(peer).
          displayed=false in ONE loop iteration per peer — partial-update
          races impossible by construction) + `ASIDE_POLL_INTERVAL_MS = 300`
          + `sessionKey(hostId, tmuxSession)` composite-key helper. Client-
          message dispatch handlers for `aside_arm` (with overlap-ignore
          gate `if (state.armed || state.displayed) return;` → injectBtw +
          state.armed=true) and `aside_dismissed` (sendEscapeToBtw +
          broadcastAsideDismissed; IGNORES client-supplied msg.hostId +
          msg.tmuxSession for send-keys routing per T-14-02-01 mitigation
          — uses connection-scoped currentHostId + currentTmuxSession only,
          forecloses client spoofing). Extraction poller (setInterval on
          ASIDE_POLL_INTERVAL_MS cadence, gated on state.armed for idle-
          cheap operation, uses `tmux capture-pane -p -S -200`, marker-
          disappearance detection FIRST for cross-tab coherence when
          Ashley externally Escapes via SSH, then streaming/stable branch
          with two-consecutive-stable-poll debounce, calls extractBtwAnswer
          + emits aside_ready). Connect-time re-attach probe (async IIFE
          with snapshot; runs INDEPENDENT of activeViewers.size per plan-
          checker W7 clarification — each connection discovers overlay
          presence via one-shot capture-pane on mount; emits aside_ready to
          THIS client only, no peer broadcast to avoid double-fire race).
          WS-close cleanup (asideState.delete + activeViewers Set/Map
          removal + extraction timer clear). teardownPane extension for
          pane-rebind cleanup (Rule 1 auto-fix during Wave 2 — prevents
          spurious dismisses on new pane after switch). Test-only re-
          exports: `__asideStateForTests`, `__activeViewersForTests`,
          `__sessionKeyForTests`, `__broadcastAsideDismissedForTests` for
          integration test observation without spinning up 7-mock WS-
          lifecycle. 4 new WS wire types added to `src/ui/api/claude-
          session-api.ts` (+55 lines, ADDITIVE only): `AsideReadyEvent`,
          `AsideDismissedEvent` (server→client, threaded into
          `ClaudeSessionServerEvent` discriminated union), `AsideArmPayload`,
          `AsideDismissedPayload` (client→server). 13 backend structural +
          6 wire-type + 5 backend integration tests pass (26 total in the
          claude-session-server.aside.* + claude-session-api.aside.* test
          files).

        * **Fix summary — frontend AsideBubble + PrettyView wiring
          (Wave 3).** New file `src/ui/features/pretty-view/AsideBubble.
          tsx` (130 lines) — pure function of props, no state / no effects
          / no refs / no event handlers, role='note' + aria-label='Plain-
          language aside from the identity'. Props: text: string, glow?:
          number (default 1.0), borderWidthPx?: number (default 10) — the
          latter two are seams for future dial-back per CONTEXT.md §
          Rendering final sentence. Identity-hue gradient background
          copied VERBATIM from ChatMessage L124 (inlined class strings, no
          cross-component import — AsideBubble stands alone; ChatMessage
          refactors can't blast-radius it). 10px opaque hue border
          (`hsla(var(--pv-id-hue), 90%, 65%, 1)`) + three-layer neon glow
          at 12/32/64px (`hsla(hue, 100%, 60|55|50%, 0.7|0.5|0.3)`)
          ADDITIVE to base depth shadow + inner rim per aside-visual-
          snippet.js prototype Ashley signed off on. whitespace-pre-wrap
          inner div preserves multi-line /btw answer newlines; React
          default text-child escaping mitigates T-14-03-01 (XSS via /btw
          answer text). PrettyView wired end-to-end with 10 additive edits
          (+152 lines): AsideBubble import, asideText useState, prev-value
          prevIsIdleRef useRef, fresh-pane reset extended with setAsideText
          (null), WS event switch cases for aside_ready (→ setAsideText
          (parsed.text)) + aside_dismissed (→ setAsideText(null)),
          handleAsideDismiss useCallback (two-step atomic: optimistic
          setAsideText(null) BEFORE WS-send + WS-send `{type:
          'aside_dismissed', hostId, tmuxSession}` — idempotent on peer
          re-receive), isIdle-transition arm-emitter useEffect (SOLE
          trigger source per CONTEXT.md § Trigger LOCK 2026-07-26; guards
          on prev===false && isIdle===true && pvIdentity != null &&
          wsRef.OPEN; identity gating happens FRONTEND-SIDE per ASIDE-02,
          backend accepts any aside_arm on connected pretty-view WS without
          checking identity), AsideBubble render slot immediately after
          {planPending && <PlanPendingBubble />} (in-flow at bottom of
          message stream per ASIDE-05), ComposeBox mount extended with
          asideActive={asideText !== null} + onAsideDismiss=
          {handleAsideDismiss}. Zero existing state / effect / WS handler
          / reset logic / render branch modified. ComposeBoxProps interface
          extended (per plan-checker W3 interface-first-across-wave-
          boundaries correction — extension lands in Wave 3, body
          consumption in Wave 4): asideActive?: boolean + onAsideDismiss?:
          () => void as optional additive fields. 12 new vitest cases
          across 3 new test files. ChatMessage / ImageBubble /
          PlanPendingBubble / WipBubble bytes UNCHANGED (git diff --stat
          confirms — Ashley's "pretty-view chat surface interior is
          LOCKED — add NEW bubble types, don't modify existing ones"
          invariant preserved from CONTEXT.md canonical_refs).

        * **Fix summary — ComposeBox morph body (Wave 4).** Extended
          ComposeBox.tsx body to consume Wave 3's asideActive +
          onAsideDismiss props (+49 lines net). 4 aux button `disabled`
          predicates extended with `|| asideActive === true`: reset
          (L1032), paperclip (L1188), thumbs-up ('let's go') (L1246),
          queue (Hourglass) (L1277, compound `queueDisabled ||`).
          Interrupt button (Square icon, patch #120) INTENTIONALLY
          EXCLUDED — its pre-existing `NOT gated on canSend` invariant
          (safety-valve for reaching interrupt when WS is in a half-state,
          per L1207-1210 comment) is preserved; extending it with
          asideActive would violate that. Send button MORPHED IN PLACE
          (same-element-conditional-attribute per PATTERNS.md L186-234 —
          preserves DOM identity + focus + tab order + parent-CSS selector
          stability across the morph transition; sibling-render would have
          broken any downstream ref / autofocus / keyboard-tab consumers):
          six attributes branch on asideActive — icon (paper-plane inline
          SVG ↔ lucide X), aria-label ("Send" ↔ "Resume"), title (same),
          onClick (handleSend ↔ onAsideDismiss?.() with defensive optional-
          chain for wave-boundary contract robustness), disabled
          (sendDisabled ↔ ALWAYS false — X is always clickable when morphed
          even with empty textarea; only way to un-block the send path is
          X-click), className (default color ↔ identity-hue color `text-
          [hsla(var(--pv-id-hue),90%,72%,0.95)] hover:text-[hsla(var(--pv-
          id-hue),95%,82%,1)]` — so the morphed X visually adopts the
          session's identity color, forming a visual pair with the
          AsideBubble above; Ashley 2026-07-26 "Style change to visually
          distinguish from send"). Textarea `disabled={queueArmed}`
          predicate DELIBERATELY NOT extended — per CONTEXT.md § ComposeBox
          morph verbatim: "Textarea remains editable. Any partial draft
          text is preserved verbatim." Source-level enforced via negative-
          grep `! grep -E "disabled=\{[^}]*queueArmed[^}]*asideActive"`;
          runtime enforced via Task 1 Test 6. lucide-react named import
          extended with `X` (alphabetically last after ThumbsUp). 15 new
          vitest cases (6 aux disable + 9 Send morph including defensive
          undefined-callback no-crash + backward-compat cases). Also
          absorbed the 2 pre-existing ComposeBox.test.tsx failures
          documented in deferred-items.md ("Wave 4 is the natural
          touchpoint") — one-line regex refresh `/send 'yes'/i` → `/send
          'let's go'/i` in commit `49bc643`; ComposeBox.test.tsx now
          20/20, full pretty-view suite 134/134 (from 132/134 baseline).

        * **Fix summary — Wave 5 integration tests + minimal source export.**
          Added `export` to the module-scope `const asideState = new Map
          <...>()` declaration in claude-session-server.ts (Option A over
          Option B getter — 1-word addition; the Map IS the source of
          truth per CONTEXT.md § Backend per-connection state LOCK, so
          exporting it lets integration tests observe cross-path state
          transitions without spinning up 7-mock WS lifecycle plumbing).
          10 new integration tests across 2 test files: 5 frontend in
          PrettyView.test.tsx (Test A aside_arm emission on isIdle
          transition + identity-gate sub-case; Test B aside_ready mount +
          ComposeBox morph as ONE integration assertion; Test C X-click
          fires WS-outbound + optimistically clears + reverts ComposeBox;
          Test D inbound aside_dismissed idempotency; Test E fresh-pane
          reset), 5 backend in NEW file claude-session-server.aside.
          integration.test.ts (Test A arm-via-aside_arm-dispatch + poller
          stability emit-only-on-4th-stable-poll; Test B cross-tab
          broadcast BOTH-STEPS with EXPLICIT peer-state-flip verification;
          Test C overlap policy dual-gate armed OR displayed; Test D
          connect-time probe independent of activeViewers.size per plan-
          checker W7; Test E marker-disappearance triggers SAME
          broadcastAsideDismissed primitive as client-initiated dismiss —
          cross-tab coherence regardless of dismiss origin). Test-seam
          rationale: full wss.emit('connection') lifecycle would require
          mocking AuthManager + UserCrypto + resolveHostById +
          connectOneShot + discoverClaudeSession + tailSessionFile +
          execCommand = 7 modules just to reach the aside_arm dispatch
          site with zero incremental coverage beyond the Map-transition +
          primitive-invocation assertions the tests already make. Chosen
          shape (Map + primitive invocation) drives the SAME code path
          production uses. Per-test hostId namespacing (42/43/44/45) +
          afterEach regex sweep prevents cross-test contamination.
          Full regression: 184/184 backend + pretty-view tests pass; zero
          regression to Waves 1-4.

        * **Deploy verification** (per Wave 6 build-verify log at
          `.planning/phases/14-plain-language-translation-asides/14-BUILD-
          VERIFY-LOG.md`). `npx tsc --noEmit` exits 0 (zero type errors
          across the whole codebase). `npx vitest run` reports **596 / 596
          passing** across 49 test files (zero failures, zero skips) — up
          from the 556/558 pre-Phase-14 baseline (the 2 pre-existing
          ComposeBox failures were absorbed in Wave 4 per the deferred-
          items.md natural-touchpoint rule; ~40 net-new tests added). `npm
          run build` succeeds in 4.38s (2395 modules transformed, zero
          warnings). Nginx caveat: N/A — Phase 14 adds no HTTP routes,
          only new WS event types on the existing port 30011 bridge (per
          CONTEXT.md non-negotiable no-new-port constraint). The docker/
          nginx.conf + docker/nginx-https.conf symmetry requirement does
          not apply.

        * **Preserved verbatim** (SHAPE-06-style scope fence). Only ONE
          new file created in `src/ui/features/pretty-view/`: `AsideBubble.
          tsx`. Existing pretty-view bubble components (ChatMessage.tsx,
          ImageBubble.tsx, PlanPendingBubble.tsx, WipBubble.tsx) are BYTE-
          PRESERVED from pre-Phase-14 tip. `src/ui/components/**` (shadcn
          primitives), `src/ui/ssh/**` (SSH/RDP dialogs), `src/ui/features/
          terminal/**` (xterm.js chrome) all UNCHANGED. Verified: `git
          diff --stat f4ae668..HEAD -- src/ui/features/pretty-view/
          {ChatMessage,ImageBubble,PlanPendingBubble,WipBubble}.tsx src/
          ui/components/ src/ui/ssh/ src/ui/features/terminal/` returns 0
          lines. Ship-of-Theseus / SHAPE-06-style rule preserves them for
          upstream Skynet rebase-ability. Backend routes untouched — Phase
          14 is a WS-only extension on the existing port 30011 bridge (per
          CONTEXT.md non-negotiable no-new-port); zero new HTTP routes.
          `git diff f4ae668..HEAD -- src/backend/claude-session/claude-
          session-server.ts | grep -E "^\+.*app\.(get|post|put|delete|use)"`
          returns empty.

        * **Bundle-size impact.** Phase 14 is additive on `PrettyView.tsx`
          (+152 lines Wave 3), `ComposeBox.tsx` (+~80 lines across Wave 3
          interface + Wave 4 body), new `AsideBubble.tsx` (~130 lines),
          plus backend `claude-session-server.ts` (+~370 lines Wave 2 + 1
          export word Wave 5). Post-Phase-14 tip bundle sizes:
          `dist/assets/index-C0XZuJ05.js` 173.31 kB / 52.20 kB gz;
          `dist/assets/AppShell-D0oaydku.js` 67.84 kB / 18.15 kB gz;
          `dist/assets/Terminal-CvCaRcn3.js` 186.10 kB / 48.19 kB gz;
          `dist/assets/index-fNY4EZmh.css` 199.29 kB / 32.18 kB gz. No new
          dependencies added, so no new vendor chunks. Backend server-side
          additions don't ship in the frontend bundle.

        * **Scope fence held.** Zero touches to `src/backend/**` outside
          `claude-session-server.ts` + `claude-session-server.aside.test.
          ts` + `claude-session-server.aside.integration.test.ts` (all new
          or extended within the Phase-14 aside-specific boundary). Zero
          touches to docker/caddy/nginx config, encrypted-SQLite schema,
          guacd/RDP/VNC render paths, xterm.js chrome, message-queue
          drawer, identity-store, session-hue store, conversation-store,
          session-working-store logic, or shadcn/SSH dialog surfaces. Only
          these files under `src/` modified in the whole phase (verified
          by `git diff --name-only f4ae668..HEAD -- 'src/**'`):
          - `src/backend/claude-session/claude-session-server.ts`
          - `src/backend/claude-session/claude-session-server.aside.test.ts` (created + extended)
          - `src/backend/claude-session/claude-session-server.aside.integration.test.ts` (created)
          - `src/ui/api/claude-session-api.ts`
          - `src/ui/api/claude-session-api.aside.test.ts` (created)
          - `src/ui/features/pretty-view/AsideBubble.tsx` (created)
          - `src/ui/features/pretty-view/AsideBubble.test.tsx` (created)
          - `src/ui/features/pretty-view/PrettyView.tsx`
          - `src/ui/features/pretty-view/PrettyView.aside.test.tsx` (created)
          - `src/ui/features/pretty-view/PrettyView.test.tsx`
          - `src/ui/features/pretty-view/ComposeBox.tsx`
          - `src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx` (created)
          - `src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx` (created)
          - `src/ui/features/pretty-view/ComposeBox.test.tsx` (regex refresh only in Wave 4)

        * **Data-store contract UNCHANGED.** `conversation-store.ts`,
          `session-working-store.ts`, `session-hue.ts`, `identities-
          store.ts`, `tabUtils.tsx` all untouched by Phase 14. No new
          store added — the tmux BTW overlay IS the source of truth per
          CONTEXT.md § State model.

        * **New test coverage summary** (net +~40 tests over pre-Phase-14
          baseline):
          - `claude-session-server.aside.test.ts` (created + extended): 21 tests (Wave 1 primitives + Wave 2 module-scope structural + Wave 5 named-export assertion)
          - `claude-session-server.aside.integration.test.ts` (created): 5 backend integration tests (Wave 5)
          - `claude-session-api.aside.test.ts` (created): 6 wire-type tests (Wave 2)
          - `AsideBubble.test.tsx` (created): 5 render + aesthetic tests (Wave 3)
          - `ComposeBox.aside-props.test.tsx` (created): 2 interface-shape tests (Wave 3)
          - `ComposeBox.aside-morph.test.tsx` (created): 15 aux-disable + Send-morph tests (Wave 4)
          - `PrettyView.aside.test.tsx` (created): 5 arm-emitter + WS-handler + mount tests (Wave 3)
          - `PrettyView.test.tsx` (extended): +5 integration tests (Wave 5)

        * **Deploy notes.** Ships BUNDLED with queued patches #150 A +
          #150 C per CONTEXT.md § Phase Boundary. Deployed behind current
          fleet DEPLOY DISCIPLINE (`~/.claude/identities/tina/deploy-
          runbook.md`, post-2026-07-21): `git push` before build; explicit
          go-ahead for the deploy window (not carried over from code
          authorization); check-before-recreate compose-image-line grep;
          `docker compose up -d --force-recreate skynet`; pre-warn Ashley
          about first-hard-refresh HTTP2_PROTOCOL_ERROR (fix = close +
          reopen tab); verify healthy + grep dist for `AsideBubble`
          signature to confirm patched bytes shipped. The retired 15-min
          deadman auto-revert regime (documented in fork CLAUDE.md's
          Deploy safety section and in the plan file's what-built section)
          does NOT apply — retired 2026-07-21, replaced by Ashley's SSM-
          tmux-attach-via-SSH-over-SSM fallback. Full deploy sequence
          documented at `.planning/phases/14-plain-language-translation-
          asides/14-UAT-CHECKLIST.md § Post-UAT deploy runbook`.

        * **Bounty reference.** `~/.claude/identities/tina/bounties/plain-
          language-translation-asides/` — closes on Ashley UAT sign-off.
          Full design session transcript in the bounty's `bounty.json §
          timeline[]` (empirical kumquat-test findings, /explain-skill-
          inlining decision, aesthetic-locking decision, deploy-bundling
          decision).

        * **Rebase risk**: MEDIUM per ROADMAP.md § Phase 14 description —
          purely additive on fork-local pretty-view + backend session-tail
          infrastructure; no upstream Skynet surfaces touched. When we
          next rebase against upstream `main`, upstream Skynet's pretty-
          view surface (fork-only anyway) has no equivalent code so no
          conflicts expected there. The `claude-session-server.ts` backend
          additions are all in the fork-local backend/claude-session
          subsystem (established Phase 1 by fork patch #43). The new WS
          wire types in `claude-session-api.ts` are additive-only
          extensions of the existing `ClaudeSessionServerEvent`
          discriminated union — zero merge conflicts on existing lines.
          The ComposeBox morph is in the fork-local pretty-view
          ComposeBox.tsx. AsideBubble is a new fork-local file. No hard
          upstream conflicts expected. Grep for `type:"aside_"` in any
          post-rebase source tree to sanity-check that no upstream naming
          collision emerged.

        * **Locked design decisions** (per CONTEXT.md, no re-litigation):
          - **Frontend-arm architecture (Trigger LOCK 2026-07-26 post
            plan-checker B1/B2/B4).** SOLE trigger source is the client's
            aside_arm WS message on PrettyView's isIdle:false→true
            transition. Backend does NOT observe terminal WSS idle-signal
            frame; no cross-WSS coupling. Identity gating happens
            frontend-side (before emit).
          - **Module-scope asideState Map (Backend per-connection state
            LOCK 2026-07-26 post plan-checker B3).** NOT closure-scoped
            `let` variables. Load-bearing for cross-tab dismiss coherence
            — broadcast MUST flip peer state, closure-scoped state would
            silently break ASIDE-08 across tabs.
          - **broadcastAsideDismissed atomic BOTH-STEPS.** ONE function
            that both (a) sends dismiss frame to each peer AND (b) flips
            each peer's state.displayed=false. Both in ONE loop iteration
            per peer — partial-update races impossible by construction.
          - **No new port.** All aside WS traffic (arm, ready, dismissed)
            multiplexes on the existing port 30011 pretty-view WS bridge
            established Phase 1.
          - **No aside store.** No DB row, no in-memory KV, no persistence
            layer. tmux BTW overlay is the sole source of truth. Backend
            restarts recover state by re-probing on next event.
          - **Locked aesthetic** (aside-visual-snippet.js prototype Ashley
            signed off on 2026-07-26). 10px opaque hue border + three-
            layer neon glow at 12/32/64px alphas 0.7/0.5/0.3. Prop-driven
            glow multiplier + borderWidthPx are future dial-back seams —
            not user-tunable at v1.
          - **v1 overlap policy: ignore.** New turn while aside displayed
            → newer turn does NOT get its own aside; current one stays
            until dismissed. Revisit if too much translation coverage is
            lost in practice.

        * **Design source-of-truth** (LOCKED, no re-litigation per
          CONTEXT.md):
          - `~/.claude/identities/tina/bounties/plain-language-translation-
            asides/bounty.json` — full 2026-07-26 design session with
            Ashley, empirical kumquat-test verification of /btw mechanism,
            all LOCKED design decisions in timeline entries 15:52-15:58Z.
          - `~/.claude/identities/tina/bounties/plain-language-translation-
            asides/aside-visual-snippet.js` — DevTools recipe Ashley
            signed off on for the aesthetic (10px + three-layer glow +
            identity hue).
          - `.planning/phases/14-plain-language-translation-asides/14-
            CONTEXT.md` — the phase boundary + scope-fence + LOCKED
            implementation decisions.
          - `.planning/phases/14-plain-language-translation-asides/14-
            PATTERNS.md` — patterns established (same-element morph,
            frontend-arm, module-scope state, atomic BOTH-STEPS
            broadcast).
          - `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)
            — the AUTHORITATIVE current deploy source (the fork CLAUDE.
            md's 15-min deadman reference is STALE, retired 2026-07-21,
            separate `claude-md-15min-deadman-stale` bounty tracks the
            update).
          - `.planning/phases/13-.../13-PATCHES-MD-ENTRY.md` — patch #140
            precedent this draft mirrors.

        * **Commits** (all on `feat/tab-title-from-tmux`, in order landed):
          - **Plan 01 (Wave 1 — backend primitives)**: 5 commits
            - `b722977` test(14-01): add failing RED-gate tests for aside Wave 1 primitives
            - `d33ff77` feat(14-01): add aside Wave 1 primitives (BTW_PROMPT + shellQuote + injectBtw + sendEscapeToBtw)
            - `c247b5c` test(14-01): add failing tests for extractBtwAnswer (5 cases A-E)
            - `ce04015` feat(14-01): add extractBtwAnswer pure-string helper (Wave 1 primitive #3)
            - `[14-01 summary SHA]` docs(14-01)
          - **Plan 02 (Wave 2 — backend WS subsystem + wire types)**: 7 commits
            - `4ebb57d` test(14-02): add failing RED-gate tests for aside WS wire types
            - `60ebeb5` feat(14-02): add four aside WS wire types on the pretty-view WS surface
            - `19ae23f` test(14-02): add failing RED-gate tests for backend aside subsystem
            - `b4d9128` feat(14-02): backend aside subsystem — module-scope state + WS dispatch + poller
            - `ab82bdd` docs(14-02): log pre-existing ComposeBox.test.tsx failures as deferred
            - `f94753c` docs(14-02): 14-02-SUMMARY.md — Wave 2 backend aside subsystem landed via TDD
            - `f4ae668` docs(14-02): finalize plan 14-02 — state + roadmap + requirements updated
          - **Plan 03 (Wave 3 — frontend AsideBubble + PrettyView wiring + ComposeBox interface)**: 7 commits
            - `8c266a5` test(14-03): add failing RED-gate tests for AsideBubble component
            - `01d9350` feat(14-03): add AsideBubble component with locked identity-hue + neon-glow aesthetic
            - `88eaf0e` test(14-03): add failing RED-gate type-shape test for ComposeBoxProps aside fields
            - `e9b0790` feat(14-03): extend ComposeBoxProps with asideActive + onAsideDismiss (interface-only)
            - `322e67f` test(14-03): add failing RED-gate tests for PrettyView aside subsystem wiring
            - `8640804` feat(14-03): wire PrettyView aside subsystem — state + WS handlers + arm-emitter + AsideBubble mount
            - `074c0bf` docs(14-03): complete plain-language-translation-asides Wave 3
          - **Plan 04 (Wave 4 — ComposeBox morph body)**: 5 commits
            - `6c43184` test(14-04): add failing RED-gate tests for ComposeBox aside morph body
            - `f8c4e93` feat(14-04): extend aux button disable predicates with asideActive gate
            - `14d43c0` feat(14-04): morph inside-textarea Send button to X (Resume) when asideActive
            - `49bc643` fix(14-04): update stale ComposeBox test aria-label regex — 'send yes' → 'send let's go'
            - `7120a15` docs(14-04): complete plain-language-translation-asides Wave 4 — ComposeBox morph body
          - **Plan 05 (Wave 5 — integration tests + minimal source export)**: 5 commits
            - `be3ceb7` test(14-05): add failing RED-gate for asideState named export
            - `2b2b360` feat(14-05): export asideState as a named export for Wave 5 integration tests
            - `945d5b9` test(14-05): add 5 frontend integration tests for aside subsystem
            - `1371ae4` test(14-05): add 5 backend integration tests for aside subsystem
            - `21358b5` docs(14-05): complete plain-language-translation-asides Wave 5 — integration tests
          - **Plan 06 (Wave 6 — deploy checkpoint)**: 2+ commits
            - `81d08e0` docs(14-06): capture pre-deploy build verification log
            - `[Plan-06 UAT+patches-md SHA]` docs(14-06): author UAT checklist + patches-md-entry draft
            - `[Plan-06 summary SHA]` docs(14-06): summary — Phase 14 code-complete + deploy staged for Ashley greenlight

          Total: ~30 commits for Phase 14 fork sequence (~22 code commits + ~6 SUMMARY docs + 2-3 Plan 06 docs). Zero rollbacks, zero reverts.

        * **Deploy status**. Code-complete on `feat/tab-title-from-tmux`
          at `[Plan-06 tip SHA — fill in after commit]`. NOT YET pushed,
          NOT YET deployed, image NOT YET built. Bundled with queued
          patches #150 A (pruner fleet-aware — `7f63a4b`) + #150 C (URL-
          restore multi-tab glow — `162dc1c`) per CONTEXT.md § Phase
          Boundary Ashley-verbatim ("there's no point in deploying until
          we get it in"). Deploy sequence documented at `.planning/phases/
          14-plain-language-translation-asides/14-UAT-CHECKLIST.md` under
          "Post-UAT deploy runbook" (authoritative source cited: `~/.
          claude/identities/tina/deploy-runbook.md`, post-2026-07-21; NOT
          the fork CLAUDE.md's stale 15-min deadman reference).

        * **Bounty closeout note**. Ashley's UAT sign-off on this patch
          (via `14-UAT-CHECKLIST.md`) closes `~/.claude/identities/tina/
          bounties/plain-language-translation-asides/`. Full backend +
          frontend + tests shipped as designed per the LOCKED 2026-07-26
          design session. No SIBLING bounties exist for this feature (per
          the master-bounty rule established in the Ship-of-Theseus
          meta-lesson).

---

## Fill-in placeholders (before pasting)

Before pasting into skynet-patches.md, replace the following (obtain from
`git rev-parse --short HEAD` immediately after the Plan 06 docs commits):

- `[14-01 summary SHA]` — from git log for the 14-01 docs commit if it needs precise placement (or omit if already captured in Wave 1 summary flow).
- `[Plan-06 UAT+patches-md SHA]` — from `git rev-parse --short HEAD` right after the combined `docs(14-06): author UAT checklist + patches-md-entry draft` commit lands.
- `[Plan-06 summary SHA]` — from `git rev-parse --short HEAD` right after the `docs(14-06): summary` commit lands.
- `[Plan-06 tip SHA — fill in after commit]` — same as the summary SHA (Plan 06 tip is the last Plan-06 docs commit).

The build-verify numbers (596/596 vitest, 4.38s build, 49 test files) are all resolved from `14-BUILD-VERIFY-LOG.md` and do not need further substitution.

## Post-paste bookkeeping

After pasting into skynet-patches.md:

1. **Verify current count first** with `grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3`. Compute the correct bump based on whether #150 A + C were previously pinned. Most likely: both unpinned at deploy time → bump by 3.
2. **Update the count line.** If both #150 A + C are pinned solo alongside #151, the count bumps by 3 (e.g. ONE HUNDRED FORTY-EIGHT → ONE HUNDRED FIFTY-ONE). If #150 A already pinned solo earlier (unlikely given the batching rule), adjust accordingly.
3. **Commit the pin.** Recommended combined pin commit: `docs(patches): pin patches #150 A + #150 C + #151 — Phase 14 aside subsystem bundled with queued pruner + URL-restore fixes`. Solo-pin variant if only #151 shipped: `docs(patches): pin patch #151 — Phase 14 plain-language translation asides`.
4. **Close `/close plain-language-translation-asides`** bounty at `~/.claude/identities/tina/bounties/plain-language-translation-asides/`. This is the load-bearing closeout for the Phase 14 feature. All design decisions + implementation decisions + test coverage + Ashley UAT are complete.
5. **Update `~/.claude/identities/tina/tina.md`** compact overview if warranted. The compose-box + pretty-view sections may want to reflect the new aside subsystem as "shape-complete" for future-me's mental-model anchoring. If Ashley's next bounties are aside-refinement work (worth-explaining Haiku filter revisit, aside stacking / history, alternative dismiss gestures), tina.md's box-map may want a "Phase 14 aside subsystem shipped — see bounty archive for design decisions" pointer.

---

*Phase: 14-plain-language-translation-asides*
*Draft authored: 2026-07-26 by Tina (Plan 14-06 Task 2)*
*Design source-of-truth: `~/.claude/identities/tina/bounties/plain-language-translation-asides/bounty.json` (LOCKED) + `.planning/phases/14-plain-language-translation-asides/14-CONTEXT.md` (LOCKED)*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21) — NOT the fork CLAUDE.md's stale 15-min deadman reference*
