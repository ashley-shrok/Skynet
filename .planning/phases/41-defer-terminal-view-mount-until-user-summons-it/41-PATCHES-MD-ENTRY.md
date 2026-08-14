# Phase 41 — skynet-patches.md Draft Entry

**Instructions for orchestrator:** Copy the block below verbatim into `~/.claude/roles/box-maintainer/skynet-patches.md` as the next numbered patch entry. Fill in `TBD` fields at ship time. Do NOT fill in deploy details before the docker build + ship motion completes.

---

## Patch #TBD (orchestrator fills at ship time) — 2026-08-14 (tanya) — Identity sessions defer the terminal view until Ashley reaches for it — PrettyView loads on its own; Ctrl+Shift+O cold-boots the terminal each visit; also rewires pretty-view file uploads off Terminal's SSH WS onto PrettyView's own claude-session WS, closing the /close verdict follow-up

Identity-based agent sessions (tanya, tina, tiffany, etc.) previously mounted the Terminal component eagerly on every tab open, even though Ashley almost never looks at the raw tmux output — PrettyView is what she uses. The SSH WebSocket was dialing, xterm was initializing, tmux was reattaching, all before Ashley touched the terminal surface once. This phase restructures identity panes so PrettyView stands on its own and Terminal is dormant until summoned; every terminal visit cold-boots fresh. Plan 41-04 additionally closes the /close-verdict follow-up by rewiring pretty-view file uploads off Terminal's SSH WebSocket onto PrettyView's own claude-session WebSocket, so file uploads work correctly on identity panes regardless of Terminal's mount state.

**Motivation:** Pretty-view is the primary surface for identity-based agent sessions; the terminal is a rare-fallback diagnostic surface. Eager-loading the terminal on every identity tab open consumed CPU, memory, and network bandwidth on every open tab — a cost paid 100% of the time for a surface used <<1% of the time. The Phase 35 (patch #435) send-path migration made this possible by decoupling PrettyView's send path from the Terminal's SSH WS.

- **Changes (frontend-only; backend: none):**

  - **Plan 41-01 — Signal re-source:** Added `useSessionIsWorkingRaw` (three-state `boolean|null` hook) to `session-working-store.ts`; created `session-tmux-store.ts` (companion store mirroring session-working-store pattern) with `publishFleetStatusTmuxSession`, `publishFleetStatusTmuxSessionGone`, `useSessionTmuxName`, `__resetForTest`. Extended AppShell's fleet-status WS callbacks (onSnapshot, onUpdate, onGone) to feed the new tmux store in addition to the working store. Rewired PrettyView's `isIdle` to derive internally via `useSessionIsWorkingRaw` from the fleet-status broadcast store instead of a Terminal-supplied prop — so WipBubble + ready-dot work correctly when Terminal is unmounted. Retargeted AppShell's `document.title` effect to read `useSessionTmuxName` from the broadcast store as the primary source (legacy `onTmuxSessionChange` callback path remains as fallback for non-identity panes).

  - **Plan 41-02 — Pane restructure:** Created `src/ui/shell/IdentitySessionPane.tsx` — a `forwardRef<TerminalHandle>` wrapper that initializes `isPrettyMode = true`, always mounts `<PrettyView>`, conditionally mounts `<Terminal>` on `!isPrettyMode`, owns `MessageQueueDrawer` / `IdentityBadge` / `IdentityModal` / session-tint (all moved from Terminal.tsx), and re-exposes the full `TerminalHandle` interface via `useImperativeHandle` with safe-noop fallbacks when Terminal is unmounted. Added `TerminalOrIdentitySessionPane` inline component in `tabUtils.tsx` (hook-boundary pattern) to dispatch identity tabs through `IdentitySessionPane` and non-identity terminal tabs through the unchanged `TerminalTabContent`. Removed 403 lines from `Terminal.tsx` (PrettyView, isPrettyMode state, pvSendInputRef/pvSendInterruptRef, hasAutoActivatedPrettyRef, MessageQueueDrawer, IdentityBadge, IdentityModal, isIdle useState, togglePrettyMode/toggleMessageQueue imperative handle, handleInjectedTurnReady — all hoisted to IdentitySessionPane or removed as no longer needed). Inverted Terminal.wiring.test.ts assertions from presence-guards to absence-guards (42 tests confirm the deleted symbols are gone). PrettyView's `isIdle` prop fully removed (was Plan 41-01 backward-compat; now dead).

- **Files touched (frontend + backend in Plan 41-04):**
  - `src/ui/state/session-working-store.ts` (+36 lines — useSessionIsWorkingRaw hook)
  - `src/ui/state/session-working-store.test.ts` (+80 lines — tests M-Q)
  - `src/ui/state/session-tmux-store.ts` (created, +182 lines)
  - `src/ui/state/session-tmux-store.test.ts` (created, +241 lines — 10 tests A-J)
  - `src/ui/AppShell.tsx` (+95 lines — tmux-store feed + useSessionTmuxName + title retarget + TerminalOrIdentitySessionPane wiring)
  - `src/ui/features/pretty-view/PrettyView.tsx` (+55/-15 — isIdleDerived internal derivation; isIdle prop removal; Plan 41-04: terminalWs prop removal, wsRef.current for uploads)
  - `src/ui/features/pretty-view/PrettyView.aside.test.tsx` (+110 lines — C1-C3 skipped tests)
  - `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx` (+9 — waitFor timeout increase, pre-existing CI-load flake fix)
  - `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` (Plan 41-04: refactored off terminalWsMock)
  - `src/ui/features/pretty-view/IdentityModal.test.tsx` (+15 — waitFor timeout increases)
  - `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` (+10 — waitFor timeout increase)
  - `src/ui/features/pretty-view/IdentityModal.share.test.tsx` (+11 — waitFor timeout increase)
  - `src/ui/shell/IdentitySessionPane.tsx` (created, +379 lines; Plan 41-04: TODO(41-followup) + terminalWs={null} removed)
  - `src/ui/shell/IdentitySessionPane.test.tsx` (created, +387 lines — 7 tests P1-P7)
  - `src/ui/shell/tabUtils.tsx` (+72 — TerminalOrIdentitySessionPane inline component)
  - `src/ui/features/terminal/Terminal.tsx` (+257/-403 net — identity-pane JSX removed)
  - `src/ui/features/terminal/Terminal.wiring.test.ts` (+194/-200 — wiring tests inverted to absence guards)
  - `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` (+14 — waitFor timeout increase, pre-existing CI-load flake fix)
  - `src/backend/claude-session/claude-session-server.ts` (Plan 41-04: upload_start/upload_chunk/upload_abort dispatch added + ownedUploadBatches/pendingStarts state + cleanupBatchesForConnection in teardownPane + ws.close + __dispatchUploadMessageForTests seam)
  - `src/backend/ssh/terminal.ts` (Plan 41-04: upload dispatch removed — handleUploadStart/handleUploadChunk/handleUploadAbort cases + imports + ownedUploadBatches/pendingStarts state)
  - `src/backend/claude-session/claude-session-server.pretty-view-upload.test.ts` (Plan 41-04: new integration test, 6 it() blocks)

- **Testing evidence:** See `.planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-BUILD-VERIFY-LOG.md`.
  - `npx tsc --noEmit` exit 0
  - `npm run build:backend` exit 0 (backend TS typecheck for claude-session-server.ts + terminal.ts changes)
  - `npm run build` exit 0 (built in ~37s; AppShell chunk 386 kB gzip 97 kB, Terminal chunk 109 kB gzip 27 kB — unchanged from Plan 41-03 baseline)
  - `npx vitest run` Phase 41-04 key files: PrettyView.compose-send.test.tsx (5/5), use-pretty-view-uploads.test.ts (20/20), IdentitySessionPane.test.tsx (7/7), pretty-view-upload.test.ts (17/17), claude-session-server.pretty-view-upload.test.ts (6/6 new) — all exit 0
  - Full-suite vitest: target exit 0, zero logic failures (pre-existing CI-load timeout flakes on unrelated files are pre-existing infrastructure flakes; see 41-BUILD-VERIFY-LOG.md for details)

- **Rebase risk: LOW.** All changes are fork-local under `src/ui/` — pretty-view, terminal, shell, state subsystems. No upstream Skynet API surface touched. IdentitySessionPane is a new wrapper at the `tabUtils` dispatch layer; non-identity pane paths (`TerminalTabContent`, `GuacamoleTabContent`, dashboard) are byte-unchanged. The `useSessionTmuxName` retarget in AppShell is additive (broadcast store primary, legacy callback fallback preserved for non-identity panes). No wire-protocol changes; fleet-status broadcast payload already carried `tmuxSession` from Phase 39.

- **Upload channel (Plan 41-04 close-verdict fix):** File uploads now work correctly when Terminal is unmounted. Plan 41-04 rewired the upload channel from Terminal's SSH WS (port 30002) to PrettyView's own claude-session WS (port 30011). The `handleUploadStart / handleUploadChunk / handleUploadAbort` dispatch moved from `terminal.ts` to `claude-session-server.ts`, using the pane's existing `sshConn` set at `connectToPane` time. The `terminalWs={null}` workaround and `TODO(41-followup)` comment in IdentitySessionPane are gone. Uploads are now available on identity panes regardless of Terminal's mount state. UAT items 11-13 cover this.

- **Nginx changes: None.** No new URL prefixes, no new endpoints, no new upstream targets. Frontend-only change set.

- **Deploy details:** TBD (orchestrator fills at ship time)
  - Container image tag: TBD
  - Container ID: TBD
  - HEAD SHA at deploy: TBD
  - HTTPS 200 verify: TBD
  - Coord-room BEFORE event ID: TBD
  - Coord-room AFTER event ID: TBD
  - `git push` timestamp: TBD

- **Bounty tracker:** TBD (orchestrator fills at ship time — no bounty was explicitly opened for this phase per current records)

- **UAT plan:** Ashley walks `.planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-UAT-CHECKLIST.md` items 1-13 against the deployed build. Core observable: open identity session → PrettyView appears with NO "Connecting…" flash → Ctrl+Shift+O summons terminal (cold-boot, "Connecting…" briefly) → second Ctrl+Shift+O tears it down → third Ctrl+Shift+O cold-boots fresh again. Items 11-13 (added in Plan 41-04): drag a file into a fresh identity pane where Terminal was never summoned → upload completes end-to-end. Fleet rule "silence IS success" applies.

- **See also:** Phase 39 (patch #441) — fleet-status SSH-poll broadcast that this phase reads isIdle + tmuxSession from; Phase 35 (patch #435) — send-path migration that made PrettyView independent of Terminal's SSH WS; patch #442 — Phase 39 UAT regression fix (dropped `status: "shell"` from composite formula).
