import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createHash } from "node:crypto";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { sshLogger } from "../utils/logger.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { discoverClaudeSession } from "./session-file-discovery.js";
import { parseSessionLine } from "./session-file-parser.js";
import { tailSessionFile, type TailHandle } from "./session-file-tail.js";
import {
  applyLineToLayer1State,
  type Layer1State,
} from "./layer1-detect.js";
import {
  createPaneStateEmitter,
  type PaneStateEmitter,
} from "./pane-state-emitter.js";
import { parseContextPct } from "./context-pct-parser.js";
import { readContextPctFromJsonl } from "./context-pct-from-jsonl.js";
import { isPlanPending, parsePlanFilePath } from "./plan-pending-parser.js";
import { fetchPlanFile } from "../ssh/plan-file-fetch.js";
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
  readIdentityBountyCounts,
  readRoleFile,
  writeIdentityWakeupUpdate,
  writeIdentityFile,
  writeIdentityHistory,
  writeIdentityHandoff,
  writeRoleFile,
  writeIdentityBountyPriority,
  writeIdentityBountyStatus,
  writeIdentityBountyPinned,
  writeIdentityBountyFields,
  archiveIdentityBounty,
  deleteIdentityBounty,
  type BountyPriority,
  type BountyStatus,
  type BountyFieldsPatch,
} from "./identity-artifact-reader.js";

/**
 * Live Claude-session WebSocket server on port 30011.
 *
 * Wire protocol (V1 hard-lock, RENDER-01 — IMAGES EXCEPTED per patch #86):
 *
 *   client -> server:
 *     { type: "connectToPane", hostId: number, tmuxSession: string }
 *     { type: "identity:list-bounties", identityKey: string, hostId?: number }    // patch #87/#92: fetch identity bounties; hostId routes to pane's box (omit = local bind-mount)
 *     { type: "identity:count-bounties", targets: Array<{ identityKey: string; hostId: number | null }> } // quick 260727-tb1 / Phase 26: batched bounty counter (pinned + needs-desk) for the per-row badge (one WS request per poll)
 *     // patch #17g/#92: identity artifact fetches (one-shot; no pane needed):
 *     { type: "identity:get-identity-file", identityKey: string, hostId?: number } // patch #17g/#92: fetch <key>.md
 *     { type: "identity:get-role-file", identityKey: string, hostId?: number }     // Phase 22 SRIC-06: fetch ~/.claude/roles/<role>/<role>.md via backend two-step (identity file → role: frontmatter → role artifact)
 *     { type: "identity:get-history", identityKey: string, hostId?: number }       // patch #17g/#92: fetch history.md
 *     { type: "identity:list-wakeups", identityKey: string, hostId?: number }      // patch #17g/#92: list wakeups/*.json
 *     { type: "identity:get-handoff", identityKey: string, hostId?: number }       // patch #17g/#92: fetch handoff.md
 *     // patch #154: first WRITE paths on identity artifacts. Same hostId routing.
 *     { type: "identity:update-wakeup", identityKey: string, hostId?: number, wakeupSlug: string, updates: { enabled?: boolean, schedule?: object } } // patch #154: patch wakeups/<slug>.json
 *     { type: "identity:update-bounty-priority", identityKey: string, hostId?: number, bountySlug: string, priority: "urgent"|"high"|"medium"|"low"|"unprioritized" } // patch #154: patch bounties/<slug>/bounty.json
 *     { type: "identity:update-bounty-status", identityKey: string, hostId?: number, bountySlug: string, status: "in_progress"|"waiting_on_someone_else"|"done"|"dropped" } // quick 260727-v0b / patch #168: patch bounties/<slug>/bounty.json status field. Allowed values: in_progress, waiting_on_someone_else, done, dropped. "pinned" removed from enum (now an independent boolean field). Folder NOT moved even for done/dropped — supports Ashley's resurrect flow via a pure JSON patch.
 *     { type: "identity:update-bounty-pinned", identityKey: string, hostId?: number, bountySlug: string, pinned: boolean } // quick 260728-sqk / patch #172: patch bounties/<slug>/bounty.json pinned field. `pinned` is an independent boolean orthogonal to status per fleet migration #168. Byte-shape mirror of update-bounty-status — flips the boolean, bumps updated_at, appends timeline line, folder untouched.
 *     { type: "identity:update-bounty-fields", identityKey: string, hostId: number, bountySlug: string, patch: BountyFieldsPatch } // Phase 18 / IDMEDIT-04: partial-JSON-patch write for bounty fields (title/premise/todos/keywords/source_links/deadline/meeting_questions). Only fields present in `patch` are written; server-owned fields (id/created_at/updated_at/timeline/pinned/requested_by) are protected. updated_at bumped unconditionally; one timeline entry per changed field. pinned rejected — use update-bounty-pinned. Returns fresh {bounties,archivedBounties} for BountyCard rehydration.
 *     { type: "identity:archive-bounty", identityKey: string, hostId?: number, bountySlug: string } // quick 260727-wd0: server decides new status internally (flip live→done or preserve terminal), then mv bounties/<slug>/ under bounties/archive/<slug>/ (mkdir -p archive/ if absent). No client-supplied status field.
 *     { type: "identity:delete-bounty", identityKey: string, hostId?: number, bountySlug: string } // quick 260729-g5r / patch #183: permanent rm -rf of a bounty folder. Applies to BOTH open (bounties/<slug>/) AND archived (bounties/archive/<slug>/) cards — server rm's both candidate paths with force:true so one call covers both locations. No confirmation gate here; window.confirm() lives in BountyCard.
 *     // Phase 18 / IDMEDIT-06: markdown write surfaces (full-overwrite, tmp+rename atomic):
 *     { type: "identity:update-identity-file", identityKey: string, hostId: number, contents: string } // Phase 18: full-overwrite <key>/<key>.md via SFTP tmp+rename (REMOTE) or fs tmp+rename (LOCAL)
 *     { type: "identity:update-role-file", identityKey: string, hostId: number, contents: string }     // Phase 22 SRIC-06: full-overwrite ~/.claude/roles/<role>/<role>.md via backend two-step
 *     { type: "identity:update-history", identityKey: string, hostId: number, contents: string }       // Phase 18: full-overwrite <key>/history.md
 *     { type: "identity:update-handoff", identityKey: string, hostId: number, contents: string }       // Phase 18: full-overwrite <key>/handoff.md
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
 *     { type: "plan_pending", pending }                          // pending = { planFilePath: string|null, planContent: string|null, contentError: string|null } | null (Phase 24 widened; presence via pane-scrape quick 260802-rps + parent-JSONL fallback patch #63; planContent fetched async via SFTP side-channel Phase 24 Plan 02)
 *     // (client -> server, Phase 24) { type: "raw_keystrokes", bytes: string } — one-shot PTY write via `tmux send-keys -l`, NO split-send. Used by PlanPendingBubble Approve ("1\r") + Feedback ("3<text>\r"). Split-send (patch #44) is NOT recognized by Ink Plan Mode as a keystroke selection.
 *     // quick 260808-cd6 — dormancy overlay + wake button:
 *     { type: "dormant", dormant: boolean }                      // server -> client: emit-only-on-change; identity pane's .dormant sentinel state
 *     { type: "pane_state", state: "active"|"holding"|"dormant"|"inactive"|"error", reason?: string } // Phase 30 PS30-01: authoritative pane-entry state verdict; emitted alongside every existing dormant/session_holding/session_holding_cleared/session_changed/inactive transition + on connectToPane attach. Legacy frames remain on the wire this phase for backward compat (deprecation deferred per 30-CONTEXT.md § Deferred).
 *     // (client -> server, quick 260808-cd6) { type: "wake" } — delete ~/.claude/identities/<name>/.dormant via SSH exec; backend uses connection-scoped currentTmuxSession (T-cd6-01 mitigation)
 *     { type: "wake_result", ok: boolean, error?: string }       // server -> client: response to { type: "wake" }
 *     { type: "inactive", reason }                               // FALLBACK-01: send once, then silent
 *     { type: "tail_error", message }                            // recoverable: client may render a banner
 *     { type: "error", message, code? }                          // fatal for this pane
 *     { type: "identity:bounties", bounties, archivedBounties, error? } // patch #87: response to identity:list-bounties (one-shot; WS closed by client after receipt)
 *     { type: "identity:bounty-counts", counts: Array<{ identityKey, hostId, pinnedCount, needsDeskCount, error? }> } // quick 260727-tb1 / Phase 26: response to identity:count-bounties (one-shot; WS closed by client after receipt)
 *     // patch #17g: identity artifact responses (one-shot; WS closed by client after receipt):
 *     { type: "identity:identity-file", markdown: string, error?: string } // patch #17g: response to identity:get-identity-file
 *     { type: "identity:role-file", markdown: string, error?: string }      // Phase 22 SRIC-06: response to identity:get-role-file
 *     { type: "identity:history", entries: string[], error?: string }       // patch #17g: response to identity:get-history
 *     { type: "identity:wakeups", wakeups: Wakeup[], error?: string }       // patch #17g: response to identity:list-wakeups
 *     { type: "identity:handoff", markdown: string, error?: string }        // patch #17g: response to identity:get-handoff
 *     // patch #154: post-write responses carry the FRESH list so the client can atomically re-render without a follow-up read.
 *     { type: "identity:wakeup-updated", wakeups: Wakeup[], error?: string }  // patch #154: response to identity:update-wakeup (includes refreshed list)
 *     { type: "identity:bounty-priority-updated", bounties, archivedBounties, error?: string } // patch #154: response to identity:update-bounty-priority (includes refreshed lists)
 *     { type: "identity:bounty-status-updated", bounties, archivedBounties, error?: string } // quick 260727-v0b: response to identity:update-bounty-status (includes refreshed lists)
 *     { type: "identity:bounty-pinned-updated", bounties, archivedBounties, error?: string } // quick 260728-sqk / patch #172: response to identity:update-bounty-pinned (includes refreshed lists — normalizeBounty carries `pinned:boolean` on every bounty)
 *     { type: "identity:bounty-fields-updated", bounties, archivedBounties, error?: string } // Phase 18 / IDMEDIT-04: response to identity:update-bounty-fields (fresh bounty lists for BountyCard rehydration — same convention as priority/status/pinned echoes)
 *     { type: "identity:bounty-archived", bounties, archivedBounties, error?: string } // quick 260727-wd0: response to identity:archive-bounty (includes refreshed lists — bounty moved from `bounties` list to `archivedBounties` list)
 *     { type: "identity:bounty-deleted", bounties, archivedBounties, error?: string } // quick 260729-g5r / patch #183: response to identity:delete-bounty (includes refreshed lists — bounty drops out of BOTH lists since its folder is gone)
 *     // Phase 18 / IDMEDIT-06: post-write echoes — server re-reads after write so client rehydrates from server-side truth:
 *     { type: "identity:identity-file-updated", markdown: string, error?: string } // Phase 18: response to identity:update-identity-file (confirmed markdown post-write)
 *     { type: "identity:role-file-updated", markdown: string, error?: string }      // Phase 22 SRIC-06: response to identity:update-role-file (confirmed markdown post-write, re-read via two-step)
 *     { type: "identity:history-updated", entries: string[], error?: string }       // Phase 18: response to identity:update-history (server re-reads + re-parses entries)
 *     { type: "identity:handoff-updated", markdown: string, error?: string }        // Phase 18: response to identity:update-handoff (confirmed markdown post-write)
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

// pv-malformed-line-dedup-across-tail-restarts (2026-08-10): stable eventId
// derived from the raw malformed line so appendDedup can collapse replays.
// tailSessionFile runs `tail -F -n +1`, which re-reads from line 1 on every
// (re)start (WS reconnect / session_changed / patch #344 visibility resume);
// without a content-derived id, each replay of the same malformed line got a
// fresh random id and stacked as a new bubble. 12 hex chars = 48 bits, ample
// for line-uniqueness within one session file.
function malformedEventId(rawLine: string): string {
  return (
    "malformed-" +
    createHash("sha1").update(rawLine).digest("hex").slice(0, 12)
  );
}
export const __malformedEventIdForTests = malformedEventId;

// Phase 3 session-changeover tuning constants. Holding timeout: 200 * 3s = 600s (10min).
// Per D-31 and CONTEXT.md § holding timeout — Nelly's original timing note said "new .jsonl
// appears within ~5s; fully-loaded identity ~30-70s later" but real /id reset flows
// under load can take multiple minutes (Ashley 2026-08-09: original 45s tripped the
// "recycle failed — refresh to check" red overlay ~60s into a normal reset that later
// completed fine; then teardownPane meant even after success nothing cleared the overlay).
// 10min matches the client-side belt-and-suspenders watchdog at
// src/ui/features/pretty-view/PrettyView.tsx (was 5min, bumped in the same change) so
// the two agree; the client watchdog covers the WS-drop case where the backend can't
// deliver the frame. Keep the two constants in lockstep on any future retune.
const HOLDING_TIMEOUT_TICKS = 200;
const DISCOVERY_REPOLL_INTERVAL_MS = 3000;
// Harness-tasks poller tuning — moved to module scope from the pre-refactor
// inline block so the setupHarnessTasksPoller helper (per BLOCKER fix from
// plan-checker 2026-07-18) can reference them without re-allocating per call.
const HARNESS_TASKS_INTERVAL_MS = 3000;
// quick 260808-fgf — Nelly's .resume-complete marker freshness contract.
// If marker never appears within 90s of wake_trigger_ts, fall back to
// sentinel-gone-alone dismiss (mixed-fleet compat for pre-marker supervisor boxes).
const MARKER_FALLBACK_MS = 90_000;
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
//   out: { type: "identity:bounty-counts", counts:  [{identityKey, hostId, pinnedCount, needsDeskCount, error?}, ...] }
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
  needsDeskCount: number;
  error?: string;
};

async function readOneTarget(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ pinnedCount: number; needsDeskCount: number }> {
  // The reader itself validates identityKey; forwarding invalid keys is fine
  // — the rejection lands in the per-target error field via allSettled.
  return readIdentityBountyCounts(conn, identityKey);
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
                pinnedCount: s.value.pinnedCount,
                needsDeskCount: s.value.needsDeskCount,
              };
            }
            return {
              identityKey: t.identityKey,
              hostId: t.hostId,
              pinnedCount: 0,
              needsDeskCount: 0,
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
                needsDeskCount: 0,
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
                  pinnedCount: s.value.pinnedCount,
                  needsDeskCount: s.value.needsDeskCount,
                };
              }
              return {
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: 0,
                needsDeskCount: 0,
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
              needsDeskCount: 0,
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

// ─── Phase 22 SRIC-06 / Plan 22-06: identity:get-role-file WS handler ──────────
//
// Byte-shape mirror of the identity:get-identity-file handler at L1928+ (which
// remains inline; extracting it would break the "byte-shape mirror" audit
// principle established in this plan). The new handlers are extracted to give
// them the same test seam as handleIdentityCountBounties above — vitest can
// drive them directly with mocked readRoleFile / resolveHostById / connectOneShot
// without a full WSS bring-up.
//
// Wire shape (mirrors identity:get-identity-file exactly):
//   request:  { type: "identity:get-role-file", identityKey: string, hostId?: number }
//   response: { type: "identity:role-file", markdown: string, error?: string }
//
// Backend does the two-step (identity file → role: frontmatter → role artifact)
// inside readRoleFile — the WS handler is a mechanical mirror of the
// identity-file version and does NOT parse frontmatter itself. Missing role:
// frontmatter surfaces as {error: "..."} per D-CONTEXT § "No no-role fallback
// branches" (LOCKED with Ashley 2026-08-04).

export async function handleIdentityGetRoleFile(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const m = (msg ?? {}) as { identityKey?: unknown; hostId?: unknown };
  const rawKey = m.identityKey;
  if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
    try {
      ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: "invalid identityKey" }));
    } catch { /* ignore */ }
    return;
  }
  const identityKey = rawKey;
  const rawHostId = m.hostId;
  const hostIdNum =
    typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
      ? rawHostId
      : undefined;
  const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

  try {
    let markdown: string;
    if (useLocal) {
      ({ markdown } = await readRoleFile(null, identityKey));
      sshLogger.info("identity:get-role-file", {
        operation: "identity_get_role_file",
        userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: markdown.length,
      });
    } else {
      const resolved = await resolveHostById(hostIdNum!, userId!);
      if (!resolved) {
        try { ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: "host not found" })); } catch { /* ignore */ }
        return;
      }
      const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
      try {
        ({ markdown } = await readRoleFile(conn, identityKey));
        sshLogger.info("identity:get-role-file", {
          operation: "identity_get_role_file",
          userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: markdown.length,
        });
      } finally {
        try { conn.end(); } catch { /* ignore */ }
      }
    }
    try { ws.send(JSON.stringify({ type: "identity:role-file", markdown })); } catch { /* ignore */ }
  } catch (err: unknown) {
    sshLogger.error(
      "identity:get-role-file error",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_get_role_file_error", userId, identityKey, hostId: hostIdNum },
    );
    try {
      ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: err instanceof Error ? err.message : String(err) }));
    } catch { /* ignore */ }
  }
}

// ─── Phase 22 SRIC-06 / Plan 22-06: identity:update-role-file WS handler ───────
//
// Byte-shape mirror of the identity:update-identity-file handler at L2213+.
// After write, re-reads via readRoleFile so the client rehydrates from
// server-side truth (T-22-06-05 mitigation — no client-side draft trust,
// server echo is authoritative). writeRoleFile handles the two-step, byte
// cap, and IDENTITY_KEY_RE guards internally.

export async function handleIdentityUpdateRoleFile(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const m = (msg ?? {}) as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
  const rawKey = m.identityKey;
  const rawContents = m.contents;
  if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
    try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: "invalid identityKey" })); } catch { /* ignore */ }
    return;
  }
  if (typeof rawContents !== "string") {
    try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: "contents must be a string" })); } catch { /* ignore */ }
    return;
  }
  const identityKey = rawKey;
  const contents = rawContents;
  const rawHostId = m.hostId;
  const hostIdNum =
    typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
      ? rawHostId
      : undefined;
  const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
  try {
    let markdown: string;
    if (useLocal) {
      await writeRoleFile(null, identityKey, contents);
      ({ markdown } = await readRoleFile(null, identityKey));
      sshLogger.info("identity:update-role-file", {
        operation: "identity_update_role_file",
        userId, identityKey, hostId: hostIdNum, useLocal: true,
        bytes: Buffer.byteLength(contents, "utf-8"),
      });
    } else {
      const resolved = await resolveHostById(hostIdNum!, userId!);
      if (!resolved) {
        try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: "host not found" })); } catch { /* ignore */ }
        return;
      }
      const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
      try {
        await writeRoleFile(conn, identityKey, contents);
        ({ markdown } = await readRoleFile(conn, identityKey));
        sshLogger.info("identity:update-role-file", {
          operation: "identity_update_role_file",
          userId, identityKey, hostId: hostIdNum, useLocal: false,
          bytes: Buffer.byteLength(contents, "utf-8"),
        });
      } finally {
        try { conn.end(); } catch { /* ignore */ }
      }
    }
    try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown })); } catch { /* ignore */ }
  } catch (err) {
    sshLogger.error(
      "identity:update-role-file unexpected error",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_update_role_file_error", userId, identityKey, hostId: hostIdNum },
    );
    try {
      ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: err instanceof Error ? err.message : String(err) }));
    } catch { /* ignore */ }
  }
}

// Test seams — Plan 22-06. Same pattern as __handleIdentityCountBountiesForTests
// above. Vitest drives the handlers directly with mocked reader/writer helpers.
export const __handleIdentityGetRoleFileForTests = handleIdentityGetRoleFile;
export const __handleIdentityUpdateRoleFileForTests = handleIdentityUpdateRoleFile;

// ─── Test seam: discovery-repoll tick logic (Fix A + Fix B, quick 260730-sjf) ──
//
// The discoveryRepollTimer .then() callback is a per-connection closure over
// ~8 mutable state variables and 4 helper functions. Spinning up the full
// WS server + SSH pair just to observe repoll branch behavior is impractical
// (requires 7+ dependency mocks to reach the connectToPane path). Instead,
// extract the core decision logic into a module-scope function with injectable
// deps so vitest can cover the five branch cases without I/O.
//
// Production code calls this via the per-connection discoveryRepollTimer
// .then() body by delegating to it with the closure-bound state refs.
// Tests instantiate a plain state box + helper stubs and call it directly.
//
// This is the same "function seam" pattern as __handleIdentityCountBountiesForTests
// (which also extracted per-connection handler logic so vitest can drive it
// without a real WebSocketServer).

/** Mutable state box shared between the per-connection closure and the test seam. */
export type __RepollStateForTests = {
  changeoverState: "active" | "holding" | "dead";
  currentSessionFile: string | null;
  holdingTicks: number;
  // Follow-up to patch #356: the reason we entered holding. Used by the
  // real transitionFromHoldingToActiveSameFile helper to skip the same-file
  // self-clear when the overlay was armed by a real /id reset (Layer 1).
  // The reducer __applyRepollResultForTests does NOT read this field —
  // it belongs to the helper's guard, not the reducer's dispatch. Kept on
  // the shared state box so tests that inline the real helper's shape
  // (see case (b) in claude-session-server.repoll.test.ts) can drive it.
  holdingReason: "id_reset" | "discovery_diff" | null;
};

/** Helpers injected into the repoll tick logic. */
export type __RepollHelpersForTests = {
  // quick 260808-ohn: reason union renamed "exit_marker" → "id_reset" to
  // match the new Layer 1 tail-state detector. Layer 2 (this file) still
  // passes "discovery_diff"; Layer 1 (onLine, via layer1-detect.ts) now
  // passes "id_reset". Both reasons flow into the same transitionToHolding
  // signature — no behavior change from Layer 2's perspective.
  transitionToHolding: (reason: "id_reset" | "discovery_diff") => void;
  transitionToActiveNew: (newSessionFile: string) => void;
  transitionFromHoldingToActiveSameFile: () => void;
  transitionToDead: (reason: string) => void;
};

/**
 * Apply one repoll tick's decision logic for a given discovery result.
 * Mutates `state` in-place (changeoverState, holdingTicks) and calls into
 * helpers (transitionToHolding / transitionToActiveNew / etc.) as needed.
 * Mirrors the .then() callback body in discoveryRepollTimer exactly.
 *
 * Returns immediately if changeoverState is already "dead" (idempotent guard).
 *
 * @param result  - discovery result for this tick
 * @param state   - mutable per-connection state box (mutated in-place)
 * @param helpers - injectable transition helpers (stubs in tests, real fns in prod)
 */
export function __applyRepollResultForTests(
  result: import("./session-file-discovery.js").ClaudeSessionDiscoveryResult,
  state: __RepollStateForTests,
  helpers: __RepollHelpersForTests,
): void {
  if (state.changeoverState === "dead") return;

  const isExecErrorTick =
    result.status === "inactive" && result.reason === "exec_error";

  if (result.status === "active") {
    if (result.sessionFile !== state.currentSessionFile) {
      if (state.changeoverState === "active") {
        helpers.transitionToHolding("discovery_diff");
      }
      helpers.transitionToActiveNew(result.sessionFile);
    } else if (state.changeoverState === "holding") {
      helpers.transitionFromHoldingToActiveSameFile();
    }
  } else if (!isExecErrorTick) {
    if (state.changeoverState === "active") {
      helpers.transitionToHolding("discovery_diff");
    }
  }

  if (state.changeoverState === "holding" && !isExecErrorTick) {
    state.holdingTicks++;
    if (state.holdingTicks >= HOLDING_TIMEOUT_TICKS) {
      helpers.transitionToDead("holding_timeout");
    }
  }
}

// ─── Test seam: dormant poll tick logic (quick 260808-cd6) ───────────────────
//
// The dormant stat check lives inside the contextPctTimer IIFE alongside a
// closure over 4 mutable state variables. Spinning up the full WS server + SSH
// pair to test it is impractical. Instead we export the core logic as a
// module-scope function with injectable deps (same pattern as
// __applyRepollResultForTests above). Tests instantiate a plain state box +
// mock execCommand + mock ws.send and call __applyDormantPollTickForTests directly.

/** Mutable dormant-state box shared between the per-connection closure and the test seam. */
export type __DormantStateForTests = {
  isIdentityShapedCached: boolean | null;
  identityShapeProbeInFlight: boolean;
  dormantLastEmitted: boolean | null;
  // quick 260809-ha3: optional getter for the wake-trigger timestamp closure.
  // When present and non-null, the dormant:true emit carries this as
  // wakingSince so the client can restore the wake-progress bar after Fix B
  // (visibility false->true) wipes local wakingStartTs. Absent/undefined =>
  // wakingSince: null (natural-dormant path — no user-initiated wake in flight).
  wakeTriggerTs?: () => number | null;
};

/**
 * Apply one dormant-poll tick for the given connection state.
 * Mutates `state` in-place and calls `wsSend` if the dormant state changed.
 * `execCommand` is injectable so tests can control its output.
 *
 * @param deps.connSnapshot  - SSH connection (typed as any in the seam; tests pass a stub)
 * @param deps.escapedName   - tmux session name (already validated to safe subset)
 * @param deps.execCommand   - injectable SSH exec helper
 * @param deps.wsSend        - injectable ws.send stub
 * @param state              - mutable per-connection dormant state box
 */
export async function __applyDormantPollTickForTests(
  deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connSnapshot: any;
    escapedName: string;
    execCommand: (conn: unknown, cmd: string) => Promise<string>;
    wsSend: (data: string) => void;
  },
  state: __DormantStateForTests,
): Promise<void> {
  const { connSnapshot, escapedName, execCommand: exec, wsSend } = deps;
  if (state.isIdentityShapedCached === null && !state.identityShapeProbeInFlight) {
    state.identityShapeProbeInFlight = true;
    try {
      const probeOut = await exec(
        connSnapshot,
        `test -d ~/.claude/identities/'${escapedName}' && echo yes || echo no`,
      );
      state.isIdentityShapedCached = probeOut.trim() === "yes";
    } catch {
      state.isIdentityShapedCached = false;
    } finally {
      state.identityShapeProbeInFlight = false;
    }
  } else if (state.isIdentityShapedCached === true) {
    try {
      const statOut = await exec(
        connSnapshot,
        `stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
      );
      const isDormant = statOut.trim() === "yes";
      if (isDormant !== state.dormantLastEmitted) {
        state.dormantLastEmitted = isDormant;
        // quick 260809-ha3: dormant:true carries wakingSince so client can
        // restore the wake-progress bar after Fix B (visibility false->true)
        // wipes local wakingStartTs. dormant:false is unchanged (client
        // clears waking state on the false-branch already).
        if (isDormant) {
          const wakingSince = state.wakeTriggerTs?.() ?? null;
          wsSend(JSON.stringify({ type: "dormant", dormant: true, wakingSince }));
        } else {
          wsSend(JSON.stringify({ type: "dormant", dormant: false }));
        }
      }
    } catch {
      /* SSH error — skip this tick silently */
    }
  }
  // isIdentityShapedCached === false → skip entirely (never re-probe on this connection)
}

/**
 * Apply the wake message handler logic for tests.
 * Tests D/E/F from dormant-poll.test.ts use this seam.
 *
 * @param deps.sshConn              - SSH connection (null if not connected)
 * @param deps.currentTmuxSession   - current pane tmux session name (null if none)
 * @param deps.isIdentityShapedCached - identity shape probe cache
 * @param deps.execCommand          - injectable SSH exec helper
 * @param deps.wsSend               - injectable ws.send stub
 */
export async function __applyWakeMessageForTests(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any | null;
  currentTmuxSession: string | null;
  isIdentityShapedCached: boolean | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
  wsSend: (data: string) => void;
}): Promise<void> {
  const { sshConn, currentTmuxSession, isIdentityShapedCached, execCommand: exec, wsSend } = deps;
  if (!sshConn || currentTmuxSession === null || isIdentityShapedCached !== true) {
    wsSend(JSON.stringify({ type: "wake_result", ok: false, error: "not connected to an identity pane" }));
    return;
  }
  const wakeEscapedName = currentTmuxSession;
  try {
    await exec(sshConn, `rm -f ~/.claude/identities/'${wakeEscapedName}'/.dormant`);
    wsSend(JSON.stringify({ type: "wake_result", ok: true }));
  } catch (err) {
    wsSend(JSON.stringify({ type: "wake_result", ok: false, error: err instanceof Error ? err.message : String(err) }));
  }
}

// ─── Test seam: dormant-poll-with-rediscovery logic (quick 260808-dmz) ────────
//
// The dormant-poll IIFE in the inactive branch polls the sentinel and, on
// disappearance, calls discoverClaudeSession + startActiveSessionFlow. Exported
// as a test seam so tests G-K can exercise sentinel-disappearance + re-discovery
// without spinning up the full WS server + SSH pair.
//
// Uses a two-arg "state accessor" pattern rather than a mutable box because the
// production code stores dormantLastEmitted in the connection closure (not in a
// box struct). The accessor pair {dormantLastEmitted, setDormantLastEmitted} lets
// tests inject a plain variable capture and assert on it.

/** Result type returned by discoverClaudeSession (subset used by the seam). */
export type __DiscoveryResultForTests =
  | { status: "active"; pid: number; sessionFile: string }
  | { status: "inactive"; reason: string };

/**
 * Apply one dormant-poll tick with sentinel check + optional re-discovery.
 * Called by the 3s setInterval in the inactive→dormant branch.
 *
 * quick 260808-fgf: extended with markerCommand (stat .resume-complete),
 * state.wakeTriggerTs (getter for the wake-handler-set timestamp), and
 * deps.now (injectable clock for deterministic tests). When wakeTriggerTs
 * is non-null, dismiss requires EITHER a fresh marker (marker_ts > triggerTs)
 * OR the 90s MARKER_FALLBACK_MS window to have elapsed.
 *
 * @param deps.connSnapshot        - SSH connection (stub in tests)
 * @param deps.escapedName         - tmux session name (already validated)
 * @param deps.execCommand         - injectable SSH exec helper
 * @param deps.discoverSession     - injectable discoverClaudeSession callback
 * @param deps.wsSend              - injectable ws.send stub
 * @param deps.startActiveFlow     - injectable callback to transition to active flow
 * @param deps.markerCommand       - injectable: cat .resume-complete; returns trimmed body or null
 * @param deps.now                 - injectable clock; defaults to Date.now
 * @param state.dormantLastEmitted - getter for current dormantLastEmitted closure value
 * @param state.setDormantLastEmitted - setter for dormantLastEmitted
 * @param state.wakeTriggerTs      - getter for wake_trigger_ts closure value (null = natural resume)
 */
export async function __applyDormantPollWithRediscoveryForTests(
  deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connSnapshot: any;
    escapedName: string;
    execCommand: (conn: unknown, cmd: string) => Promise<string>;
    discoverSession: (conn: unknown, session: string) => Promise<__DiscoveryResultForTests>;
    wsSend: (data: string) => void;
    startActiveFlow: (pid: number, sessionFile: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    markerCommand: (conn: any, name: string) => Promise<string | null>;
    now: () => number;
  },
  state: {
    dormantLastEmitted: () => boolean | null;
    setDormantLastEmitted: (v: boolean | null) => void;
    wakeTriggerTs: () => number | null;
  },
): Promise<void> {
  const { connSnapshot, escapedName, execCommand: exec, discoverSession, wsSend, startActiveFlow, markerCommand, now } = deps;
  try {
    // Poll the .dormant sentinel (reuse exact command from seam line 956-961)
    const statOut = await exec(
      connSnapshot,
      `stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
    );
    const isDormant = statOut.trim() === "yes";
    if (isDormant) {
      // Sentinel still present — emit only on change (state-change guard)
      if (state.dormantLastEmitted() !== true) {
        state.setDormantLastEmitted(true);
        // quick 260809-ha3: dormant:true carries wakingSince (server-authoritative
        // wake-trigger timestamp) so the client can restore the wake-progress
        // bar after Fix B (visibility false->true edge) wipes local wakingStartTs.
        // Natural-resume path (wakeTriggerTs null) sends wakingSince:null.
        wsSend(JSON.stringify({ type: "dormant", dormant: true, wakingSince: state.wakeTriggerTs() }));
      }
      return; // keep polling
    }
    // Sentinel disappeared. Apply Nelly's freshness contract when this was a
    // user-initiated wake (wakeTriggerTs non-null). Natural resumes (wakeTriggerTs
    // null) skip the check entirely — preserves Test H / prior behavior.
    const triggerTs = state.wakeTriggerTs();
    if (triggerTs !== null) {
      // User-initiated wake path: require fresh marker OR 90s fallback.
      const markerBody = await markerCommand(connSnapshot, escapedName);
      let markerFresh = false;
      let fellBack = false;
      if (markerBody !== null) {
        const markerTs = Date.parse(markerBody.trim());
        if (Number.isFinite(markerTs) && markerTs > triggerTs) {
          markerFresh = true;
        }
      }
      if (!markerFresh) {
        const elapsed = now() - triggerTs;
        if (elapsed >= MARKER_FALLBACK_MS) {
          markerFresh = true;
          fellBack = true;
        }
      }
      if (!markerFresh) {
        // Neither fresh marker nor fallback window elapsed — keep polling.
        return;
      }
      if (fellBack) {
        sshLogger.info("Dormancy marker fallback — supervisor pre-dates .resume-complete contract", {
          operation: "dormancy_marker_fallback",
          escapedName,
        });
      }
    }
    // Sentinel disappeared (and freshness check passed if applicable).
    // Emit dormant:false (state-change guard).
    if (state.dormantLastEmitted() !== false) {
      state.setDormantLastEmitted(false);
      wsSend(JSON.stringify({ type: "dormant", dormant: false }));
    }
    // Re-run discovery to see if claude has come back
    const rediscovery = await discoverSession(connSnapshot, escapedName);
    if (rediscovery.status === "active") {
      // Transition to normal active session flow
      startActiveFlow(rediscovery.pid, rediscovery.sessionFile);
      return;
    }
    // Still inactive (supervisor may not have reconciled yet) — keep polling.
    // dormantLastEmitted stays false so if the sentinel comes back, we re-emit
    // dormant:true on the next tick. No teardown; no clearing of dormant-poll timer.
  } catch {
    // SSH error — skip this tick silently (same posture as __applyDormantPollTickForTests)
  }
}

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
  // quick 260808-cd6 — dormancy overlay + wake button.
  // Per-connection (closure-scoped) dormancy guards. Mirror the
  // contextPctInFlight pattern: only the dormant-state stat check is
  // guarded; the one-shot identity-shape probe is separately guarded
  // by identityShapeProbeInFlight. All four reset naturally with the
  // closure on WS close — no explicit teardown step needed as long as
  // these bindings live inside the same per-connection closure scope.
  let dormantInFlight = false;
  let dormantLastEmitted: boolean | null = null;       // change-only emit guard, mirrors planPendingLastSerialized = "null"
  let isIdentityShapedCached: boolean | null = null;  // null = not yet probed; true = identity pane; false = skip dormancy forever
  let identityShapeProbeInFlight = false;
  // quick 260808-dmz — dormant-poll loop (inactive-branch fix).
  // Lightweight 3s poll that replaces the SSH teardown in the inactive branch
  // when a dormant sentinel is detected. Mirrors contextPctTimer/contextPctInFlight
  // pattern for lifecycle (cleared in teardownPane, guarded against pileups).
  let dormantPollTimer: NodeJS.Timeout | null = null;
  let dormantPollInFlight = false;
  // quick 260808-fgf — Nelly's .resume-complete freshness contract.
  // Set to Date.now() when the wake handler successfully SSH-execs rm -f .dormant.
  // Read by the dormant-poll seam via a getter accessor. Null means natural resume
  // (no user-initiated Wake click) → skip freshness check entirely.
  // Cleared inside startActiveFlow callback to avoid leaking into a subsequent
  // dormancy cycle on the same WS connection.
  let wakeTriggerTs: number | null = null;
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
  // Plan-pending PANE-SCRAPE sentinel (quick 260802-rps). Independent of
  // `pendingPlansLastSerialized` (which gates the legacy patch #63 JSONL
  // scan below) because the two signal sources have different resolution
  // timing under Claude Code 2.1.150 — the pane transitions to pending
  // instantly when the Ink prompt opens, while the JSONL only shows the
  // ExitPlanMode tool_use after the user resolves. Both emit onto the
  // same `{type:"plan_pending", pending}` WS frame; whichever transitions
  // first wins on the frontend (see PlanPendingBubble.tsx). Same "null"
  // initial sentinel as `pendingPlansLastSerialized` — matches
  // JSON.stringify(null) so an initial `pending:null` scrape does not
  // fire a spurious first emit.
  let planPendingLastSerialized = "null";
  // Phase 24 Plan 03: plan-content cache — keyed by planFilePath, cleared
  // when the pending window closes (isPlanPending returns false). When the
  // SAME slug reappears immediately (edge: feedback → regenerate same
  // name), we refetch because we cleared on the intermediate close.
  // `planPendingFetchInFlightForPath` ensures at most one in-flight SFTP
  // fetch per (pending-window, planFilePath) pair (T-24-03-02). Both are
  // cleared alongside `planPendingLastSerialized = "null"` on teardown
  // (~L1121) and on session_changed clean-slate (~L1805).
  const planPendingContentByPath: Map<
    string,
    { content: string | null; error: string | null }
  > = new Map();
  const planPendingFetchInFlightForPath: Set<string> = new Set();
  // Phase 24 CR-01 fix: per-pending-window token. Bumped at EVERY cache-clear
  // site (transition-to-closed, teardownPane, session_changed clean-slate).
  // Captured at fetch kickoff; late-arriving `.then()`/`.catch()` callbacks
  // compare `fetchToken !== planPendingWindowToken` and drop the result
  // silently if the window they were dispatched for is no longer current.
  //
  // Why this is necessary: the pre-fix guard only checked
  // `planPendingLastSerialized === "null"` (i.e. pending fully closed). If
  // the pending window transitioned from PlanA → PlanB (different slug, OR
  // same slug regenerated after Feedback) WITHOUT an intervening null-tick
  // that the fetch outlived, that guard is false and a stale PlanA fetch
  // could overwrite PlanB's cache + emit stale content. The token-compare
  // covers BOTH the fully-closed case AND the window-transition case with
  // a single monotonic counter — no need to separately compare planFilePath
  // against the current pane state.
  let planPendingWindowToken = 0;
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
  // Layer 1 tail-state (quick 260808-ohn / bounty
  // session-holding-layer1-detect-id-reset-not-exit): tracks whether the
  // most-recent user turn observed on this pane's session file is /id
  // reset. Reset to {mostRecentUserTurnIsIdReset: null} on teardownPane
  // and transitionToActiveNew — both are per-connection resets where a
  // fresh tail is about to start. See layer1-detect.ts for the reducer
  // + rationale. Replaces the pre-refactor `hasSeenExit` boolean.
  let layer1: Layer1State = { mostRecentUserTurnIsIdReset: null };
  // Phase 30 Plan 30-01 (PS30-01): per-connection authoritative pane_state
  // emitter. Consolidates today's five racing wire frames (dormant /
  // session_holding / session_holding_cleared / session_changed / inactive)
  // into ONE authoritative { type: "pane_state", state, reason? } frame.
  // Legacy frames stay on the wire alongside (backward-compat this phase);
  // the emitter is ADDITIVE — every existing ws.send at the transition sites
  // below gets a matching paneStateEmitter.emit(...) call. Deduped on strict
  // (state, reason) equality against the last emit (mirrors dormantLastEmitted
  // at lines 1010-1022). See pane-state-emitter.ts for the pure module +
  // 30-CONTEXT.md § Signal set for the LOCKED wire contract.
  const paneStateEmitter: PaneStateEmitter = createPaneStateEmitter({
    wsSend: (data: string) => {
      if (!stopped && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          /* ws may be mid-close */
        }
      }
    },
  });
  // Follow-up to patch #356 (2026-08-08): the reason we entered holding.
  // Layer 2's transitionFromHoldingToActiveSameFile helper reads this to
  // decide whether a "same-file active" repoll tick should self-clear the
  // overlay. When holdingReason === "id_reset" the overlay stays up until
  // the NEW session file appears (transitionToActiveNew) — because Claude
  // is still running its /id save flow before the real recycle, and
  // Layer 2's same-file reading is stale.
  let holdingReason: "id_reset" | "discovery_diff" | null = null;
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
    // quick 260808-dmz: clear dormant-poll loop on pane teardown.
    if (dormantPollTimer) {
      clearInterval(dormantPollTimer);
      dormantPollTimer = null;
    }
    dormantPollInFlight = false;
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
    planPendingLastSerialized = "null";
    // Phase 24 Plan 03: invalidate the fetched plan-content cache and drop
    // any in-flight fetch trackers. Late arrivals from a pre-teardown fetch
    // are short-circuited by the per-window token compare in .then()/.catch()
    // (CR-01 fix — token bump on every cache-clear invalidates in-flight
    // closures regardless of what planPendingLastSerialized currently holds).
    planPendingContentByPath.clear();
    planPendingFetchInFlightForPath.clear();
    planPendingWindowToken += 1;
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
    layer1 = { mostRecentUserTurnIsIdReset: null };
    holdingReason = null;
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
  // pre-refactor code with ONE addition: the Layer 1 tail-state-derived
  // /id reset detector right after the ws-open guard (quick 260808-ohn).
  const onLine = (line: string) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;

    // Phase 3 Layer 1 (rewired 2026-08-08, quick 260808-ohn / bounty
    // session-holding-layer1-detect-id-reset-not-exit):
    //
    // Feed every raw JSONL line through the tail-state reducer in
    // layer1-detect.ts. The reducer updates `layer1.mostRecentUserTurnIsIdReset`
    // iff the line is a user turn, then decides an action based on
    // the new state + current changeoverState. The SessionHoldingOverlay
    // is armed IFF the file's most-recent user turn is /id reset —
    // computed uniformly across `-n +1` replay AND live-append, so
    // historical /exit or historical /id reset lines from prior
    // recycles no longer re-flash the overlay on WS reconnect (Ashley
    // empirically saw 14 arm+clear pairs in ~1h under the pre-refactor
    // /exit edge-triggered detector). Sub-second detection of the
    // current session's /id reset is preserved. Layer 2 (discovery
    // repoll in the ticker) still catches SIGTERM-fallback and
    // recover-in-different-cwd via sessionFile diff. See
    // layer1-detect.ts for the reducer's rationale + unit tests, and
    // CONTEXT.md D-30 for the two-layer architecture.
    //
    // Fall through — the parser may still emit the /id reset turn as
    // a message (per Ashley's HARD LOCK: slash commands must remain
    // visible in pretty view). The state transition is orthogonal to
    // whether the /id reset text renders as a chat bubble. DO NOT
    // `return` here.
    const layer1Action = applyLineToLayer1State(line, layer1, changeoverState);
    if (layer1Action === "arm_holding") {
      transitionToHolding("id_reset");
    } else if (layer1Action === "clear_holding") {
      transitionFromHoldingToActiveSameFile();
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
      // ── DEPRECATED FOR PENDING-WINDOW DETECTION (quick 260802-rps) ─────
      // Claude Code 2.1.150's `ExitPlanModeV2Tool` BUFFERS the tool_use in
      // Ink UI memory and only flushes it to the parent JSONL when the user
      // resolves the plan-approval prompt (approve or reject). Live
      // confirmation on Moxie's workstation 2026-08-02: 57-minute gap
      // between the model calling ExitPlanMode and the JSONL write, which
      // landed at the exact moment Ashley approved. As a result THIS SCAN
      // IS EFFECTIVELY DEAD CODE for pending-window detection — during the
      // entire pending window the JSONL has zero signal.
      //
      // The authoritative live signal is now the pane-scrape via
      // `isPlanPending` wired into the context-pct setInterval (see
      // ~line 3106). This scan is RETAINED as belt-and-suspenders for two
      // remaining edges: (1) the resolution edge — after V2 flushes both
      // the tool_use and the matching tool_result on user resolution, this
      // scan will re-emit `pending: null` (harmless coalesce with the
      // pane-scrape's own null-emit); (2) backward-compat for any older
      // Claude Code sessions still writing ExitPlanMode eagerly (v1 tool
      // behavior). Do NOT delete without confirming both edges are
      // covered by the pane-scrape.
      // ────────────────────────────────────────────────────────────────
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
      // Phase 24 Plan 03: widen the JSONL-scan emit shape to match the
      // pane-scrape emit (`{planFilePath, planContent, contentError}` or
      // null). JSONL is a resolution-edge fallback per patch #63 docblock;
      // do NOT trigger an SFTP fetch here — the pane-scrape at ~L3355 is
      // the authoritative live signal that owns the fetch trigger. Content
      // will always be null on this path; the frontend renders "Loading
      // plan…" until (in the unlikely event a JSONL-first pending appears)
      // the pane-scrape catches up on its next tick.
      const currentPending = pendingIter.done
        ? null
        : {
            planFilePath: pendingIter.value.planFilePath || null,
            planContent: null,
            contentError: null,
          };
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
      case "malformed":
        // pv-malformed-jsonl-placeholder-bubble (2026-08-10): emit a
        // placeholder frame so the frontend can render a compact
        // "[malformed JSONL line — N bytes, content lost]" bubble.
        // eventId is a content-hash of the raw line (see malformedEventId)
        // so tail-restart replays dedupe via appendDedup instead of stacking.
        // Bytes carries the trimmed byte length as diagnostic. Root cause is
        // a Claude Code writer race reported separately upstream; this
        // placeholder is user-facing visibility that a turn was dropped.
        try {
          ws.send(
            JSON.stringify({
              type: "malformed_line",
              bytes: parsed.bytes,
              eventId: malformedEventId(line),
              ts: Date.now(),
            }),
          );
        } catch {
          /* ws may be mid-close; drop */
        }
        break;
      // kind:"skip" — silent drop (RENDER-01 lock; skip covers meta,
      // empty_content, harness_wrapper, no_message, unknown-type)
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
  // layer1, holdingTicks, ws, sshConn, etc.) and the connection-scoped
  // context (currentHostId, currentTmuxSession — set on connectToPane).
  // ---------------------------------------------------------------------------

  // Called when the tail's onLine dispatches Layer 1's tail-state-derived
  // /id reset detector (sub-second, quick 260808-ohn) OR when the ticker's
  // discovery-repoll notices a changed sessionFile (Layer 2's
  // SIGTERM-fallback path). Idempotent against double-fire — if state is
  // already `holding` or `dead`, this is a no-op. That protects against the
  // race where Layer 1 fires on the tail's onLine milliseconds before the
  // ticker's Layer 2 repoll notices the same recycle.
  const transitionToHolding = (
    reason: "id_reset" | "discovery_diff",
  ): void => {
    if (changeoverState !== "active") return;
    changeoverState = "holding";
    holdingReason = reason;
    holdingTicks = 0;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session_holding" }));
      } catch {
        /* ws may be mid-close */
      }
    }
    // Phase 30 Plan 30-01 (PS30-01): authoritative pane_state alongside the
    // legacy session_holding frame. `reason` forwards through — Layer 1
    // dispatches "id_reset"; Layer 2 discovery-repoll dispatches
    // "discovery_diff". The emitter's own guard + dedupe make this safe
    // even under the pre-existing idempotent-double-fire race between L1
    // and L2 (both funnel here with the same reason on rare co-fires).
    paneStateEmitter.emit("holding", reason);
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

  // Fix B (2026-07-30): self-clear the holding overlay when the repoll's
  // active-branch sees the SAME sessionFile while changeoverState === "holding".
  // This means the overlay was armed by a false alarm (e.g. a transient SSH
  // blip that slipped through before Fix A, or a brief bare-shell gap that
  // resolved on the next tick), NOT a real recycle. The same-file result on
  // an active tick proves claude never actually stopped writing to this file.
  //
  // Contrast with transitionToActiveNew (called when sessionFile CHANGED) which
  // is a heavy-reset for a confirmed real recycle. This helper is surgical:
  // flip changeoverState back to active, reset holdingTicks, emit
  // session_holding_cleared. The frontend handler clears only isHolding +
  // holdingTimeoutError and does NOT touch messages / contextPct / harnessTasks
  // / backgroundedAgents / plan_pending / asideText — false-alarm recovery
  // must not discard the conversation the user is looking at.
  //
  // Idempotency: if changeoverState is not "holding", this is a no-op. Guards
  // against double-fire (e.g. from a fast repoll that fires twice before the
  // first tick's WS send completes).
  const transitionFromHoldingToActiveSameFile = (): void => {
    if (changeoverState !== "holding") return;
    // Follow-up to patch #356 (2026-08-08): if we entered holding because
    // Layer 1 saw a real /id reset in the tail, the 3-second repoll tick's
    // "same-file active" reading is STALE — Claude is still running its
    // /id save flow (many tool invocations) before exit, so discovery
    // correctly reports the OLD session file as active. Clearing here
    // would flash the SessionHoldingOverlay off within ~1-3s of Ashley
    // typing /id reset even though the real recycle is still coming.
    // Skip the clear; wait for transitionToActiveNew when the new session
    // file appears (Layer 2's real-recycle path, unchanged).
    if (holdingReason === "id_reset") {
      sshLogger.debug(
        "Layer 2 same-file-active during id_reset holding — deferring clear to transitionToActiveNew",
        {
          operation: "claude_session_holding_same_file_id_reset_deferred",
          userId,
          sessionId,
          hostId: currentHostId,
          tmuxSession: currentTmuxSession,
          sessionFile: currentSessionFile,
        },
      );
      return;
    }
    changeoverState = "active";
    holdingReason = null;
    holdingTicks = 0;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session_holding_cleared" }));
      } catch {
        /* ws may be mid-close */
      }
    }
    // Phase 30 Plan 30-01: false-alarm-recovery case. Surface the recovery
    // reason so the frontend + logs can distinguish this "we armed holding
    // then discovery repoll proved it was a false alarm" path from the
    // real-recycle transitionToActiveNew ("session_changed") path.
    paneStateEmitter.emit("active", "same_file_recovery");
    sshLogger.info("Claude session self-cleared from holding on same-file recovery", {
      operation: "claude_session_holding_cleared",
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      sessionFile: currentSessionFile,
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
    planPendingLastSerialized = "null";
    // Phase 24 Plan 03: clean-slate the plan-content cache on session recycle.
    // CR-01 fix: bump the window token so any in-flight fetch dispatched
    // against the OLD session's pending window drops its result silently.
    planPendingContentByPath.clear();
    planPendingFetchInFlightForPath.clear();
    planPendingWindowToken += 1;
    // quick 260808-ohn: reset Layer 1 tail-state on session recycle so the
    // new tail's -n +1 replay converges on clean bookkeeping.
    layer1 = { mostRecentUserTurnIsIdReset: null };
    holdingReason = null;
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
    // Phase 30 Plan 30-01: real-recycle path. The new session file's UUID
    // stays on the legacy session_changed frame only — pane_state's
    // reason field is enum-shaped (no filesystem paths per T-30-01
    // mitigation). "session_changed" as reason keeps parity with the
    // legacy frame's meaning.
    paneStateEmitter.emit("active", "session_changed");
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
    // Phase 30 Plan 30-01: terminal inactive from holding-timeout. Reason
    // forwards through as "holding_timeout" (the only current caller).
    paneStateEmitter.emit("inactive", reason);
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

  // quick 260808-dmz: connection-scoped forward reference for startActiveSessionFlow.
  // Assigned on the first connectToPane message (before discovery), so it is
  // in scope when the dormant-poll timer callback fires 3 seconds later even if
  // the message handler returned early via the inactive→dormant branch.
  // eslint-disable-next-line prefer-const
  let startActiveSessionFlow: (params: {
    pid: number;
    sessionFile: string;
    tmuxSession: string;
    hostId: number;
  }) => void = () => { /* noop until assigned by connectToPane */ };

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

    // Phase 22 SRIC-06 / Plan 22-06: identity:get-role-file — byte-shape mirror
    // of identity:get-identity-file above. Delegates to handleIdentityGetRoleFile
    // (exported for tests) so the entire byte-shape mirror body is a single
    // audit surface. See handler prologue at the module-scope function below.
    if (msg.type === "identity:get-role-file") {
      await handleIdentityGetRoleFile(ws, msg, userId);
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
        let markdown: string;
        if (useLocal) {
          ({ entries, markdown } = await readIdentityHistory(null, identityKey));
          sshLogger.info("identity:get-history", {
            operation: "identity_get_history",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: entries.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:history", entries: [], markdown: "", error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ entries, markdown } = await readIdentityHistory(conn, identityKey));
            sshLogger.info("identity:get-history", {
              operation: "identity_get_history",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: entries.length,
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        // Phase 18 / IDMEDIT-02: emit markdown alongside entries so HistoryTab
        // can populate its textarea editor without a separate raw-file fetch.
        try { ws.send(JSON.stringify({ type: "identity:history", entries, markdown })); } catch { /* ignore */ }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-history error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_history_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:history", entries: [], markdown: "", error: err instanceof Error ? err.message : String(err) }));
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
    //
    // Quick 260731-2pa: `updates` widened to also accept `name` (non-empty
    // string) and `instruction` (string). Backs the form-based editor in
    // WakeupsTab.tsx which writes the full spec on Save. Filter, validate,
    // and thread each field into `filtered` the same way enabled/schedule
    // already do; the `no updates` guard now considers all four.
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
      const updates = rawUpdates as { enabled?: unknown; schedule?: unknown; name?: unknown; instruction?: unknown };
      const filtered: { enabled?: boolean; schedule?: unknown; name?: string; instruction?: string } = {};
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
      if (updates.name !== undefined) {
        if (typeof updates.name !== "string" || updates.name.length === 0) {
          try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "name must be a non-empty string" })); } catch { /* ignore */ }
          return;
        }
        filtered.name = updates.name;
      }
      if (updates.instruction !== undefined) {
        if (typeof updates.instruction !== "string") {
          try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "instruction must be a string" })); } catch { /* ignore */ }
          return;
        }
        filtered.instruction = updates.instruction;
      }
      if (filtered.enabled === undefined && filtered.schedule === undefined && filtered.name === undefined && filtered.instruction === undefined) {
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

    // Phase 18 / IDMEDIT-06: identity:update-identity-file — full-overwrite
    // <key>/<key>.md via SFTP tmp+rename (REMOTE) or fs tmp+rename (LOCAL).
    // After write, re-reads the file via readIdentityFile so the client
    // rehydrates from server-side truth. Mirror of identity:update-wakeup.
    if (msg.type === "identity:update-identity-file") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
      const rawKey = raw.identityKey;
      const rawContents = raw.contents;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawContents !== "string") {
        try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: "contents must be a string" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const contents = rawContents;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let markdown: string;
        if (useLocal) {
          await writeIdentityFile(null, identityKey, contents);
          ({ markdown } = await readIdentityFile(null, identityKey));
          sshLogger.info("identity:update-identity-file", {
            operation: "identity_update_identity_file",
            userId, identityKey, hostId: hostIdNum, useLocal: true,
            bytes: Buffer.byteLength(contents, "utf-8"),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityFile(conn, identityKey, contents);
            ({ markdown } = await readIdentityFile(conn, identityKey));
            sshLogger.info("identity:update-identity-file", {
              operation: "identity_update_identity_file",
              userId, identityKey, hostId: hostIdNum, useLocal: false,
              bytes: Buffer.byteLength(contents, "utf-8"),
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-identity-file unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_identity_file_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Phase 22 SRIC-06 / Plan 22-06: identity:update-role-file — byte-shape
    // mirror of identity:update-identity-file above. Delegates to
    // handleIdentityUpdateRoleFile (exported for tests). See handler prologue
    // at the module-scope function below.
    if (msg.type === "identity:update-role-file") {
      await handleIdentityUpdateRoleFile(ws, msg, userId);
      return;
    }

    // Phase 18 / IDMEDIT-06: identity:update-history — full-overwrite
    // <key>/history.md. After write, re-reads via readIdentityHistory so the
    // client receives parsed entries (mirrors HistoryTab's existing wire shape).
    if (msg.type === "identity:update-history") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
      const rawKey = raw.identityKey;
      const rawContents = raw.contents;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawContents !== "string") {
        try { ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], error: "contents must be a string" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const contents = rawContents;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let entries: string[];
        let markdown: string;
        if (useLocal) {
          await writeIdentityHistory(null, identityKey, contents);
          ({ entries, markdown } = await readIdentityHistory(null, identityKey));
          sshLogger.info("identity:update-history", {
            operation: "identity_update_history",
            userId, identityKey, hostId: hostIdNum, useLocal: true,
            bytes: Buffer.byteLength(contents, "utf-8"),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], markdown: "", error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityHistory(conn, identityKey, contents);
            ({ entries, markdown } = await readIdentityHistory(conn, identityKey));
            sshLogger.info("identity:update-history", {
              operation: "identity_update_history",
              userId, identityKey, hostId: hostIdNum, useLocal: false,
              bytes: Buffer.byteLength(contents, "utf-8"),
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        // Phase 18 / IDMEDIT-02: echo both entries and markdown so HistoryTab
        // rehydrates the textarea from server truth after Save.
        try { ws.send(JSON.stringify({ type: "identity:history-updated", entries, markdown })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-history unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_history_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch { /* ignore */ }
      }
      return;
    }

    // Phase 18 / IDMEDIT-06: identity:update-handoff — full-overwrite
    // <key>/handoff.md. After write, re-reads via readIdentityHandoff so the
    // client rehydrates from server-side truth.
    if (msg.type === "identity:update-handoff") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
      const rawKey = raw.identityKey;
      const rawContents = raw.contents;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawContents !== "string") {
        try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: "contents must be a string" })); } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const contents = rawContents;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let markdown: string;
        if (useLocal) {
          await writeIdentityHandoff(null, identityKey, contents);
          ({ markdown } = await readIdentityHandoff(null, identityKey));
          sshLogger.info("identity:update-handoff", {
            operation: "identity_update_handoff",
            userId, identityKey, hostId: hostIdNum, useLocal: true,
            bytes: Buffer.byteLength(contents, "utf-8"),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityHandoff(conn, identityKey, contents);
            ({ markdown } = await readIdentityHandoff(conn, identityKey));
            sshLogger.info("identity:update-handoff", {
              operation: "identity_update_handoff",
              userId, identityKey, hostId: hostIdNum, useLocal: false,
              bytes: Buffer.byteLength(contents, "utf-8"),
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-handoff unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_handoff_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: err instanceof Error ? err.message : String(err) }));
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

    // Phase 18 / IDMEDIT-04: identity:update-bounty-fields — partial-JSON-patch
    // writer for bounty fields. Accepts title/premise/todos/keywords/source_links/
    // deadline/meeting_questions; rejects pinned (has its own handler). Per-field
    // validation runs inside writeIdentityBountyFields — handler only validates the
    // top-level shape. Returns fresh {bounties, archivedBounties} so BountyCard
    // rehydrates from server truth (same convention as the priority/status/pinned echoes).
    if (msg.type === "identity:update-bounty-fields") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; patch?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawPatch = raw.patch;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
        return;
      }
      if (typeof rawPatch !== "object" || rawPatch === null) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid patch" })); } catch { /* ignore */ }
        return;
      }
      // Per-field type validation (title length, todos shape, etc.) runs inside
      // writeIdentityBountyFields. Handler-level check only ensures patch is an object.
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const patch = rawPatch as BountyFieldsPatch;
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
          await writeIdentityBountyFields(null, identityKey, bountySlug, patch);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-fields", {
            operation: "identity_update_bounty_fields",
            userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true,
            fields: Object.keys(patch).join(","),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyFields(conn, identityKey, bountySlug, patch);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-fields", {
              operation: "identity_update_bounty_fields",
              userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false,
              fields: Object.keys(patch).join(","),
            });
          } finally {
            try { conn.end(); } catch { /* ignore */ }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties, archivedBounties })); } catch { /* ignore */ }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-fields unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_fields_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
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

    // Phase 24 Plan 03: raw_keystrokes — one-shot PTY write for plan-mode
    // Approve ("1\r") + Feedback ("3<text>\r"). Deliberately NOT the
    // ComposeBox split-send path (patch #44's body+\r-with-60ms-gap) — Ink
    // Plan Mode does NOT recognize split-send as a keystroke selection
    // (PlanPendingBubble.tsx L14-21 lesson; verified by Ashley 2026-07-18).
    // `tmux send-keys -l` (literal flag) prevents a leading `1`, `3`, or
    // `\r` inside the payload from being interpreted as a tmux key-name.
    //
    // Trust boundary (mirrors aside_dismissed T-14-02-01): the send target
    // is derived from the connection's captured currentTmuxSession (set on
    // connectToPane discovery success). We IGNORE any client-supplied
    // hostId/tmuxSession in the payload — a client cannot spoof a raw
    // keystroke into a pane it doesn't own.
    if (msg.type === "raw_keystrokes") {
      if (!sshConn || !currentTmuxSession) return;
      const bytes = String((msg as { bytes?: unknown }).bytes ?? "");
      if (bytes.length === 0) return;
      // WR-03 fix: cap the payload size before it hits `tmux send-keys -l`.
      // A misbehaving/buggy client (or forced payload) with a multi-megabyte
      // feedback string would otherwise flow straight to a single-argv shell
      // command that guaranteed-fails at POSIX ARG_MAX, wasting a channel
      // open + a serialize pass. 16KB is comfortably above any legitimate
      // plan-approval feedback (Claude Code's own input is smaller).
      const MAX_RAW_KEYSTROKES_BYTES = 16 * 1024;
      if (bytes.length > MAX_RAW_KEYSTROKES_BYTES) {
        sshLogger.warn("raw_keystrokes rejected: payload too large", {
          operation: "raw_keystrokes_reject_size",
          hostId: currentHostId,
          tmuxSession: currentTmuxSession,
          bytesLength: bytes.length,
          maxBytes: MAX_RAW_KEYSTROKES_BYTES,
        });
        return;
      }
      try {
        await execCommand(
          sshConn,
          `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}`,
        );
      } catch (err) {
        // Log but do not throw — the bubble stays mounted and the user can
        // retry via the pane keyboard directly. Fail-quietly here matches
        // the injectBtw / dismissBtw posture (they also log-and-swallow).
        sshLogger.warn("raw_keystrokes send failed", {
          operation: "raw_keystrokes_send_error",
          hostId: currentHostId,
          tmuxSession: currentTmuxSession,
          bytesLength: bytes.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // quick 260808-cd6 — wake message: client -> server sentinel delete.
    // Guard: require currentTmuxSession + sshConn + isIdentityShapedCached === true
    // (T-cd6-01: backend ignores any hostId/tmuxSession in the payload and uses
    // only connection-scoped currentTmuxSession set at connectToPane discovery).
    // (T-cd6-02: single-quote wrap on escapedName; already validated to safe subset).
    // (T-cd6-03: path hard-coded to ~/.claude/identities/<name>/.dormant).
    // Does NOT try to fast-poke the supervisor; next CHECK_INTERVAL tick picks it up.
    if (msg.type === "wake") {
      // quick 260808-fgf: intercept wsSend to detect a successful wake_result
      // and record wakeTriggerTs at the moment the rm -f exec succeeded.
      // We wrap wsSend (not the seam itself) so __applyWakeMessageForTests's
      // signature contract (Tests E/F/K) is preserved unchanged.
      let lastWakeOk = false;
      await __applyWakeMessageForTests({
        sshConn,
        currentTmuxSession,
        isIdentityShapedCached,
        execCommand,
        wsSend: (data: string) => {
          try {
            const frame = JSON.parse(data);
            if (frame.type === "wake_result" && frame.ok === true) {
              lastWakeOk = true;
            }
          } catch { /* ignore parse failures — still forward the frame */ }
          try { ws.send(data); } catch { /* ws may be mid-close */ }
        },
      });
      if (lastWakeOk) {
        wakeTriggerTs = Date.now();
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

    // quick 260808-dmz: closure-scoped helper — extracted active-flow start.
    // Called from (a) the initial active discovery path below, and (b) the
    // dormant-poll wake path above when sentinel disappears + re-discovery
    // finds an active session. Extracts SESSION-METADATA-EMIT + TAIL-START +
    // CONTEXT-PCT-TIMER-START (lines originally ~3503-3841). The aside
    // subsystem block is NOT extracted — it stays inline in the initial-active
    // path and is re-invoked separately in the dormant-poll wake path.
    //
    // Captures closure state: ws, sshConn, sshLogger, userId, sessionId,
    // tailHandle, contextPctTimer, contextPctInFlight, dormantInFlight,
    // dormantLastEmitted, isIdentityShapedCached, identityShapeProbeInFlight,
    // planPendingContentByPath, pendingPlans, pendingPlansLastSerialized,
    // planPendingLastSerialized, planPendingWindowToken,
    // planPendingFetchInFlightForPath, backgroundedAgents,
    // backgroundedAgentsLastSerialized, backgroundedShells,
    // backgroundedShellsLastSerialized, changeoverState, currentSessionFile,
    // sessionIdFromFile, hasSeenExit, holdingTicks, discoveryRepollInFlight,
    // currentHostId, currentTmuxSession, stopped.
    startActiveSessionFlow = ({ pid, sessionFile, tmuxSession: activeTmuxSession, hostId: activeHostId }: {
      pid: number;
      sessionFile: string;
      tmuxSession: string;
      hostId: number;
    }) => {
    // Active path: metadata frame first, then start the tail.
    ws.send(
      JSON.stringify({
        type: "session",
        pid,
        sessionFile,
      }),
    );
    // Phase 30 Plan 30-01 (PS30-07): attach-time pane_state establishment.
    // Fires right after the session metadata so a fresh client that has
    // never received a pane_state before immediately learns "this pane is
    // active" — no wait for the first transition tick. Same call site is
    // reused by the dormant-poll → wake path (startActiveFlow callback)
    // which routes through startActiveSessionFlow, so both attach flows
    // (fresh connectToPane AND wake-from-dormant) establish pane_state
    // uniformly through this one line. No reason (bare "active") — reasons
    // decorate transitions, not the initial establishment.
    paneStateEmitter.emit("active");

    sshLogger.info("Starting Claude session tail", {
      operation: "claude_session_tail_start",
      userId,
      sessionId,
      hostId: activeHostId,
      tmuxSession: activeTmuxSession,
      pid,
      sessionFile,
    });

    // Phase 3: pin the connection-scoped context so the state-transition
    // helpers can log with the right hostId/tmuxSession without needing to
    // re-thread them through every callsite. Also gives the discovery-repoll
    // ticker its baseline to compare `sessionFile` against — without
    // seeding `currentSessionFile` here, the first ticker comparison would
    // treat the current file as "changed" and immediately fire
    // transitionToActiveNew on itself.
    currentHostId = activeHostId;
    currentTmuxSession = activeTmuxSession;
    currentSessionFile = sessionFile;
    sessionIdFromFile = sessionFile
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
    //   * BAR-ANCHORED regex (patch #187 / quick 260729-ig7): the `%`
    //     must be immediately preceded (with optional whitespace) by a
    //     Claude Code meter glyph (`[█▉▊▋▌▍▎▏░]\s*NN%`). Closes the
    //     false-positive where a weekly-limit warning appended to the
    //     same line ("... 29% ┃ youve used 95% of your weekly limit")
    //     caused rightmost-wins to return 95 instead of 29. Rightmost
    //     still wins for the patch #59 milestone-bar case because both
    //     meters are bar-anchored.
    //   * FALLBACK: bar-glyph pattern (░/█ chars unique to the visual
    //     context bar) with the same per-line rightmost-% rule, for hosts
    //     where "(1M context)" is absent but the visual bar remains.
    //
    // Scan logic lives in ./context-pct-parser.ts for testability; this
    // callback just delegates to parseContextPct(output).
    const CONTEXT_PCT_INTERVAL_MS = 3000;
    // Single-quote wrap for the session name. Tmux session names are
    // validated by the frontend to a tmux-safe subset (alphanumeric,
    // dash, underscore), so single-quote escape is sufficient.
    const captureCmd = `tmux capture-pane -p -t '${activeTmuxSession}'`;
    contextPctTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (contextPctInFlight) return; // guard against slow SSH pileups
      contextPctInFlight = true;
      const connSnapshot = sshConn;
      // Read currentSessionFile at poll-fire time (not up-front) so a
      // session recycle after connect is picked up on the next tick —
      // matches how other closure-scoped fields are consulted inside
      // this callback.
      const sessionFileSnapshot = currentSessionFile;
      // TODO(post-260808-11l): once JSONL is confirmed stable in prod,
      // the capture-pane call could be skipped in the pct-only path when
      // plan-pending is disabled. Deferred — keep behavior symmetric
      // while validating the swap.
      (async () => {
        try {
          // PRIMARY: JSONL read (authoritative, pane-width-independent).
          // See ./context-pct-from-jsonl.ts docblock for the WHY / the
          // 16.5% autocompact normalization mirror / the ±1 rounding
          // note. Returns null on any error — helper never throws.
          let pct: number | null = null;
          if (sessionFileSnapshot) {
            pct = await readContextPctFromJsonl(
              connSnapshot,
              sessionFileSnapshot,
            );
          }
          // Get pane output once — needed for parseContextPct fallback
          // AND for isPlanPending / parsePlanFilePath below (they still
          // key off the pane's overlay text, not the JSONL).
          let output = "";
          try {
            output = await execCommand(connSnapshot, captureCmd);
          } catch {
            // Silent — scrape failure is nice-to-have, not load-bearing.
            // pct stays whatever the JSONL path produced; plan-pending
            // simply sees "" and reports null.
          }
          // FALLBACK: only invoke the scrape parser if JSONL yielded no
          // value (no sessionFile resolved yet, or fresh session with
          // no assistant turn). context-pct-parser.ts is preserved as
          // the fallback path per quick-260808-11l.
          if (pct === null && output !== "") {
            pct = parseContextPct(output);
          }
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (pct !== null) {
            try {
              ws.send(JSON.stringify({ type: "context_pct", pct }));
            } catch {
              /* ws may be mid-close */
            }
          }
          // Plan-pending PANE-SCRAPE (quick 260802-rps; extended Phase 24
          // Plan 03). Reuses the same `output` capture-pane payload that
          // just fed parseContextPct above — no additional SSH round-trip.
          //
          // Phase 24 extended shape: `{planFilePath, planContent, contentError}`
          // (or null when the prompt is absent). The IMMEDIATE emit carries
          // presence + planFilePath only; planContent is populated by an
          // async SFTP fetch that fires once per (pending-window, planFilePath)
          // pair and re-emits with the same de-dup guard.
          //
          // De-dup guard preserved verbatim: `JSON.stringify(currentPending)`
          // vs `planPendingLastSerialized`. On the transition-to-closed edge
          // (isPending false + we previously had cached content or an
          // in-flight fetch), we invalidate the caches — the same slug
          // reappearing after a close is treated as a fresh window and
          // refetched (per CONTEXT § "cache keyed by pending window").
          const isPending = isPlanPending(output);
          const planFilePath = isPending ? parsePlanFilePath(output) : null;

          // Transition-to-closed: clear the per-window content cache and
          // any in-flight tracker. Late-arriving fetches short-circuit via
          // the per-window token compare in .then()/.catch() (CR-01 fix).
          if (
            !isPending &&
            (planPendingContentByPath.size > 0 ||
              planPendingFetchInFlightForPath.size > 0)
          ) {
            planPendingContentByPath.clear();
            planPendingFetchInFlightForPath.clear();
            planPendingWindowToken += 1;
          }

          // CR-01 fix: window-transition invalidation. If the pane is still
          // pending but the planFilePath differs from what any in-flight
          // fetch was dispatched for, we need to invalidate the prior
          // window's token too — otherwise a PlanA → PlanB slug swap (or a
          // same-slug regenerate that never went through a null tick) lets
          // a stale PlanA fetch write into what the UI has now moved on
          // from. We detect this by: pane is pending + we have EITHER
          // in-flight fetches for paths that don't match the current path,
          // OR cached content for paths that don't match. In either case,
          // clear caches for stale paths and bump the token so the stale
          // fetches drop silently on arrival.
          if (
            isPending &&
            planFilePath &&
            (Array.from(planPendingContentByPath.keys()).some(
              (p) => p !== planFilePath,
            ) ||
              Array.from(planPendingFetchInFlightForPath).some(
                (p) => p !== planFilePath,
              ))
          ) {
            planPendingContentByPath.clear();
            planPendingFetchInFlightForPath.clear();
            planPendingWindowToken += 1;
          }

          const cached = planFilePath
            ? planPendingContentByPath.get(planFilePath)
            : null;
          const currentPending = isPending
            ? {
                planFilePath,
                planContent: cached?.content ?? null,
                contentError: cached?.error ?? null,
              }
            : null;
          const pendingSerialized = JSON.stringify(currentPending);
          if (pendingSerialized !== planPendingLastSerialized) {
            planPendingLastSerialized = pendingSerialized;
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

          // Kick off async SFTP fetch once per (pending-window, planFilePath)
          // pair. Guards: pane must actually be pending; parser must have
          // yielded a path; sshConn must still be bound; we don't already
          // have a cached result; and no fetch is already in flight.
          if (
            isPending &&
            planFilePath &&
            sshConn &&
            !planPendingContentByPath.has(planFilePath) &&
            !planPendingFetchInFlightForPath.has(planFilePath)
          ) {
            planPendingFetchInFlightForPath.add(planFilePath);
            const targetPath = planFilePath; // capture for the async closure
            const activeSshConn = sshConn; // narrow non-null for the closure
            // CR-01 fix: capture the current window token at fetch-dispatch
            // time. Any cache-clear site (transition-to-closed, teardown,
            // session_changed, slug-swap-during-pending) bumps
            // planPendingWindowToken; a mismatch in .then()/.catch() means
            // this fetch was dispatched for a window that no longer exists,
            // and its result must be discarded rather than written into a
            // future window's cache (which would flip-flop the UI or make
            // it stick on a stale plan).
            const fetchToken = planPendingWindowToken;
            void fetchPlanFile(activeSshConn, targetPath)
              .then((result) => {
                planPendingFetchInFlightForPath.delete(targetPath);
                // CR-01 fix: per-window token guard. Drops the result
                // silently if the pending window this fetch was dispatched
                // for is no longer current (closed OR transitioned to a
                // different slug). Replaces the pre-fix
                // `planPendingLastSerialized === "null"` guard, which only
                // caught the fully-closed case.
                if (fetchToken !== planPendingWindowToken) return;
                const cacheEntry =
                  "content" in result
                    ? { content: result.content, error: null }
                    : { content: null, error: result.error };
                planPendingContentByPath.set(targetPath, cacheEntry);
                // Re-emit with populated planContent OR contentError. De-dup
                // guard reused so back-to-back identical emits collapse.
                const nextPending = {
                  planFilePath: targetPath,
                  planContent: cacheEntry.content,
                  contentError: cacheEntry.error,
                };
                const nextSerialized = JSON.stringify(nextPending);
                if (nextSerialized !== planPendingLastSerialized) {
                  planPendingLastSerialized = nextSerialized;
                  try {
                    ws.send(
                      JSON.stringify({
                        type: "plan_pending",
                        pending: nextPending,
                      }),
                    );
                  } catch {
                    /* ws may be mid-close */
                  }
                }
              })
              .catch((err) => {
                planPendingFetchInFlightForPath.delete(targetPath);
                // CR-01 fix: same per-window token guard on the error path —
                // if the window is stale we must not cache the error either
                // (would poison the new window's slot if the slug matches).
                if (fetchToken !== planPendingWindowToken) return;
                // Cache the error so subsequent ticks don't re-fire the
                // fetch until the pending window closes and re-opens.
                const message =
                  err instanceof Error ? err.message : String(err);
                planPendingContentByPath.set(targetPath, {
                  content: null,
                  error: message,
                });
              });
          }

          // quick 260808-cd6 — dormancy stat check (two-tier: identity-shape probe
          // on first tick, dormant sentinel stat on subsequent ticks).
          // Runs AFTER the plan_pending block, BEFORE the finally.
          // Uses the SAME connSnapshot + tmuxSession captured above — zero new SSH
          // connections, zero new timers. The dormantInFlight guard mirrors
          // contextPctInFlight to prevent slow-SSH pileups.
          // Only VISIBLE panes are polled — hidden-pane suppression is inherited
          // from patch #344's WS-pause on !isVisible (the WS is closed, so poll
          // never fires). No additional gate needed here.
          if (!dormantInFlight && currentTmuxSession !== null && !stopped && ws.readyState === WebSocket.OPEN) {
            // Use the escapedName for single-quote shell wrapping. tmuxSession is
            // already validated to alphanumeric/dash/underscore by the frontend
            // (same rule as captureCmd at line ~3441 above). Per T-cd6-02: the
            // single-quote wrap prevents any $(…) or backtick injection.
            const escapedName = currentTmuxSession;
            // Build a per-connection state box pointing at the closure-scoped lets.
            // __applyDormantPollTickForTests mutates this box; we sync back below.
            const dormantState: __DormantStateForTests = {
              isIdentityShapedCached,
              identityShapeProbeInFlight,
              dormantLastEmitted,
              // quick 260809-ha3: pipe closure-scoped wakeTriggerTs through the
              // state box so the tick seam can emit wakingSince on dormant:true.
              wakeTriggerTs: () => wakeTriggerTs,
            };
            dormantInFlight = true;
            // Phase 30 Plan 30-01: capture dormantLastEmitted BEFORE the seam
            // runs so we can detect a change post-return and funnel it through
            // paneStateEmitter WITHOUT adding paneStateEmitter as an injected
            // dep on the pure __applyDormantPollTickForTests seam (that would
            // break the test-seam contract — every existing test constructs
            // deps by name).
            const dormantEmittedBefore = dormantLastEmitted;
            (async () => {
              try {
                await __applyDormantPollTickForTests(
                  {
                    connSnapshot,
                    escapedName,
                    execCommand,
                    wsSend: (data: string) => {
                      try { ws.send(data); } catch { /* ws may be mid-close */ }
                    },
                  },
                  dormantState,
                );
                // Sync mutation back to closure-scoped state.
                isIdentityShapedCached = dormantState.isIdentityShapedCached;
                identityShapeProbeInFlight = dormantState.identityShapeProbeInFlight;
                dormantLastEmitted = dormantState.dormantLastEmitted;
                // Phase 30 Plan 30-01: if the tick's dormancy state changed,
                // funnel the equivalent pane_state alongside the legacy
                // {type:"dormant",...} frame the seam already emitted. Compare
                // captured-before value to the post-sync value; on transition
                // to true → emit("dormant"), on transition to false →
                // emit("active", "dormancy_cleared").
                if (
                  dormantLastEmitted !== dormantEmittedBefore &&
                  dormantLastEmitted !== null
                ) {
                  if (dormantLastEmitted === true) {
                    paneStateEmitter.emit("dormant");
                  } else {
                    paneStateEmitter.emit("active", "dormancy_cleared");
                  }
                }
              } finally {
                dormantInFlight = false;
              }
            })();
          }
        } finally {
          contextPctInFlight = false;
        }
      })();
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
      discoverClaudeSession(connSnapshot, activeTmuxSession)
        .then((result) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (changeoverState === "dead") return; // idempotent guard

          // Fix A (2026-07-30): hoist isExecErrorTick flag so BOTH the
          // inactive branch (which must not arm holding) and the
          // holdingTicks++ block (which must not burn the timeout budget)
          // can check the same value without duplicating the predicate.
          //
          // exec_error = "we couldn't reliably ask" (SSH-side failure at
          // any of the four SSH-throw sites: queryPanePid, descendant walk,
          // PID-file read, JSONL test). Categorically different from the
          // real-inactive reasons below, which mean "we asked and got a
          // definitive no":
          //   • not_claude            — pane has no claude in its tree
          //   • no_pid_session_file   — claude PID exists but no PID file
          //   • no_open_session_file  — PID file found but JSONL missing
          //   • no_tmux_session       — no tmux pane to query at all
          //   • pid_unavailable       — kept for backcompat; no longer emitted
          // A transient SSH round-trip failure must NOT arm the overlay.
          const isExecErrorTick =
            result.status === "inactive" && result.reason === "exec_error";

          if (result.status === "active") {
            if (result.sessionFile !== currentSessionFile) {
              // File moved: recycle OR recover-in-different-cwd.
              if (changeoverState === "active") {
                // SIGTERM-fallback path: /exit never landed but the file
                // changed. Emit both holding and changed on the SAME tick.
                transitionToHolding("discovery_diff");
              }
              transitionToActiveNew(result.sessionFile);
            } else if (changeoverState === "holding") {
              // Fix B (2026-07-30): same file + still active + we're in holding
              // → the overlay was a false alarm. Self-clear on this repoll tick.
              transitionFromHoldingToActiveSameFile();
            }
            // else: same file + active + changeoverState === "active"
            // — nominal steady-state, no state change needed.
          } else if (!isExecErrorTick) {
            // status === "inactive" with a REAL inactive reason (not an SSH
            // failure). Bare-shell gap during recycle is expected.
            if (changeoverState === "active") {
              transitionToHolding("discovery_diff");
            }
          }
          // else: isExecErrorTick — SSH-side failure; silent tick.
          // Do NOT call transitionToHolding. !isExecErrorTick guard below
          // also prevents burning the holding budget.

          // Fix A (2026-07-30): guard with !isExecErrorTick so transient SSH
          // failures don't burn the 5-min holding budget on no-signal ticks.
          if (changeoverState === "holding" && !isExecErrorTick) {
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

    tailHandle = tailSessionFile(sshConn!, sessionFile, onLine, onError);
    }; // end of startActiveSessionFlow

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
      // quick 260808-dmz — dormancy probe BEFORE teardown.
      // FIX §1-2: if this is an identity-shaped pane AND the .dormant sentinel
      // exists, enter the dormant state instead of tearing down SSH. The probe is
      // inline+await so the branch decision (teardown vs. keep-alive) is synchronous.
      // Fail-safe: any SSH throw here falls through to the normal teardown path
      // (do not hold an SSH conn open on error).
      let enteredDormantPoll = false;
      if (result.reason === "not_claude") {
        // Only probe for dormancy on not_claude (the signal that no claude process is
        // running); exec_error / no_tmux_session / no_pid_session_file / etc. are
        // not dormancy candidates — treat them as plain inactive.
        try {
          const escapedName = tmuxSession; // validated to safe subset by frontend
          // Tier 1: is this an identity-shaped pane? (reuse exact command from seam line 946-950)
          const identityProbeOut = await execCommand(
            conn,
            `test -d ~/.claude/identities/'${escapedName}' && echo yes || echo no`,
          );
          const isIdentityShape = identityProbeOut.trim() === "yes";
          // Cache for the connection lifetime so dormant-poll and wake handler use it.
          isIdentityShapedCached = isIdentityShape;
          if (isIdentityShape) {
            // Tier 2: .dormant sentinel present? (reuse exact command from seam line 956-961)
            const dormantProbeOut = await execCommand(
              conn,
              `stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
            );
            if (dormantProbeOut.trim() === "yes") {
              // This IS a dormant pane. Seed closure state so wake handler +
              // dormant-poll can operate, then emit dormant:true and start poll.
              currentHostId = hostId;
              currentTmuxSession = tmuxSession;
              dormantLastEmitted = true;
              sshLogger.info("Claude session dormant state entered", {
                operation: "claude_session_dormant_entered",
                userId,
                sessionId,
                hostId,
                tmuxSession,
              });
              try {
                // quick 260809-ha3: dormant:true carries wakingSince (closure-scoped
                // wakeTriggerTs at ~L1264) so the client's wake-progress bar survives
                // Fix B (visibility false->true edge). Natural-dormant path (fresh
                // WS, no prior wake click) sends wakingSince:null.
                ws.send(JSON.stringify({ type: "dormant", dormant: true, wakingSince: wakeTriggerTs }));
              } catch { /* ws may be mid-close */ }
              // Phase 30 Plan 30-01 (PS30-07): initial-discovery-dormant path
              // establishes attach-time pane_state alongside the legacy dormant
              // frame. wakingSince stays on the legacy frame only — pane_state's
              // reason enum is qualitative, not timestamp-carrying (T-30-01).
              paneStateEmitter.emit("dormant");
              // FIX §3: Start the lightweight dormant-poll loop (3s cadence).
              // The loop polls the sentinel; on disappearance re-runs discovery;
              // on active → transitions to active flow via startActiveSessionFlow.
              // dormantPollInFlight guards against slow-SSH pileups.
              dormantPollTimer = setInterval(() => {
                if (stopped || ws.readyState !== WebSocket.OPEN || !sshConn || dormantPollInFlight) return;
                dormantPollInFlight = true;
                // Phase 30 Plan 30-01: capture dormantLastEmitted BEFORE the
                // seam runs so we can detect a change post-return and funnel
                // it through paneStateEmitter WITHOUT injecting the emitter
                // into the pure __applyDormantPollWithRediscoveryForTests
                // seam (that would break the test-seam contract). The
                // startActiveFlow callback below routes through
                // startActiveSessionFlow which fires paneStateEmitter.emit
                // ("active") on its own; here we cover the dormant:true and
                // dormant:false wire emits the seam does directly.
                const dormantEmittedBefore = dormantLastEmitted;
                (async () => {
                  try {
                    await __applyDormantPollWithRediscoveryForTests(
                      {
                        connSnapshot: sshConn!,
                        escapedName: currentTmuxSession!,
                        execCommand,
                        discoverSession: (c, s) => discoverClaudeSession(c as import("ssh2").Client, s),
                        wsSend: (data: string) => {
                          try { ws.send(data); } catch { /* ws may be mid-close */ }
                        },
                        startActiveFlow: (pid, sessionFile) => {
                          // Transition from dormant-poll to active flow.
                          // Clear dormant-poll timer — contextPctTimer takes over from here.
                          if (dormantPollTimer) { clearInterval(dormantPollTimer); dormantPollTimer = null; }
                          // Belt-and-suspenders: clear wakeTriggerTs so a subsequent
                          // dormancy+wake cycle on this same WS doesn't see a stale ts.
                          wakeTriggerTs = null;
                          startActiveSessionFlow({ pid, sessionFile, tmuxSession: currentTmuxSession!, hostId: currentHostId! });
                          // Aside subsystem registration for the wake path.
                          // Dormant panes had no active aside connection — register now.
                          if (currentHostId != null && currentTmuxSession != null) {
                            const wakeAsideKey = sessionKey(currentHostId, currentTmuxSession);
                            if (!activeViewers.has(wakeAsideKey)) activeViewers.set(wakeAsideKey, new Set());
                            activeViewers.get(wakeAsideKey)!.add(ws);
                          }
                        },
                        // quick 260808-fgf: cat .resume-complete; returns trimmed body or null.
                        markerCommand: async (conn: unknown, name: string): Promise<string | null> => {
                          try {
                            const out = await execCommand(
                              conn as import("ssh2").Client,
                              `cat ~/.claude/identities/'${name}'/.resume-complete 2>/dev/null || echo`,
                            );
                            const trimmed = out.trim();
                            return trimmed.length > 0 ? trimmed : null;
                          } catch {
                            return null;
                          }
                        },
                        // Injectable clock — Date.now in production, deterministic in tests.
                        now: () => Date.now(),
                      },
                      {
                        dormantLastEmitted: () => dormantLastEmitted,
                        setDormantLastEmitted: (v) => { dormantLastEmitted = v; },
                        wakeTriggerTs: () => wakeTriggerTs,
                      },
                    );
                    // Phase 30 Plan 30-01: if the seam flipped
                    // dormantLastEmitted, mirror the change onto pane_state.
                    // - false→true (sentinel re-appeared during poll):
                    //     emit("dormant")
                    // - true→false (sentinel disappeared; freshness check
                    //   passed; re-discovery about to run):
                    //     emit("active", "dormancy_cleared")
                    // The startActiveFlow callback above ALSO fires
                    // paneStateEmitter.emit("active") through
                    // startActiveSessionFlow if re-discovery reports active.
                    // The emitter's dedupe on identical (state, reason)
                    // safely collapses the resulting back-to-back
                    // ("active","dormancy_cleared") → ("active") pair to two
                    // distinct wire frames (different reason), which is the
                    // correct behavior — the first tells the client "we've
                    // exited dormancy" and the second establishes the fresh
                    // active session's attach-time pane_state.
                    if (
                      dormantLastEmitted !== dormantEmittedBefore &&
                      dormantLastEmitted !== null
                    ) {
                      if (dormantLastEmitted === true) {
                        paneStateEmitter.emit("dormant");
                      } else {
                        paneStateEmitter.emit("active", "dormancy_cleared");
                      }
                    }
                  } finally {
                    dormantPollInFlight = false;
                  }
                })();
              }, 3000);
              enteredDormantPoll = true;
            }
          }
        } catch {
          // SSH throw during probe — fall through to normal teardown (fail-safe).
          isIdentityShapedCached = false;
        }
      }
      if (enteredDormantPoll) {
        // SSH stays alive; dormant-poll loop is running. Return WITHOUT teardown.
        return;
      }
      // FALLBACK-01: emit one inactive frame and STOP. Do not open a tail,
      // do not fall through to any prior session file. The `never reach
      // back` rule is enforced structurally — there is no branch below
      // that could start a tail from an inactive result.
      ws.send(
        JSON.stringify({ type: "inactive", reason: result.reason }),
      );
      // Phase 30 Plan 30-01 (PS30-07): initial-discovery-inactive path
      // establishes attach-time pane_state before the WS drops back to
      // "waiting for the next connectToPane". Reason forwards the
      // discovery result verbatim — same string set that already reached
      // the wire via the legacy inactive frame pre-Phase-30 (not_claude,
      // no_pid_session_file, no_open_session_file, no_tmux_session,
      // exec_error), so no new information disclosure surface per T-30-01.
      paneStateEmitter.emit("inactive", result.reason);
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

    // Initial active discovery path: call startActiveSessionFlow now.
    // The aside subsystem (fan-out registration, connect-time probe,
    // extraction poller, harness-tasks poller, discovery-repoll timer,
    // tail start) is ALL inside startActiveSessionFlow and runs here.
    // The dormant-poll wake path calls startActiveSessionFlow() too,
    // then does a guarded aside fan-out registration (see startActiveFlow
    // callback in the dormant-poll block above).
    startActiveSessionFlow({ pid: result.pid, sessionFile: result.sessionFile, tmuxSession, hostId });
  });
});

const CLAUDE_SESSION_WS_PORT = 30011;
sshLogger.info("Claude session WebSocket server listening", {
  operation: "claude_session_ws_boot",
  port: CLAUDE_SESSION_WS_PORT,
});
