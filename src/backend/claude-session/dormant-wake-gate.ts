/**
 * dormant-wake-gate.ts — shared dormancy wake-gate primitive.
 *
 * Extracted from __applyInputMessageForTests's Phase 56 Plan 01 send-while-
 * dormant branch (claude-session-server.ts) so both the pretty-view WS input
 * path AND the /agent-reset backend endpoint dispatch through the same
 * primitive. Prior to extraction the WS path had the wake gate; agent-reset
 * (Phase 90 Plan 00 Wave 0 Task 3 mechanical rewire, 2026-09-08) did NOT — a
 * regression that made reset on a dormant pane paste `/id reset` into a bare
 * bash shell, producing `-bash: /id: No such file or directory` (2026-09-20
 * incident: lark-box-maintainer).
 *
 * The gate:
 *   1. Records triggerTs = now().
 *   2. Optionally calls setWakeTriggerTs(triggerTs) so a caller-supplied
 *      per-connection dormant-poll can hold its dormant:true frame in place
 *      while the wake completes (WS path uses this; agent-reset does not).
 *   3. `rm -f ~/fleet/identities/'<tmuxSession>'/.dormant` over the caller-
 *      supplied SSH connection. Failure is logged but non-fatal — pane may
 *      still be usable; any real tmux-side error surfaces later.
 *   4. Polls .resume-complete via caller-supplied markerCommand every
 *      pollIntervalMs (default 500ms) until either its parsed timestamp is
 *      strictly > triggerTs (marker fresh) OR (now - triggerTs) reaches
 *      MARKER_FALLBACK_MS (mixed-fleet compat: pre-marker supervisor boxes
 *      never write the marker).
 *
 * Freshness contract MUST stay byte-parallel with the dormant-poll's own
 * marker-freshness gate at claude-session-server.ts:__applyDormantPollWith
 * RediscoveryForTests. If these two ever drift, they will produce non-
 * deterministic wake behavior.
 *
 * Callers must have ALREADY determined dormancy before invoking. Detection
 * differs by caller: the WS path reads its subscribed dormant-poll's closure
 * signal (dormantLastEmitted); agent-reset does an SSH `test -f .dormant`
 * beforehand. The gate itself does no dormancy detection — its contract is
 * "wake this pane."
 */

import { sshLogger } from "../utils/logger.js";

/**
 * Mixed-fleet compat window (quick 260808-fgf, Nelly's .resume-complete
 * marker freshness contract): if the marker never appears within 90s of
 * wake_trigger_ts, fall back to sentinel-gone-alone dismiss for pre-marker
 * supervisor boxes. Canonical source of truth — claude-session-server.ts
 * imports this constant.
 */
export const MARKER_FALLBACK_MS = 90_000;

/** Default poll cadence for the .resume-complete marker check. */
const DEFAULT_POLL_INTERVAL_MS = 500;

export interface DormantWakeGateDeps {
  /** SSH connection to the pane's host. Passed to exec + markerCommand. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any;
  /** Identity/tmux session name (also the identity folder name). */
  tmuxSession: string;
  /** Host ID for structured log context (null-tolerant to match caller shapes). */
  hostId: number | null;
  /** Executes a shell command over sshConn. */
  exec: (conn: unknown, cmd: string) => Promise<string>;
  /**
   * Reads the .resume-complete marker file for this identity. Returns the
   * file body (ISO-8601 timestamp string) on success, or null if the file
   * doesn't exist (pre-marker supervisor OR marker not written yet).
   */
  markerCommand: (conn: unknown, name: string) => Promise<string | null>;
  /**
   * Optional: connection-scoped write-back for the WS path. When supplied,
   * called exactly once with triggerTs so the WS's own subscribed dormant-
   * poll can hold its dormant:true frame in place while the wake completes.
   * Agent-reset (no subscribed poll) omits this.
   */
  setWakeTriggerTs?: (ts: number) => void;
  /** Test seam. Defaults to Date.now. */
  now?: () => number;
  /**
   * Log op prefix (e.g. "pv_input" or "agent_reset"). Emitted as
   * `${prefix}_dormant_send_start`, `${prefix}_dormant_sentinel_drop_failed`,
   * `${prefix}_dormant_wait_marker`, `${prefix}_dormant_marker_fresh`, and
   * `${prefix}_dormant_marker_fallback`. Underscores in the prefix are also
   * converted to dashes for the human-readable log-message bracket tag
   * (e.g. "pv_input" → "[pv-input] ..."), preserving the WS-path text.
   */
  logOpPrefix: string;
  /** MQID for log context (WS path threads through the input frame's mqid). */
  mqid?: string;
  /** Test seam for poll interval. Defaults to 500ms. */
  pollIntervalMs?: number;
}

export interface DormantWakeGateResult {
  triggerTs: number;
  fellBack: boolean;
  elapsedMs: number;
}

export async function performDormantWakeGate(
  deps: DormantWakeGateDeps,
): Promise<DormantWakeGateResult> {
  const now = deps.now ?? (() => Date.now());
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const mqidForLog = (deps.mqid ?? "").length > 0 ? deps.mqid! : "none";
  const bracketTag = deps.logOpPrefix.replace(/_/g, "-");

  sshLogger.info(
    `[${bracketTag}] send received while pane dormant, dropping sentinel`,
    {
      operation: `${deps.logOpPrefix}_dormant_send_start`,
      hostId: deps.hostId,
      tmuxSession: deps.tmuxSession,
      mqid: mqidForLog,
    },
  );
  const triggerTs = now();
  sshLogger.info(
    `[diag-dormant-send] backend dormant-send-start mqid=${mqidForLog} sessionId=${deps.tmuxSession} triggerTs=${triggerTs}`,
  );

  deps.setWakeTriggerTs?.(triggerTs);

  try {
    await deps.exec(
      deps.sshConn,
      `rm -f ~/fleet/identities/'${deps.tmuxSession}'/.dormant`,
    );
    sshLogger.info(
      `[diag-dormant-send] backend sentinel-dropped mqid=${mqidForLog} elapsedMs=${now() - triggerTs}`,
    );
  } catch (sentinelErr) {
    const errMsg =
      sentinelErr instanceof Error ? sentinelErr.message : String(sentinelErr);
    sshLogger.warn(
      `[${bracketTag}] sentinel drop failed during dormant send`,
      {
        operation: `${deps.logOpPrefix}_dormant_sentinel_drop_failed`,
        hostId: deps.hostId,
        tmuxSession: deps.tmuxSession,
        mqid: mqidForLog,
        error: errMsg,
      },
    );
    sshLogger.warn(
      `[diag-dormant-send] backend sentinel-drop-failed mqid=${mqidForLog} elapsedMs=${now() - triggerTs} error="${errMsg}"`,
    );
    // Fall through to marker-poll anyway — the pane may still be usable,
    // and any real tmux-side failure will surface via the caller's own send
    // path (WS: send_keys_error frame; agent-reset: 502 from split-send throw).
  }

  sshLogger.info(
    `[${bracketTag}] sentinel dropped, waiting for .resume-complete marker (or MARKER_FALLBACK_MS)`,
    {
      operation: `${deps.logOpPrefix}_dormant_wait_marker`,
      hostId: deps.hostId,
      tmuxSession: deps.tmuxSession,
      triggerTs,
      mqid: mqidForLog,
    },
  );

  // Poll .resume-complete. Byte-parallel with the dormant-poll's freshness
  // gate at __applyDormantPollWithRediscoveryForTests: fresh means parsed
  // markerTs > triggerTs; fallback means (now - triggerTs) >= MARKER_FALLBACK_MS.
  let fellBack = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = await deps.markerCommand(deps.sshConn, deps.tmuxSession);
    if (body !== null) {
      const markerTs = Date.parse(body.trim());
      if (Number.isFinite(markerTs) && markerTs > triggerTs) {
        break;
      }
    }
    if (now() - triggerTs >= MARKER_FALLBACK_MS) {
      fellBack = true;
      break;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  const elapsedMs = now() - triggerTs;
  if (fellBack) {
    sshLogger.info(
      `[${bracketTag}] .resume-complete marker did not appear; falling back after MARKER_FALLBACK_MS`,
      {
        operation: `${deps.logOpPrefix}_dormant_marker_fallback`,
        hostId: deps.hostId,
        tmuxSession: deps.tmuxSession,
        elapsedMs,
        fellBack: true,
        mqid: mqidForLog,
      },
    );
    sshLogger.info(
      `[diag-dormant-send] backend marker-fallback mqid=${mqidForLog} elapsedMs=${elapsedMs} branch=fallback`,
    );
  } else {
    sshLogger.info(
      `[${bracketTag}] .resume-complete marker fresh; dispatching send-keys`,
      {
        operation: `${deps.logOpPrefix}_dormant_marker_fresh`,
        hostId: deps.hostId,
        tmuxSession: deps.tmuxSession,
        elapsedMs,
        mqid: mqidForLog,
      },
    );
    sshLogger.info(
      `[diag-dormant-send] backend marker-fresh mqid=${mqidForLog} elapsedMs=${elapsedMs} branch=fresh`,
    );
  }

  return { triggerTs, fellBack, elapsedMs };
}
