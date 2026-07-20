# Phase 5: Pretty view file upload support — Context

**Gathered:** 2026-07-20
**Status:** Ready for planning
**Source:** Synthesized from shape file `.planning/shapes/shape-pretty-view-file-upload-support.md` — that file is authoritative and every philosophical question was locked during a long `/open` discussion with Ashley on 2026-07-20 (see the shape's session log for provenance). This CONTEXT.md restates the shape as locked planning decisions plus the concrete termix-fork integration points. **The shape is not to be re-litigated; the planner's job is HOW, not WHAT.**

<domain>
## Phase Boundary

This phase adds a "cognitively-free" file-attachment affordance to pretty view without disturbing any other Termix surface. Scope:

1. **Frontend (pretty-view compose surface only).** Drop overlay, chip strip staging component, per-chip progress indicators, clipboard-paste handling, mobile-only paperclip button, sender-side chip rendering in the just-sent message bubble.
2. **Backend upload path over the EXISTING per-pane SSH channel.** No new WebSocket, no new HTTP endpoint. Files travel down the same channel that already carries `TerminalHandle.sendInput()` from patch #40 / #60 / #100; the wire-protocol addition is a distinct message type for upload chunks + progress ACKs, layered onto the existing WS.
3. **Receiving-side landing convention.** Backend service on Termix EC2 orchestrates writing bytes to `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>` on the receiving box via SSH (SFTP or `cat > file` — planner's call, see decisions below). The receiving user is whoever the SSH channel is authenticated as — no assumption about identity loading on the box.
4. **Injected user turn.** Once all files land, an injected message (caption + per-file metadata block) is sent through the SAME split-send path patch #100 fixed — inheriting Enter-drop reliability for free.

Phase 5 does NOT touch: terminal tab bar, RDP/VNC panes, message queue drawer chrome, session-file tail / WS bridge, identity registry, host records, Filestash, Caddy. If the planner surfaces tasks in those areas, that is a scope violation — file transfer rides existing infrastructure, does not build new.

</domain>

<decisions>
## Implementation Decisions

All items below are **LOCKED** by the shape file — do NOT re-open them during planning. Where the shape used "Claude's Discretion" the planner still has room; those cases are flagged explicitly.

### Attachment entry points (UPLOAD-01, UPLOAD-02, UPLOAD-03)
- **Drag-and-drop is the PRIMARY affordance on desktop.** A drag entering the pretty-view surface (whole PrettyView container, not just the compose area) shows a full-surface overlay ("drop files here"). Drop anywhere in the surface stages the files as attachments.
- **Clipboard paste into the compose textarea is first-class.** A screenshot / image / file-shaped clipboard payload pasted into the compose textarea stages that payload as an attachment. Text pastes behave normally (existing behavior).
- **Mobile paperclip button — gated on `useIsTouchDevice` from patch #102.** The paperclip appears ONLY when `useIsTouchDevice()` returns true (touchscreens: coarse pointer + no hover). Desktop — regardless of window width — never sees the paperclip. Tap opens native file picker. This is a one-line consequence of the hook that already shipped; do NOT re-detect touch, do NOT gate on window width.

### Chip strip staging (UPLOAD-04)
- Attachments render as a chip strip in the compose area ABOVE the textarea. Each chip: original filename + human-readable size + × control to remove that attachment before send.
- The strip is present ONLY when at least one attachment is staged. No empty-strip chrome on desktop when nothing is attached.
- Attachments never send on their own — they always ride a message you're composing. Empty caption is fine (send with attachments only).

### Atomic transfer semantics (UPLOAD-06, UPLOAD-07)
- **HARD LOCK from shape.** The injected user turn does NOT go until every attachment has successfully landed on the receiving box. This is non-negotiable — the agent should never see a message referencing a file that isn't there.
- On mid-transfer failure: chips turn red, message stays in staging, user retries. Do NOT auto-retry silently — the user chooses when to reattempt.
- On SSH-channel-down at send time: attachments + caption queue locally; send when connection returns. Caption inherits patch #49 draft persistence; attachments do NOT persist across tab close (per UPLOAD-08).

### Per-chip progress (UPLOAD-05)
- **Preferred:** each chip shows its own progress indicator (bytes uploaded / total, or a ring).
- **Acceptable fallback:** if per-chip proves fiddly (e.g., aggregating multiple parallel uploads), a single aggregate progress indicator across the batch is fine.
- Planner picks the wire-protocol shape for progress events (see Wire protocol below).

### Landing convention (UPLOAD-10)
- Files land at `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>` under the receiving user's home directory.
- `<yyyy-mm-dd>` and `<hhmmss>` are UTC or box-local — Claude's Discretion (box-local is more human-legible; UTC avoids DST surprises; pick one and stay consistent). Recommend box-local per user-legibility.
- Subdirectories are created on demand (`mkdir -p ~/pretty-view-uploads/<date>/`).
- Collisions on same-second filename+size are unlikely (timestamp + original name); if they happen, second file gets `-2`, `-3` suffix. Planner picks the specific collision-suffix format.
- **No auto-cleanup, ever.** Uploads persist until the agent or the user deletes them. No sweep policy in this phase (deferred; see shape's "Deferred — revisit if the itch surfaces").

### Path-only injection (UPLOAD-09) — HARD LOCK from shape
- The injected user turn contains: (a) the caption text, (b) a compact metadata block per file with `filename`, `size`, `mimetype`, `upload_timestamp`, `landing_path`.
- **File BYTES are NEVER inlined into the injected message.** A 100MB attachment costs zero session context until the agent chooses to read the file. Violating this rule (e.g., dumping a small text file inline "for convenience") defeats the entire feature's purpose per the shape's philosophy.
- Metadata block format is **Claude's Discretion for the planner** (prose-with-header, structured block, YAML fence, etc.). Constraints:
  - Must be human-legible so a shell user can `cat`/`less` the path (UPLOAD-14).
  - Must be trivially machine-parseable so an agent can `@`-reference the path without ambiguity.
  - Must be visually distinct from the caption text so an agent doesn't confuse metadata with the user's actual request.
  - Recommend: a fenced block or short structured section after the caption with one line per file.

### Sender-side rendering (UPLOAD-11)
- In the sender's own pretty-view stream, the just-sent message renders as a SINGLE bubble containing the caption text and inline chips for each attachment (filename + size only).
- No thumbnails, no inline previews, even for images. Consistent across all mimetypes. Rationale from shape: chip-only keeps visual noise minimal and the pattern consistent; the agent can render the image itself if the user asks.
- Chip rendering in the message stream should feel visually consistent with patch #86's inline image render for tool_result blocks (same visual language, different code path).

### Folder drops refused (UPLOAD-12)
- Attempting to drop a folder is refused with an in-surface nudge ("please attach files or zip first"); no attachments are staged.
- Detection: `DataTransferItem.webkitGetAsEntry().isDirectory` OR `File.type === '' && File.size === 0` (browser dependent). Planner picks the detection method that covers Chrome/Firefox/Safari.
- Recursive folder uploads never happen — this is a HARD LOCK.

### Single caption per batch (UPLOAD-13)
- Multiple attachments in one send share a single caption input. No per-chip caption inputs.
- Empty caption is allowed (send with attachments only). Send button remains enabled when at least one attachment is staged, regardless of caption emptiness.

### Works on any pane (UPLOAD-14)
- Feature works on both Claude Code panes AND plain-shell panes. The receiving box only needs SSH + writable `~/pretty-view-uploads/` — no dependency on any identity being loaded, no dependency on Claude Code being running.
- The injected metadata block is meaningful to a human at a shell (cat/less the path) as much as to an agent (@-reference the path).

### Draft persistence asymmetry (UPLOAD-08) — matches patch #49's model
- Caption text SURVIVES tab close via the existing draft-persistence model (patch #49). If the user has a staged batch, types "here's the log", closes the tab, reopens: the caption is restored.
- Attachment bytes DO NOT survive tab close. User re-drags the file from their desktop (where it still lives). Rationale: storing raw file bytes client-side is a footgun (localStorage size limits, memory bloat, security surface for whatever bytes were being staged). The bytes are already on the user's machine; they can re-attach in one gesture.
- **Practical consequence for planner:** the attachment staging state is React-only (not persisted); the caption text uses the same persistence primitive as the message queue drawer's draft.

### Integration with patch #60 (atomic delete-on-send) — CRITICAL
- Patch #60 introduced `messageQueueItemId` in `src/backend/ssh/terminal.ts` — a per-message queue item id that keys the atomic delete-on-send. The pre-send upload phase should extend this SAME pattern rather than build a parallel one.
- Suggested extension shape (planner refines): each staged batch gets a `messageQueueItemId`; when send is triggered, backend orchestrates upload-then-inject as one atomic unit keyed on that id; success deletes the queue item (existing behavior); failure leaves the queue item + attachments intact for retry.
- **Do NOT build a separate upload queue with a separate id namespace.** Bind attachments + message + delete-on-send lifecycle to one logical unit via the existing id.

### Integration with patch #100 (split-and-delay Enter) — inherited free
- Attachment submits go through the same input handler in `src/backend/ssh/terminal.ts`. Patch #100's split-and-delay Enter path (50ms delayed `\r` write when payload has `messageQueueItemId`) applies AUTOMATICALLY to the injected user turn. Planner does NOT need to reimplement or re-wire this — just extend the payload shape so the injected metadata block flows through the same code path.

### `useIsTouchDevice` reuse (UPLOAD-03) — inherited free
- Use the exact same hook that gates the mobile bottom nav (patch #102). One import, one call, one conditional render on the paperclip. Do NOT re-detect touch, do NOT add a new hook.

### Wire protocol for upload chunks + progress (Claude's Discretion, with fences)
- The transport is the existing per-pane SSH WebSocket — do NOT open a new WS or HTTP endpoint. Add new message types on the existing WS.
- Recommended shape (planner refines):
  - `upload_start` (client → server): `{messageQueueItemId, files: [{tempId, filename, size, mimetype}]}`
  - `upload_chunk` (client → server): `{messageQueueItemId, tempId, offset, bytes (base64)}` — chunked so a 100MB file doesn't block the WS.
  - `upload_progress` (server → client): `{messageQueueItemId, tempId, bytes_received, total}` — for per-chip progress.
  - `upload_complete` (server → client): `{messageQueueItemId, tempId, landing_path}` — one per file as it finishes.
  - `upload_failed` (server → client): `{messageQueueItemId, tempId, error}` — chip turns red.
  - `upload_ready_to_inject` (server → client): `{messageQueueItemId}` — fires once ALL files in the batch have `upload_complete`; client THEN sends the injected user turn through the existing send path.
- Chunk size: 64KB is a reasonable default (WS frame overhead vs latency); planner confirms.
- Concurrency: files in a batch can upload in parallel (they don't depend on each other); each file's chunks are sequential.
- **Backpressure:** if the WS buffer is saturated, the client pauses reading from the file until drain. Do NOT queue all chunks eagerly in memory.

### Backend receiving path — SFTP vs `cat > file` (Claude's Discretion)
- Two viable shapes:
  - **(a) SFTP subsystem** over the existing SSH connection. Cleaner, atomic (rename-on-complete), well-supported. Requires the receiving box to have the SFTP subsystem enabled (all managed boxes do).
  - **(b) `cat > temp_file && mv temp_file final_path` via SSH exec.** Simpler wire, no SFTP dependency; slightly less clean (need explicit temp+rename). Works on any box with a shell.
- Planner picks (a) if the codebase already uses ssh2's SFTP client; picks (b) if it's exec-only. Filestash uses SFTP so the SFTP client should already be available in the dep tree.
- Either way: write to a temp filename first (`.<final>.partial` or similar), rename on complete. This is how atomicity manifests at the filesystem layer.

### Injected metadata block format (Claude's Discretion, with fences)
- Recommended shape for the injected user turn (planner refines):
  ```
  {caption text, possibly empty}

  --- attached files ---
  1. {filename} ({size}, {mimetype}) → {landing_path}
     uploaded {upload_timestamp}
  2. ...
  ```
- Delimiter choice (`--- attached files ---` vs a fenced block vs YAML frontmatter) is planner discretion. Constraints from shape:
  - Human-legible at a shell.
  - Machine-parseable (unambiguous separator between caption and metadata).
  - Visually distinct so an agent doesn't mistake metadata for the user's request.
- **Do NOT include the source machine** (which box the user was on). The shape locked this: only filename + size + mimetype + timestamp + landing path.

### Claude's Discretion (open items for the planner)
- **Chunk size** — 64KB default recommended, planner confirms.
- **Concurrent uploads per batch** — 3-5 parallel files is a reasonable default; planner picks.
- **Landing timestamp: box-local vs UTC** — recommend box-local for user legibility; planner picks and comments.
- **Filename collision suffix format** — `-2`, `-3` recommended; planner picks.
- **Drop overlay visual treatment** — atmospheric card overlay matching the Phase 4 Glass aesthetic (if Phase 4 has shipped by then; if not, match existing pretty-view idiom). Planner picks.
- **Progress indicator visual** — ring vs bar vs bytes-in-chip; planner picks.
- **Injected metadata block delimiter** — fenced block, `--- attached files ---`, YAML, planner picks per constraints above.
- **SFTP vs exec+cat** — planner picks based on existing dep tree.
- **Error copy for folder-drop refusal** — "please attach files or zip first" is the shape's recommended wording; planner can refine copy while preserving the nudge intent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (source of truth)
- `.planning/shapes/shape-pretty-view-file-upload-support.md` — the LOCKED shape from Ashley's `/open` discussion. Every decision in this CONTEXT.md traces back to this file. Read it first.

### Backend send path (atomic delete-on-send + split-and-delay Enter)
- `src/backend/ssh/terminal.ts` — the input handler patch #60 introduced `messageQueueItemId` and atomic delete-on-send in. Patch #100 added the split-and-delay Enter path here. The upload orchestration extends this handler; do NOT add a parallel one.
- `~/.claude/identities/tina/termix-patches.md` — see patch #60 and patch #100 entries for full rationale and code shape. (Not in the fork's git — lives in tina's identity dir; read before touching terminal.ts.)

### Touch device detection (mobile-only paperclip)
- `src/ui/hooks/use-is-touch-device.ts` — patch #102. Returns `true` on touch devices (coarse pointer, no hover). Reuse as-is.
- `src/ui/features/pretty-view/MobileBottomBar.tsx` (or wherever patch #102 gates the mobile bottom nav) — reference for how to consume the hook conditionally.

### Draft persistence (caption text)
- Patch #49's draft-persistence implementation in the message queue drawer — this is the model for how caption text survives a reload. Attachments explicitly do NOT inherit this. Read patch #49's implementation before wiring caption persistence.
- Look in `src/ui/features/pretty-view/MessageQueueDrawer.tsx` (or equivalent) for the existing draft-persistence primitive.

### Frontend pretty-view surface
- `src/ui/features/pretty-view/PrettyView.tsx` — top-level pretty-view container; drop overlay mounts here.
- `src/ui/features/pretty-view/ComposeBox.tsx` — compose textarea + send button; chip strip, paperclip button (mobile-only), paste handler mount here.
- `src/ui/features/pretty-view/ChatMessage.tsx` — sender-side chip rendering in the just-sent message bubble uses this component (or a sibling), matching patch #86's visual language for inline image renders.

### Fork operational context
- `~/.claude/identities/tina/deploy-runbook.md` — mandatory deadman + build + deploy + rollback flow. Ship path for Phase 5 patches. Standard fork build + force-recreate.
- `~/.claude/identities/tina/termix-patches.md` — 103-patch catalog. Read #49, #60, #86, #100, #102 entries before planning; those are the load-bearing analogs.

</canonical_refs>

<specifics>
## Specific Ideas

### Reference SSH transport in fork
- ssh2 npm client is already in the dep tree (used for the terminal WS backend AND for Filestash SFTP). SFTP subsystem is accessible via `ssh2.Client.sftp((err, sftp) => sftp.createWriteStream(path))`. This is the natural implementation for the receiving-side write.

### Reference chunked-upload analog
- No prior fork patch does chunked-upload over the terminal WS. Patch #43's session-file WS bridge tails a file (read); this is the write direction. The wire-protocol design is fresh work in this phase; the transport layer is not.

### Reference visual language for chips
- Patch #86 renders inline images in tool_result blocks. Chip rendering in the sender-side bubble should feel visually consistent — same border-radius, same subtle background — even though the code path differs. Read patch #86's component before designing the chip visual.

### Reference bubble treatment
- Sender-side "message with attachments" bubble is a ChatMessage variant. Match the existing user-bubble treatment (Phase 4's Glass reskin if shipped; existing brutalist if not). Chips sit INSIDE the bubble alongside the caption, not adjacent to it.

</specifics>

<deferred>
## Deferred Ideas

Explicitly out of scope for this phase (per shape's "Deferred — revisit if the itch surfaces"):

- **"Inline this" per-attachment toggle** — for cases where the user really does want a small text file dumped straight into context. Deferred; earn its way in later if the friction surfaces.
- **Agent → user download direction** — agent produces a file, user pulls it back to their local. Deferred; separate feature shape.
- **Drag-out from a chip in a received message** — save a file the agent produced to local. Deferred.
- **Sweep policy** for uploads older than N days. No auto-cleanup this phase; add later if disk usage becomes a real problem on any managed box.
- **Keyboard shortcut** to open the file picker on desktop. Trivial to add later if the itch surfaces; unlikely.
- **Rich thumbnail previews** for image attachments in the message-stream bubble. Chip-only is the visual lock for this phase.
- **Auto-inline for tiny text files** ("smart" mimetype behaviors). Every smart special case is another surprise in a feature that's supposed to be surprise-free.
- **Aggregate batch progress alongside per-chip** progress. Redundant.

</deferred>

<scope_fence>
## Scope Fence

Things the planner MUST NOT plan tasks for. If tasks appear in these areas, that's a scope violation caught at plan-check time:

- Any change to terminal tab bar, RDP/VNC panes, message queue drawer chrome, session-file tail / WS bridge, identity registry, host records, Filestash, Caddy.
- Any change to the SSH connection lifecycle or authentication (uploads ride the existing connection).
- Any new HTTP endpoint or new WebSocket (uploads ride the existing per-pane WS).
- Any implementation of "smart" attachment behaviors (auto-inline, thumbnails, per-file caption, agent-download-direction).
- Any auto-cleanup policy on the receiving side.
- Any client-side persistence of attachment BYTES across tab close (caption only).
- Any inclusion of the source machine in the injected metadata (only filename + size + mimetype + timestamp + landing path).
- Any UI surface for uploads other than the pretty-view compose area (no dashboard uploads, no host-records uploads, no Filestash integration).
- Any change to file uploads landing outside `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>` — no configurable landing paths in this phase.

</scope_fence>

---

*Phase: 05-pretty-view-file-upload-support*
*Context synthesized from shape file on 2026-07-20 by tina*
