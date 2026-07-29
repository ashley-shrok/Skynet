import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { sshLogger } from "../utils/logger.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { discoverClaudeSession } from "./session-file-discovery.js";
import { parseSessionLine } from "./session-file-parser.js";
import { tailSessionFile, type TailHandle } from "./session-file-tail.js";
import { execCommand } from "../ssh/tmux-helper.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
  IDENTITY_SLUG_RE,
  BOUNTY_PRIORITY_VALUES,
  BOUNTY_STATUS_VALUES,
  humanizeWakeupSchedule,
  readIdentityFile,
  readIdentityHistory,
  readIdentityWakeups,
  readIdentityHandoff,
  readIdentityBounties,
  readIdentityPinnedBountyCount,
  writeIdentityWakeupUpdate,
  writeIdentityBountyPriority,
  writeIdentityBountyStatus,
  writeIdentityBountyPinned,
  archiveIdentityBounty,
  deleteIdentityBounty,
  type BountyPriority,
  type BountyStatus,
} from "./identity-artifact-reader.js";

/**
 * Live Claude-session WebSocket server on port 30011.
 *
 * Wire protocol (V1 hard-lock, RENDER-01 — IMAGES EXCEPTED per patch #86):
 *
 *   client -> server:
 *     { type: "connectToPane", hostId: number, tmuxSession: string }
 *     { type: "identity:list-bounties", identityKey: string, hostId?: number }    // patch #87/#92: fetch identity bounties; hostId routes to pane's box (omit = local bind-mount)
 *     { type: "identity:count-bounties", targets: Array<{ identityKey: string; hostId: number | null }> } // quick 260727-tb1: batched pinned bounty counter for the per-row badge (one WS request per poll)
 *     // patch #17g/#92: identity artifact fetches (one-shot; no pane needed):
 *     { type: "identity:get-identity-file", identityKey: string, hostId?: number } // patch #17g/#92: fetch <key>.md
 *     { type: "identity:get-history", identityKey: string, hostId?: number }       // patch #17g/#92: fetch history.md
 *     { type: "identity:list-wakeups", identityKey: string, hostId?: number }      // patch #17g/#92: list wakeups/*.json
 *     { type: "identity:get-handoff", identityKey: string, hostId?: number }       // patch #17g/#92: fetch handoff.md
 *     // patch #154: first WRITE paths on identity artifacts. Same hostId routing.
 *     { type: "identity:update-wakeup", identityKey: string, hostId?: number, wakeupSlug: string, updates: { enabled?: boolean, schedule?: object } } // patch #154: patch wakeups/<slug>.json
 *     { type: "identity:update-bounty-priority", identityKey: string, hostId?: number, bountySlug: string, priority: "urgent"|"high"|"medium"|"low"|"unprioritized" } // patch #154: patch bounties/<slug>/bounty.json
 *     { type: "identity:update-bounty-status", identityKey: string, hostId?: number, bountySlug: string, status: "in_progress"|"waiting_on_someone_else"|"done"|"dropped" } // quick 260727-v0b / patch #168: patch bounties/<slug>/bounty.json status field. Allowed values: in_progress, waiting_on_someone_else, done, dropped. "pinned" removed from enum (now an independent boolean field). Folder NOT moved even for done/dropped — supports Ashley's resurrect flow via a pure JSON patch.
 *     { type: "identity:update-bounty-pinned", identityKey: string, hostId?: number, bountySlug: string, pinned: boolean } // quick 260728-sqk / patch #172: patch bounties/<slug>/bounty.json pinned field. `pinned` is an independent boolean orthogonal to status per fleet migration #168. Byte-shape mirror of update-bounty-status — flips the boolean, bumps updated_at, appends timeline line, folder untouched.
 *     { type: "identity:archive-bounty", identityKey: string, hostId?: number, bountySlug: string } // quick 260727-wd0: server decides new status internally (flip live→done or preserve terminal), then mv bounties/<slug>/ under bounties/archive/<slug>/ (mkdir -p archive/ if absent). No client-supplied status field.
 *     { type: "identity:delete-bounty", identityKey: string, hostId?: number, bountySlug: string } // quick 260729-g5r / patch #183: permanent rm -rf of a bounty folder. Applies to BOTH open (bounties/<slug>/) AND archived (bounties/archive/<slug>/) cards — server rm's both candidate paths with force:true so one call covers both locations. No confirmation gate here; window.confirm() lives in BountyCard.
 *     // hostId routing (patch #92): when omitted OR when the hostId is in IDENTITIES_LOCAL_HOST_IDS,
 *     // reads from the local bind-mount (IDENTITIES_HOST_DIR); otherwise SSHes to the pane's host.
 *     // Response shapes UNCHANGED — only request payloads gain the optional hostId field.
 *
 *   server -> client:
 *     { type: "session", pid, sessionFile }                      // metadata
 *     { type: "message", role, content, eventId, ts }            // per parsed JSONL line
 *     { type: "image", role, images, text, eventId, ts }         // per parsed JSONL turn carrying base64 image content (patch #86, WS-inline b64)
 *     { type: "wip", active }                                    // work-in-progress state (emitted on transitions + once as initial state)
 *     { type: "context_pct", pct }                               // 0-100, live scrape of Claude Code status-line "context) NN%"
 *     { type: "harness_tasks", tasks }                           // Claude Code /queue + TaskCreate items — read from ~/.claude/tasks/<sid>/*.json
 *     { type: "backgrounded_agents", agents }                    // currently-running Agent{run_in_background:true} subagents — derived from JSONL tool_use/tool_result correlation (patch #61)
 *     { type: "backgrounded_shells", shells }                    // currently-running Bash{run_in_background:true} shells — derived from JSONL tool_use / task-notification correlation (patch #68)
 *     { type: "plan_pending", pending }                          // unmatched ExitPlanMode tool_use in the parent JSONL — non-null when Claude is waiting on the user's "1"/"2" Plan Mode reply (patch #63)
 *     { type: "inactive", reason }                               // FALLBACK-01: send once, then silent
 *     { type: "tail_error", message }                            // recoverable: client may render a banner
 *     { type: "error", message, code? }                          // fatal for this pane
 *     { type: "identity:bounties", bounties, archivedBounties, error? } // patch #87: response to identity:list-bounties (one-shot; WS closed by client after receipt)
 *     { type: "identity:bounty-counts", counts: Array<{ identityKey, hostId, pinnedCount, error? }> } // quick 260727-tb1: response to identity:count-bounties (one-shot; WS closed by client after receipt)
 *     // patch #17g: identity artifact responses (one-shot; WS closed by client after receipt):
 *     { type: "identity:identity-file", markdown: string, error?: string } // patch #17g: response to identity:get-identity-file
 *     { type: "identity:history", entries: string[], error?: string }       // patch #17g: response to identity:get-history
 *     { type: "identity:wakeups", wakeups: Wakeup[], error?: string }       // patch #17g: response to identity:list-wakeups
 *     { type: "identity:handoff", markdown: string, error?: string }        // patch #17g: response to identity:get-handoff
 *     // patch #154: post-write responses carry the FRESH list so the client can atomically re-render without a follow-up read.
 *     { type: "identity:wakeup-updated", wakeups: Wakeup[], error?: string }  // patch #154: response to identity:update-wakeup (includes refreshed list)
 *     { type: "identity:bounty-priority-updated", bounties, archivedBounties, error?: string } // patch #154: response to identity:update-bounty-priority (includes refreshed lists)
 *     { type: "identity:bounty-status-updated", bounties, archivedBounties, error?: string } // quick 260727-v0b: response to identity:update-bounty-status (includes refreshed lists)
 *     { type: "identity:bounty-pinned-updated", bounties, archivedBounties, error?: string } // quick 260728-sqk / patch #172: response to identity:update-bounty-pinned (includes refreshed lists — normalizeBounty carries `pinned:boolean` on every bounty)
 *     { type: "identity:bounty-archived", bounties, archivedBounties, error?: string } // quick 260727-wd0: response to identity:archive-bounty (includes refreshed lists — bounty moved from `bounties` list to `archivedBounties` list)
 *     { type: "identity:bounty-deleted", bounties, archivedBounties, error?: string } // quick 260729-g5r / patch #183: response to identity:delete-bounty (includes refreshed lists — bounty drops out of BOTH lists since its folder is gone)
 *
 * Image frames carry inline base64 payloads: each `images[]` element is
 * `{ data: string, mediaType: string, toolUseId?: string }` where `data`
 * is raw base64 with no `data:` URI prefix (the frontend adds one at
 * render time). A typical PNG Read is ~150KB on the wire — acceptable
 * for the read-only sessions pretty-view targets, and there is no HTTP
 * fallback endpoint to bolt onto (pretty-view is WS-only architecture).
 *
 * Auth model mirrors `src/backend/ssh/terminal.ts` exactly: cookie `jwt=`
 * then `Authorization: Bearer <token>` then `?token=` query fallback. JWT
 * verified by AuthManager singleton; UserCrypto data-key must be resolved
 * (otherwise close 1008 with DATA_LOCKED per the terminal WS posture).
 *
 * Keep-alive follows patch #10's convention: `ws.ping()` every 30 s and
 * terminate on a double-miss of `pong`. This survives Chrome's
 * intensive-throttling on backgrounded tabs because ping/pong frames are
 * dispatched by the browser's networking layer, not the JS event loop.
 *
 * FALLBACK-01 enforcement (never reach back to a prior session file):
 * when discovery returns `inactive`, the server emits a single
 * `{type:"inactive",reason}` frame and STOPS. It does not open a tail; it
 * does not look at any other file. Any future scope creep here should
 * touch this comment first.
 */

const authManager = AuthManager.getInstance();
const userCrypto = UserCrypto.getInstance();

// Patch #92: humanizeWakeupSchedule moved to identity-artifact-reader.ts to avoid
// circular dependency (reader imports from server → server imports from reader would cycle).
// Imported above and re-exported so callers outside this module can still use it if needed.
export { humanizeWakeupSchedule };

// Phase 3 session-changeover tuning constants. Holding timeout: 15 * 3s = 45s.
// Per D-31 and CONTEXT.md § holding timeout — Nelly's timing note: "new .jsonl
// appears within ~5s; fully-loaded identity ~30-70s later." 45s catches the
// "no new file appeared" degenerate case (recycle failed to relaunch anything)
// while giving normal recycles headroom. If this tunes out on live use, bump
// it up by editing this constant only — no state machine change required.
const HOLDING_TIMEOUT_TICKS = 15;
const DISCOVERY_REPOLL_INTERVAL_MS = 3000;
// Harness-tasks poller tuning — moved to module scope from the pre-refactor
// inline block so the setupHarnessTasksPoller helper (per BLOCKER fix from
// plan-checker 2026-07-18) can reference them without re-allocating per call.
const HARNESS_TASKS_INTERVAL_MS = 3000;
const UUID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Phase 14 (plain-language-translation-asides) Wave 1 — module-scope primitives.
//
// The aside subsystem injects a fixed `/btw` prompt into an identity's tmux
// pane, extracts the BTW-overlay answer, and dismisses the overlay via
// Escape. All three operations reuse the pane's existing sshConn + the
// existing execCommand primitive (per PATTERNS.md L438-440 and CONTEXT.md
// § canonical_refs: no new SSH subsystem, no new port).
//
// Per ASIDE-10 (no aside store): these helpers carry NO module-scope state —
// they are pure request/response over the passed-in SSH connection. Wave 2
// (14-02) composes them into the frontend-arm-driven poller + WS event
// surface.
//
// BTW_PROMPT is the EXACT literal text from CONTEXT.md § Injection (per
// ASIDE-03 no-paraphrase rule). The em-dash MUST be a real U+2014 character.
export const BTW_PROMPT =
  "/btw Re-explain concisely whatever's currently going on to me since my last message without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.";

// ASIDE_END_MARKER is the literal end-of-answer substring from the BTW
// overlay's footer line (full marker: `↑/↓ to scroll · f to fork · Esc to
// close`). Stable across BTW invocations in Claude Code 2.1.150 per the
// kumquat-test verification (CONTEXT.md § Mechanism).
export const ASIDE_END_MARKER = "Esc to close";

// BTW_CLEAR_HISTORY_KEY — key sent into the tmux pane before Escape to
// clear Claude Code's in-overlay /btw history before dismissing the
// overlay. Rationale: /btw history within a Claude Code session poisons
// subsequent aside answers (the model self-references prior "please
// explain" turns from earlier asides). Sending this key first gives every
// new aside a clean slate. Lowercase `x` per the overlay's clear-history
// keybinding (Ashley 2026-07-27). If UAT reveals a different key (e.g.
// `c`, `Ctrl+L`), change this constant only — the two-keystroke shape
// stays the same.
export const BTW_CLEAR_HISTORY_KEY = "x";

// Local shellQuote — byte-identical to src/backend/ssh/terminal.ts L123.
// Kept local (not cross-module import) to preserve terminal.ts's
// "no new deps, no new modules" comment above L122. If a future refactor
// promotes shellQuote to a shared module, update both call sites in lock-step.
const shellQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}'`;

// Test-only re-export of the local shellQuote helper. NOT for production
// callers — the underscore prefix marks it as an internal test seam. Lets
// claude-session-server.aside.test.ts verify byte-parity with terminal.ts L123
// without duplicating the 2-line body in the test file.
export const __asideShellQuoteForTests = shellQuote;

/**
 * injectBtw — send the fixed /btw prompt into the identity's tmux pane via
 * the pane's existing SSH connection. Wraps the send-keys payload and target
 * in shellQuote (house-style parity with terminal.ts L574 + L760). Failures
 * are logged and swallowed — a failed injection is not fatal; Wave 2's
 * poll-timeout logic handles the "no answer arrived" case.
 */
async function injectBtw(
  conn: SSHClientType,
  tmuxSession: string,
): Promise<void> {
  try {
    // Patch #152 (2026-07-26): Send BTW_PROMPT text and the Enter keystroke
    // as TWO separate tmux send-keys invocations with a 200ms gap. In one
    // call, Claude Code v2.1.150's Ink-based REPL treats the ~300-char
    // BTW_PROMPT burst as a paste and absorbs the trailing Enter into the
    // paste buffer — /btw overlay never opens. Two calls + delay lets the
    // paste buffer flush before Enter arrives as a distinct keystroke.
    // See ~/.claude/identities/tina/bounties/aside-btw-enter-not-submitting/
    // for the live reproduction + fix verification against v2.1.150.
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} ${shellQuote(BTW_PROMPT)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} Enter`,
    );
  } catch (err) {
    sshLogger.info("aside injectBtw failed", {
      operation: "aside_inject",
      tmuxSession,
      err,
    });
  }
}

// Test-only re-export of injectBtw. Same underscore-prefix convention as
// __asideShellQuoteForTests — internal seam so the vitest suite can assert
// the two-call shape locked by Patch #152. NOT for production callers.
export const __injectBtwForTests = injectBtw;

/**
 * dismissBtw — close the /btw overlay via a TWO-keystroke sequence into the
 * identity's tmux pane. Replaces the previous single-Escape dismiss so that
 * the /btw overlay's in-session history is cleared BEFORE the overlay
 * closes; without this, prior aside answers within the same Claude Code
 * session poison subsequent asides (the model self-references earlier
 * "please explain" turns from the same overlay history buffer).
 *
 * Sequence:
 *   1. tmux send-keys BTW_CLEAR_HISTORY_KEY (`x`) — clear /btw history.
 *   2. Wait 100ms (see gap rationale below).
 *   3. tmux send-keys Escape — close the /btw overlay.
 *
 * The 100ms gap mirrors the SHAPE of patch #152's injectBtw two-call
 * workaround but uses a shorter delay: dismiss is a pair of single-key
 * presses, not the ~300-char BTW_PROMPT paste that needs Ink's paste
 * buffer to flush. 100ms is enough for tmux to deliver the first keystroke
 * to the overlay before the second is queued.
 *
 * The WS frame shape (`{type:'aside_dismissed', hostId, tmuxSession}`) and
 * the frontend dismiss handler are UNCHANGED — only the backend tmux
 * keystroke sequence differs from the prior single-Escape dispatch. Both
 * send-keys calls are wrapped in a single try/catch (log-and-swallow) so a
 * failed dismiss is not fatal; the pane's Escape recovery is best-effort.
 *
 * Both send-keys payloads use shellQuote for the tmux target (house-style
 * parity with terminal.ts L574 + L760). Escape is an unquoted tmux
 * send-keys key name — same shape as `Enter` / `C-c` in terminal.ts.
 */
async function dismissBtw(
  conn: SSHClientType,
  tmuxSession: string,
): Promise<void> {
  try {
    // Step 1: clear /btw history via BTW_CLEAR_HISTORY_KEY before Escape.
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} ${shellQuote(BTW_CLEAR_HISTORY_KEY)}`,
    );
    // Step 2: 100ms gap so tmux delivers the clear-history key to the
    // overlay before Escape is queued. Shorter than injectBtw's 200ms —
    // no paste-buffer flush needed for a single-key press.
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Step 3: send Escape to close the (now history-cleared) /btw overlay.
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} Escape`,
    );
  } catch (err) {
    sshLogger.info("aside dismissBtw failed", {
      operation: "aside_dismiss",
      tmuxSession,
      err,
    });
  }
}

// Test-only re-export of dismissBtw. Same underscore-prefix convention as
// __injectBtwForTests — internal seam so the vitest suite can assert the
// two-call shape locked by the quick 260727-lbr change. NOT for production
// callers.
export const __dismissBtwForTests = dismissBtw;

/**
 * extractBtwAnswer — pure string function that extracts the /btw answer
 * text from a raw tmux capture-pane output snapshot.
 *
 * Input:
 *   paneOutput: raw multi-line output from `tmux capture-pane -p -S -200`
 *   marker:     the end-of-answer substring (typically ASIDE_END_MARKER,
 *               i.e. "Esc to close")
 *
 * Behavior contract (validated by claude-session-server.aside.test.ts
 * cases A-E; per 14-01-PLAN.md Task 2 <behavior>):
 *
 *   A. marker absent            → null   (answer still streaming)
 *   B. single-line answer       → the trimmed text between /btw echo + marker
 *   C. multi-line with scrollback → last-occurrence anchors on BOTH the marker
 *      AND the /btw echo pick the CURRENT invocation, not any prior BTW echo
 *      still visible in scrollback (ASIDE-04 scrollback-recovery requirement)
 *   D. marker present but no /btw echo → null (malformed; do not emit garbage
 *      to the frontend — Wave 3 renders this string into React and we do not
 *      want a false-positive aside from parsing noise)
 *   E. marker + /btw echo + zero lines between → "" (degenerate valid case;
 *      Wave 2's poll-stability guard filters these — the extractor itself
 *      does not judge)
 *
 * The `/^\s*(>\s*)?\/btw\b/` regex allows for tmux prompt prefixes like
 * `> ` that Claude Code renders before the echoed slash-command. The `\b`
 * word-boundary prevents matching random lines that happen to contain
 * `/btw` as a substring (e.g. a URL or a file path).
 */
export function extractBtwAnswer(
  paneOutput: string,
  marker: string,
): string | null {
  const lines = paneOutput.split("\n");

  // (2) Find the LAST index containing the marker substring.
  let endIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(marker)) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null; // CASE A

  // (3) Find the LAST index BEFORE endIdx that matches the /btw echo pattern.
  //     Allow optional tmux prompt prefix (e.g. `> `).
  const btwEchoRe = /^\s*(>\s*)?\/btw\b/;
  let startIdx = -1;
  for (let i = endIdx - 1; i >= 0; i--) {
    if (btwEchoRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null; // CASE D

  // (5) Slice between the two anchors (exclusive of both), join, trim.
  //     May return "" for CASE E (valid degenerate).
  return lines.slice(startIdx + 1, endIdx).join("\n").trim();
}

// Phase 14 Wave 2 (14-02) — Aside subsystem module-scope state + helpers.
//
// Non-negotiable architecture (per CONTEXT.md § Trigger + § Backend per-
// connection state locks, 2026-07-26):
//
//   * asideState MUST live at MODULE SCOPE, not inside wss.on("connection").
//     Cross-tab dismiss coherence (ASIDE-11) requires broadcastAsideDismissed
//     to flip peer WSes' `displayed` flags — closure-scoped `let` variables
//     would leave stale gates on peer connections and silently break the v1
//     overlap policy (ASIDE-08) across tabs.
//
//   * The SOLE trigger source is the client's `aside_arm` WS message. The
//     backend does NOT observe the terminal WSS idle-signal frame
//     (that runs on port 30002 in terminal.ts, a separate closure with no
//     shared state). Identity gating happens frontend-side.
//
//   * No aside store beyond these two ephemeral Maps — the tmux BTW overlay
//     is source of truth (ASIDE-10). Both Maps are keyed by live WS
//     connections / session identity and are dropped on disconnect.
//
// `asideState` — per-WS overlap-ignore gate flags.
//   `armed`: /btw has been injected on this WS, poller should scrape.
//   `displayed`: an aside is currently rendered on this WS (own render OR
//                broadcast render from another tab's arm on the same session).
//
// Phase 14 Plan 05 Task 1: `export` added so Wave 5's integration test
// suite can inspect the source-of-truth Map directly (`import { asideState }`)
// to assert cross-tab peer-state-flip coherence — the atomic BOTH-STEPS
// rule from CONTEXT.md § Backend per-connection state LOCK. This is a
// legitimate observation seam, NOT a test-only export: the Map IS the
// source of truth per the CONTEXT lock, and observing it is the same
// posture as any other exported module constant. The pre-existing
// `__asideStateForTests` alias (below) is preserved for backward
// compatibility with Wave 2's structural tests.
export const asideState = new Map<
  import("ws").WebSocket,
  { armed: boolean; displayed: boolean }
>();

// `activeViewers` — fan-out registry keyed by `${hostId}::${tmuxSession}`.
// Set on connectToPane discovery success; peer entry removed on ws.close.
const activeViewers = new Map<string, Set<import("ws").WebSocket>>();

// ASIDE_POLL_INTERVAL_MS — extraction poll cadence (per CONTEXT.md
// § Extraction: ~200-400ms; picked 300ms as the mid-point, matching the
// house-style grouping with other polling-interval constants like
// HARNESS_TASKS_INTERVAL_MS.
const ASIDE_POLL_INTERVAL_MS = 300;

// sessionKey — build the `${hostId}::${tmuxSession}` composite key used
// as the activeViewers Map's index. Delimiter `::` avoids collision with
// tmux-safe session names (frontend restricts to alphanumeric + dash +
// underscore, so `::` never appears inside the session name half).
function sessionKey(hostId: number, tmuxSession: string): string {
  return `${hostId}::${tmuxSession}`;
}

// broadcastAsideDismissed — atomic fan-out for the dismiss signal.
// LOAD-BEARING per CONTEXT.md § Backend per-connection state (2026-07-26 lock):
// MUST perform BOTH steps for every OPEN peer in activeViewers.get(key):
//   (a) send `{type:"aside_dismissed"}` frame to peer's client
//   (b) flip `asideState.get(peer).displayed = false` — resets the peer's
//       overlap-ignore gate so it can arm on the next isIdle transition.
// Missing step (b) silently breaks the v1 overlap policy (ASIDE-08) across
// tabs — the peer stays stuck on `displayed:true` forever.
function broadcastAsideDismissed(key: string): void {
  const peers = activeViewers.get(key);
  if (!peers) return;
  const frame = JSON.stringify({ type: "aside_dismissed" });
  for (const peer of peers) {
    // WebSocket.OPEN = 1 (from the "ws" package). Use the numeric sentinel
    // rather than the class constant to avoid coupling this helper to a
    // direct WebSocketServer import here (the class is imported at file top).
    if (peer.readyState !== WebSocket.OPEN) continue;
    // (a) Send the dismiss frame to the peer's client.
    try {
      peer.send(frame);
    } catch {
      /* peer may be mid-close — swallow, matching the sibling send-guards
         throughout this file */
    }
    // (b) MANDATORY per CONTEXT.md § Backend per-connection state:
    // flip the peer's `displayed` flag so its overlap-ignore gate resets
    // and the peer can arm on next turn's isIdle transition.
    const peerState = asideState.get(peer);
    if (peerState) peerState.displayed = false;
  }
}

// Test-only re-exports — internal test seams. Underscore prefix marks them
// as private; NO production caller should reference these. Enables the
// vitest suite to assert the module-scope Map identities + the atomic
// BOTH-STEPS rule of broadcastAsideDismissed without spinning up a full
// WebSocketServer.
export const __asideStateForTests = asideState;
export const __activeViewersForTests = activeViewers;
export const __sessionKeyForTests = sessionKey;
export const __broadcastAsideDismissedForTests = broadcastAsideDismissed;

// ---------------------------------------------------------------------------
// Quick 260727-tb1: identity:count-bounties handler + test seam
// ---------------------------------------------------------------------------
//
// The handler is extracted from the switch-dispatcher's message-router so the
// vitest suite can drive it without a real WebSocketServer. Wire shape:
//
//   in:  { type: "identity:count-bounties", targets: [{identityKey, hostId}, ...] }
//   out: { type: "identity:bounty-counts", counts:  [{identityKey, hostId, pinnedCount, error?}, ...] }
//
// Semantics:
//   - hostId=null OR hostId in IDENTITIES_LOCAL_HOST_IDS → local (bind-mount) branch.
//   - Otherwise: group targets by hostId, resolve host once, connectOneShot
//     once per hostId, run every identity in that hostId's group through the
//     single conn, close via try/finally.
//   - Every per-target read is wrapped in Promise.allSettled so one dead
//     SSH host cannot block the batch.
//   - Rejected reads → {pinnedCount: 0, error: String(reason)}.

type CountBountiesTarget = { identityKey: string; hostId: number | null };
type CountBountiesResult = {
  identityKey: string;
  hostId: number | null;
  pinnedCount: number;
  error?: string;
};

async function readOneTarget(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<number> {
  // The reader itself validates identityKey; forwarding invalid keys is fine
  // — the rejection lands in the per-target error field via allSettled.
  return readIdentityPinnedBountyCount(conn, identityKey);
}

export async function handleIdentityCountBounties(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const rawTargets = (msg as { targets?: unknown }).targets;
  const targets: CountBountiesTarget[] = Array.isArray(rawTargets)
    ? rawTargets
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => {
          const key = typeof t.identityKey === "string" ? t.identityKey : "";
          const hostIdRaw = t.hostId;
          const hostId =
            typeof hostIdRaw === "number" &&
            Number.isFinite(hostIdRaw) &&
            hostIdRaw > 0
              ? hostIdRaw
              : null;
          return { identityKey: key, hostId };
        })
    : [];

  if (targets.length === 0) {
    try {
      ws.send(JSON.stringify({ type: "identity:bounty-counts", counts: [] }));
    } catch {
      /* ignore */
    }
    return;
  }

  // Group targets by "routing key": hostId=null / local hosts → "local";
  // otherwise the numeric hostId. Each group opens one conn (or zero for
  // the local group) and reads all its identities through the same conn.
  const groups = new Map<string | number, CountBountiesTarget[]>();
  for (const t of targets) {
    const useLocal = t.hostId === null || isLocalHostId(t.hostId);
    const groupKey: string | number = useLocal ? "local" : t.hostId!;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(t);
    else groups.set(groupKey, [t]);
  }

  // Fan-out: each group returns Array<CountBountiesResult>. Group-level
  // failures (host not found, connectOneShot rejection) collapse into
  // per-target error entries so the caller still gets a uniform response.
  const groupPromises: Array<Promise<CountBountiesResult[]>> = [];
  for (const [groupKey, bucket] of groups) {
    if (groupKey === "local") {
      groupPromises.push(
        (async () => {
          const settled = await Promise.allSettled(
            bucket.map((t) => readOneTarget(null, t.identityKey)),
          );
          return settled.map((s, i) => {
            const t = bucket[i];
            if (s.status === "fulfilled") {
              return {
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: s.value,
              };
            }
            return {
              identityKey: t.identityKey,
              hostId: t.hostId,
              pinnedCount: 0,
              error: String((s.reason as Error)?.message ?? s.reason),
            };
          });
        })(),
      );
    } else {
      const hostIdNum = groupKey as number;
      groupPromises.push(
        (async () => {
          let conn: SSHClientType | null = null;
          try {
            const resolved = await resolveHostById(hostIdNum, userId!);
            if (!resolved) {
              return bucket.map((t) => ({
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: 0,
                error: "host not found",
              }));
            }
            conn = await connectOneShot(
              resolved as unknown as Parameters<typeof connectOneShot>[0],
              5000,
            );
            const settled = await Promise.allSettled(
              bucket.map((t) => readOneTarget(conn, t.identityKey)),
            );
            return settled.map((s, i) => {
              const t = bucket[i];
              if (s.status === "fulfilled") {
                return {
                  identityKey: t.identityKey,
                  hostId: t.hostId,
                  pinnedCount: s.value,
                };
              }
              return {
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: 0,
                error: String((s.reason as Error)?.message ?? s.reason),
              };
            });
          } catch (err) {
            // Group-level failure (resolveHostById throw or connect timeout).
            const msgStr = err instanceof Error ? err.message : String(err);
            return bucket.map((t) => ({
              identityKey: t.identityKey,
              hostId: t.hostId,
              pinnedCount: 0,
              error: msgStr,
            }));
          } finally {
            if (conn) {
              try {
                conn.end();
              } catch {
                /* ignore */
              }
            }
          }
        })(),
      );
    }
  }

  const groupResults = await Promise.all(groupPromises);
  const counts: CountBountiesResult[] = groupResults.flat();

  try {
    ws.send(JSON.stringify({ type: "identity:bounty-counts", counts }));
  } catch {
    /* ws may be mid-close */
  }
}

// Test seam — quick 260727-tb1. Vitest drives the handler directly rather
// than spinning up a WebSocketServer + ssh2 pair. Aliased to underscore so
// production consumers stay clear of the internal handler.
export const __handleIdentityCountBountiesForTests = handleIdentityCountBounties;

const wss = new WebSocketServer({ port: 30011 });

wss.on("connection", async (ws: WebSocket, req) => {
  let userId: string | undefined;
  let sessionId: string | undefined;

  try {
    let token: string | undefined;

    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length);
      }
    }

    if (!token) {
      const urlObj = new URL(req.url || "", "http://localhost");
      const qp = urlObj.searchParams.get("token");
      if (qp) token = qp;
    }

    if (!token) {
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload?.userId || payload.pendingTOTP) {
      ws.close(1008, "Authentication required");
      return;
    }

    userId = payload.userId;
    sessionId = payload.sessionId;
  } catch (error) {
    sshLogger.error(
      "Claude session WS JWT verification failed",
      error,
      {
        operation: "claude_session_ws_error",
        ip: req.socket.remoteAddress,
      },
    );
    ws.close(1008, "Authentication required");
    return;
  }

  const dataKey = userCrypto.getUserDataKey(userId);
  if (!dataKey) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Data locked - re-authenticate with password",
        code: "DATA_LOCKED",
      }),
    );
    ws.close(1008, "Data access required");
    return;
  }

  sshLogger.info("Claude session WebSocket connection established", {
    operation: "claude_session_ws_connect",
    userId,
    sessionId,
  });

  // Phase 14 Wave 2: initialize this WS's overlap-ignore state in the
  // module-scope asideState Map (per CONTEXT.md § Backend per-connection
  // state lock 2026-07-26). Cleaned up in ws.on("close") below.
  asideState.set(ws, { armed: false, displayed: false });

  let sshConn: SSHClientType | null = null;
  let tailHandle: TailHandle | null = null;
  let contextPctTimer: NodeJS.Timeout | null = null;
  let contextPctInFlight = false;
  // Phase 14 Wave 2: per-connection aside extraction bookkeeping. These
  // are per-connection (not cross-tab-shared) so closure-scope is correct.
  // Only `armed`/`displayed` MUST live in module-scope asideState — per
  // CONTEXT.md § Backend per-connection state lock.
  let asideExtractionTimer: NodeJS.Timeout | null = null;
  let asideExtractionInFlight = false;
  let lastStableCapture: string | null = null;
  let hadMarkerLastCapture = false;
  let harnessTasksTimer: NodeJS.Timeout | null = null;
  let harnessTasksInFlight = false;
  let harnessTasksLastSerialized: string | null = null;
  // Backgrounded-agent tracking (patch #61): parent-JSONL scan for Agent
  // tool_use blocks with run_in_background:true, paired against subsequent
  // tool_result blocks by tool_use_id. Emit on serialized-change only.
  // `backgroundedAgentsLastSerialized` is initialized to "[]" (not "") so
  // a JSONL with no background agents produces net-zero emits after the
  // initial `tail -F -n +1` replay.
  const backgroundedAgents = new Map<
    string,
    {
      toolUseId: string;
      subagentType: string;
      description: string;
      startedAt: number;
    }
  >();
  let backgroundedAgentsLastSerialized = "[]";
  // Backgrounded-shells tracking (patch #68): parent-JSONL scan for Bash
  // tool_use blocks with run_in_background:true, paired against subsequent
  // <task-notification> completion payloads. Unlike backgroundedAgents,
  // there is NO tool_result-removal branch — Bash BG tool_results are
  // ALWAYS launch-acks (content starts with "Command running in background
  // with ID:"). Real completion arrives via task-notification only, handled
  // in the shared patch-#66 IIFE below.
  // `backgroundedShellsLastSerialized` is initialized to "[]" (not "") so
  // an empty initial state doesn't emit a spurious frame.
  const backgroundedShells = new Map<
    string,
    {
      toolUseId: string;
      description: string;
      command: string;
      ts: number;
    }
  >();
  let backgroundedShellsLastSerialized = "[]";
  // Plan-pending tracking (patch #63): parent-JSONL scan for
  // ExitPlanMode tool_use blocks (Claude asking Ashley to accept /
  // keep-planning in Plan Mode), paired against subsequent
  // tool_result blocks by tool_use_id. Emit on serialized-change
  // only. `pendingPlansLastSerialized` is initialized to "null" (not
  // "") so a JSONL with no unmatched ExitPlanMode produces net-zero
  // emits after the initial `tail -F -n +1` replay — the emit shape
  // when pending is null is `{ type: "plan_pending", pending: null }`
  // and JSON.stringify(null) === "null", so matching the initial
  // sentinel to "null" suppresses the spurious first empty emit.
  const pendingPlans = new Map<
    string,
    { planFilePath: string; ts: number }
  >();
  let pendingPlansLastSerialized = "null";
  let stopped = false;

  // Phase 3 session-changeover state machine. Per D-30 (two-layer detection):
  // `active`  — currently tailing a live session; ticker also polls context-% + tasks.
  // `holding` — recycle in progress: /exit was seen OR discovery repoll showed a
  //             changed sessionFile, but the new tail has not started yet
  //             (Layer 1 fires this on `/exit`; Layer 2 fires it same-tick when
  //             it spots a changed file with no prior /exit).
  // `dead`    — holding timed out (~45s); one final `{type:"inactive"}` was sent
  //             and all pollers/tail were stopped. WS remains open so the client
  //             can render FALLBACK-01; no auto-restart from here.
  type ChangeoverState = "active" | "holding" | "dead";
  let changeoverState: ChangeoverState = "active";
  let currentSessionFile: string | null = null; // set on first discovery success and each session_changed
  let sessionIdFromFile: string | null = null; // UUID basename of currentSessionFile; drives harness-tasks poller cmd (BLOCKER fix)
  let hasSeenExit = false; // Layer 1 flag; reset on session_changed
  let holdingTicks = 0; // # of 3s ticks in `holding`; timeout at HOLDING_TIMEOUT_TICKS
  let discoveryRepollInFlight = false; // guard against slow SSH pileups (mirrors contextPctInFlight)
  let discoveryRepollTimer: NodeJS.Timeout | null = null;
  // Phase 3: current pane's hostId/tmuxSession hoisted to connection scope so
  // the state-transition helpers (defined once per connection) can log with
  // the right context and so `transitionToActiveNew` can pass tmuxSession into
  // `discoverClaudeSession` if needed. Set on connectToPane after successful
  // discovery; cleared in teardownPane. The connection callback enforces
  // one active pane per WS (line 295 `if (sshConn || tailHandle) teardownPane()`),
  // so these are effectively read-only for the lifetime of a pane.
  let currentHostId: number | null = null;
  let currentTmuxSession: string | null = null;

  const teardownPane = () => {
    if (contextPctTimer) {
      clearInterval(contextPctTimer);
      contextPctTimer = null;
    }
    if (harnessTasksTimer) {
      clearInterval(harnessTasksTimer);
      harnessTasksTimer = null;
    }
    if (discoveryRepollTimer) {
      clearInterval(discoveryRepollTimer);
      discoveryRepollTimer = null;
    }
    // Phase 14 Wave 2: extraction poller lifecycle is tied to the pane —
    // teardownPane fires on connectToPane rebind and (via ws.on("close"))
    // on disconnect. activeViewers Set membership is torn down in
    // ws.on("close") only (not here) because a pane-switch keeps the WS
    // itself alive; the fan-out registry is per-WS, not per-pane.
    if (asideExtractionTimer) {
      clearInterval(asideExtractionTimer);
      asideExtractionTimer = null;
    }
    asideExtractionInFlight = false;
    lastStableCapture = null;
    hadMarkerLastCapture = false;
    // Reset per-WS aside gates on pane rebind — the fresh pane has no
    // aside in flight yet. asideState entry itself stays (module-scope,
    // lifetime = WS connection); we just clear the flags.
    const st = asideState.get(ws);
    if (st) {
      st.armed = false;
      st.displayed = false;
    }
    // Phase 14 Wave 2: on pane rebind, remove this WS from any prior
    // pane's fan-out registry so a subsequent broadcast doesn't spuriously
    // dismiss on the new pane. The current-pane registration happens
    // freshly in the connectToPane handler below (after discovery success).
    if (currentHostId != null && currentTmuxSession != null) {
      const priorKey = sessionKey(currentHostId, currentTmuxSession);
      const priorPeers = activeViewers.get(priorKey);
      if (priorPeers) {
        priorPeers.delete(ws);
        if (priorPeers.size === 0) activeViewers.delete(priorKey);
      }
    }
    harnessTasksLastSerialized = null;
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
    backgroundedAgents.clear();
    backgroundedAgentsLastSerialized = "[]";
    backgroundedShells.clear();
    backgroundedShellsLastSerialized = "[]";
    // Phase 3: reset changeover state so a full pane teardown-and-reconnect
    // (e.g. via a fresh connectToPane) starts clean. connectToPane already
    // calls teardownPane before starting a new pane; being defensive here
    // means the state is guaranteed reset even if teardownPane is called
    // from elsewhere (e.g. transitionToDead) without a follow-up reconnect.
    changeoverState = "active";
    currentSessionFile = null;
    sessionIdFromFile = null;
    hasSeenExit = false;
    holdingTicks = 0;
    discoveryRepollInFlight = false;
    currentHostId = null;
    currentTmuxSession = null;
    if (tailHandle) {
      try {
        tailHandle.stop();
      } catch {
        /* ignore */
      }
      tailHandle = null;
    }
    if (sshConn) {
      try {
        sshConn.end();
      } catch {
        /* ignore */
      }
      sshConn = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Phase 3 canonical declaration order (W1 fix from plan-checker):
  //   state vars (above)
  //   → teardownPane (above)
  //   → const onLine (here)
  //   → const onError (here)
  //   → setupHarnessTasksPoller (here)
  //   → transitionToHolding (here)
  //   → transitionToActiveNew (here; references onLine, onError, setupHarnessTasksPoller)
  //   → transitionToDead (here; references teardownPane)
  //   → ws.on("message") handler body (below, unchanged shape)
  //
  // All cross-references between helpers happen at call-time inside async
  // callbacks (setInterval, tail's onLine), never at synchronous handler-body
  // execution — so TypeScript's TDZ and JS's const-scoping are both happy
  // with this order. `hostId` and `tmuxSession` from the connectToPane
  // message handler are captured via connection-scoped `let currentHostId` /
  // `let currentTmuxSession` (set on discovery success, cleared in
  // teardownPane) so these helpers can log with the correct context.
  // ---------------------------------------------------------------------------

  // Tail's onLine handler — extracted from the pre-Phase-3 inline lambda so
  // `transitionToActiveNew` can restart the tail with the SAME callbacks
  // rather than duplicating them. Body is byte-for-byte preserved from the
  // pre-refactor code with ONE addition: the Layer 1 raw-line /exit scan
  // right after the ws-open guard.
  const onLine = (line: string) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;

    // Phase 3 Layer 1: raw-line /exit marker scan (BEFORE JSON.parse for
    // cheapness). Empirical (verified 2026-07-18): /exit lands as a
    // type:"user" turn with content
    // "<command-name>/exit</command-name>\n            <command-message>exit</command-message>..."
    // Sub-second edge-triggered detection of graceful recycle. The
    // discovery repoll in the ticker (Layer 2) catches SIGTERM-fallback
    // and recover-in-different-cwd. See CONTEXT.md D-30 for two-layer
    // rationale.
    if (
      !hasSeenExit &&
      changeoverState === "active" &&
      line.includes('"content":"<command-name>/exit</command-name>')
    ) {
      hasSeenExit = true;
      transitionToHolding("exit_marker");
      // Fall through — the parser may still emit the /exit turn as a
      // message (per Ashley's HARD LOCK: slash commands must remain
      // visible in pretty view). The state transition is orthogonal to
      // whether the /exit text renders as a chat bubble. DO NOT `return`
      // here.
    }

    // Parallel raw-line scan for backgrounded Agent invocations (patch
    // #61). Runs ALONGSIDE parseSessionLine, not through it — RENDER-01
    // HARD LOCK strips tool_use/tool_result blocks structurally at the
    // parser, so they never reach parseSessionLine's output. A second
    // JSON.parse is trivially cheap at these volumes.
    //
    // Detection (from github.com/delexw/claude-code-trace spec 09):
    //   - tool_use with name === "Agent" and input.run_in_background ===
    //     true → started; keyed by tool_use.id.
    //   - tool_result with matching tool_use_id → completed; drop.
    // Emit `backgrounded_agents` only when the sorted-serialized list
    // changes vs last emit. The tail's `-n +1` replay converges the map
    // naturally through history — a completed subagent adds then removes
    // within a few lines, and the initial `lastSerialized = "[]"` matches
    // the empty-list stringification so no spurious empty emit fires.
    try {
      const obj = JSON.parse(line) as {
        type?: string;
        timestamp?: string;
        message?: { content?: unknown };
      };
      const content = obj?.message?.content;
      if (obj?.type === "assistant" && Array.isArray(content)) {
        for (const block of content as unknown[]) {
          const b = block as {
            type?: string;
            name?: string;
            id?: string;
            input?: {
              run_in_background?: boolean;
              subagent_type?: unknown;
              description?: unknown;
              command?: unknown;
            };
          };
          if (
            b?.type === "tool_use" &&
            b?.name === "Agent" &&
            b?.input?.run_in_background === true &&
            typeof b?.id === "string"
          ) {
            const startedAt =
              typeof obj.timestamp === "string"
                ? Date.parse(obj.timestamp) || Date.now()
                : Date.now();
            backgroundedAgents.set(b.id, {
              toolUseId: b.id,
              subagentType:
                typeof b.input.subagent_type === "string"
                  ? b.input.subagent_type
                  : "",
              description:
                typeof b.input.description === "string"
                  ? b.input.description
                  : "",
              startedAt,
            });
          }
          if (
            b?.type === "tool_use" &&
            b?.name === "Bash" &&
            b?.input?.run_in_background === true &&
            typeof b?.id === "string"
          ) {
            const ts =
              typeof obj.timestamp === "string"
                ? Date.parse(obj.timestamp) || Date.now()
                : Date.now();
            const rawCommand =
              typeof b.input.command === "string" ? b.input.command : "";
            backgroundedShells.set(b.id, {
              toolUseId: b.id,
              description:
                typeof b.input.description === "string"
                  ? b.input.description
                  : "",
              command: rawCommand.slice(0, 120),
              ts,
            });
          }
        }
      } else if (obj?.type === "user" && Array.isArray(content)) {
        // Async launch acks (patch #66 fix): for run_in_background:true Agent
        // invocations, Claude Code writes a tool_result within ~100ms of the
        // tool_use as a LAUNCH ACKNOWLEDGEMENT ("Async agent launched
        // successfully...") — NOT completion. The turn carries
        // toolUseResult.isAsync === true and status: "async_launched". Real
        // completion arrives ~seconds-to-minutes later as a task-notification
        // attachment turn (see the new branch below). Skip removal for the
        // ack so the panel stays mounted; the attachment branch clears it
        // on the actual completion event.
        const isAsyncAck =
          (obj as { toolUseResult?: { isAsync?: boolean } })?.toolUseResult
            ?.isAsync === true;
        if (!isAsyncAck) {
          for (const block of content as unknown[]) {
            const b = block as {
              type?: string;
              tool_use_id?: string;
            };
            if (
              b?.type === "tool_result" &&
              typeof b?.tool_use_id === "string"
            ) {
              backgroundedAgents.delete(b.tool_use_id);
            }
          }
        }
      }
      // Patch #66 completion signal for backgrounded Agents. Claude Code /
      // its harness lands the task-notification payload in the JSONL in
      // AT LEAST three observed shapes across versions and states:
      //   (1) type:"attachment" with attachment.commandMode:"task-
      //       notification" and attachment.prompt carrying the XML.
      //   (2) type:"queue-operation" with a top-level `content` string
      //       carrying the XML (harness enqueue bookkeeping).
      //   (3) type:"user" with message.content being a raw STRING that
      //       starts with "<task-notification>" (the user-turn form
      //       observed on this box's Claude Code v2.1.143).
      // Detect any of the three by picking whichever field carries the
      // payload; require the STRING to START with "<task-notification>"
      // (not merely contain it) so a normal user message or tool_result
      // that happens to quote the phrase does NOT false-positive — same
      // discipline as patch #65's anchored /exit scan.
      const notifPayload = ((): string | null => {
        // Shape 1: type:"attachment" + attachment.prompt
        const attachmentAny = obj as {
          type?: string;
          attachment?: { commandMode?: string; prompt?: unknown };
        };
        if (
          attachmentAny?.type === "attachment" &&
          attachmentAny?.attachment?.commandMode === "task-notification" &&
          typeof attachmentAny?.attachment?.prompt === "string" &&
          attachmentAny.attachment.prompt.startsWith("<task-notification>")
        ) {
          return attachmentAny.attachment.prompt;
        }
        // Shape 2: type:"queue-operation" + top-level content string
        const qopAny = obj as { type?: string; content?: unknown };
        if (
          qopAny?.type === "queue-operation" &&
          typeof qopAny?.content === "string" &&
          qopAny.content.startsWith("<task-notification>")
        ) {
          return qopAny.content;
        }
        // Shape 3: type:"user" + message.content as raw XML string
        if (
          obj?.type === "user" &&
          typeof content === "string" &&
          content.startsWith("<task-notification>")
        ) {
          return content;
        }
        return null;
      })();
      if (notifPayload) {
        const idMatch = notifPayload.match(
          /<tool-use-id>(toolu_[^<]+)<\/tool-use-id>/,
        );
        const statusMatch = notifPayload.match(
          /<status>(completed|failed|stopped|cancelled|error)<\/status>/,
        );
        if (idMatch && statusMatch) {
          backgroundedAgents.delete(idMatch[1]);
          backgroundedShells.delete(idMatch[1]);
        }
      }
      // Plan-pending scan (patch #63). Reuses `obj` + `content` from the
      // patch-#61 backgrounded-agents scan above; do NOT re-parse.
      //   - assistant turn whose content[] contains a tool_use block with
      //     name === "ExitPlanMode" → pending; keyed by tool_use.id.
      //   - user turn whose content[] contains a tool_result with matching
      //     tool_use_id → cleared. (The patch-#61 branch already iterates
      //     tool_result blocks for its Agent correlation; adding one more
      //     `pendingPlans.delete(id)` call in the same loop is the cheap
      //     option, but for readability we do a fresh iteration here — the
      //     line volume is low enough that it does not matter.)
      if (obj?.type === "assistant" && Array.isArray(content)) {
        for (const block of content as unknown[]) {
          const b = block as {
            type?: string;
            name?: string;
            id?: string;
            input?: { planFilePath?: unknown };
          };
          if (
            b?.type === "tool_use" &&
            b?.name === "ExitPlanMode" &&
            typeof b?.id === "string"
          ) {
            pendingPlans.set(b.id, {
              planFilePath:
                typeof b.input?.planFilePath === "string"
                  ? b.input.planFilePath
                  : "",
              ts:
                typeof obj.timestamp === "string"
                  ? Date.parse(obj.timestamp) || Date.now()
                  : Date.now(),
            });
          }
        }
      } else if (obj?.type === "user" && Array.isArray(content)) {
        for (const block of content as unknown[]) {
          const b = block as { type?: string; tool_use_id?: string };
          if (
            b?.type === "tool_result" &&
            typeof b?.tool_use_id === "string"
          ) {
            pendingPlans.delete(b.tool_use_id);
          }
        }
      }
      // Only one ExitPlanMode can be pending at a time in practice (Claude
      // Code's Ink UI serializes Plan Mode prompts), so taking any entry
      // (via `.values().next()`) is correct. If somehow more than one
      // survives, we still emit a stable answer — whichever entry the map
      // returns first — until one is closed.
      const pendingIter = pendingPlans.values().next();
      const currentPending = pendingIter.done
        ? null
        : { planFilePath: pendingIter.value.planFilePath };
      const planSerialized = JSON.stringify(currentPending);
      if (planSerialized !== pendingPlansLastSerialized) {
        pendingPlansLastSerialized = planSerialized;
        try {
          ws.send(
            JSON.stringify({
              type: "plan_pending",
              pending: currentPending,
            }),
          );
        } catch {
          /* ws may be mid-close */
        }
      }
      const agents = Array.from(backgroundedAgents.values()).sort(
        (a, b) => a.startedAt - b.startedAt,
      );
      const serialized = JSON.stringify(agents);
      if (serialized !== backgroundedAgentsLastSerialized) {
        backgroundedAgentsLastSerialized = serialized;
        try {
          ws.send(
            JSON.stringify({ type: "backgrounded_agents", agents }),
          );
        } catch {
          /* ws may be mid-close */
        }
      }
      const shells = Array.from(backgroundedShells.values()).sort(
        (a, b) => a.ts - b.ts,
      );
      const shellsSerialized = JSON.stringify(shells);
      if (shellsSerialized !== backgroundedShellsLastSerialized) {
        backgroundedShellsLastSerialized = shellsSerialized;
        try {
          ws.send(
            JSON.stringify({ type: "backgrounded_shells", shells }),
          );
        } catch {
          /* ws may be mid-close */
        }
      }
    } catch {
      /* malformed line — silently ignore, same posture as parser */
    }

    const parsed = parseSessionLine(line);
    // Discriminator switch on parsed.kind — RENDER-01 hard-lock enforcement.
    // kind:"skip" and kind:"malformed" are silently dropped. Each emitting
    // branch sends exactly one WS frame per parsed turn; the switch guarantees
    // mutual exclusivity (only one case fires per line).
    //
    // Phase 17 (RELAYBUB-01, RELAYBUB-02) adds two new cases without touching
    // the existing "message"/"image" branches or skip/malformed semantics.
    switch (parsed.kind) {
      case "message":
        try {
          ws.send(
            JSON.stringify({
              type: "message",
              role: parsed.role,
              content: parsed.content,
              eventId: parsed.eventId,
              ts: parsed.ts,
            }),
          );
        } catch {
          /* ws may be mid-close; drop */
        }
        break;
      case "image":
        // Patch #86: images that survived the parser's dedup + role
        // derivation. Wire shape mirrors the parser's ImageMessage 1:1;
        // frontend adds the `data:${mediaType};base64,` URI prefix when
        // building the <img src>.
        try {
          ws.send(
            JSON.stringify({
              type: "image",
              role: parsed.role,
              images: parsed.images,
              text: parsed.text,
              eventId: parsed.eventId,
              ts: parsed.ts,
            }),
          );
        } catch {
          /* ws may be mid-close; drop */
        }
        break;
      case "relay_outbound":
        // Phase 17 (RELAYBUB-01): a Bash tool_use confirmed as a real Matrix
        // relay send (curl + -X PUT + URL shape conjunction). Wire shape is a
        // faithful command record — rawCommand IS the body (Option D, Ashley
        // 2026-07-28). No body extraction, no ⚠ fallback. The bubble renders
        // rawCommand as a scrollable mono block.
        // Dedup: eventId = outer JSONL uuid — appendDedup handles it identically
        // to message/image turns (no special-casing needed downstream).
        try {
          ws.send(
            JSON.stringify({
              type: "relay_outbound",
              room: parsed.room,
              rawCommand: parsed.rawCommand,
              eventId: parsed.eventId,
              ts: parsed.ts,
            }),
          );
        } catch {
          /* ws may be mid-close; drop */
        }
        break;
      case "relay_inbound":
        // Phase 17 (RELAYBUB-02): a task-notification user turn whose body
        // matches the recv.sh event-line format [room X] [@sender] (event $Y):
        // BODY. matrixEventId is the Matrix $event_id from the recv.sh line
        // (distinct from the outer JSONL uuid in eventId). raw is preserved for
        // the expand-raw panel in plan 17-03.
        try {
          ws.send(
            JSON.stringify({
              type: "relay_inbound",
              room: parsed.room,
              sender: parsed.sender,
              matrixEventId: parsed.matrixEventId,
              body: parsed.body,
              raw: parsed.raw,
              eventId: parsed.eventId,
              ts: parsed.ts,
            }),
          );
        } catch {
          /* ws may be mid-close; drop */
        }
        break;
      // kind:"skip" and kind:"malformed" — silent drop (RENDER-01 lock)
    }
  };

  // Tail's onError handler — byte-for-byte preserved from the pre-refactor
  // inline lambda apart from swapping the message-scoped `hostId` /
  // `tmuxSession` for the connection-scoped `currentHostId` /
  // `currentTmuxSession` (set on connectToPane discovery success, both are
  // non-null whenever the tail is running).
  const onError = (err: Error) => {
    sshLogger.error("Claude session tail error", err, {
      operation: "claude_session_tail_error",
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
    });
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          type: "tail_error",
          message: err.message,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  // BLOCKER fix (plan-checker 2026-07-18): the harness-tasks poller setup
  // is extracted into a helper so `transitionToActiveNew` can rebind it
  // against the NEW sessionId after a recycle. The pre-Phase-3 code baked
  // the initial-connect UUID into `tasksCmd` as a `const`, so post-recycle
  // the poller kept querying the DEAD session's tasks directory forever.
  //
  // The helper is idempotent — safe to call at any state; teardown-and-
  // restart against any UUID (including the same UUID, which is the
  // CHANGEOVER-05 recover-in-different-cwd case). The setInterval body is
  // byte-for-byte preserved from the pre-refactor block.
  const setupHarnessTasksPoller = (
    newSessionIdFromFile: string,
  ): void => {
    if (harnessTasksTimer) {
      clearInterval(harnessTasksTimer);
      harnessTasksTimer = null;
    }
    // Belt-and-braces: clear the dedupe sentinel so the first emit after
    // a restart fires unconditionally. transitionToActiveNew ALSO resets
    // this — doing it here means direct callers (e.g. the initial-connect
    // path) don't need to remember.
    harnessTasksLastSerialized = null;
    // No UUID → no tasks dir → no poller. Same guard the pre-refactor
    // patch-#52c code used; also protects against shell injection via a
    // malformed sessionId basename.
    if (!UUID_RE.test(newSessionIdFromFile)) return;

    const tasksCmd = `for f in "$HOME/.claude/tasks/${newSessionIdFromFile}"/*.json; do [ -f "$f" ] && { tr '\\n' ' ' < "$f"; echo; }; done 2>/dev/null`;
    harnessTasksTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (harnessTasksInFlight) return;
      harnessTasksInFlight = true;
      const connSnapshot = sshConn;
      execCommand(connSnapshot, tasksCmd)
        .then((output) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const tasks: unknown[] = [];
          for (const raw of output.split("\n")) {
            const line = raw.trim();
            if (!line) continue;
            try {
              tasks.push(JSON.parse(line));
            } catch {
              /* skip malformed lines silently */
            }
          }
          // Sort by numeric id ascending so display order matches /queue.
          tasks.sort((a, b) => {
            const ai = parseInt(
              String((a as { id?: unknown }).id ?? ""),
              10,
            );
            const bi = parseInt(
              String((b as { id?: unknown }).id ?? ""),
              10,
            );
            if (Number.isFinite(ai) && Number.isFinite(bi))
              return ai - bi;
            return 0;
          });
          const serialized = JSON.stringify(tasks);
          if (serialized === harnessTasksLastSerialized) return;
          harnessTasksLastSerialized = serialized;
          try {
            ws.send(
              JSON.stringify({ type: "harness_tasks", tasks }),
            );
          } catch {
            /* ws may be mid-close */
          }
        })
        .catch(() => {
          /* Silent — same posture as the context-pct poller. */
        })
        .finally(() => {
          harnessTasksInFlight = false;
        });
    }, HARNESS_TASKS_INTERVAL_MS);
  };

  // ---------------------------------------------------------------------------
  // Phase 3 state-transition helpers. All three close over the connection-
  // scoped state (changeoverState, currentSessionFile, sessionIdFromFile,
  // hasSeenExit, holdingTicks, ws, sshConn, etc.) and the connection-scoped
  // context (currentHostId, currentTmuxSession — set on connectToPane).
  // ---------------------------------------------------------------------------

  // Called when the tail's onLine sees an `/exit` marker (Layer 1, edge-
  // triggered, sub-second) OR when the ticker's discovery-repoll notices a
  // changed sessionFile without a prior /exit having been seen (Layer 2's
  // SIGTERM-fallback path). Idempotent against double-fire — if state is
  // already `holding` or `dead`, this is a no-op. That protects against the
  // race where Layer 1 fires on the tail's onLine milliseconds before the
  // ticker's Layer 2 repoll notices the same recycle.
  const transitionToHolding = (
    reason: "exit_marker" | "discovery_diff",
  ): void => {
    if (changeoverState !== "active") return;
    changeoverState = "holding";
    holdingTicks = 0;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session_holding" }));
      } catch {
        /* ws may be mid-close */
      }
    }
    sshLogger.info("Claude session entering holding state", {
      operation: "claude_session_holding",
      reason,
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      oldSessionFile: currentSessionFile,
    });
  };

  // Called by the discovery-repoll branch when a changed sessionFile is
  // detected. Tears down the old tail, clears ALL buffered per-session
  // state (CHANGEOVER-04 backend-side reset), rebinds the harness-tasks
  // poller against the new UUID (BLOCKER fix), starts a new tail on the
  // new file, and emits `session_changed`. Does NOT close the WS and does
  // NOT touch `sshConn` — the same SSH connection multiplexes the new tail
  // + the same three pollers.
  const transitionToActiveNew = (newSessionFile: string): void => {
    const oldSessionFile = currentSessionFile;
    const oldSessionIdFromFile = sessionIdFromFile;
    if (tailHandle) {
      try {
        tailHandle.stop();
      } catch {
        /* ignore */
      }
      tailHandle = null;
    }
    // Clear ALL buffered per-session state before the new tail starts so
    // the fresh session's `-n +1` replay converges on clean bookkeeping.
    harnessTasksLastSerialized = null;
    backgroundedAgents.clear();
    backgroundedAgentsLastSerialized = "[]";
    backgroundedShells.clear();
    backgroundedShellsLastSerialized = "[]";
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
    hasSeenExit = false;
    holdingTicks = 0;

    // Derive the new UUID basename using the same slug logic the initial-
    // connect path uses. Kept inline to keep this file self-contained.
    const newSessionIdFromFile = newSessionFile
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, "");
    currentSessionFile = newSessionFile;
    sessionIdFromFile = newSessionIdFromFile;

    // BLOCKER fix: rebind the harness-tasks poller against the NEW UUID.
    // For CHANGEOVER-05 (recover-in-different-cwd, UUID preserved), this
    // is an idempotent no-op restart against the same UUID — still safe.
    setupHarnessTasksPoller(newSessionIdFromFile);

    changeoverState = "active";

    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type: "session_changed",
            newSessionFile,
          }),
        );
      } catch {
        /* ws may be mid-close */
      }
    }
    sshLogger.info("Claude session changed", {
      operation: "claude_session_changed",
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      oldSessionFile,
      newSessionFile,
      // For post-deploy debugging: distinguishes recycle (UUID changed)
      // from recover-in-different-cwd (UUID preserved, projects/slug
      // subdir moved).
      sessionIdChanged:
        oldSessionIdFromFile !== newSessionIdFromFile,
    });

    // Restart the tail on the new file with the SAME onLine/onError
    // closures — do NOT create new lambdas; that would defeat the point
    // of extracting them.
    if (sshConn) {
      tailHandle = tailSessionFile(
        sshConn,
        newSessionFile,
        onLine,
        onError,
      );
    }
  };

  // Called by the discovery-repoll branch when holdingTicks reaches the
  // timeout without a new sessionFile having appeared. Emits a terminal
  // inactive frame with `reason:"holding_timeout"`, then teardownPane
  // (which stops all pollers, stops the tail, and closes the SSH
  // connection). WS stays open by default so the client renders FALLBACK-01
  // per the existing initial-inactive-exit path (~line 407-423).
  const transitionToDead = (reason: "holding_timeout"): void => {
    const finalSessionFile = currentSessionFile;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "inactive", reason }));
      } catch {
        /* ws may be mid-close */
      }
    }
    sshLogger.info("Claude session dead", {
      operation: "claude_session_dead",
      reason,
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      currentSessionFile: finalSessionFile,
    });
    // teardownPane resets changeoverState back to "active" among other
    // things — set `dead` AFTER teardown so the state accurately reflects
    // "terminal, no recovery attempts."
    teardownPane();
    changeoverState = "dead";
  };

  let wsAlive = true;

  ws.on("pong", () => {
    wsAlive = true;
  });

  const wsPingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!wsAlive) {
        sshLogger.warn(
          "Claude session WS pong timeout - terminating",
          {
            operation: "claude_session_ws_error",
            userId,
            sessionId,
          },
        );
        ws.terminate();
        return;
      }
      wsAlive = false;
      ws.ping();
    }
  }, 30000);

  ws.on("close", () => {
    clearInterval(wsPingInterval);
    stopped = true;
    teardownPane();
    // Phase 14 Wave 2: WS lifetime ended — drop this WS from all module-
    // scope aside state. teardownPane already unregistered this WS from
    // activeViewers[currentSessionKey] (via the per-pane branch), but we
    // defensively iterate here in case any prior state escaped that path
    // (e.g. a bug in a future patch). Cheap: activeViewers is small.
    asideState.delete(ws);
    for (const [key, peers] of activeViewers) {
      if (peers.delete(ws) && peers.size === 0) {
        activeViewers.delete(key);
      }
    }
    sshLogger.info("Claude session WebSocket disconnected", {
      operation: "claude_session_ws_disconnect",
      userId,
      sessionId,
    });
  });

  ws.on("error", (err: Error) => {
    sshLogger.error("Claude session WS error", err, {
      operation: "claude_session_ws_error",
      userId,
      sessionId,
    });
  });

  ws.on("message", async (raw: RawData) => {
    // Idempotency guard: once stopped, refuse all traffic.
    if (stopped) {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Connection closing",
          }),
        );
      } catch {
        /* ignore */
      }
      return;
    }

    let msg: { type?: unknown; hostId?: unknown; tmuxSession?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(
        JSON.stringify({ type: "error", message: "Malformed message" }),
      );
      return;
    }

    // Patch #87/#92: identity:list-bounties — read-only bounty fetch, independent
    // of connectToPane. Patch #92: routes via identity-artifact-reader.ts helper;
    // local branch when hostId is in IDENTITIES_LOCAL_HOST_IDS, SSH branch otherwise.
    if (msg.type === "identity:list-bounties") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(
            JSON.stringify({
              type: "identity:bounties",
              bounties: [],
              archivedBounties: [],
              error: "invalid identityKey",
            }),
          );
        } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];

        if (useLocal) {
          // LOCAL branch — bind-mount fast-path (patch #89, preserved byte-for-byte)
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:list-bounties", {
            operation: "identity_list_bounties",
            userId,
            identityKey,
            hostId: hostIdNum,
            useLocal: true,
            openCount: bounties.length,
            archivedCount: archivedBounties.length,
          });
        } else {
          // REMOTE branch — SSH to the pane's host
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try {
              ws.send(JSON.stringify({ type: "identity:bounties", bounties: [], archivedBounties: [], error: "host not found" }));
            } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:list-bounties", {
              operation: "identity_list_bounties",
              userId,
              identityKey,
              hostId: hostIdNum,
              useLocal: false,
              openCount: bounties.length,
              archivedCount: archivedBounties.length,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }

        try {
          ws.send(JSON.stringify({ type: "identity:bounties", bounties, archivedBounties }));
        } catch { /* ws may be mid-close */ }
      } catch (err) {
        sshLogger.error(
          "identity:list-bounties unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_list_bounties_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(
            JSON.stringify({
              type: "identity:bounties",
              bounties: [],
              archivedBounties: [],
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        } catch { /* ignore */ }
      }
      return;
    }

    // Quick 260727-tb1: identity:count-bounties — batched pinned bounty
    // counter powering the per-row bounty badge in pretty-conversations.
    // ONE WS request carrying [{identityKey, hostId}, ...]; ONE response
    // carrying [{identityKey, hostId, pinnedCount, error?}, ...].
    //
    // Design decisions the tests lock in:
    //   1. Targets are grouped by hostId. Local group (hostId=null OR in
    //      IDENTITIES_LOCAL_HOST_IDS) reads via the bind-mount branch —
    //      no SSH connection needed.
    //   2. Each non-local hostId opens EXACTLY ONE SshConnection via
    //      connectOneShot; every identity in that hostId's group is read
    //      through that single conn; conn.end() runs in try/finally.
    //   3. Every per-target read is wrapped in Promise.allSettled — one
    //      slow or dead SSH host does not block the batch.
    //   4. Rejected reads surface as {pinnedCount:0, error:string};
    //      successful reads omit the error field. Zero-with-error keeps
    //      the wire shape uniform.
    if (msg.type === "identity:count-bounties") {
      await handleIdentityCountBounties(ws, msg, userId);
      return;
    }

    // Patch #17g/#92: identity:get-identity-file — read <identityKey>/<identityKey>.md as markdown.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:get-identity-file") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:identity-file", markdown: "", error: "invalid identityKey" }));
        } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let markdown: string;
        if (useLocal) {
          ({ markdown } = await readIdentityFile(null, identityKey));
          sshLogger.info("identity:get-identity-file", {
            operation: "identity_get_identity_file",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: markdown.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:identity-file", markdown: "", error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ markdown } = await readIdentityFile(conn, identityKey));
            sshLogger.info("identity:get-identity-file", {
              operation: "identity_get_identity_file",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: markdown.length,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:identity-file", markdown })); } catch { /* ignore */ }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-identity-file error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_identity_file_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:identity-file", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Patch #17g/#92: identity:get-history — read history.md; reverse lines for most-recent-first.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:get-history") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:history", entries: [], error: "invalid identityKey" }));
        } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let entries: string[];
        if (useLocal) {
          ({ entries } = await readIdentityHistory(null, identityKey));
          sshLogger.info("identity:get-history", {
            operation: "identity_get_history",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: entries.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:history", entries: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ entries } = await readIdentityHistory(conn, identityKey));
            sshLogger.info("identity:get-history", {
              operation: "identity_get_history",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: entries.length,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:history", entries })); } catch { /* ignore */ }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-history error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_history_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:history", entries: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Patch #17g/#92: identity:list-wakeups — enumerate wakeups/*.json and humanize each schedule.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:list-wakeups") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:wakeups", wakeups: [], error: "invalid identityKey" }));
        } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let wakeups: { name: string; enabled: boolean; scheduleHuman: string; instruction: string }[];
        if (useLocal) {
          ({ wakeups } = await readIdentityWakeups(null, identityKey));
          sshLogger.info("identity:list-wakeups", {
            operation: "identity_list_wakeups",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: wakeups.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:wakeups", wakeups: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ wakeups } = await readIdentityWakeups(conn, identityKey));
            sshLogger.info("identity:list-wakeups", {
              operation: "identity_list_wakeups",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: wakeups.length,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:wakeups", wakeups })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:list-wakeups unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_list_wakeups_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:wakeups", wakeups: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Patch #154: identity:update-wakeup — patch a single wakeups/<slug>.json
    // (enabled and/or schedule) and return the fresh list so the modal can
    // atomically re-render. Same local/SSH routing as list-wakeups.
    if (msg.type === "identity:update-wakeup") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; wakeupSlug?: unknown; updates?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.wakeupSlug;
      const rawUpdates = raw.updates;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "invalid wakeup slug" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawUpdates !== "object" || rawUpdates === null) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "invalid updates" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const wakeupSlug = rawSlug;
      const updates = rawUpdates as { enabled?: unknown; schedule?: unknown };
      const filtered: { enabled?: boolean; schedule?: unknown } = {};
      if (updates.enabled !== undefined) {
        if (typeof updates.enabled !== "boolean") {
          try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "enabled must be boolean" })); } catch { /* ignore */ }
          return;
        }
        filtered.enabled = updates.enabled;
      }
      if (updates.schedule !== undefined) {
        filtered.schedule = updates.schedule;
      }
      if (filtered.enabled === undefined && filtered.schedule === undefined) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "no updates" })); } catch { /* ignore */ }
        return;
      }
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let wakeups: Awaited<ReturnType<typeof readIdentityWakeups>>["wakeups"];
        if (useLocal) {
          await writeIdentityWakeupUpdate(null, identityKey, wakeupSlug, filtered);
          ({ wakeups } = await readIdentityWakeups(null, identityKey));
          sshLogger.info("identity:update-wakeup", {
            operation: "identity_update_wakeup",
            userId, identityKey, wakeupSlug, hostId: hostIdNum, useLocal: true,
            fields: Object.keys(filtered).join(","),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityWakeupUpdate(conn, identityKey, wakeupSlug, filtered);
            ({ wakeups } = await readIdentityWakeups(conn, identityKey));
            sshLogger.info("identity:update-wakeup", {
              operation: "identity_update_wakeup",
              userId, identityKey, wakeupSlug, hostId: hostIdNum, useLocal: false,
              fields: Object.keys(filtered).join(","),
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-wakeup unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_wakeup_error", userId, identityKey, wakeupSlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Quick 260727-wd0: identity:archive-bounty — sibling of the v0b status
    // handler below on the archive axis. Server decides the new status
    // internally (flip live→done, or preserve done/dropped), tmp+rename
    // patches bounty.json at the CURRENT (open) path, then mv's
    // bounties/<slug>/ under bounties/archive/<slug>/ (mkdir -p archive/
    // if absent). Returns the fresh bounty lists so the modal atomically
    // re-renders — the archived bounty moves from `bounties` to
    // `archivedBounties`. No client-supplied status field: semantics are
    // fully server-locked per PLAN.md § Semantics.
    if (msg.type === "identity:archive-bounty") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await archiveIdentityBounty(null, identityKey, bountySlug);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:archive-bounty", {
            operation: "identity_archive_bounty",
            userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await archiveIdentityBounty(conn, identityKey, bountySlug);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:archive-bounty", {
              operation: "identity_archive_bounty",
              userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties, archivedBounties })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:archive-bounty unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_archive_bounty_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Quick 260729-g5r / patch #183: identity:delete-bounty — byte-shape
    // mirror of the archive handler above but with rm -rf semantics
    // (no JSON patch, no timeline entry, no status flip, no folder move).
    // Applies to BOTH open AND archived cards — the writer rm's both
    // candidate paths with force:true so one call covers both locations.
    // Returns fresh {bounties, archivedBounties} so the modal atomically
    // re-renders and the deleted card unmounts naturally when its slug
    // drops out of both lists. window.confirm() gate lives in BountyCard.
    if (msg.type === "identity:delete-bounty") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await deleteIdentityBounty(null, identityKey, bountySlug);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:delete-bounty", {
            operation: "identity_delete_bounty",
            userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await deleteIdentityBounty(conn, identityKey, bountySlug);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:delete-bounty", {
              operation: "identity_delete_bounty",
              userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties, archivedBounties })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:delete-bounty unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_delete_bounty_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Quick 260727-v0b: identity:update-bounty-status — byte-shape mirror of
    // the priority handler below for the `status` field. Server patches
    // bounty.json IN PLACE (folder NOT moved even when transitioning to/from
    // done/dropped) and returns the fresh bounty lists so the modal can
    // atomically re-render. Editable for ALL bounties including archived —
    // that IS the resurrect flow (click "pinned" on a done/dropped card to
    // pull it back into working set).
    if (msg.type === "identity:update-bounty-status") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; status?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawStatus = raw.status;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawStatus !== "string" || !(BOUNTY_STATUS_VALUES as readonly string[]).includes(rawStatus)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "invalid status" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const status = rawStatus as BountyStatus;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyStatus(null, identityKey, bountySlug, status);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-status", {
            operation: "identity_update_bounty_status",
            userId, identityKey, bountySlug, status, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyStatus(conn, identityKey, bountySlug, status);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-status", {
              operation: "identity_update_bounty_status",
              userId, identityKey, bountySlug, status, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties, archivedBounties })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-status unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_status_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Quick 260728-sqk / patch #172: identity:update-bounty-pinned —
    // byte-shape mirror of the status handler above for the `pinned` boolean
    // field. Post-Nelly-fleet-migration (#168, 2026-07-28), `pinned` is an
    // independent boolean orthogonal to lifecycle `status`. Server patches
    // bounty.json IN PLACE (folder NOT moved) and returns the fresh bounty
    // lists so the modal can atomically re-render. Editable for ALL bounties
    // including archived — unpinning an archived pinned bounty stays legal
    // and re-pinning is the resurrect signal on the pinned axis.
    if (msg.type === "identity:update-bounty-pinned") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; pinned?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawPinned = raw.pinned;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawPinned !== "boolean") {
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid pinned" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const pinned = rawPinned;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyPinned(null, identityKey, bountySlug, pinned);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-pinned", {
            operation: "identity_update_bounty_pinned",
            userId, identityKey, bountySlug, pinned, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyPinned(conn, identityKey, bountySlug, pinned);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-pinned", {
              operation: "identity_update_bounty_pinned",
              userId, identityKey, bountySlug, pinned, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties, archivedBounties })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-pinned unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_pinned_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Patch #154: identity:update-bounty-priority — patch bounty.json's
    // priority field, bump updated_at, append a timeline line. Returns the
    // fresh bounty lists so the modal can atomically re-render.
    if (msg.type === "identity:update-bounty-priority") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; priority?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawPriority = raw.priority;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawPriority !== "string" || !(BOUNTY_PRIORITY_VALUES as readonly string[]).includes(rawPriority)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "invalid priority" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const priority = rawPriority as BountyPriority;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyPriority(null, identityKey, bountySlug, priority);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-priority", {
            operation: "identity_update_bounty_priority",
            userId, identityKey, bountySlug, priority, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyPriority(conn, identityKey, bountySlug, priority);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-priority", {
              operation: "identity_update_bounty_priority",
              userId, identityKey, bountySlug, priority, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties, archivedBounties })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-priority unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_priority_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Patch #17g/#92: identity:get-handoff — read handoff.md as markdown.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:get-handoff") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:handoff", markdown: "", error: "invalid identityKey" }));
        } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let markdown: string;
        if (useLocal) {
          ({ markdown } = await readIdentityHandoff(null, identityKey));
          sshLogger.info("identity:get-handoff", {
            operation: "identity_get_handoff",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: markdown.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:handoff", markdown: "", error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ markdown } = await readIdentityHandoff(conn, identityKey));
            sshLogger.info("identity:get-handoff", {
              operation: "identity_get_handoff",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: markdown.length,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:handoff", markdown })); } catch { /* ignore */ }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-handoff error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_handoff_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:handoff", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Phase 14 Wave 2: aside_arm — the SOLE trigger source per CONTEXT.md
    // § Trigger lock (2026-07-26). Frontend PrettyView WS-sends this on
    // the `isIdle:false -> true` transition when `pvIdentity !== null`.
    // The backend does NOT gate identity (delegated to the frontend) and
    // does NOT observe the terminal WSS's idle-signal frame (that runs
    // on port 30002 in a separate closure with no shared state). If a WS
    // sends aside_arm, backend arms — trust boundary is frontend-owned.
    //
    // v1 overlap policy (ASIDE-08): if this WS's state has `armed` OR
    // `displayed` set, the incoming aside_arm is a no-op — no re-inject
    // of /btw while an aside is armed OR displayed. Bounds the tmux
    // send-keys rate to ONE /btw per aside-cycle-completion per WS.
    if (msg.type === "aside_arm") {
      const state = asideState.get(ws);
      if (!state) return; // defensive — asideState.set(ws) fires at connect init
      if (state.armed || state.displayed) return; // overlap-ignore gate
      if (!sshConn || !currentTmuxSession) return; // no pane bound yet
      state.armed = true;
      lastStableCapture = null;
      hadMarkerLastCapture = false;
      sshLogger.info("aside poll diag: armed", {
        hostId: currentHostId,
        tmuxSession: currentTmuxSession,
      });
      // injectBtw log-and-swallows internally; do NOT roll back state.armed
      // on failure — the poller's disarm-on-emit path handles the "no
      // answer arrived" case, and a stuck armed flag clears on next
      // dismiss cycle. Keeps the dispatch simple.
      await injectBtw(sshConn, currentTmuxSession);
      return;
    }

    // Phase 14 Wave 2: aside_dismissed — client clicked the X (Resume)
    // affordance on ComposeBox. Send Escape into the pane's tmux to close
    // the BTW overlay, then broadcast the dismiss to all peer WSes on the
    // same session so cross-tab tabs also clear their aside display.
    //
    // Per T-14-02-01 mitigation: we IGNORE msg.hostId / msg.tmuxSession
    // for send-keys routing. The connection's own captured
    // currentHostId / currentTmuxSession is the trusted source (set at
    // connectToPane discovery success). Client-supplied fields cannot
    // spoof a dismiss for a session the client doesn't own.
    //
    // Do NOT set asideState.get(ws).armed = false here — the poller's
    // marker-disappearance path (or the extract-and-emit path) owns that.
    // broadcastAsideDismissed flips this ws's `displayed=false` (since
    // this ws IS in its own activeViewers set) and all peers' atomically.
    if (msg.type === "aside_dismissed") {
      if (sshConn && currentTmuxSession) {
        await dismissBtw(sshConn, currentTmuxSession);
      }
      if (currentHostId != null && currentTmuxSession != null) {
        broadcastAsideDismissed(sessionKey(currentHostId, currentTmuxSession));
      }
      return;
    }

    if (msg.type !== "connectToPane") {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unknown message type: " + String(msg.type),
        }),
      );
      return;
    }

    const hostId = msg.hostId;
    const tmuxSession = msg.tmuxSession;
    if (
      typeof hostId !== "number" ||
      !Number.isFinite(hostId) ||
      hostId <= 0 ||
      typeof tmuxSession !== "string" ||
      tmuxSession.length === 0
    ) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "connectToPane requires hostId and tmuxSession",
        }),
      );
      return;
    }

    // Enforce one active pane per WS: any prior tail/conn is torn down first.
    if (sshConn || tailHandle) {
      sshLogger.info("Claude session pane switch", {
        operation: "claude_session_pane_switch",
        userId,
        sessionId,
        hostId,
        tmuxSession,
      });
      teardownPane();
    }

    const resolved = await resolveHostById(hostId, userId!);
    if (!resolved) {
      ws.send(
        JSON.stringify({ type: "error", message: "Host not found" }),
      );
      return;
    }

    let conn: SSHClientType;
    try {
      conn = await connectOneShot(
        resolved as unknown as Parameters<typeof connectOneShot>[0],
        5000,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "SSH connect failed: " + message,
        }),
      );
      return;
    }

    // Store immediately so a WS close during discovery still tears down.
    sshConn = conn;
    if (stopped) {
      teardownPane();
      return;
    }

    const result = await discoverClaudeSession(conn, tmuxSession);
    sshLogger.info("Claude session discovery result", {
      operation: "claude_session_discovery",
      userId,
      sessionId,
      hostId,
      tmuxSession,
      status: result.status,
    });

    if (result.status === "inactive") {
      // FALLBACK-01: emit one inactive frame and STOP. Do not open a tail,
      // do not fall through to any prior session file. The `never reach
      // back` rule is enforced structurally — there is no branch below
      // that could start a tail from an inactive result.
      ws.send(
        JSON.stringify({ type: "inactive", reason: result.reason }),
      );
      // Keep sshConn open? No — releasing the SSH connection here keeps
      // idle inactive WSs cheap. A subsequent connectToPane will reopen.
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      sshConn = null;
      return;
    }

    // Active path: metadata frame first, then start the tail.
    ws.send(
      JSON.stringify({
        type: "session",
        pid: result.pid,
        sessionFile: result.sessionFile,
      }),
    );

    sshLogger.info("Starting Claude session tail", {
      operation: "claude_session_tail_start",
      userId,
      sessionId,
      hostId,
      tmuxSession,
      pid: result.pid,
      sessionFile: result.sessionFile,
    });

    // Phase 3: pin the connection-scoped context so the state-transition
    // helpers can log with the right hostId/tmuxSession without needing to
    // re-thread them through every callsite. Also gives the discovery-repoll
    // ticker its baseline to compare `result.sessionFile` against — without
    // seeding `currentSessionFile` here, the first ticker comparison would
    // treat the current file as "changed" and immediately fire
    // transitionToActiveNew on itself.
    currentHostId = hostId;
    currentTmuxSession = tmuxSession;
    currentSessionFile = result.sessionFile;
    sessionIdFromFile = result.sessionFile
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, "");

    // Context-% poller: scrape Claude Code's status-line percentage every
    // ~3s via `tmux capture-pane -p -t <session>` over a fresh exec channel
    // on the same SSH connection. ssh2 multiplexes channels so this runs
    // alongside the JSONL tail without blocking it. On miss we DON'T emit;
    // the client holds its last known value rather than blank out. Recipe
    // cribbed from nelly's context-watch.py (2026-07-18).
    //
    // Three-part hardening:
    //   * BOTTOM 8 LINES (patch #56): only look at the footer region so
    //     transcript quotes of "context) NN%" elsewhere in the pane can't
    //     win. N=8: footer=5 lines (2 separator + prompt + status +
    //     bypass/permissions) plus a 3-line buffer for footer variations
    //     (weekly-limit warnings, narrow-terminal wrap).
    //   * PER-LINE + RIGHTMOST-% anchored on `context)` (patch #59): for
    //     each line containing the label, take the RIGHTMOST NN% on that
    //     line. Claude Code's real context % renders far-right, so a
    //     custom statusline (opengsd's milestone bar was the observed
    //     case) that injects a NN% between `context)` and the real % on
    //     the SAME line can't win. Mirrors nelly's source-side hardening
    //     in context-watch.py. Last matching line across the 8-line slice
    //     wins (multi-line last-wins semantic preserved).
    //   * FALLBACK: bar-glyph pattern (░/█ chars unique to the visual
    //     context bar) with the same per-line rightmost-% rule, for hosts
    //     where "(1M context)" is absent but the visual bar remains.
    const CONTEXT_PCT_INTERVAL_MS = 3000;
    // Single-quote wrap for the session name. Tmux session names are
    // validated by the frontend to a tmux-safe subset (alphanumeric,
    // dash, underscore), so single-quote escape is sufficient.
    const captureCmd = `tmux capture-pane -p -t '${tmuxSession}'`;
    contextPctTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (contextPctInFlight) return; // guard against slow SSH pileups
      contextPctInFlight = true;
      const connSnapshot = sshConn;
      execCommand(connSnapshot, captureCmd)
        .then((output) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const lines = output.split("\n").slice(-8);
          // Per-line scan anchored on `context)`, rightmost NN% wins.
          let pct: number | null = null;
          for (const line of lines) {
            if (!line.includes("context)")) continue;
            const pcts = [...line.matchAll(/(\d{1,3})%/g)];
            if (pcts.length === 0) continue;
            pct = parseInt(pcts[pcts.length - 1][1], 10);
          }
          if (pct === null) {
            // Fallback: bar-glyph anchor, same rightmost-per-line rule.
            for (const line of lines) {
              if (!/[░█]/.test(line)) continue;
              const pcts = [...line.matchAll(/(\d{1,3})%/g)];
              if (pcts.length === 0) continue;
              pct = parseInt(pcts[pcts.length - 1][1], 10);
            }
          }
          if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100)
            return;
          try {
            ws.send(JSON.stringify({ type: "context_pct", pct }));
          } catch {
            /* ws may be mid-close */
          }
        })
        .catch(() => {
          /* Silent on scrape failure — the tail's error handler covers
             connection health; this is a nice-to-have signal, not
             load-bearing. */
        })
        .finally(() => {
          contextPctInFlight = false;
        });
    }, CONTEXT_PCT_INTERVAL_MS);

    // Phase 14 Wave 2: aside subsystem — register this WS in the fan-out
    // registry, run the connect-time re-attach probe, and arm the
    // extraction poller. All three pieces reuse the pane's existing sshConn
    // (established above during connectToPane discovery); no new SSH
    // subsystem, no new port. Per CONTEXT.md § canonical_refs.
    //
    // Runs REGARDLESS of activeViewers.get(key).size — each connection
    // independently discovers overlay presence via capture-pane on mount
    // (per plan-checker W7 clarification). No "wait for another viewer"
    // gate.
    const asideKey = sessionKey(currentHostId, currentTmuxSession);
    if (!activeViewers.has(asideKey)) activeViewers.set(asideKey, new Set());
    activeViewers.get(asideKey)!.add(ws);

    // Connect-time re-attach probe (ASIDE-09): one-shot capture-pane on
    // mount. If the BTW overlay is already open (Ashley closed a prior tab
    // without dismissing, or her SSH session left a /btw hanging), emit
    // aside_ready to THIS client so the aside re-renders in-place, and
    // flip THIS ws's asideState.displayed = true so the overlap-ignore
    // gate blocks new aside_arms from firing until dismiss.
    //
    // Do NOT broadcast to peers on this probe — other tabs either already
    // have it displayed (their own state carries it) or their own connect-
    // time probes will fire independently. Broadcasting here would race
    // against peers' initial state and could double-fire aside_ready.
    (async () => {
      // Snapshot sshConn + currentTmuxSession — teardownPane may fire while
      // this promise is in flight (fast connectToPane rebind), nulling the
      // closure vars. Snapshot at kick-off preserves the correct target
      // for this probe attempt.
      const probeConn = sshConn;
      const probeSession = currentTmuxSession;
      if (!probeConn || !probeSession) return;
      try {
        const probeOutput = await execCommand(
          probeConn,
          `tmux capture-pane -p -S -200 -t ${shellQuote(probeSession)}`,
        );
        if (stopped || ws.readyState !== WebSocket.OPEN) return;
        if (!probeOutput.includes(ASIDE_END_MARKER)) return;
        const text = extractBtwAnswer(probeOutput, ASIDE_END_MARKER);
        if (text === null || text === "") return;
        try {
          ws.send(JSON.stringify({ type: "aside_ready", text }));
        } catch {
          /* ws may be mid-close */
        }
        const st = asideState.get(ws);
        if (st) st.displayed = true;
        // Set hadMarkerLastCapture so the subsequent poll's marker-
        // disappearance detection works from mount forward (if Ashley
        // Escape-closes the overlay via SSH, we want to broadcast dismiss).
        hadMarkerLastCapture = true;
      } catch {
        /* Silent — probe failure is not fatal; a later aside_arm will
           re-trigger the normal inject + poll cycle. */
      }
    })();

    // Extraction poller (ASIDE-04) — one setInterval per WS connection,
    // gated on `asideState.get(ws)?.armed`. When disarmed, the poll body
    // early-returns without capturing (idle-cheap; only armed connections
    // do exec calls). Same setInterval + execCommand + inFlight + silent-
    // catch posture as the context-pct poller above (per PATTERNS.md
    // L303-370). Uses scrollback (-S -200) to catch multi-line answers
    // exceeding the visible pane per CONTEXT.md § Extraction.
    const asideCaptureCmd =
      `tmux capture-pane -p -S -200 -t ${shellQuote(currentTmuxSession)}`;
    asideExtractionTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (asideExtractionInFlight) return; // guard against slow SSH pileups
      const st = asideState.get(ws);
      if (!st?.armed) return; // gate — only poll when armed
      asideExtractionInFlight = true;
      const connSnapshot = sshConn;
      execCommand(connSnapshot, asideCaptureCmd)
        .then((output) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const markerPresent = output.includes(ASIDE_END_MARKER);
          sshLogger.info("aside poll diag: poll", {
            hostId: currentHostId,
            tmuxSession: currentTmuxSession,
            len: output.length,
            markerPresent,
            hadMarkerLast: hadMarkerLastCapture,
            lastStableLen: lastStableCapture === null ? null : lastStableCapture.length,
            tail: output.slice(-60),
          });

          // Marker-disappearance detection FIRST — cross-tab coherence
          // when Ashley externally Escapes via SSH, or tmux dies. If we
          // saw the marker last poll and it's gone now AND this ws has
          // displayed=true, the overlay closed externally. broadcast
          // dismiss to all peers (flips this ws AND peers' displayed
          // flags per the atomic BOTH-STEPS rule) and reset stability.
          if (
            hadMarkerLastCapture &&
            !markerPresent &&
            asideState.get(ws)?.displayed === true &&
            currentHostId != null &&
            currentTmuxSession != null
          ) {
            sshLogger.info("aside poll diag: marker-disappeared → dismiss");
            broadcastAsideDismissed(
              sessionKey(currentHostId, currentTmuxSession),
            );
            lastStableCapture = null;
            hadMarkerLastCapture = false;
            return;
          }

          if (!markerPresent) {
            // Still streaming, or nothing to see. Update flag; wait.
            hadMarkerLastCapture = false;
            return;
          }

          // markerPresent === true from here on.
          if (lastStableCapture !== output) {
            // First capture with the marker, OR a later capture that has
            // still-changing content (agent finalizing the answer). Store
            // and wait for stability on the next poll.
            sshLogger.info("aside poll diag: unstable-or-first", {
              wasNull: lastStableCapture === null,
              prevLen: lastStableCapture?.length ?? null,
              nowLen: output.length,
            });
            lastStableCapture = output;
            hadMarkerLastCapture = true;
            return;
          }

          // Stable: same output as last capture, marker present.
          sshLogger.info("aside poll diag: stable-extracting", {
            len: output.length,
            outputTail: output.slice(-400),
          });
          const text = extractBtwAnswer(output, ASIDE_END_MARKER);
          if (text === null) {
            // Degenerate — marker + no /btw echo. Disarm; swallow.
            sshLogger.info("aside poll diag: extract-null → disarm");
            const s = asideState.get(ws);
            if (s) s.armed = false;
            lastStableCapture = null;
            hadMarkerLastCapture = true; // overlay still displayed on pane
            return;
          }

          // Still-working guard (Ashley 2026-07-26 UAT, iterating).
          // The stability check (`lastStableCapture !== output`) alone
          // false-positives when Claude Code's spinner sits byte-
          // identical across a 300ms poll window.
          //
          // Guard: reject any extract ending in horizontal ellipsis `…`
          // (U+2026). Every Claude spinner variant is `<glyph> <Verb>…`
          // — universal suffix regardless of the ~10 dingbat asterisks
          // Claude cycles through (✻ ✢ ✶ ✳ etc.). Real /btw answers
          // end with normal punctuation.
          //
          // Ruled-out alternatives:
          //   - `esc to close`: shown in BOTH working and done states.
          //   - `esc to interrupt`: not present in the compact /btw
          //      overlay layout in Claude Code v2.1.150+.
          //   - `f to fork` in raw pane: false-positive from scrollback
          //      containing prior completed overlays (capture-pane -S -200
          //      includes 200 lines of scrollback).
          //
          // Reset lastStableCapture so the NEXT real-quiescence pair of
          // polls re-establishes stability on the finished answer.
          // Do NOT disarm — the /btw is still valid.
          if (/…\s*$/.test(text)) {
            sshLogger.info("aside poll diag: still-working → reset stability", {
              textPreview: text.slice(0, 80),
            });
            lastStableCapture = null;
            hadMarkerLastCapture = true;
            return;
          }

          // Emit aside_ready to THIS ws AND every peer in the fan-out
          // registry. For each recipient (including self), flip
          // asideState.displayed = true so the overlap-ignore gate
          // blocks further aside_arm re-injection until dismiss.
          const frame = JSON.stringify({ type: "aside_ready", text });
          const key =
            currentHostId != null && currentTmuxSession != null
              ? sessionKey(currentHostId, currentTmuxSession)
              : null;
          const peers = key ? activeViewers.get(key) : undefined;
          const recipients = peers ?? new Set<import("ws").WebSocket>([ws]);
          sshLogger.info("aside poll diag: emit aside_ready", {
            textLen: text.length,
            recipients: recipients.size,
            keyPresent: key !== null,
            peerRegistryHit: peers !== undefined,
          });
          // Fallback single-recipient set covers the pathological case
          // where the pane's connectToPane hadn't yet registered this ws
          // in activeViewers (shouldn't happen — registration is
          // synchronous above the poller — but defensive).
          for (const recipient of recipients) {
            if (recipient.readyState !== WebSocket.OPEN) continue;
            try {
              recipient.send(frame);
            } catch {
              /* recipient may be mid-close */
            }
            const recState = asideState.get(recipient);
            if (recState) recState.displayed = true;
          }

          // Disarm THIS ws only — peers arm/disarm on their own
          // aside_arm messages independently.
          const s = asideState.get(ws);
          if (s) s.armed = false;
          lastStableCapture = null;
          // hadMarkerLastCapture stays true — the overlay IS still
          // displayed on the pane; marker-disappearance detection
          // above needs this to fire when Ashley externally Escapes.
          hadMarkerLastCapture = true;
        })
        .catch(() => {
          /* Silent on scrape failure — matches the context-pct poller
             posture. A miss on one tick is fine; next tick tries again. */
        })
        .finally(() => {
          asideExtractionInFlight = false;
        });
    }, ASIDE_POLL_INTERVAL_MS);

    // Harness-tasks poller: read Claude Code's on-disk task queue (populated
    // by TaskCreate + /queue) and emit it to the client on change. Storage
    // layout: ~/.claude/tasks/<sessionId>/<n>.json — one JSON file per task
    // numbered from 1. sessionId is the JSONL basename we already have from
    // the discovery result. Each task is
    //   { id, subject, description?, activeForm?, status, blocks[], blockedBy[] }
    // with status in {pending, in_progress, completed, ...}. Files are
    // pretty-printed multi-line JSON; we collapse each to one line with
    // `tr '\n' ' '` on the remote (valid JSON is whitespace-insensitive,
    // and escaped `\n` inside string literals is TWO bytes `\` + `n` so
    // tr on real LF only touches formatter whitespace, not string data).
    //
    // Live update: 3s polling on the same SSH connection as the tail (ssh2
    // multiplexes channels — concurrent execs are fine). On payload change
    // vs last-emitted, emit a fresh `{type:"harness_tasks", tasks}` frame;
    // when unchanged, skip the emit to avoid pushing identical arrays every
    // tick. The client filters completed tasks for display and hides the
    // panel entirely when no active tasks remain.
    //
    // BLOCKER fix (plan-checker 2026-07-18): setup is now via the module-
    // scoped `setupHarnessTasksPoller` helper so `transitionToActiveNew`
    // can rebind against the fresh session's UUID after a recycle. Pre-
    // Phase-3, the poller was baked into a local `const tasksCmd` at
    // connect time and stayed pointed at the DEAD session's UUID forever
    // after a recycle. `sessionIdFromFile` is set just above in the initial
    // session-file assignment block.
    setupHarnessTasksPoller(sessionIdFromFile!);

    // Phase 3 Layer 2: discovery-repoll backstop. Runs the SAME full
    // `discoverClaudeSession` call the initial connectToPane branch used,
    // once per tick, on the same SSH connection. On change:
    //   - active + new file  → transitionToHolding("discovery_diff") then
    //                          transitionToActiveNew(newFile) same tick
    //                          (SIGTERM-fallback path — /exit never landed)
    //   - holding + new file → transitionToActiveNew(newFile)
    //                          (normal recycle after /exit)
    //   - holding + no file  → increment holdingTicks; if >= timeout, dead
    //   - active + inactive  → transitionToHolding (defensive — treated as
    //                          recover-pending; may resolve as file appears
    //                          in a future tick or as dead on timeout)
    //
    // Full discovery each tick (not a cached `ls -t $projects_dir/*.jsonl`)
    // is LOAD-BEARING per Nelly's recover-in-different-cwd case (2026-07-15):
    // the same session id can move projects subdirs, so the projects dir
    // may not be the same one we started from. `discoverClaudeSession`
    // walks pane→pid→cwd→slug fresh each tick and correctly follows the
    // move. See CONTEXT.md D-30 and CHANGEOVER-05.
    discoveryRepollTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (discoveryRepollInFlight) return;
      discoveryRepollInFlight = true;
      const connSnapshot = sshConn;
      discoverClaudeSession(connSnapshot, tmuxSession)
        .then((result) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (changeoverState === "dead") return; // idempotent guard

          if (result.status === "active") {
            if (result.sessionFile !== currentSessionFile) {
              // File moved: recycle OR recover-in-different-cwd.
              if (changeoverState === "active") {
                // SIGTERM-fallback path: /exit never landed but the file
                // changed. Emit both holding and changed on the SAME tick.
                transitionToHolding("discovery_diff");
              }
              transitionToActiveNew(result.sessionFile);
            }
            // else: same file, still active — no state change here. If we
            // were already in `holding` AND the file matches
            // currentSessionFile, that means our pre-holding file is still
            // on disk (unusual — supervisor should have rotated it after
            // /exit). We fall through to the holdingTicks++ block below,
            // which lets the timeout progress. Do NOT reset holdingTicks
            // in this same-file branch: reset happens only in
            // transitionToActiveNew.
          } else {
            // status === "inactive": no claude in the pane right now.
            // Bare-shell gap during recycle is expected — do NOT flip to
            // dead on a single inactive tick. Only flip on holding
            // timeout. (If we were in `active` and suddenly the pane has
            // no claude AND no /exit was seen, something crashed —
            // transition to holding so the client shows the banner while
            // we wait for a recover.)
            if (changeoverState === "active") {
              transitionToHolding("discovery_diff");
            }
          }

          // W2 fix from plan-checker: the holdingTicks++ check below fires
          // on EVERY holding tick — including this same-file-active branch
          // above (where we did NOT reset holdingTicks) and the inactive
          // branch (which may have just flipped us to holding this tick).
          // Intentional: if the pre-holding file still exists but no new
          // file has appeared for HOLDING_TIMEOUT_TICKS, declare dead. A
          // stuck same-file result during holding still counts against the
          // timeout, otherwise the pane could sit in "recycling…"
          // indefinitely on a supervisor bug.
          if (changeoverState === "holding") {
            holdingTicks++;
            if (holdingTicks >= HOLDING_TIMEOUT_TICKS) {
              transitionToDead("holding_timeout");
            }
          }
        })
        .catch(() => {
          /* Silent — same posture as the context-pct and harness-tasks
             pollers. A discovery failure on one tick shouldn't kill the
             session; the next tick tries again. */
        })
        .finally(() => {
          discoveryRepollInFlight = false;
        });
    }, DISCOVERY_REPOLL_INTERVAL_MS);

    tailHandle = tailSessionFile(conn, result.sessionFile, onLine, onError);
  });
});

const CLAUDE_SESSION_WS_PORT = 30011;
sshLogger.info("Claude session WebSocket server listening", {
  operation: "claude_session_ws_boot",
  port: CLAUDE_SESSION_WS_PORT,
});
