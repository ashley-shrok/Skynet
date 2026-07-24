# Phase 5 UAT Checklist — pretty-view file upload support

Post-deploy walk-through for Ashley. Every UPLOAD-NN requirement gets an observable check, quoted verbatim from `.planning/REQUIREMENTS.md` so you walk the exact contract. Groupings: desktop happy-path first, clipboard paste, failure recovery + edge cases, mobile paperclip, works-on-any-pane, regression smoke. Blocking-severity gates are marked 🚨 (regression = revert immediately). Nice-to-have polish items are unmarked or ✨.

**Trace commits:** Phase 5 code-side ships as
- Plan 01: `a24483f` (shared types), `aa6c86c` (orchestrator), `8b1225f` (terminal.ts WS cases)
- Plan 02: `6a275a7` (hook), `19fd628` (chip strip + drop overlay), `d1d8f3f` (ComposeBox + PrettyView wiring)
- Plan 03: `beef578` (Terminal.tsx wiring), `4fe48df` (ChatMessage chip render + parser hardening)
- Plan 04 build-verify: `fcfd4c8` (this walkthrough is the deploy-side verification of everything above)

## Sign-off (top-of-page so you can find it fast)

- [ ] All 🚨 items pass → **disarm deadman:**
      ```
      sudo touch /tmp/skynet-keep-patched
      sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'
      ```
      Then help me pin the patch: paste `.planning/phases/05-pretty-view-file-upload-support/05-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` as patch #104 (or next available), bump the "ONE HUNDRED THREE numbered patches" count near the top of that file, and commit the pin.
- [ ] Any 🚨 item fails → **let the deadman fire** (15-min timer will auto-revert) OR run `sudo bash /opt/skynet/.tmp-revert.sh` immediately for instant rollback.

## Setup — one time

1. Open https://term.gigaashley.click in Chrome on desktop.
2. Open a pretty-view pane on a host where you can write to `~/pretty-view-uploads/` — `thenasty` is fine; the tmux session doesn't need to be Claude Code (UPLOAD-14 says works on any pane).
3. Have a small test file ready on your local Desktop (e.g. `test.txt`, a few hundred bytes of content).
4. Have a screenshot in your clipboard (or take one now with Cmd+Shift+4 → space → click a window).

---

## Desktop happy-path (UPLOAD-01, 04, 05, 06, 09, 10, 11, 13)

> **UPLOAD-01 contract:** *"Drag-and-drop anywhere on the pretty-view surface stages files as attachments; while a drag is over the surface, a full-surface 'drop files here' overlay is visible; dropping outside the surface has no effect"*

- [ ] 🚨 **UPLOAD-01 drag-hover** Drag `test.txt` FROM Desktop OVER the pretty-view surface (top-pane conversation area). While dragging (button still held), a full-surface **"Drop files here"** overlay appears with a subtle slate tint + dashed inset border + Upload icon centered.
- [ ] 🚨 **UPLOAD-01 drop** Drop anywhere on the surface (chat area, above the compose row, on top of a bubble — anywhere within the pretty-view root). The file stages as a chip in a strip that appears ABOVE the compose textarea.
- [ ] 🚨 **UPLOAD-01 negative-space** Drag `test.txt` over an area OUTSIDE the pretty-view surface (e.g. the tab bar, the sidebar, or another pane). No overlay, no staging. Drop outside the surface — nothing happens (browser default behavior).

> **UPLOAD-04 contract:** *"Staged attachments render as a chip strip above the compose textarea; each chip shows the original filename + human-readable size and has a × control to remove that attachment before send; the strip is only present when at least one attachment is staged (no empty-strip chrome)"*

- [ ] 🚨 **UPLOAD-04 chip content** The chip renders with: file icon + `test.txt` filename (truncated at 220px if long) + human-readable size (e.g. `342 B`, `1.2 KB`) + a × control on the right (aria-label `Remove attachment test.txt`).
- [ ] 🚨 **UPLOAD-04 strip absent when empty** Click the × on the chip. The chip disappears AND the strip container disappears — no leftover empty row of chrome. Re-drag `test.txt` on to restore for the next check.

> **UPLOAD-13 contract:** *"Multiple attachments in one send share a single caption input (one caption per batch); there is no per-chip caption; empty caption is allowed (send with attachments only)"*

- [ ] **UPLOAD-13 multi-file** Drop 3 files at once (or drag them one at a time — either works). Verify all 3 chips render side-by-side in the strip (`flex flex-wrap gap-2`). Verify there is ONE shared caption input (the compose textarea) — no per-chip caption field.
- [ ] **UPLOAD-13 empty caption OK** With the 3 chips staged, leave the caption textarea EMPTY. Click Send. The Send button IS enabled (this used to require text; the gate is now `text.trim() OR attachments present`). The batch fires.
- [ ] 🚨 Remove the extras and re-stage a single `test.txt`. Type a short caption like `check this out`. Click Send.

> **UPLOAD-05 contract:** *"During transfer, each chip shows its own progress indicator (per-chip progress preferred; a single aggregate indicator across the batch is an acceptable fallback if per-chip proves fiddly)"*

- [ ] 🚨 **UPLOAD-05 per-chip progress** During transfer, the chip shows a per-chip progress bar / ring filling as bytes flow. For a small file it will flash by fast — try a ~10MB file if you want to actually see it fill. If per-chip proved fiddly and only aggregate landed, that's also acceptable per the requirement.

> **UPLOAD-06 contract:** *"Send is atomic — the injected user turn does NOT go until every attachment has successfully landed on the receiving box; if any file fails mid-transfer, chips turn red, the message stays in staging, and the user can retry"*

- [ ] 🚨 **UPLOAD-06 atomicity** After the chip fills to 100% (complete-check appears), a message is injected into the pretty-view stream. The message reference to the file NEVER appears before the file completes. Watch the order: chip fills → check appears → message renders. (You can eyeball this by using a moderately-large file so the progress-fill window is visible.)

> **UPLOAD-11 contract:** *"In the sender's own pretty-view stream, the just-sent message renders as a single bubble containing the caption text and inline chips for each attachment (filename + size only); no inline previews or thumbnails, consistent across all mimetypes"*

- [ ] 🚨 **UPLOAD-11 single-bubble render** The sent message appears as a SINGLE user bubble. The bubble contains:
    - Your caption text at the top (whitespace-preserved so multi-line captions render correctly)
    - Below the caption, an inline chip for `test.txt` with filename + human-size ONLY. No thumbnail, no preview.

> **UPLOAD-09 contract:** *"Once all files have landed, a message is injected into the tmux session containing the caption text plus a compact metadata block per file: original filename, size, mimetype, upload timestamp, and full landing path on the receiving box; file BYTES are never inlined into the injected message (path-only-with-metadata)"*

- [ ] 🚨 **UPLOAD-09 metadata block on the wire** In another shell, SSH to the same box you tested on (`ssh thenasty` or whichever). Attach to the same tmux session (or view via `tmux capture-pane -pJt <session>` if you don't want to steal focus). The injected user turn text should include:
    ```
    <your caption>

    --- attached files ---
    1. test.txt (342 B, text/plain) → /home/<user>/pretty-view-uploads/2026-07-20/HHmmss-test.txt
       uploaded 2026-07-20THH:mm:ss
    ```
    File BYTES are never inlined (the block is path-only-with-metadata). Grep the tmux tail for `--- attached files ---` — should be exactly one delimiter per attached-turn.

> **UPLOAD-10 contract:** *"Files land at `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>` under the receiving user's home directory; day-organized subfolders are created on demand; the receiving side does NOT auto-clean any uploads (agent or user deletes them when done)"*

- [ ] 🚨 **UPLOAD-10 landing path** SSH to the receiving box: `ssh thenasty "ls -la ~/pretty-view-uploads/$(date +%Y-%m-%d)/"`. Verify a file named `<hhmmss>-test.txt` exists (e.g. `120347-test.txt`). `cat` it — content matches what you originally created. Verify the day directory `2026-07-20/` was created on demand (was not there before this UAT). Verify no auto-cleanup — file will still be there tomorrow / next week / until you `rm` it.

---

## Clipboard paste (UPLOAD-02)

> **UPLOAD-02 contract:** *"Clipboard paste into the compose area — screenshots, images, or any file-shaped clipboard payload — stages that payload as an attachment through the same landing path as drag-and-drop"*

- [ ] 🚨 **UPLOAD-02 screenshot paste** Copy a screenshot to your clipboard (Cmd+Shift+4 → space → click a window, or use a screenshot tool that copies to clipboard). Click into the compose textarea. Paste (Cmd/Ctrl+V). The screenshot stages as a chip through the SAME landing path (chip appears in the strip, upload flows, lands in `~/pretty-view-uploads/<date>/` with an image mimetype like `image/png` in the injected metadata block).
- [ ] **UPLOAD-02 plain text still normal** Copy plain text (any random paragraph) and paste into the compose textarea. Verify the text just inserts into the textarea normally — no chip staged. Only file-shaped clipboard payloads trigger staging.

---

## Failure recovery + retry (UPLOAD-06 negative-space, UPLOAD-07)

> **UPLOAD-07 contract:** *"When the pane's SSH channel is down at send time, attachments + caption queue locally alongside the draft and send when the connection returns; when transfer fails mid-flight, retry is available without re-attaching"*

- [ ] **UPLOAD-06 chip-red on failure** Stage `test.txt`. Open DevTools Network tab. Set throttling to Offline. Click Send. Verify the chip transitions to an error state (red border, AlertCircle icon, error message text like `network_error` or similar). Verify no message appears in the pretty-view stream (atomicity per UPLOAD-06).
- [ ] **UPLOAD-06 message stays in staging** After the error surfaces, the chip is STILL in the strip (not cleared). The caption text is STILL in the textarea (not cleared).
- [ ] **UPLOAD-07 retry without re-attaching** Set DevTools throttling back to Online. Click the **Retry** button that appears above the chip strip (small variant=outline size=xs, only visible when at least one chip has status=error). Verify the batch re-uploads and completes successfully. You did NOT need to re-drag `test.txt`.
- [ ] **UPLOAD-07 queue-on-disconnect** Optional/harder to reproduce: with a staged batch, close the SSH pane's underlying WS (kill the terminal via `.docker kill skynet` — DON'T actually do this during a deploy window; use only if you're deliberately regression-testing this later). The staged batch parks in `pendingSendWaitingForWs=true`. When the WS reconnects, the batch fires. If this is hard to reproduce in production, it's fine to mark N/A — Test 10 in `use-pretty-view-uploads.test.ts` covers this in the unit suite.

---

## Draft persistence asymmetry (UPLOAD-08)

> **UPLOAD-08 contract:** *"Caption text inherits the existing message-queue-draft persistence model (patch #49) and survives tab close and reload; attachment bytes do NOT persist across tab close (user re-drags from the file still on their desktop) — no client-side blob storage"*

- [ ] 🚨 **UPLOAD-08 caption persists** Type a caption in the compose textarea (do NOT attach anything). Close the tab. Reopen the pane at https://term.gigaashley.click. Verify the caption text is restored (patch #57 compose-drafts machinery — this is the same behavior you already had pre-Phase-05).
- [ ] 🚨 **UPLOAD-08 asymmetry — attachment bytes do NOT persist** Type a caption AND attach a file (stage a chip). Close the tab. Reopen the pane. Verify:
    - Caption text IS restored ✓
    - Chip strip is EMPTY (attachment bytes are React-only by design — no localStorage, no IndexedDB, no sessionStorage of file bytes) ✓
    - You must re-drag the file from your desktop (where it still lives) to re-stage

---

## Folder rejection (UPLOAD-12)

> **UPLOAD-12 contract:** *"Attempting to drop a folder is refused with an in-surface nudge ('please attach files or zip first') and no attachments are staged; recursive folder uploads never happen"*

- [ ] 🚨 **UPLOAD-12 folder refused with nudge** Try to drag a FOLDER from your Desktop onto the pretty-view surface (e.g. drag your `Downloads/` folder or any folder icon). Verify:
    - The nudge `please attach files or zip first` appears momentarily (~3s) with an amber tint + AlertTriangle icon
    - NO attachments are staged (chip strip stays empty)
    - The recursive folder upload never happens
- [ ] 🚨 **UPLOAD-12 no landing** SSH to the receiving box: `ls ~/pretty-view-uploads/$(date +%Y-%m-%d)/`. Verify none of the folder's contents are present — no folder-derived files.

---

## Mobile paperclip (UPLOAD-03) — requires touch device

> **UPLOAD-03 contract:** *"On touch devices only (gated by the same `useIsTouchDevice` signal that gates the mobile bottom nav), a paperclip button appears in the compose area and opens the native file picker on tap; desktop never renders the paperclip"*

**Ashley:** this section requires a touch device (phone / tablet). If you don't have one handy, skip and mark N/A. The Vitest suite covers the gate logic (10/10 ComposeBox tests including the showPaperclip prop branches).

- [ ] 🚨 **UPLOAD-03 paperclip on touch** On a touchscreen device (any width), open a pretty-view pane. Verify a paperclip button appears in the compose area's icon column (TOP of the column, above ThumbsUp — least-used-first convention). Tap it → native file picker opens. Select a file → stages as a chip. Send flow works identically to desktop.
- [ ] 🚨 **UPLOAD-03 desktop negative-space** On desktop (any window width, including narrow), verify the paperclip button is NOT rendered. In DevTools console: `matchMedia("(pointer: coarse) and (hover: none)").matches` should return `false` on desktop, and there is NO paperclip. Resize the browser narrow (mobile-width simulation) — paperclip STILL absent on desktop (patch #102's `useIsTouchDevice` is pointer-based, not width-based — this is the fix from patch #102).

---

## Works-on-any-pane (UPLOAD-14)

> **UPLOAD-14 contract:** *"The feature works on any pretty-view pane whose receiving-box shell can write to the user's home — including plain-shell panes as well as Claude Code panes; the injected metadata block is human-readable so a shell user can `cat`/`less` the file at the given path just as readily as an agent can `@`-reference it"*

- [ ] 🚨 **UPLOAD-14 plain-shell pane** Test on a plain shell pane (not Claude Code — any host with a plain tmux session running just `bash` will do). Attach a file, send. Verify:
    - File lands in `~/pretty-view-uploads/<date>/` on that box ✓
    - Injected message appears in the tail as HUMAN-READABLE text (caption + delimiter + metadata block) ✓
    - You could `cat` the landing path from that shell and see the file content ✓
- [ ] **UPLOAD-14 Claude Code pane comparison** Test on a Claude Code pane too. Same behavior — file lands, injected turn arrives, agent can `@`-reference the landing path.

---

## Regression smoke — pre-existing patches must still work

- [ ] 🚨 **Message queue drawer (patch #60 atomic delete-on-send).** Open drawer with `Ctrl+Shift+;`. Type a message, hit Send. Verify: message lands in the terminal; drawer row disappears in the same tick (no ghost row); refresh the page — the sent message is NOT back in the drawer. The patch #60 marker `message_queue_delete_on_send` is grep-verified in the dist bundle.
- [ ] 🚨 **Split-and-delay Enter (patch #100).** Send a message via the pretty-view compose (no attachments). Verify text arrives in Claude Code + Enter fires as separate keystrokes — Claude Code REPL treats it as typed input, not paste. If Claude ever treats a pretty-view submit as a paste blob (character-count-in-status-bar or bracketed-paste indicator), that's a patch #100 regression. The marker `ssh_input_delayed_enter` is grep-verified in dist.
- [ ] 🚨 **Compose-drafts persistence (patch #57).** Type in the compose textarea, close the tab, reopen the pane. Text is restored. `/compose-drafts` endpoint is grep-verified in dist (2 call sites — GET + PUT via fetch keepalive).
- [ ] 🚨 **useIsTouchDevice (patch #102).** Mobile bottom nav appears on touchscreens (any width), absent on desktop (any width, including narrow). Same signal drives the Phase 5 mobile paperclip. `pointer: coarse` matchMedia string is grep-verified in dist.
- [ ] 🚨 **Terminal / RDP / VNC / file manager / dashboard / sidebar / tab bar / AppRail.** All render + behave normally. Open at least one RDP tab (e.g. `workstation-RDP`) and one file-manager surface — verify no unexpected changes. Terminal xterm still works (send input, see output). Sidebar still expands/collapses.
- [ ] 🚨 **Identity badge on pretty-view.** Still visible with the same treatment (Phase 4 Glass — patches #17, #38, #86 and Phase 4 all intact). Large avatar (~56px), name + title stacked, subtle breathing brightness animation.
- [ ] 🚨 **3D orb WIP indicator** (whatever the current WipBubble is): still renders — Phase 5 does not touch WipBubble.
- [ ] 🚨 **Backgrounded-agents panel (patch #61)** if any pane is running background agents: still renders above ComposeBox, below HarnessTasksPanel.
- [ ] 🚨 **Session-holding overlay + jump pill** (patches #103 and Phase 4 machinery): jump pill still hides when a user message anchors scroll (patch #103's fix from 2026-07-20).

---

## Post-sign-off actions

Once all 🚨 items pass and you've disarmed the deadman:

1. **Pin the patch.** Paste the content of `05-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` at the appropriate ordinal position (currently patch #104 — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3`).
2. **Bump the count.** Update the "ONE HUNDRED THREE numbered patches" line near the top of `skynet-patches.md` to "ONE HUNDRED FOUR" (or the actual new count).
3. **Commit the pin.** Standard conventional-commit style.
4. **Close the bounty.** `~/.claude/identities/tina/bounties/pretty-view-file-upload-support/` via `/close pretty-view-file-upload-support`.
