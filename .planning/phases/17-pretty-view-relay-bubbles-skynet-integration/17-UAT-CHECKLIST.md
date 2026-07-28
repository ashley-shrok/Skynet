# Phase 17 UAT Checklist — Pretty-View Relay Bubbles

**For:** Ashley
**Post-deploy validation of the Phase 17 relay bubble subsystem.**
**Deploy anchor:** term.gigaashley.click (production) — post-deploy once Ashley greenlights the batch.
**Design source-of-truth:** `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html` (6/6 acceptance battery passed with Ashley 2026-07-28) + `.planning/phases/17-pretty-view-relay-bubbles-skynet-integration/17-UI-SPEC.md` (LOCKED).

**Trace commits (Phase 17 on `feat/tab-title-from-tmux`):**
- `7251d6d` feat(17-01): relay detection (OUTBOUND 3-way conjunction + INBOUND_REGEX)
- `4a74ebd` feat(17-01): relay WS frame emission + client wire types
- `7e31e69` feat(17-02): /relay-pointer Express route (SSRF-gated, head-c bounded read)
- `1649446` feat(17-02): nginx location blocks in both docker/nginx.conf + docker/nginx-https.conf
- `e3c8dd0` feat(17-03): RelayOutboundBubble + RelayInboundBubble + helpers
- `53379ef` feat(17-03): PrettyView WS dispatch + render loop

**Build-verify status (per `17-BUILD-VERIFY-LOG.md`):**
- `npx tsc --noEmit` — exit 0
- `npx vitest run` — 758/758 passing, 66 test files, 0 failures
- `npm run build` — exit 0, 3.73s, 2407 modules transformed
- NGINX-DRIFT-GATE-OK (both blocks non-empty, zero diff)

---

## Sign-off

- [ ] **All 6 RELAYBUB items + 3 polish items pass** → greenlight the deploy + paste `17-PATCHES-MD-ENTRY.md` into `skynet-patches.md` as patch #169. Reply with "approved" or "ship it".
- [ ] **Any item fails** → note the failing item + observed-vs-expected. Route back per the Failure table at the bottom.
- [ ] **Reply "hold off"** if something else takes priority or UAT surfaces something needing revision.

---

## Before You Start: Post-Deploy Smoke Check

**Run these BEFORE the UAT walkthrough** (after `docker compose up -d --force-recreate skynet`):

```bash
# Primary smoke
curl -sS -o /tmp/relay-smoke-body.txt -w '%{http_code}\n' \
  'https://term.gigaashley.click/relay-pointer?hostId=1&path=/etc/passwd'
head -c 40 /tmp/relay-smoke-body.txt
```

MUST return HTTP `{400, 401}` AND body MUST NOT start with `<!DOCTYPE html>`.

```bash
# Unauthenticated variant
curl -sS -o /dev/null -w '%{http_code}\n' 'https://term.gigaashley.click/relay-pointer'
```

MUST return `{400, 401}`, NOT `200`.

If either returns `200` with HTML: **STOP** — nginx SPA fallback is active. Roll back immediately, do not proceed to UAT. See `17-BUILD-VERIFY-LOG.md § Failure protocol`.

---

## Setup

1. Open https://term.gigaashley.click in **Chrome on a desktop window** (1400px+) AND on your **iPhone PWA** (home-screen icon).
2. Have a fleet-connected tmux session with **a real Matrix relay send ready** — either a `curl -X PUT` to a room pre-staged in history, or trigger one live (Ashley's standard `relay-send.sh` or equivalent).
3. Have the **same room** open in Element on another device so you can send an inbound relay message (the "banana banana banana" test from the prototype acceptance battery).
4. Open DevTools Network tab on the desktop — you'll check it for RELAYBUB-04 (file-pointer fetch).
5. Have the ashley identity's `colorHue` value handy for RELAYBUB-03 (check `~/.claude/identities/ashley/identity.json` or the Skynet identity registry).

---

## Item 1 — RELAYBUB-01: Outbound blue bubble

**Action:** On a tina-identity pretty-view tab, trigger a real Matrix relay send (Ashley's `curl -X PUT` to a room, the same 3-way command format the prototype detects).

**Expected:**
- A bubble appears RIGHT-ALIGNED in the message stream
- Background is cool-blue glass (`rgba(64, 96, 160, 0.28)` with backdrop-filter blur)
- Header line reads `▸ relay send → !room-alias:server` (or the room's matrix ID)
- Body shows the extracted message text (e.g. "Hey @ashley, the deploy is green")
- Footer shows `via curl` below the bubble (small, dim)

**Acceptable variations:**
- If the `curl` command used shell-var interpolation for the body (e.g. `--data "$body"`), the bubble body will show `⚠ extraction failed — no -d single/double quoted arg found` — this is correct behavior per RELAYBUB-05. The bubble should still appear; skip to Item 5 to verify the extraction-failure path.

**Failure → route:** 17-03 (RelayOutboundBubble.tsx) or 17-01 (detection)

- [ ] RELAYBUB-01 PASS

---

## Item 2 — RELAYBUB-02: Inbound orange bubble

**Action:** From Element (or a second phone), send a message to the relay room that tina is monitoring via recv.sh — e.g. "banana banana banana". Wait for the recv.sh event to surface in the tmux session.

**Expected:**
- A bubble appears LEFT-ALIGNED in the message stream
- Background is warm-orange glass (`rgba(200, 128, 64, 0.28)` with backdrop-filter blur)
- Header line reads `● ashley · !room-alias:server` (or the room ID — the dot is the identity avatar-dot)
- Body shows "banana banana banana"
- Footer shows `via recv.sh` below the bubble (small, dim)

**Failure → route:** 17-03 (RelayInboundBubble.tsx) or 17-01 (INBOUND detection)

- [ ] RELAYBUB-02 PASS

---

## Item 3 — RELAYBUB-03: Sender hue on inbound bubble

**Action:** On the inbound bubble from Item 2, look at the avatar-dot in the header line.

**Expected:**
- The avatar-dot is rendered in **ashley's identity colorHue** (warm orange/amber — whatever `colorHue` is set to in the ashley identity registry, typically in the 20-40 hsl-degree range)
- It is NOT the neutral grey fallback (`hsl(210, 8%, 50%)`)
- Cross-check: if the bubble sender's mxid resolves to the ashley identity in the registry, the hue should match `hsl(colorHue, 70%, 65%)` or similar per the hue-chain convention

**Failure → route:** 17-03 (relay-mxid-resolve.ts + RelayInboundBubble sender-hue chain)

- [ ] RELAYBUB-03 PASS

---

## Item 4 — RELAYBUB-04: Long inbound file-pointer fetch

**Action:** Ask Ashley to send a long message (>500 characters, or whatever the recv.sh threshold is for writing to a temp file instead of inline body) from Element. The recv.sh event body will read `body written to /tmp/relay-msg-XXXX.txt` instead of inline text.

**Expected:**
- Inbound bubble appears with a preview line: `📄 body written to /tmp/relay-msg-XXXX.txt`
- Within ~1 second, the full fetched body appears inline below the preview line
- In DevTools Network tab, confirm a request to `/relay-pointer?hostId=...&path=/tmp/relay-msg-...` returning **HTTP 200**
  - Path must be `/relay-pointer` (the main-backend mount per plan 17-02) — NOT any older path from earlier revisions
  - The request goes to the main Skynet backend (port 30001 proxied through nginx)
- If the backend is unreachable for the pointer fetch, the bubble shows `📄 fetch failed (503)` or similar indicator — NOT a silent drop

**Failure → route:**
- File-pointer not fetched at all → 17-03 (relay-pointer-detect.ts + RelayInboundBubble fetch logic)
- Network tab shows wrong path or 200 with HTML → 17-02 (nginx routing issue for /relay-pointer)
- Network tab shows a path under `/claude-session/` instead of `/relay-pointer` → stale path in RelayInboundBubble.tsx — route to 17-03

- [ ] RELAYBUB-04 PASS

---

## Item 5 — RELAYBUB-05: Extraction-failure graceful fallback + source toggle

**Action:** Find or trigger a relay send where the `curl` command body uses shell-var interpolation (e.g. `curl -X PUT ... -d "$body"` or `--data-raw "$BODY"`). This is the "no static value available" case.

**Expected:**
- Outbound bubble still appears (detection fires on curl + PUT + matrix send URL)
- Bubble body shows: `⚠ extraction failed — no -d single/double quoted arg found` (or similar extraction-failure reason)
- Below the extraction-failure line, a **"show source"** toggle button is visible (collapsed by default)
- Click the toggle: the raw command should expand inline below
- Click again: collapses back

**Verification note:** The prototype's 3 extraction-failure cases (shell-var interpolation, `--data-raw` variant, heredoc-nested payload) should all produce the same ⚠ path. Shell-var is the easiest to trigger.

**Failure → route:** 17-03 (RelayOutboundBubble.tsx extractError path + toggle)

- [ ] RELAYBUB-05 PASS

---

## Item 6 — RELAYBUB-06: No-regression check on normal pretty-view surfaces

**Action:** On a normal Claude Code pretty-view session that has had no relay activity (a regular agent conversation tab), verify all the following:

**Expected (nothing should have changed):**
- [ ] User and assistant bubbles look identical to pre-deploy (same layout, colors, fonts, spacing as before Phase 17)
- [ ] ComposeBox typing still works; Send sends normally; queue/reset/paperclip buttons all functional
- [ ] IdentityBadge in the header still shows correct identity avatar with correct hue
- [ ] WipBubble renders on a session that has an active tool-use in progress
- [ ] PlanPendingBubble renders when a plan is pending confirmation (if you can trigger this state)
- [ ] AsideBubble (Phase 14) still renders on isIdle transition if a fleet-identity session goes idle
- [ ] Session-holding banner appears normally on `/id reset` (the "session is being restarted" state)
- [ ] Keyboard chord Ctrl+Shift+O still toggles between pretty view and tmux mode (or whatever chord is mapped to the toggle)

**Regression signal:** If ANY of these fail, it means Phase 17's PrettyView dispatch additions touched something they shouldn't have. Route to 17-03 (PrettyView.tsx dispatch wiring) for investigation.

**Failure → route:** 17-03 (PrettyView.tsx render dispatch — ensure relay bubbles are only emitted on relay_* event types, not normal message/image turns)

- [ ] RELAYBUB-06 PASS (no regressions on normal turns or existing bubbles)

---

## Polish Items (non-blocking, but note any issues)

### Polish A — Mobile viewport bubble wrap

**Action:** On your iPhone PWA, trigger (or scroll back to) an outbound relay bubble and an inbound relay bubble.

**Expected:** Both bubble types wrap correctly in the narrow mobile viewport — no horizontal overflow, no text clipping, glass background fills the bubble correctly.

**Note if failing:** route to 17-03 (RelayOutboundBubble.tsx + RelayInboundBubble.tsx Tailwind layout).

- [ ] Polish A PASS / note: ____________________

### Polish B — Native text selection from bubble body

**Action:** On an inbound relay bubble with a short inline body ("banana banana banana"), use native browser text selection to highlight + copy the body text.

**Expected:** Standard browser selection works (cursor appears, text highlights, Ctrl+C / Cmd+C copies). Per RENDER-04, bubble text is not wrapped in any selection-blocking overlay.

- [ ] Polish B PASS / note: ____________________

### Polish C — Rapid-fire relay stability

**Action:** Trigger or observe 5+ relay round-trips within ~30 seconds (mix of outbound sends and inbound receives).

**Expected:** No visual stuttering (bubbles don't flicker or disappear), no double-emission (each relay event produces exactly one bubble), the message stream stays in the correct order.

- [ ] Polish C PASS / note: ____________________

---

## Failure → Route-Back Table

| Symptom | Route to plan |
|---------|--------------|
| Relay bubbles don't appear at all | 17-01 (detection not firing) or 17-03 (WS dispatch not wired) |
| Blue bubble is orange / orange bubble is blue | 17-03 (RelayOutboundBubble vs RelayInboundBubble assignment in dispatch) |
| File-pointer fetch shows a path under `/claude-session/` in Network tab (stale earlier-revision path) | 17-03 (fix fetch URL in RelayInboundBubble.tsx) |
| File-pointer fetch returns 200 HTML (SPA fallback) | 17-02 (nginx block missing or wrong location priority on deployed instance) |
| Sender hue is always grey (no colorHue) | 17-03 (relay-mxid-resolve.ts mxid resolution or colorHue lookup) |
| Extraction-failure ⚠ not showing source toggle | 17-03 (RelayOutboundBubble.tsx rawCommand/toggle path) |
| Normal user/assistant bubbles look wrong | 17-03 (PrettyView.tsx dispatch — verify relay branch doesn't bleed into ChatMessage path) |
| ComposeBox broken | HARD FAIL — Phase 17 must not have touched ComposeBox. Verify with `git diff HEAD~6..HEAD src/ui/features/pretty-view/ComposeBox.tsx` — should be empty |
| IdentityBadge wrong | HARD FAIL — same, verify `git diff HEAD~6..HEAD src/ui/features/terminal/IdentityBadge.tsx` |

---

## Post-UAT Steps

On UAT green (all 6 RELAYBUB items + any polish notes):

1. Paste `17-PATCHES-MD-ENTRY.md` draft into `~/.claude/identities/tina/skynet-patches.md` as patch #169.
2. Update the count line from "ONE HUNDRED SIXTY-EIGHT" to "ONE HUNDRED SIXTY-NINE numbered patches".
3. Commit: `docs(patches): pin patch #169 — Phase 17 pretty-view relay bubbles`.
4. Reply "approved" to close the Phase 17 deploy checkpoint.

On UAT red on any item: describe what you saw; route back per the table above.

---

*Phase: 17-pretty-view-relay-bubbles-skynet-integration*
*Checklist authored: 2026-07-28 by Tina*
*Design source-of-truth: `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html` (LOCKED)*
