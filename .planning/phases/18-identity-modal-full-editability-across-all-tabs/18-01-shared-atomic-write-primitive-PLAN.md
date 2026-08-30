---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
autonomous: true
requirements:
  - IDMEDIT-06
tags:
  - identity-modal
  - backend
  - atomic-write
  - sftp
  - security
  - phase-18

must_haves:
  truths:
    - "New backend export writeIdentityFile(conn, identityKey, contents) exists in identity-artifact-reader.ts; when called with conn === null it writes the LOCAL bind-mount root/identityKey/identityKey.md via tmp+rename; when called with a live SSHClientType it writes the remote $HOME/.claude/identities/identityKey/identityKey.md via SFTP tmp+rename."
    - "New backend export writeIdentityHistory(conn, identityKey, contents) exists with identical LOCAL and REMOTE branches, targeting history.md."
    - "New backend export writeIdentityHandoff(conn, identityKey, contents) exists with identical LOCAL and REMOTE branches, targeting handoff.md."
    - "A shared private helper writeMarkdownFileAtomic(conn, absPath, contents) is used by all three writers to keep the REMOTE-branch SFTP tmp+rename byte-shape identical across markdown writers — one code path, one audit surface per D-IDMEDIT-06."
    - "REMOTE branch uses SSH2 SFTPWrapper (from conn.sftp) — NOT execCommand — because execCommand in src/backend/ssh/tmux-helper.ts does not support stdin and cannot safely stream arbitrary markdown payloads through shell interpolation. SFTP delivers UTF-8 bytes as a first-class stream and matches the existing SFTP idiom in src/backend/ssh/file-manager-session.ts getSessionSftp and src/backend/ssh/host-transfer.ts."
    - "REMOTE tmp+rename shape: SFTP writes to targetPath.tmp via sftp.writeFile with mode 0o644, then SFTP renames tmp → target. Mid-write crash leaves the previous file on disk."
    - "REMOTE branch enforces IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000 UTF-8-byte cap on contents; oversized payloads throw before opening SFTP, matching the SPEAK_TEXT_MAX = 25000 pattern from src/backend/database/routes/voice.ts."
    - "REMOTE branch validates identityKey against IDENTITY_KEY_RE before path interpolation (second belt on top of the caller's server-side check — matches writeIdentityWakeupUpdate pattern at identity-artifact-reader.ts:727)."
    - "Three new WS write handlers in claude-session-server.ts — identity:update-identity-file, identity:update-history, identity:update-handoff — mirror the shape of the existing identity:update-wakeup handler at lines 2057-2153: typed guards on every input field, IDENTITY_KEY_RE.test(identityKey) validation before dispatch, hostId → useLocal branching via isLocalHostId, resolveHostById + connectOneShot for REMOTE branch with try/finally conn.end()."
    - "Each new handler emits a fresh-echo response after write — identity:identity-file-updated { markdown }, identity:history-updated { entries }, identity:handoff-updated { markdown } — by immediately re-reading the file via the existing readIdentityFile / readIdentityHistory / readIdentityHandoff on the same branch, so the client rehydrates from server-side truth per IDMEDIT-01/02/03 shape lock (server echoes the confirmed markdown back)."
    - "Invalid identityKey or payload emits an error response of the same event type with a truthful error string and empty payload — matches the update-wakeup handler's error-echo convention."
    - "New wire types in src/ui/api/claude-session-api.ts: IdentityUpdateIdentityFilePayload, IdentityIdentityFileUpdatedEvent, IdentityUpdateHistoryPayload, IdentityHistoryUpdatedEvent, IdentityUpdateHandoffPayload, IdentityHandoffUpdatedEvent — matching payload/event pair shape of IdentityUpdateWakeupPayload / IdentityWakeupUpdatedEvent."
  artifacts:
    - path: "src/backend/claude-session/identity-artifact-reader.ts"
      provides: "writeIdentityFile, writeIdentityHistory, writeIdentityHandoff, writeMarkdownFileAtomic (private helper), IDMEDIT_MAX_MARKDOWN_BYTES const"
      contains: "export async function writeIdentityFile"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "identity:update-identity-file, identity:update-history, identity:update-handoff WS handlers with matching *-updated echo events"
      contains: "identity:update-identity-file"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "wire types for markdown update payloads + updated events"
      contains: "IdentityUpdateIdentityFilePayload"
  key_links:
    - from: "src/ui/api/claude-session-api.ts"
      to: "src/backend/claude-session/claude-session-server.ts"
      via: "wire type contract — server accepts JSON matching client payload discriminator, emits JSON matching client event discriminator"
      pattern: "identity:update-identity-file|identity:update-history|identity:update-handoff"
    - from: "src/backend/claude-session/claude-session-server.ts"
      to: "src/backend/claude-session/identity-artifact-reader.ts"
      via: "handler imports + calls writeIdentityFile / writeIdentityHistory / writeIdentityHandoff, then re-reads for echo"
      pattern: "writeIdentityFile|writeIdentityHistory|writeIdentityHandoff"
    - from: "src/backend/claude-session/identity-artifact-reader.ts REMOTE branch"
      to: "ssh2 SFTPWrapper"
      via: "conn.sftp(cb) → sftp.writeFile(tmp) → sftp.rename(tmp,target) — matches existing SFTP idiom in file-manager-session.ts getSessionSftp"
      pattern: "conn\\.sftp\\("
---

<objective>
Deliver the shared backend foundation for Phase 18: atomic-write primitives
for the three markdown identity artifacts (identity file, history, handoff)
that work over BOTH the LOCAL bind-mount branch and the REMOTE SSH branch,
plus the three WS handlers and wire types that expose them.

Purpose: Every downstream Phase 18 plan (Wave 2 markdown-tab UI, Wave 4
bounty-fields backend, Wave 5 bounty UI) reuses this SFTP tmp+rename
primitive. Getting the primitive right once — with the correct security
posture (IDENTITY_KEY_RE validation, IDMEDIT_MAX_MARKDOWN_BYTES cap, no
shell interpolation on payload) and the correct atomic-write semantics
(tmp+rename so a mid-write crash leaves the prior file intact) — means
Plans 02, 04, and 05 can wire UI plus JSON writers on top without
re-solving these questions.

Design decision (per IDMEDIT-05 planning): SFTP over chunked-stdin.
execCommand in src/backend/ssh/tmux-helper.ts lines 21-50 does not support
stdin. Extending it would require a parallel exec-with-stdin variant.
SFTP is already used in src/backend/ssh/file-manager-session.ts line 124
(getSessionSftp) and src/backend/ssh/host-transfer.ts for the file-manager
subsystem — the SFTPWrapper.writeFile plus rename idiom is battle-tested
in this codebase. SFTP also cleanly avoids the shell-escape audit surface
entirely for the payload (only the target path is interpolated, and
identityKey is regex-validated).

Output: three exported writer functions, one shared private SFTP helper,
three WS handlers with error echoes, and six new wire type exports.
No frontend consumers wired yet — Plan 02 handles that. Existing wakeup,
bounty priority, bounty status, bounty pinned, bounty archive, and bounty
delete handlers UNCHANGED.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add three markdown writer functions + shared SFTP helper to identity-artifact-reader.ts</name>
  <files>src/backend/claude-session/identity-artifact-reader.ts</files>
  <read_first>
    - src/backend/claude-session/identity-artifact-reader.ts (READ IN FULL — the writeIdentityWakeupUpdate function at lines 664-744 is the exact byte-shape you are mirroring for the LOCAL branch tmp+rename; also read lines 100-165 for module-load helpers getLocalIdentitiesRoot, shellEscape, execWithTimeout, and lines 200-486 for the existing read functions readIdentityFile, readIdentityHistory, readIdentityHandoff whose file paths the new writers must target byte-for-byte)
    - src/backend/ssh/file-manager-session.ts (READ lines 30-160 for the existing SFTPWrapper idiom — session.client.sftp promise-wrap pattern; the new writeMarkdownFileAtomic helper mirrors this promise-wrap shape without the session caching, since Phase 18 writes are one-shot per WS message)
    - src/backend/ssh/host-transfer.ts (READ lines 40-70 plus 660-700 for SFTPWrapper promise-wrap patterns; helpers like promisifySftpUnlink at line 681 are a direct model for the new promise-wrapped sftp.writeFile and sftp.rename calls)
    - src/backend/database/routes/voice.ts (READ lines 25-140 for the SPEAK_TEXT_MAX = 25000 byte-cap pattern — the new IDMEDIT_MAX_MARKDOWN_BYTES const follows the same shape: module-level export, checked at ingress, throws with a truthful message on overflow)
    - src/backend/ssh/tmux-helper.ts (READ lines 1-50 to confirm execCommand cannot accept stdin — this is the WHY SFTP is chosen)
  </read_first>
  <action>
Append three exported functions to identity-artifact-reader.ts, plus a shared private helper and a byte-cap constant. Placement: append after writeIdentityWakeupUpdate (ends around line 744), before the existing writeIdentityBountyPriority block that starts around line 757. Reuse existing module imports (fs from fs/promises, path, SSHClientType, sshLogger, getLocalIdentitiesRoot, IDENTITY_KEY_RE); the only new type import is `type SFTPWrapper = import("ssh2").SFTPWrapper` declared at the top of the file (matches host-transfer.ts line 43 idiom).

Exports to add:

1. Byte-cap const named IDMEDIT_MAX_MARKDOWN_BYTES with value 2_000_000. Exported.

2. writeIdentityFile(conn, identityKey, contents): Promise<void>. LOCAL branch (conn === null): compute filePath as path.join(getLocalIdentitiesRoot(), identityKey, identityKey + ".md"); write via tmp+rename (const tmpPath = filePath + ".tmp"; fs.writeFile(tmpPath, contents, "utf-8"); fs.rename(tmpPath, filePath)) — mirrors lines 713-718 of writeIdentityWakeupUpdate. REMOTE branch (conn is SSHClientType): validate IDENTITY_KEY_RE.test(identityKey) and throw "invalid identityKey" if not; check Buffer.byteLength(contents, "utf-8") vs IDMEDIT_MAX_MARKDOWN_BYTES and throw "markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES" if over; derive the remote home via execWithTimeout(conn, "echo $HOME") (fixed command string — no shell-inject surface, per D-IDMEDIT-06); construct targetPath as `${remoteHome}/.claude/identities/${identityKey}/${identityKey}.md`; call writeMarkdownFileAtomic(conn, targetPath, contents).

3. writeIdentityHistory(conn, identityKey, contents): Promise<void>. Identical shape to writeIdentityFile except targetPath basename is history.md (LOCAL: path.join(root, identityKey, "history.md"); REMOTE: `${remoteHome}/.claude/identities/${identityKey}/history.md`).

4. writeIdentityHandoff(conn, identityKey, contents): Promise<void>. Identical shape to writeIdentityFile except targetPath basename is handoff.md.

5. writeMarkdownFileAtomic(conn: SSHClientType, targetPath: string, contents: string): Promise<void>. Private (not exported). Opens SFTP via a promise-wrap of conn.sftp(cb) — identical to file-manager-session.ts line 136-138 idiom but without session caching. Promise-wrap sftp.writeFile(targetPath + ".tmp", Buffer.from(contents, "utf-8"), { mode: 0o644 }, cb). Then promise-wrap sftp.rename(targetPath + ".tmp", targetPath, cb). On any error: attempt best-effort sftp.unlink(targetPath + ".tmp", () => {}) fire-and-forget cleanup, then re-throw the original error. Always close SFTP via sftp.end() in a finally block. Log successes at info level via sshLogger.info with operation identity_markdown_write and fields targetPath plus bytes = Buffer.byteLength(contents, "utf-8"); log failures at error level via sshLogger.error with the underlying error.

Do NOT add rate-limiting or userId scoping in this module — the WS-handler layer in Task 2 owns userId scoping (via resolveHostById which is user-scoped, matching the existing update-wakeup handler pattern). Do NOT touch existing exports. Do NOT modify readIdentityFile / readIdentityHistory / readIdentityHandoff (their read paths must stay byte-identical for the Task 2 fresh-echo response to work).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "identity-artifact-reader\.ts|error TS" | head -20 ; echo "---" ; grep -n "^export.*writeIdentityFile\b\|^export.*writeIdentityHistory\b\|^export.*writeIdentityHandoff\b\|^export const IDMEDIT_MAX_MARKDOWN_BYTES\|^async function writeMarkdownFileAtomic\b" src/backend/claude-session/identity-artifact-reader.ts</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0 (no new type errors)
    - grep prints five matching lines (byte-shape verified): the const export, three writer exports, one private helper
    - LOCAL branch of writeIdentityFile contains literal tmpPath followed by fs.rename(tmpPath, filePath) (mirror of line 713-718)
    - REMOTE branch of writeIdentityFile contains IDENTITY_KEY_RE.test(identityKey) gate AND Buffer.byteLength check against IDMEDIT_MAX_MARKDOWN_BYTES BEFORE opening SFTP
    - writeMarkdownFileAtomic contains conn.sftp, sftp.writeFile, sftp.rename, and sftp.end (grep confirms all four)
    - No new top-level imports beyond `type SFTPWrapper = import("ssh2").SFTPWrapper`
  </acceptance_criteria>
  <done>Three exported writer functions plus one private SFTP helper plus one byte-cap const added to identity-artifact-reader.ts. TypeScript clean. Byte-shape mirrors writeIdentityWakeupUpdate LOCAL branch; REMOTE branch uses SFTP with identityKey regex-validation and payload byte-cap.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Add three WS handlers with fresh-echo responses to claude-session-server.ts</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <read_first>
    - src/backend/claude-session/claude-session-server.ts (READ lines 1-90 for the header WS-shape docblock — you will add three new lines each to the client→server and server→client shape blocks — plus lines 1877-1933 for the existing identity:get-identity-file READ handler shape, AND lines 2057-2153 for the existing identity:update-wakeup WRITE handler shape which is your exact template)
    - src/backend/claude-session/identity-artifact-reader.ts (READ your new exports from Task 1 to confirm signature: writeIdentityFile(conn, identityKey, contents), writeIdentityHistory(conn, identityKey, contents), writeIdentityHandoff(conn, identityKey, contents), plus the existing readIdentityFile / readIdentityHistory / readIdentityHandoff you will re-read after write for echo)
    - src/backend/ssh/host-resolver.ts (glance at resolveHostById signature — used unchanged from update-wakeup handler)
    - src/backend/ssh/ssh-one-shot.ts (glance at connectOneShot signature — used unchanged from update-wakeup handler)
  </read_first>
  <action>
Add three new WS message-type branches to the message handler in claude-session-server.ts. Placement: insert immediately AFTER the existing identity:update-wakeup handler block that ends at line 2153 with `return;`, and BEFORE the identity:archive-bounty handler at line 2164. Update the header docblock (client→server and server→client shape lists near lines 46-83) to include the three new message types.

Also add three-or-four new imports from identity-artifact-reader.ts at the top of the file (currently imports readIdentityFile, writeIdentityWakeupUpdate, writeIdentityBountyPriority around lines 15-27): add writeIdentityFile, writeIdentityHistory, writeIdentityHandoff, and readIdentityHandoff if it is not already imported.

Handler shape — three near-identical blocks, one per message type, each around 50 lines mirroring the update-wakeup block at 2057-2153:

Block A — identity:update-identity-file. Guard rawKey is string and IDENTITY_KEY_RE.test — on failure send { type: "identity:identity-file-updated", markdown: "", error: "invalid identityKey" } and return. Guard rawContents is string — on failure send { markdown: "", error: "contents must be a string" } and return. (Byte-cap enforced again inside writeIdentityFile; here we surface a nicer top-level error before dispatch.) hostId resolution mirroring update-wakeup lines 2106-2111 (typeof rawHostId === "number" and Number.isFinite and > 0). useLocal branching mirroring lines 2112-2140 — dispatch to writeIdentityFile(null, identityKey, contents) then readIdentityFile(null, identityKey) for LOCAL; for REMOTE call resolveHostById(hostIdNum, userId), connectOneShot with 5000ms timeout, writeIdentityFile(conn, identityKey, contents) then readIdentityFile(conn, identityKey), wrap in try/finally with conn.end(). Emit { type: "identity:identity-file-updated", markdown } on success; on catch emit { type: "identity:identity-file-updated", markdown: "", error: err.message }. sshLogger.info with operation identity_update_identity_file plus fields userId, identityKey, hostId, useLocal, bytes.

Block B — identity:update-history. Same shape as Block A except echo event type is identity:history-updated and echo carries `entries: string[]` (NOT markdown), obtained by calling readIdentityHistory(conn|null, identityKey). The reason: HistoryTab currently renders entries: string[] (see readIdentityHistory at identity-artifact-reader.ts:247-288 which splits, filters comments, reverses); the client already has the reader shape wired, so echoing entries lets the Wave 2 client rehydrate via the existing wire shape.

Block C — identity:update-handoff. Same shape as Block A except echo event type is identity:handoff-updated and echo carries `markdown` obtained by calling readIdentityHandoff(conn|null, identityKey).

Per D-IDMEDIT-06: every handler validates identityKey against IDENTITY_KEY_RE BEFORE any shell/SSH interpolation, matching the update-wakeup handler pattern. Payload byte-cap of IDMEDIT_MAX_MARKDOWN_BYTES is enforced inside writeIdentityFile / writeIdentityHistory / writeIdentityHandoff; the client-facing gate here is only string-vs-not so the byte-cap message surfaces via the writer's throw as the error field of the echo.

Do NOT add rate-limiting. Do NOT bypass userId scoping — resolveHostById is called with the same userId argument as the update-wakeup handler (userId is already in scope from the outer message handler; do not shadow it).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "claude-session-server\.ts|error TS" | head -20 ; echo "---" ; grep -c "identity:update-identity-file\|identity:update-history\|identity:update-handoff\|identity:identity-file-updated\|identity:history-updated\|identity:handoff-updated" src/backend/claude-session/claude-session-server.ts</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - grep count of the six wire strings is at least 12 (each string appears at least twice — once in header docblock, once in handler body — so 6 × 2 = 12 minimum)
    - Each handler contains IDENTITY_KEY_RE.test(rawKey) gate before dispatch
    - Each handler contains useLocal-ternary branching between writeIdentity* with null vs writeIdentity* with conn (LOCAL vs REMOTE, mirror of update-wakeup)
    - Each REMOTE branch has try/finally { conn.end() } closer (mirror of lines 2129-2139)
    - No new top-level imports beyond adding writeIdentityFile, writeIdentityHistory, writeIdentityHandoff, and readIdentityHandoff to the existing identity-artifact-reader.ts import list
  </acceptance_criteria>
  <done>Three WS message-type branches added, each dispatching to the appropriate writer then re-reader, emitting a fresh-echo response with the confirmed server-side markdown or entries. TypeScript clean. Docblock updated. No changes to existing handlers.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Add six wire type exports to claude-session-api.ts</name>
  <files>src/ui/api/claude-session-api.ts</files>
  <read_first>
    - src/ui/api/claude-session-api.ts (READ lines 319-435 for existing IdentityUpdateWakeupPayload / IdentityWakeupUpdatedEvent / IdentityGetIdentityFilePayload / IdentityIdentityFileEvent — your new types mirror these shapes byte-for-byte; also read the header docblock at lines 319-334 which enumerates the client↔server contracts and needs three new lines added)
    - src/backend/claude-session/claude-session-server.ts (READ your new handler wire shapes from Task 2 to confirm frontend type matches — payload fields identityKey/hostId/contents, event fields for each *-updated variant)
  </read_first>
  <action>
Append six new type exports to src/ui/api/claude-session-api.ts in the "Patch #17g/#92: identity artifact WS wire types" section (currently ends around line 435 with IdentityWakeupUpdatedEvent). Placement: insert after IdentityWakeupUpdatedEvent and BEFORE IdentityUpdateBountyPriorityPayload at line 436.

Also update the header docblock at lines 319-334 to add three new client→server plus three new server→client shape entries under the existing list.

Types to add — byte-shape-mirror IdentityUpdateWakeupPayload / IdentityWakeupUpdatedEvent at lines 415-434:

- IdentityUpdateIdentityFilePayload: type literal "identity:update-identity-file", identityKey string, hostId number (JSDoc: pane SSH host id used by server to route writes to the pane box), contents string (JSDoc: UTF-8 markdown payload; server caps at IDMEDIT_MAX_MARKDOWN_BYTES which equals 2MB).

- IdentityIdentityFileUpdatedEvent: type literal "identity:identity-file-updated", markdown string (JSDoc: server-echoed confirmed markdown post-write; source of truth for client rehydrate), error string optional.

- IdentityUpdateHistoryPayload: type literal "identity:update-history", identityKey string, hostId number, contents string.

- IdentityHistoryUpdatedEvent: type literal "identity:history-updated", entries string array (JSDoc: server re-reads history.md and returns parsed entries — mirrors identity:history event shape), error string optional.

- IdentityUpdateHandoffPayload: type literal "identity:update-handoff", identityKey string, hostId number, contents string.

- IdentityHandoffUpdatedEvent: type literal "identity:handoff-updated", markdown string, error string optional.

Per D-IDMEDIT-01/02/03 shape lock: contents carries the FULL FILE — Save is a full-overwrite on the markdown side, not a diff or patch. The *-updated echo carries the confirmed post-write markdown or entries so the client rehydrates from server-side truth rather than trusting its own draft.

Do NOT add these types to any exported discriminated union yet — Plan 02 will consume them directly by name via the existing sendIdentityMutation generic helper at IdentityModal.tsx:461-490.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "claude-session-api\.ts|error TS" | head -20 ; echo "---" ; grep -c "^export type IdentityUpdateIdentityFilePayload\|^export type IdentityIdentityFileUpdatedEvent\|^export type IdentityUpdateHistoryPayload\|^export type IdentityHistoryUpdatedEvent\|^export type IdentityUpdateHandoffPayload\|^export type IdentityHandoffUpdatedEvent" src/ui/api/claude-session-api.ts</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - grep count of the six type-export declarations equals 6 (each declared exactly once)
    - IdentityUpdateIdentityFilePayload / IdentityUpdateHistoryPayload / IdentityUpdateHandoffPayload each contain a `contents: string` field with a JSDoc referencing IDMEDIT_MAX_MARKDOWN_BYTES or 2MB byte-cap
    - IdentityIdentityFileUpdatedEvent and IdentityHandoffUpdatedEvent each carry `markdown: string`; IdentityHistoryUpdatedEvent carries `entries: string[]`
    - All six types carry the `hostId: number` field (identityKey scoped to hostId per patch #92 pattern)
  </acceptance_criteria>
  <done>Six wire type exports added to claude-session-api.ts matching the backend handler shapes from Task 2. TypeScript clean. Docblock updated. Frontend consumers can now import these types by name.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → WS server | Authenticated user session; msg payloads are untrusted JSON until validated |
| WS server → identity-artifact-reader | userId + identityKey are trusted (userId from session, identityKey regex-validated at handler); contents byte-string is untrusted until byte-capped |
| identity-artifact-reader REMOTE branch → remote host via SFTP | identityKey used in path interpolation is regex-validated; contents streamed as bytes via SFTP (no shell interpolation on payload) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-18-01 | Tampering | claude-session-server.ts new WS handlers | mitigate | Every handler runs `IDENTITY_KEY_RE.test(rawKey)` before path interpolation or dispatch — matches update-wakeup pattern at lines 2062. Rejection returns error echo, no side effect. |
| T-18-02 | Elevation of Privilege | identity-artifact-reader.ts REMOTE branch path interpolation | mitigate | Second-belt `IDENTITY_KEY_RE.test(identityKey)` inside REMOTE branch of writeIdentityFile / writeIdentityHistory / writeIdentityHandoff, before constructing targetPath — matches writeIdentityWakeupUpdate line 727 pattern. `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` rejects `/`, `..`, `~`, shell metacharacters. |
| T-18-03 | Denial of Service | identity-artifact-reader.ts markdown writers via unbounded payload | mitigate | IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000 hard cap checked via Buffer.byteLength before opening SFTP; oversized throws before any bytes cross the wire. Mirrors SPEAK_TEXT_MAX = 25000 pattern from voice.ts (2MB is generous for identity files — nelly.md is currently ~40KB, headroom for growth without enabling DoS). |
| T-18-04 | Information Disclosure | cross-user identity write (userA writes to userB's identity file) | accept | Inherited from resolveHostById which requires userId — user cannot resolve a host they do not own; new handlers use the same resolveHostById(hostIdNum, userId!) pattern as update-wakeup line 2123 with no bypass. No new user-scoping code needed. |
| T-18-05 | Repudiation | markdown edits leave no audit trail | accept | Markdown files are unstructured content; unlike bounty JSON (which gets a timeline entry per edit — Plan 04), markdown files do not have a native audit surface. Git commits on the identity repo are the audit trail (out of scope for this phase; user commits their own identity dir separately). |
| T-18-06 | Tampering | mid-write crash leaves truncated markdown | mitigate | Atomic tmp+rename on both LOCAL (fs.rename) and REMOTE (sftp.rename) branches. Mirror of writeIdentityWakeupUpdate lines 713-718 (LOCAL) and lines 736-738 (REMOTE python script pattern). SFTP path uses sftp.writeFile(tmp) → sftp.rename(tmp, target). |
| T-18-07 | Tampering | SFTP connection stays open leaking file handles on error | mitigate | writeMarkdownFileAtomic uses try/finally with sftp.end() closer; on write error, best-effort sftp.unlink(tmp) cleanup fires before re-throw. |
| T-18-SC | Tampering | npm/pip/cargo installs | mitigate | No new packages installed in this plan — SFTP already available via ssh2 (present in package.json). No slopcheck needed. |
</threat_model>

<verification>
- npx tsc --noEmit exits 0
- npx vitest run src/backend/claude-session/ passes (or unchanged from baseline — no new tests introduced in Plan 01; Plan 06 verification-time task adds integration coverage)
- grep verifies all wire strings appear in both backend handler and frontend wire types (paired shape)
- Manual sanity: on a running Skynet, open a browser devtools WS inspector; send a manually-constructed `identity:update-identity-file` payload with `{ identityKey: "tina", hostId: <local-host-id>, contents: "test" }` and confirm the server echoes back `identity:identity-file-updated` with `markdown: "test"`. Reverting the file requires re-sending with the original contents (no automatic undo).
</verification>

<success_criteria>
- Three new markdown writer functions exported from identity-artifact-reader.ts
- Three new WS handlers registered in claude-session-server.ts
- Six new wire types exported from claude-session-api.ts
- IDENTITY_KEY_RE validation gate on every new handler AND inside every REMOTE-branch writer (defense in depth)
- IDMEDIT_MAX_MARKDOWN_BYTES byte-cap enforced before SFTP open
- SFTP tmp+rename atomic pattern on REMOTE; fs.rename tmp+rename on LOCAL
- TypeScript clean; existing tests still pass; no changes to existing handlers or writers
</success_criteria>

<output>
Create `.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-01-SUMMARY.md` when done.
</output>
