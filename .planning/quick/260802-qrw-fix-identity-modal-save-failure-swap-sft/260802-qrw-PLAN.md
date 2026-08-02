---
phase: 260802-qrw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts
autonomous: true
requirements:
  - QRW-01  # Swap sftp.rename → sftp.ext_openssh_rename in writeMarkdownFileAtomic (root cause of IdentityModal save failure on existing identities)
  - QRW-02  # Add regression test that asserts writeIdentityFile calls ext_openssh_rename (and NOT sftp.rename) on the REMOTE branch
  - QRW-03  # Update JSDoc prologue on writeMarkdownFileAtomic to record WHY the extension is required (link/EEXIST → SSH2_FX_FAILURE trap; @stacy 2026-08-02 root cause)

must_haves:
  truths:
    - "Ashley's IdentityModal saves against an EXISTING identity file no longer surface generic 'Error: Failure' (SFTP code 4) on skynet-ec2."
    - "All four identity writers (writeIdentityFile, writeIdentityHistory, writeIdentityHandoff, writeIdentityBountyFields) route their atomic rename through the OpenSSH posix-rename extension, giving them POSIX rename(2) overwrite semantics."
    - "A regression test in the identity-artifact-reader REMOTE-branch suite fails loudly (throws a diagnostic 'must not call sftp.rename — use ext_openssh_rename') if a future edit reverts writeMarkdownFileAtomic to sftp.rename."
    - "`npm run build:backend` passes on the strict backend tsconfig (belt-and-suspenders per Tina's learned rule — frontend `tsc --noEmit` alone does not catch backend TS errors)."
  artifacts:
    - path: "src/backend/claude-session/identity-artifact-reader.ts"
      provides: "writeMarkdownFileAtomic using sftp.ext_openssh_rename + updated JSDoc prologue explaining the swap"
      contains: "sftp.ext_openssh_rename(tmpPath, targetPath"
    - path: "src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts"
      provides: "REMOTE-branch regression test: writeIdentityFile calls ext_openssh_rename, NOT sftp.rename"
      exports: []
  key_links:
    - from: "src/backend/claude-session/identity-artifact-reader.ts:writeMarkdownFileAtomic"
      to: "ssh2 SFTPWrapper.ext_openssh_rename"
      via: "conn.sftp callback → sftp.ext_openssh_rename(tmpPath, targetPath, cb)"
      pattern: "sftp\\.ext_openssh_rename\\("
    - from: "identity-artifact-reader.remote-writes.test.ts"
      to: "writeIdentityFile REMOTE branch"
      via: "mock SSHClientType whose conn.sftp yields a mock SFTPWrapper with ext_openssh_rename spy AND a throwing rename trap"
      pattern: "ext_openssh_rename:\\s*vi\\.fn"
---

<objective>
Fix IdentityModal save failure on EXISTING identity files (per QRW-01).

Root cause (confirmed on skynet-ec2, root-caused by @stacy on ceo-skynet 2026-08-02, full handoff at ~/pretty-view-uploads/2026-08-02/190204-TINA-HANDOFF.md):

  writeMarkdownFileAtomic at src/backend/claude-session/identity-artifact-reader.ts:855
  calls sftp.rename(tmp, target, cb), which sends SFTPv3 SSH_FXP_RENAME.
  OpenSSH's process_rename tries link(old, new) first. When `new` already exists,
  link() returns EEXIST. OpenSSH's errno_to_portable() has no case for EEXIST and
  falls through to SSH2_FX_FAILURE — the client sees a generic `Error: Failure`
  with code 4 and an empty error string. Every overwrite of an existing identity
  file therefore fails; only first-time writes (target missing) succeed. Matches
  Ashley's "sometimes it works, sometimes it doesn't" — she confirmed all her
  IdentityModal saves have been on EXISTING identities.

Fix: swap the single call site to sftp.ext_openssh_rename (posix-rename@openssh.com
extension). It has POSIX rename(2) semantics — atomic overwrite. Supported by every
OpenSSH ≥5.1 (2008+); no fallback needed against any modern sshd. One helper change
transitively fixes all four consumers (writeIdentityFile, writeIdentityHistory,
writeIdentityHandoff, writeIdentityBountyFields) — they all delegate rename to
writeMarkdownFileAtomic.

Also add a regression test that pins the fix in place (QRW-02) and update the
JSDoc prologue on writeMarkdownFileAtomic to record WHY the extension is required
(QRW-03), so a future refactor that "cleans up" the extension call back to plain
sftp.rename fails at review-time as well as at test-time.

Purpose: Restore IdentityModal save reliability for the entire fleet. This is the
top-of-list production bug for Ashley today.

Output: single-file backend patch (identity-artifact-reader.ts) + new regression
test file (identity-artifact-reader.remote-writes.test.ts).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/backend/claude-session/identity-artifact-reader.ts

# ssh2 API reference — verified byte-shape of the extension we're switching to.
# Confirms the signature is ext_openssh_rename(oldPath, newPath, cb) and the
# error surface (throws "Server does not support this extended request" if the
# server does not advertise posix-rename@openssh.com === "1"; OpenSSH ≥5.1
# always advertises it, so this branch is unreachable in practice against
# every host in Ashley's fleet).
@node_modules/ssh2/lib/protocol/SFTP.js
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Swap sftp.rename → sftp.ext_openssh_rename in writeMarkdownFileAtomic + update JSDoc + write regression test</name>
  <files>src/backend/claude-session/identity-artifact-reader.ts, src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts</files>
  <behavior>
    Regression test (new file, identity-artifact-reader.remote-writes.test.ts) — added FIRST, must fail against unmodified identity-artifact-reader.ts:

    - Suite: `writeIdentityFile — REMOTE branch atomic-rename API`

    - Test 1 (load-bearing): `calls ext_openssh_rename (posix-rename@openssh.com), not sftp.rename, to allow atomic overwrite of existing identity files`
      - Arrange: build a fake ssh2 Client (SSHClientType) whose:
          - `.exec(cmd, cb)` handles `echo $HOME` — invoke cb with a fake channel that emits `/home/tester\n` on 'data', then 'close'. (Mirrors what execCommand in ../ssh/tmux-helper.js consumes.) If wiring a full exec channel is too heavy, an equivalent path is to vi.mock the tmux-helper module and stub `execCommand` to return `/home/tester`. Executor may choose whichever route keeps the test surface small — prefer vi.mock the tmux-helper module.
          - `.sftp(cb)` invokes cb(null, mockSftp) where mockSftp has:
              - `writeFile: vi.fn((path, buf, opts, cb) => cb())`
              - `ext_openssh_rename: vi.fn((from, to, cb) => cb())`  ← MUST be present and callable
              - `rename: vi.fn(() => { throw new Error("must not call sftp.rename — use ext_openssh_rename"); })`  ← trap; the load-bearing bit that pins the fix
              - `unlink: vi.fn((p, cb) => cb())`
              - `end: vi.fn()`
      - Act: `await writeIdentityFile(mockConn, "tina", "hello world")`
      - Assert:
          - `mockSftp.ext_openssh_rename` was called exactly once
          - the call's first arg ends in `/tina/tina.md.tmp` and second arg ends in `/tina/tina.md` (both under `/home/tester/.claude/identities/tina/`)
          - `mockSftp.rename` was NOT called (throwing trap unreached)
          - `mockSftp.end` was called (finally cleanup)

    - Test 2 (defensive coverage): `writeIdentityHistory and writeIdentityHandoff also route through ext_openssh_rename` — same shape, targets `.../tina/history.md` and `.../tina/handoff.md`. This documents that the single helper swap covers all three markdown writers. (writeIdentityBountyFields also uses the helper but has more setup — leave it out of scope; the shared helper guarantees the fix transitively.)

    Both tests should FAIL against the pre-swap code (they will invoke the throwing `rename` trap and reject with the diagnostic message) and PASS after the swap.

    Implementation changes (identity-artifact-reader.ts):
    - Line ~855: change `sftp.rename(tmpPath, targetPath, ...)` → `sftp.ext_openssh_rename(tmpPath, targetPath, ...)`. Callback shape, error handling, and surrounding try/catch/finally are unchanged.
    - Lines ~817-825 JSDoc prologue for writeMarkdownFileAtomic: rewrite to a short paragraph explaining why the extension is required. Cover: (1) SFTPv3 SSH_FXP_RENAME cannot atomically overwrite; (2) OpenSSH process_rename tries link() first, EEXIST → SSH2_FX_FAILURE via errno_to_portable() gap; (3) posix-rename@openssh.com extension has POSIX rename(2) semantics; (4) supported by every OpenSSH ≥5.1; (5) root-caused 2026-08-02 by @stacy on ceo-skynet, confirmed on skynet-ec2. The existing "Promise-wraps conn.sftp → sftp.writeFile(tmp) → sftp.rename(tmp, target)" sentence must be updated to reference ext_openssh_rename (this is what changes the executable-rename-count grep result).
  </behavior>
  <action>
Do this task in strict RED→GREEN order — the regression test is the mechanism that pins QRW-01 in place forever, so it MUST exist and MUST fail before the swap lands.

STEP A (RED — write test first). Create `src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts` following the mock/assertion shape spelled out in `<behavior>` above. Model the file header/import discipline on `src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts` (vitest imports: describe/it/expect/beforeEach/afterEach/vi). Prefer `vi.mock("../ssh/tmux-helper.js", () => ({ execCommand: vi.fn().mockResolvedValue("/home/tester\n") }))` for stubbing `execWithTimeout`'s underlying execCommand — this keeps the test surface tiny and avoids building a fake ssh2 exec channel. The mock SSHClientType only needs `.sftp(cb)` populated when tmux-helper is stubbed. Run `npx vitest run src/backend/claude-session/identity-artifact-reader.remote-writes` and confirm both tests fail with the "must not call sftp.rename — use ext_openssh_rename" diagnostic (proves the trap fires against unmodified code).

STEP B (GREEN — apply the swap + JSDoc). In `src/backend/claude-session/identity-artifact-reader.ts`:
  1. At line ~855 replace `sftp.rename(tmpPath, targetPath, (err) => { ... })` with `sftp.ext_openssh_rename(tmpPath, targetPath, (err) => { ... })`. Preserve the callback body and surrounding Promise wrap exactly.
  2. Rewrite the JSDoc prologue at lines ~817-825 to record WHY (the EEXIST → SSH2_FX_FAILURE trap, POSIX rename(2) semantics of the extension, OpenSSH ≥5.1 universality, @stacy root-cause 2026-08-02). The prologue's mention of `sftp.rename(tmp, target)` must be updated to `sftp.ext_openssh_rename(tmp, target)` so the file no longer contains any reference to the buggy API in executable position.
  3. Rerun `npx vitest run src/backend/claude-session/identity-artifact-reader.remote-writes` — both tests must now pass.

STEP C (safety net). Run the full identity-artifact-reader suite and the strict backend build to catch any collateral damage (see `<verify>`).

STEP D (grep gate). Run `grep -c "sftp\.rename(" src/backend/claude-session/identity-artifact-reader.ts` (note the trailing paren — matches only executable call sites, not the word "sftp.rename" inside JSDoc prose that ends the sentence with punctuation). Result must be 0. If you kept a phrase like "plain sftp.rename" in the JSDoc without a `(`, that is fine; the paren-anchored grep ignores it.

Constraints (from scope, non-negotiable):
- Do NOT touch `src/backend/ssh/pretty-view-upload.ts` — its sftp.rename target is guaranteed non-existent by resolveNonCollidingFinal; scope stays narrow.
- Do NOT add a fallback for sshd versions that lack posix-rename@openssh.com — OpenSSH ≥5.1 (2008+) supports it universally and every host in Ashley's fleet is well beyond that; a fallback would add a code path we cannot exercise.
- Do NOT `git push`, do NOT `docker build`, do NOT `docker compose up`. Commit on the current branch and STOP.
- Do NOT use git worktrees (fleet rule).
- Do NOT update `~/.claude/identities/tina/skynet-patches.md` or the bounty archive — the orchestrator handles that after this plan lands.
- Do NOT fix adjacent bugs or clean up nearby comments; this quick task is single-purpose.
- Frontend `tsc --noEmit` is insufficient for backend changes (learned rule): `npm run build:backend` is REQUIRED because it uses the strict backend tsconfig.

Rebase-ability constraint (CLAUDE.md): this is a bugfix, not a numbered patch on top of upstream. Keep the diff minimal and self-contained so it survives future rebases against upstream v2.3.x — one call-site swap, one JSDoc rewrite, one new test file.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/backend/claude-session/identity-artifact-reader &amp;&amp; npm run build:backend &amp;&amp; npm run build &amp;&amp; npx tsc --noEmit &amp;&amp; test "$(grep -c 'sftp\.rename(' src/backend/claude-session/identity-artifact-reader.ts)" = "0"</automated>
  </verify>
  <done>
    - `sftp.ext_openssh_rename(tmpPath, targetPath, ...)` is the single rename call site inside writeMarkdownFileAtomic (identity-artifact-reader.ts ~line 855).
    - JSDoc prologue for writeMarkdownFileAtomic (~lines 817-825) documents the EEXIST → SSH2_FX_FAILURE trap and the @stacy 2026-08-02 root cause; no lingering executable reference to `sftp.rename(` remains anywhere in the file.
    - New file `src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts` exists with a `rename: vi.fn(() => { throw ... })` trap that would fail loudly against any future revert to `sftp.rename`. It contains at least one passing test for `writeIdentityFile` and at least one covering `writeIdentityHistory` + `writeIdentityHandoff` (either combined or split).
    - `npx vitest run src/backend/claude-session/identity-artifact-reader` — full suite green (existing local-branch tests untouched + new REMOTE-branch tests passing).
    - `npm run build:backend` — strict backend tsconfig passes.
    - `npm run build` + `npx tsc --noEmit` — both pass.
    - `grep -c "sftp\.rename(" src/backend/claude-session/identity-artifact-reader.ts` — 0.
    - No git push, no docker build, no compose up. Change committed on `feat/tab-title-from-tmux` branch.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| skynet backend → managed target sshd | SFTP write of identity markdown crosses trust boundary (target host is Ashley-controlled fleet member, but the SFTP protocol surface itself is the boundary). |
| IdentityModal (browser) → skynet backend WS | Already bounded by IDENTITY_KEY_RE at the WS handler AND inside each REMOTE-branch writer (double-belt per D-IDMEDIT-06). Unchanged by this patch. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-QRW-01 | Tampering | ext_openssh_rename argument construction (tmpPath, targetPath) | accept | targetPath is built from `${remoteHome}/.claude/identities/${identityKey}/...` where identityKey is validated by IDENTITY_KEY_RE (`^[a-z0-9_-]{1,64}$`) BEFORE the SFTP call (identity-artifact-reader.ts:931/959/987). tmpPath is `targetPath + ".tmp"`. No new interpolation, no new user-controlled string reaches SFTP through this patch. |
| T-QRW-02 | Denial of Service | posix-rename@openssh.com absent on target sshd | accept | ssh2 throws "Server does not support this extended request" synchronously. Every OpenSSH ≥5.1 (2008+) advertises the extension by default; Ashley's fleet is entirely modern Linux (Ubuntu 22/24) — this branch is unreachable in practice. Any hypothetical failure surfaces as a caught exception in writeMarkdownFileAtomic's try/catch, gets logged via sshLogger.error with the existing shape, and propagates to the WS handler exactly as any other write error would. No new failure mode versus the pre-patch bug (which failed 100% of overwrites); this is a strict improvement. |
| T-QRW-03 | Repudiation | Bounty/history markdown overwritten silently | accept | Unchanged behavior surface. writeMarkdownFileAtomic already logs `identity_markdown_write` on success and `identity_markdown_write_error` on failure with operation/targetPath/bytes. The patch preserves the log shape verbatim. |
| T-QRW-SC | Tampering | npm/pip/cargo installs | n/a | No new packages installed. ssh2 is a pre-existing dependency (node_modules/ssh2 already present); ext_openssh_rename is a method on the existing SFTPWrapper class, not a new module. |
</threat_model>

<verification>
Phase-level checks:

1. Regression test as pinning gate: `identity-artifact-reader.remote-writes.test.ts` must contain the throwing `rename: vi.fn(() => { throw new Error("must not call sftp.rename — use ext_openssh_rename"); })` trap. This is the load-bearing bit. Any future edit that reverts writeMarkdownFileAtomic to `sftp.rename(...)` will make the test invoke the trap and fail loudly with a diagnostic message that names the fix — not silently green.

2. Grep gate: `grep -c "sftp\.rename(" src/backend/claude-session/identity-artifact-reader.ts` must return `0`. The trailing `(` anchors the match to executable call sites and ignores any JSDoc prose that references the old API by name for explanation (e.g. "plain sftp.rename is unsafe because ..."). This grep gate is deliberately narrower than "grep sftp.rename" because the JSDoc rewrite intentionally names the old API to document the swap.

3. Backend build discipline (Tina's learned rule): `npm run build:backend` is REQUIRED. The default `tsc --noEmit` on the frontend project does not exercise the backend TypeScript config; a backend-only type regression can slip past frontend typechecking. This has bitten Tina before — the learned rule is codified in `~/.claude/identities/tina/skynet-patches.md`.

4. Manual smoke (out of scope for automation but noted for the orchestrator's post-plan verification): after this plan ships and skynet redeploys, Ashley should be able to open the IdentityModal on any existing identity (e.g. `tina`), edit any of the four writable fields (main markdown, history, handoff, bounty fields), click Save, and see the save succeed without the generic "Error: Failure" toast. The orchestrator owns the redeploy step (not this plan; per scope, no `docker compose up`).
</verification>

<success_criteria>
- writeMarkdownFileAtomic uses sftp.ext_openssh_rename (executable-position grep count = 0 for `sftp.rename(`).
- New regression test file exists and passes, with a throwing `rename` trap that would fail loudly against any future revert.
- Full identity-artifact-reader vitest suite passes (existing + new).
- `npm run build:backend`, `npm run build`, and `npx tsc --noEmit` all pass.
- JSDoc prologue for writeMarkdownFileAtomic explains WHY the extension is required (link/EEXIST trap, POSIX rename(2) semantics, OpenSSH ≥5.1 universality, @stacy root-cause).
- Change is committed on `feat/tab-title-from-tmux`. Nothing pushed, nothing deployed.
</success_criteria>

<output>
Create `.planning/quick/260802-qrw-fix-identity-modal-save-failure-swap-sft/260802-qrw-SUMMARY.md` when done. Summary should record: the executable-position grep count for `sftp.rename(` after the swap (must be 0), the vitest outcome for the new REMOTE-branch test file, and the exact commit SHA on `feat/tab-title-from-tmux` that carries the fix.
</output>
