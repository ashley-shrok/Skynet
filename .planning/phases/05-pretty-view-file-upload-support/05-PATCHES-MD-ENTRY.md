# Draft entry for `~/.claude/identities/tina/skynet-patches.md`

**Patch number placeholder:** `NNN.` — Ashley fills in at pin time. Current top is patch #103 (jump-pill scroll fix, 2026-07-20), so this will most likely be **patch #104** unless something else lands between now and Phase 5 deploy.

**Deploy date placeholder:** `2026-MM-DD` — fill in with the actual deploy date at pin time.

**At pin time:**
1. Assign patch number (check `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3` for the current top).
2. Paste the entry below (with number + date filled in) into `~/.claude/identities/tina/skynet-patches.md` at the appropriate ordinal position (after patch #103).
3. Bump the "ONE HUNDRED THREE numbered patches" count near the top of that file to the new count (e.g. "ONE HUNDRED FOUR").
4. Commit the pin.

Formatted to match patch #60's canonical multi-file entry style (motivation → root cause → fix → files touched → rebase risk → verify-post-deploy invariants → deploy note).

---

```
   NNN. `feat(pretty-view): file upload support — drag/drop/paste/mobile
       paperclip, atomic transfer, path-only injection` — Phase 5,
       shipped 2026-MM-DD. Eight-commit landing across three code-side
       plans (05-01 backend orchestrator + wire protocol; 05-02
       frontend hook + chip strip + drop overlay + ComposeBox
       wiring; 05-03 Terminal.tsx wiring + ChatMessage sender-side
       chip render). Adds a cognitively-free "attach a file" affordance
       to pretty view. Drag-and-drop anywhere on the pretty-view
       surface, clipboard paste, and (mobile only, gated by patch
       #102 `useIsTouchDevice`) a paperclip button. Files transfer
       atomically over the EXISTING per-pane SSH WebSocket to
       `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<name>` on the
       receiving box, then an injected user turn carries path-only-
       with-metadata (never inlined bytes) — a 100MB attachment costs
       zero session context until the agent chooses to read it.

       * **Motivation** (from bounty + Phase 5 shape + CONTEXT.md).
         Moving a file to an agent used to require per-box transfer
         paths — different for each box, none convenient, always
         broke the flow of talking. The paperclip should feel
         cognitively free: never think "which box, which path, will
         this eat context, will it work next reboot." Path-only
         injection with atomic transfer collapses those questions.
         See `~/.claude/identities/tina/bounties/pretty-view-file-
         upload-support/` for the framing.

       * **Transport — the existing terminal WS, zero new endpoints.**
         Every pretty-view pane already has an authenticated SSH
         connection to the receiving box (the same connection carrying
         send/receive today). Uploads ride that channel; no new WS,
         no new HTTP endpoint, no nginx changes. Three new client→
         server message types on the existing `/ssh/websocket/`:
         - `upload_start`: batch metadata + per-file
           `{tempId, filename, size, mimetype}`. Batch keyed on
           patch #60's `messageQueueItemId` (`crypto.randomUUID`),
           so the injected user turn inherits patch #60's lifecycle
           key and rides the existing atomic delete-on-send path.
         - `upload_chunk`: `{tempId, offset, base64 bytes}`,
           64KB per chunk, sequential per file, up to 3 files in
           parallel per batch.
         - `upload_abort`: `{tempId?}` — omit tempId to abort the
           whole batch; include it to abort a single file.
         Plus four server→client event types emitted by the backend
         orchestrator: `upload_progress`, `upload_complete`,
         `upload_failed`, `upload_ready_to_inject`.

       * **Atomic transfer via extended patch #60 lifecycle.** The
         injected user turn (fired ONLY after ALL files have
         `upload_complete`) rides the SAME `case "input"` handler
         patch #60 established, carrying the same
         `messageQueueItemId` on its second WS event — automatically
         inheriting split-and-delay Enter (patch #100) and atomic
         delete-on-send (patch #60) for free. No parallel send path,
         no new sendInput variant, no shape drift from the existing
         MessageQueueDrawer send. Terminal.tsx's new
         `handleInjectedTurnReady` useCallback (line 2827-2851) is
         byte-for-byte the same two-event split-send that
         MessageQueueDrawer already uses inline (sha256-pinned in
         `src/ui/features/terminal/Terminal.wiring.test.ts` for
         future regression detection).

       * **Landing convention.** `$HOME/pretty-view-uploads/
         <yyyy-mm-dd>/<hhmmss>-<sanitized-filename>` under the
         receiving user's home. **HOME resolved once per batch via
         `sftp.realpath('.')`, NEVER hardcoded `/home/<user>/`
         concat** — 05-CONTEXT.md HARD LOCK, verified by grepping
         `/home/` in `src/backend/ssh/pretty-view-upload.ts`
         returning zero hits outside test fixtures. Day subdir
         created on demand via `sftp.mkdir({recursive: true})`
         wrapper. Filename collisions suffixed `-2`, `-3`, ... up
         to 10 attempts (`log.txt` → `log-2.txt`) before emitting
         `collision_max_retries`. Write goes to a temp file at
         `.<hhmmss>-<name>.<8-char-random-hex>.partial` with
         `createWriteStream({flags: 'wx'})` (fail-if-exists → no
         symlink write); rename-on-complete gives atomicity at the
         FS layer. **No auto-cleanup, ever** — uploads persist
         until the agent or user deletes them (UPLOAD-10 lock).

       * **Injected metadata block.** After the caption text:
         ```
         --- attached files ---
         1. {filename} ({human size}, {mimetype}) → {landing path}
            uploaded {box-local ISO timestamp}
         2. ...
         ```
         Delimiter is LOCKED at `--- attached files ---` —
         `sanitizeFilenameForUpload` rejects any filename containing
         that substring OR any newline-then-`--- ` sequence
         (delimiter-collision defense, `delimiter_collision`
         failure reason). Human-legible at a shell (`cat`/`less`),
         trivially machine-parseable (agent `@`-references the
         landing path). Source machine NOT included per shape's
         lock ("the injected turn is the receiver's context, not
         the sender's story").

       * **Parser hardening (T-05-09 + T-05-11 mitigations).**
         `parseInjectedUserTurn` in the shared wire-protocol module
         gates on three conditions before returning non-null:
         (1) input ≤ 1MB (`PARSE_MAX_INPUT_BYTES` = DoS bound —
         a legitimate injected turn with 32 files at reasonable
         name+path lengths is well under 100KB), (2) every
         (header, indented-timestamp) tuple validates strictly (no
         `continue` fallthrough), (3) at least one valid file line
         must be present (a user typing the delimiter substring in
         chatty prose does NOT get re-rendered as an empty chip
         strip). Round-trip contract locked with
         `formatInjectedUserTurn` — 37/37 protocol tests pass
         including 6 parser edge-case tests.

       * **Threat model addressed at ingress** (six blocking threats
         mitigated at upload_start / upload_chunk, tested against a
         mock SFTP + mock WS in `src/backend/ssh/pretty-view-
         upload.test.ts` — 13/13 orchestrator tests pass). T-05-01
         (path traversal): filename sanitization strips `/`, `\`,
         and rejects null bytes, `.`/`..`, leading-dot, paths >200
         chars, and newlines. T-05-02 (symlink write): SFTP write
         uses `flags: 'wx'` (no symlink follow) plus a random-hex-8
         suffix on the temp path (belt-and-suspenders against pre-
         planted symlinks on the predictable prefix). T-05-03
         (disk-fill): 500MB per-file and 2GB per-batch limits
         enforced at upload_start BEFORE any bytes flow; size
         overflow during chunking tears down + unlinks the temp
         file. T-05-05 (delimiter collision): blocked at upload_
         start with `delimiter_collision` reason. T-05-07 (unauth
         upload): silent no-op when `sshConn` is null; zero WS
         events emitted. T-05-08 (chunk out-of-order): temp file
         unlinked with `chunk_out_of_order` reason. Attacker who
         owns the browser session can only upload up to their
         SSH-authenticated write capacity on the receiving box
         (same trust boundary that already exists for any
         pretty-view send).

       * **Frontend UX — a single hook orchestrates staging + chunk
         pump + WS event handling.** `usePrettyViewUploads` in
         `src/ui/features/pretty-view/use-pretty-view-uploads.ts`
         owns staged-attachment state (React-only refs — grep for
         `localStorage|sessionStorage|indexedDB` returns zero hits,
         locking in UPLOAD-08 asymmetry), the chunk pump gated by
         `MAX_CONCURRENT_UPLOADS_PER_BATCH=3` semaphore,
         backpressure via caller-provided `getBufferedAmount()`
         (4MB high water, 1MB low water, ~3s hard timeout), and
         the retry API (fresh `messageQueueItemId` per retry by
         default, matching backend's no-`upload_reset` assumption).
         Drop-overlay on the whole pretty-view surface (patch #74
         verified `data-pv-root` positioning still works with
         `absolute inset-0` children). Chip strip mounts above the
         compose textarea ONLY when at least one attachment is
         staged (no empty chrome — UPLOAD-04 lock). Per-chip
         progress ring driven by `upload_progress` events; × control
         to remove; failure → chip turns red, message stays in
         staging, Retry button appears above the strip when any
         chip has status='error'. Folder drops refused with an in-
         surface amber-tinted nudge "please attach files or zip
         first" via `DataTransferItemList.webkitGetAsEntry()` (all-
         or-nothing rejection per UPLOAD-12); recursive uploads
         never happen. Mobile paperclip gated on `useIsTouchDevice`
         from patch #102 (one-line consumer — no touch re-detection).

       * **Caption + attachment persistence asymmetry** (UPLOAD-08
         HARD LOCK). Caption text inherits patch #57's
         compose-drafts persistence — survives tab close, restored
         on reload. Attachment bytes DO NOT persist — user re-drags
         the file from their desktop (where it still lives). No
         localStorage / IndexedDB / sessionStorage of file bytes;
         staging state is React-only. Rationale: raw file bytes
         client-side is a footgun (storage limits, memory bloat,
         security surface). Verified by grepping the hook module
         for browser-storage primitives (zero hits) and by the
         hook's own Test 3 (remove-during-upload emits abort).

       * **Sender-side render** (UPLOAD-11). In the sender's own
         pretty-view stream, the just-sent user turn renders as a
         single bubble containing the caption text (whitespace-
         preserved so multi-line captions render correctly) and
         inline chips for each attachment (filename + size only,
         no thumbnails, consistent across mimetypes per shape
         lock). `ChatMessage` detects the injected format via
         `parseInjectedUserTurn` when `role === 'user'` (role gate
         + early-`indexOf` bail — zero perf cost for non-injected
         messages); non-matching content renders as plain markdown
         byte-identically to pre-patch behavior. The
         `AttachmentChipStrip` component gains a `readOnly` prop
         (same visual language as staging — no duplicated JSX)
         that suppresses × / progress / error decorations and
         renders a subdued sent-side tint reading correctly inside
         a user bubble.

       * **Works on any pane** (UPLOAD-14). Feature works on Claude
         Code panes AND plain shell panes — the receiving box only
         needs SSH + writable `$HOME`. No dependency on Claude Code
         running, no dependency on any identity being loaded. The
         injected metadata block is meaningful to a human at a
         shell (`cat`/`less` the landing path) as much as to an
         agent (`@`-reference the path).

       * **Verify post-deploy invariants** (for future rebase smoke
         checks):
         - `docker exec skynet grep -c 'case "upload_start":' /app/
           dist/backend/backend/ssh/terminal.js` should return 1
         - `docker exec skynet grep -c 'case "upload_chunk":' /app/
           dist/backend/backend/ssh/terminal.js` should return 1
         - `docker exec skynet grep -c 'case "upload_abort":' /app/
           dist/backend/backend/ssh/terminal.js` should return 1
         - `docker exec skynet ls /app/dist/backend/backend/ssh/
           pretty-view-upload.js` should exit 0 (module ships)
         - `docker exec skynet grep -c 'sanitizeFilenameForUpload\|
           handleUploadStart\|handleUploadChunk' /app/dist/backend/
           backend/ssh/pretty-view-upload.js` should return ≥ 3
           (orchestrator exports reachable)
         - `docker exec skynet grep -c 'message_queue_delete_on_
           send' /app/dist/backend/backend/ssh/terminal.js` should
           return ≥ 1 (patch #60 preserved — atomic delete-on-send
           byte still there)
         - `docker exec skynet grep -c 'ssh_input_delayed_enter' /
           app/dist/backend/backend/ssh/terminal.js` should return
           ≥ 1 (patch #100 preserved — split-and-delay Enter byte
           still there)
         - `docker exec skynet grep -c '\-\-\- attached files \-\-\-'
           /app/dist/assets/*.js` should return ≥ 1 (INJECTED_
           DELIMITER constant survived Vite tree-shake)
         - `docker exec skynet grep -c 'webkitGetAsEntry' /app/dist/
           assets/*.js` should return ≥ 1 (folder-detection code
           shipped)
         - `docker exec skynet grep -c 'Drop files here' /app/dist/
           assets/*.js` should return ≥ 1 (DropOverlay visible-text
           shipped)
         - `docker exec skynet grep -c '/compose-drafts' /app/dist/
           assets/*.js` should return ≥ 1 (patch #57 compose-drafts
           persistence still wired — function names are mangled
           by Terser, so the correct post-tree-shake gate is the
           URL literal, not `putComposeDraft`)
         - `docker exec skynet grep -c 'pointer: coarse' /app/dist/
           assets/*.js` should return ≥ 1 (patch #102 useIsTouchDevice
           matchMedia query still there)

       * **Files touched** (from Plans 01-03 SUMMARY files; 8 commits
         total on branch `feat/tab-title-from-tmux`):
         - `src/backend/ssh/terminal.ts` — three new `case` blocks
           (upload_start / upload_chunk / upload_abort) + one import
           line + one `ownedUploadBatches: Set<string>` declaration
           in WS scope + close-handler `cleanupBatchesForConnection`
           call. `case "input":` UNCHANGED byte-for-byte (117 lines,
           sha256=d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252
           cf5127db17d47709) — verified by `scripts/verify-input-
           case-unchanged.sh` and enforced as a pre-commit
           regression guard.
         - `src/backend/ssh/pretty-view-upload.ts` — NEW module,
           ~500 lines. Orchestrator: handleUploadStart /
           handleUploadChunk / handleUploadAbort / cleanupBatches
           ForConnection / emitEvent public API; internal Promise
           wrappers around ssh2's SFTP callback API; per-batch
           state map; temp-file naming with random-hex-8 suffix;
           collision loop up to 10 retries; progress throttling
           to ≤1 event/100ms per tempId; test-injectable clock
           for deterministic timestamped-path unit tests.
         - `src/ui/api/pretty-view-upload-protocol.ts` — NEW
           module, ~370 lines. Shared TS types (UploadStart/Chunk/
           Abort payloads; UploadProgress/Complete/Failed/
           ReadyToInject events; UploadFailureReason enum),
           constants (MAX_PER_FILE_BYTES=500MB,
           MAX_PER_BATCH_BYTES=2GB, CHUNK_SIZE_BYTES=64KB,
           MAX_CONCURRENT_UPLOADS_PER_BATCH=3, INJECTED_DELIMITER,
           PARSE_MAX_INPUT_BYTES=1MB), sanitizeFilenameForUpload +
           classifyFilenameRejection, formatHumanSize,
           formatInjectedUserTurn, parseInjectedUserTurn (with
           T-05-09 + T-05-11 hardening). Consumed by both browser
           (Plans 02/03 client code) and Node (Plan 01 backend
           orchestrator) via one relative import path.
         - `src/ui/features/pretty-view/use-pretty-view-uploads.ts`
           — NEW, ~630 lines. Orchestrator hook (staging state +
           chunk pump + WS event handling + folder rejection +
           WS-disconnect resume + retry).
         - `src/ui/features/pretty-view/AttachmentChipStrip.tsx` —
           NEW, ~215 lines (includes readOnly branching added in
           Plan 03). Used both in ComposeBox for staging AND in
           ChatMessage in readOnly mode for sender-side render.
         - `src/ui/features/pretty-view/DropOverlay.tsx` — NEW,
           ~100 lines. Full-surface drop overlay + folder-nudge
           variants; pointer-events-none on both.
         - `src/ui/features/pretty-view/ComposeBox.tsx` — chip
           strip mount + paperclip button (gated on showPaperclip)
           + hidden file input + onPaste handler +
           onSendWithAttachments callback branch + Retry button
           + sendDisabled reworked to allow empty caption with
           attachments. Existing textarea + meter well + icon
           column + queue-armed overlay UNCHANGED. Patch #57 draft
           persistence machinery 100% intact.
         - `src/ui/features/pretty-view/PrettyView.tsx` — drop-
           overlay mount + drag/drop event handlers on
           data-pv-root + usePrettyViewUploads consumption +
           useIsTouchDevice consumption + 6 new prop pass-throughs
           to ComposeBox + 2 new optional props (terminalWs,
           onInjectedTurnReady). Drag counter pattern debounces
           child-boundary misfires.
         - `src/ui/features/pretty-view/ChatMessage.tsx` — sender-
           side chip render branch when parseInjectedUserTurn
           matches AND role='user' (defense-in-depth role gate);
           non-matching content renders unchanged. isQuickReply
           short-circuit updated to also require `!injected` so
           quick-reply and injected are mutually exclusive.
         - `src/ui/features/terminal/Terminal.tsx` — new
           `handleInjectedTurnReady` useCallback (line 2827-2851;
           two-event split-send matching MessageQueueDrawer's inline
           pattern byte-for-byte, sha256-pinned in wiring test) +
           two new JSX attributes on the PrettyView mount
           (`terminalWs={webSocketRef.current}` and
           `onInjectedTurnReady={handleInjectedTurnReady}`).
           Existing PrettyView onSend and MessageQueueDrawer
           onSend UNCHANGED byte-for-byte (both sha256-pinned in
           `src/ui/features/terminal/Terminal.wiring.test.ts`:
           `264385b1...` for PrettyView onSend, `46dbc0d8...` for
           MessageQueueDrawer onSend).

         Test suite adds: 43 protocol tests (Plan 01, ~30 protocol
         + 13 orchestrator) + 34 frontend tests (Plan 02, 14 hook +
         7 chip strip + 5 drop overlay + 10 ComposeBox + 3
         PrettyView, minus 5 accounting delta) + 25 wiring/parser/
         chip-readOnly/ChatMessage tests (Plan 03). Grand total
         after Phase 5: 409/409 tests pass across 35 files (was
         345 pre-Phase-5).

       * **Rebase risk**: MEDIUM on `terminal.ts` (`case "input":`
         neighborhood — patches #13/#24/#33/#51/#60/#100 all live
         here; the three new upload cases go IMMEDIATELY after the
         input case and BEFORE `case "ping":`; if upstream
         restructures the input handler, resolve by preserving all
         patch #60 + #100 behavior first, running
         `scripts/verify-input-case-unchanged.sh` to confirm, then
         re-inserting the upload cases at the same position).
         LOW-MEDIUM on `Terminal.tsx` (busiest file on the branch
         — patches 1/3/6/13/17/24/26/28/33/39/40/41/44/50/51/52/60
         all touch it; this patch added a useCallback around line
         2827 and two JSX attrs at line 2886-2905, localized in the
         PrettyView mount region; the pre-existing PrettyView onSend
         + MessageQueueDrawer onSend byte-identity is sha256-pinned
         in `Terminal.wiring.test.ts` so any accidental drift on
         rebase trips a test). LOW on all new files (fork-only, no
         upstream conflict surface — `pretty-view-upload.ts`,
         `use-pretty-view-uploads.ts`, `AttachmentChipStrip.tsx`,
         `DropOverlay.tsx`, `pretty-view-upload-protocol.ts`).
         LOW on `ComposeBox.tsx` + `PrettyView.tsx` + `ChatMessage.tsx`
         (all fork-only files — pretty-view didn't exist upstream).

       * **Deploy note**: shipped behind the mandatory 15-min
         deadman per Ashley 2026-07-03 with explicit per-deploy
         green light per Ashley 2026-07-12. Zero new npm
         dependencies (ssh2 SFTP subsystem already in dep tree
         from file-manager routes). Zero new nginx location blocks
         (rides existing `/ssh/websocket/` — no new backend HTTP
         or WS route was added, so the fork's "location block on
         both nginx configs" trap does NOT apply here). Standard
         `sudo bash /opt/skynet/skynet-patches/build-skynet.sh` +
         `sudo docker compose up -d --force-recreate skynet`
         inside the arm-deadman → deploy → wait-for-Ashley →
         disarm-or-fire flow documented in `~/.claude/identities/
         tina/deploy-runbook.md`. UAT walkthrough for post-deploy
         verification: `.planning/phases/05-pretty-view-file-
         upload-support/05-UAT-CHECKLIST.md`.

       Related bounty: `~/.claude/identities/tina/bounties/pretty-
       view-file-upload-support/` — close via `/close pretty-view-
       file-upload-support` after successful UAT.
```
