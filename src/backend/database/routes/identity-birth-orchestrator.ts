/**
 * Phase 20 (IDUI-06/08/09): Identity birth orchestrator — pure logic module.
 *
 * Exports: birthIdentity(opts, emit, deps) — runs the 5-step Nelly-cribbed
 * bootstrap sequence and streams progress via the emit callback.
 *
 * Design: pure function with injected deps (no direct express or HTTP imports),
 * making unit testing clean. The SSE route wraps this with real dep instances.
 *
 * Step sequence (cribbed from ~/vms-apps/apps/home/agent-supervisor.sh §FRESH):
 *   Step 1: Create Skynet identity record + GET-verify silent-no-op guard
 *   Step 2: mkdir -p + tmux new-session on target host (SSH or local)
 *   Step 3: pre-write hasTrustDialogAccepted + launch claude CLI
 *   Step 4: blind Enter train × 7 at 3s spacing (fire-and-forget, timing-based)
 *   Step 5: send /id <name> then Enter
 *
 * Failure policy: any step failure emits step:N:failed + ended{ok:false,failedStep:N}
 * and STOPS. NO rollback. NO retry. NO cancel. (Ashley-locked, CONTEXT.md §Failure.)
 *
 * tmux note: always -t <name> (plain). NEVER -t "=<name>" — tmux 3.4 exact-match
 * syntax errors on send-keys (Nelly §3).
 */

import type { Client as SSHClient } from "ssh2";

// ---------------------------------------------------------------------------
// Nelly-verbatim constants (audited against agent-supervisor.sh + DM §1)
// ---------------------------------------------------------------------------

/** Number of blind Enter presses in the settle train (Nelly §1(g)). */
export const ENTER_TRAIN_COUNT = 7;

/** Milliseconds between each Enter press in the train (Nelly §1(g), 3s per Enter). */
export const ENTER_TRAIN_SPACING_MS = 3000;

/**
 * SETTLE_SECONDS = 22 (Nelly §1(g), agent-supervisor.sh line 333).
 * Documentation constant: SETTLE_SECONDS × 1000 / ENTER_TRAIN_SPACING_MS ≈ 7 Enters.
 * Not directly used in loop logic (we use ENTER_TRAIN_COUNT), but exported
 * for parity with agent-supervisor.sh and for plan 06 documentation.
 */
export const SETTLE_SECONDS = 22;

/** Sleep after tmux new-session so login shell can source its profile (Nelly §1(b)). */
export const STEP_2_SLEEP_MS = 3000;

/** Sleep after claude launch before starting the Enter train (Nelly §1(f)). */
export const STEP_3_SLEEP_MS = 2000;

/** SSH connect timeout. */
export const SSH_CONNECT_TIMEOUT_MS = 30000;

/**
 * Claude CLI launch env-var prefix (Nelly §1(d) verbatim).
 * Dodges resume-summary and resume-threshold prompts that --dangerously-skip-permissions
 * does NOT cover on the RESUME path. Cheap insurance even for fresh launches.
 */
export const CLAUDE_LAUNCH_CMD_PREFIX =
  "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999";

/** tmux new-session terminal sizing flags (Nelly §3 terminal-sizing gotcha). */
export const TMUX_NEW_SESSION_FLAGS = "-x 220 -y 50";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BirthEvent =
  | { type: "step"; n: 1 | 2 | 3 | 4 | 5; phase: "started" | "completed" | "failed"; reason?: string }
  | { type: "ended"; ok: boolean; failedStep?: number; identityId?: string; sessionName?: string };

export interface BirthOptions {
  userId: number;
  hostId: number;
  name: string;
  title: string;
  path: string;
  colorHue: number | null;
  voice: string | null;
  avatarCandidateId: string;
}

export interface BirthDeps {
  /** Opens an SSH connection to the target host. */
  connectOneShot: (host: unknown, timeoutMs: number) => Promise<SSHClient>;
  /** Runs a command over SSH and returns stdout. */
  execCommand: (conn: SSHClient, command: string) => Promise<string>;
  /** Returns true when hostId maps to the local Skynet host (self-birth). */
  isLocalHostId: (hostId: number) => boolean;
  /** Runs a shell command locally (child_process.exec equivalent). */
  execLocal: (command: string) => Promise<string>;
  /** Creates an identity record in Skynet DB. */
  createIdentityRecord: (
    userId: number,
    meta: {
      identityKey: string;
      displayName: string;
      colorHue: number | null;
      voice: string | null;
    },
    avatarBytes: Buffer,
  ) => Promise<{
    id: string;
    colorHue: number | null;
    voice: string | null;
    avatarEtag: string;
  }>;
  /** Fetches an identity record for GET-verify. */
  getIdentityRecord: (
    userId: number,
    id: string,
  ) => Promise<{
    id: string;
    colorHue: number | null;
    voice: string | null;
    avatarEtag: string;
  }>;
  /** Fetches avatar candidate bytes from plan 01's cache. Returns null if expired/missing. */
  getCandidateForBirth: (userId: number, id: string) => { bytes: Buffer; mime: string } | null;
  /** Resolves a hostId to host connection details. */
  resolveHostById: (hostId: number, userId: number) => Promise<unknown>;
  /** fs/promises subset for trust-flag write (local-branch only). */
  fsp: {
    readFile: (p: string, enc: "utf8") => Promise<string>;
    writeFile: (p: string, content: string) => Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Sentinel error for early termination (step failure path)
// ---------------------------------------------------------------------------

class BirthAborted extends Error {
  constructor(public readonly step: number) {
    super(`BirthAborted at step ${step}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POSIX single-quote escape. Wraps s in '...' and escapes embedded ' as '\''. */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Shell-safe path helper:
 * - "$HOME" or "$HOME/..." → unquoted (shell must expand the var)
 * - everything else → single-quoted
 */
function shellPath(p: string): string {
  if (p === "$HOME" || p.startsWith("$HOME/")) {
    return p; // let shell expand $HOME
  }
  return shellSingleQuote(p);
}

/** await-friendly sleep that works with vi.useFakeTimers. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sanitize an error message for safe inclusion in SSE reason field.
 * Maps common SSH errors to safe strings. Never leaks raw stacks.
 */
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return "Unknown error";
  const msg = err.message;
  if (/timeout|unreachable/i.test(msg)) return "Host unreachable";
  if (/connect/i.test(msg)) return "Host unreachable";
  // Truncate to 200 chars max; no stack, no raw SSH internals
  return msg.slice(0, 200);
}

// Regex gate (matches identities.ts IDENTITY_KEY_RE)
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;

/**
 * Stricter than IDENTITY_KEY_RE — used as a second gate inside birthIdentity()
 * to reject names that would be valid identity keys but produce malformed or
 * ambiguous tmux target arguments. Rejects `=`, `/`, `+`, `.` because tmux
 * interprets these in target syntax (`-t =name` = exact match, `.name` =
 * window/pane reference, `+name` = relative pane offset, `/name` = malformed
 * target). See CR-02 in .planning/phases/20-identity-creation-ui/20-REVIEW.md.
 */
const TMUX_SAFE_NAME_RE = /^[a-z][a-z0-9_-]*$/;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the 5-step birth sequence and emit progress events.
 *
 * @param opts   Birth options from the HTTP request body + userId from JWT
 * @param emit   Callback receiving BirthEvent objects as each step runs
 * @param deps   Injected dependencies (testable; route provides real ones)
 */
export async function birthIdentity(
  opts: BirthOptions,
  emit: (e: BirthEvent) => void,
  deps: BirthDeps,
): Promise<void> {
  // -------------------------------------------------------------------------
  // 0. Validate name (defense-in-depth — route layer should also gate)
  // -------------------------------------------------------------------------
  if (!IDENTITY_KEY_RE.test(opts.name)) {
    throw new Error(
      `identityKey must match [a-z0-9._=/+-]+; got: ${JSON.stringify(opts.name)}`,
    );
  }

  // CR-02: Second gate — stricter tmux-safety check. Names containing `=`,
  // `/`, `+`, or `.` pass IDENTITY_KEY_RE but produce malformed/ambiguous tmux
  // target arguments. Reject them before any SSH/exec/DB work is done.
  if (!TMUX_SAFE_NAME_RE.test(opts.name)) {
    throw new Error(
      `identity name unsafe for tmux target — must match [a-z][a-z0-9_-]*; got: ${JSON.stringify(opts.name)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 0b. Normalize path
  //   - Replace backslashes with forward slashes
  //   - Empty string or ~ → "$HOME" for remote shell expansion
  // -------------------------------------------------------------------------
  let normalizedPath = opts.path.replace(/\\/g, "/");
  if (normalizedPath === "" || normalizedPath === "~") {
    normalizedPath = "$HOME";
  }

  // -------------------------------------------------------------------------
  // 0c. runStep helper — wraps each step in started/completed/failed events
  // -------------------------------------------------------------------------
  async function runStep(
    n: 1 | 2 | 3 | 4 | 5,
    fn: () => Promise<void>,
    failReasonOverride?: string,
  ): Promise<void> {
    emit({ type: "step", n, phase: "started" });
    try {
      await fn();
      emit({ type: "step", n, phase: "completed" });
    } catch (e) {
      const reason = failReasonOverride ?? sanitizeError(e);
      emit({ type: "step", n, phase: "failed", reason });
      emit({ type: "ended", ok: false, failedStep: n });
      throw new BirthAborted(n);
    }
  }

  // -------------------------------------------------------------------------
  // Branch selection: SSH vs local
  // -------------------------------------------------------------------------
  const useLocal = deps.isLocalHostId(opts.hostId);

  // For SSH branch: resolve the host and connect.
  // Wrap ALL step 2-5 ops in try/finally that calls conn.end().
  let conn: SSHClient | null = null;

  // -------------------------------------------------------------------------
  // Exec abstraction — same interface for remote and local branches
  // -------------------------------------------------------------------------
  async function exec(command: string): Promise<string> {
    if (useLocal) {
      return deps.execLocal(command);
    } else {
      return deps.execCommand(conn!, command);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Create Skynet identity record + GET-verify (always local to backend)
  // -------------------------------------------------------------------------
  let identityId: string | undefined;

  try {
    await runStep(1, async () => {
      // Look up avatar bytes from plan 01's candidate cache
      const cand = deps.getCandidateForBirth(opts.userId, opts.avatarCandidateId);
      if (!cand) {
        throw new Error("avatar candidate expired or not found");
      }

      // Create the identity record
      const created = await deps.createIdentityRecord(
        opts.userId,
        {
          identityKey: opts.name,
          displayName: opts.title,
          colorHue: opts.colorHue,
          voice: opts.voice,
        },
        cand.bytes,
      );

      identityId = created.id;

      // GET-verify: silent-no-op guard (colorHue/voice/avatarEtag must match)
      const fresh = await deps.getIdentityRecord(opts.userId, created.id);

      if (opts.colorHue !== null && fresh.colorHue !== opts.colorHue) {
        throw new Error(
          `silent-no-op: colorHue not persisted (sent ${opts.colorHue}, got ${fresh.colorHue})`,
        );
      }
      if (opts.voice !== null && fresh.voice !== opts.voice) {
        throw new Error(
          `silent-no-op: voice not persisted (sent ${opts.voice}, got ${fresh.voice})`,
        );
      }
      // avatarEtag check: we trust the DB wrote it if colorHue+voice passed,
      // but verify anyway as defense-in-depth
      if (fresh.avatarEtag !== created.avatarEtag) {
        throw new Error(
          `silent-no-op: avatarEtag mismatch (expected ${created.avatarEtag}, got ${fresh.avatarEtag})`,
        );
      }
    });
  } catch (e) {
    if (e instanceof BirthAborted) return;
    // Pre-step-1 error (shouldn't normally reach here)
    emit({ type: "ended", ok: false });
    return;
  }

  // -------------------------------------------------------------------------
  // Steps 2-5: SSH or local (wrapped in try/finally for conn cleanup)
  // -------------------------------------------------------------------------
  try {
    // For remote branch, connect now
    if (!useLocal) {
      const host = await deps.resolveHostById(opts.hostId, opts.userId);
      try {
        conn = await deps.connectOneShot(host, SSH_CONNECT_TIMEOUT_MS);
      } catch (e) {
        // Step 2 failure: SSH connect error
        emit({ type: "step", n: 2, phase: "started" });
        const reason = /timeout|unreachable/i.test((e as Error).message ?? "")
          ? "Host unreachable"
          : "Host unreachable";
        emit({ type: "step", n: 2, phase: "failed", reason });
        emit({ type: "ended", ok: false, failedStep: 2 });
        return;
      }
    }

    // Single-quote the session name for shell safety
    const escName = shellSingleQuote(opts.name);
    const escPath = shellPath(normalizedPath);

    // -----------------------------------------------------------------------
    // Step 2: mkdir -p + tmux new-session (Nelly §1(a) + terminal sizing)
    // -----------------------------------------------------------------------
    await runStep(2, async () => {
      await exec(
        `mkdir -p ${escPath} && tmux new-session -d -s ${escName} -c ${escPath} ${TMUX_NEW_SESSION_FLAGS}`,
      );
      // Sleep 3s: login shell needs to source its profile (Nelly §1(b))
      await sleep(STEP_2_SLEEP_MS);
    });

    // -----------------------------------------------------------------------
    // Step 3: pre-write hasTrustDialogAccepted + launch claude CLI
    // Nelly §1(c-f): trust flag MUST be pre-set BEFORE claude launch
    // -----------------------------------------------------------------------
    await runStep(3, async () => {
      // Build the trust-flag write command.
      // For remote: the node one-liner runs on the target host (cribbed from
      // agent-supervisor.sh:125 accept_trust_for_workdir() — structure preserved verbatim).
      // The path inside the JS one-liner is passed via process.argv[1] to avoid
      // shell-escape complexity in the outer double-quoted node -e string.
      //
      // For local: same one-liner, but we could also use fsp.readFile/writeFile.
      // We keep the same node one-liner for both branches so behavior is identical.
      //
      // Path for trust-flag: use normalizedPath (already has $HOME or absolute)
      // Note: we pass the path as process.argv[1] to the node one-liner using
      // a shell argument — this avoids embedding the path inside the JS string,
      // which would require complex escaping. The outer shell single-quotes the path arg.
      const trustCmd =
        `node -e ` +
        shellSingleQuote(
          `const fs=require("fs"),os=require("os"),p=require("path");` +
          `const f=p.join(os.homedir(),".claude.json");` +
          `const wd=process.argv[1];` +
          `let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"));}catch(e){}` +
          `if(typeof d!=="object"||!d||Array.isArray(d))d={};` +
          `d.projects=(d.projects&&typeof d.projects==="object")?d.projects:{};` +
          `d.projects[wd]=(d.projects[wd]&&typeof d.projects[wd]==="object")?d.projects[wd]:{};` +
          `d.projects[wd].hasTrustDialogAccepted=true;` +
          `try{fs.writeFileSync(f,JSON.stringify(d,null,2)+"\\n");console.log("set");}catch(e){console.log("skip");}`,
        ) +
        ` ${escPath}`;

      await exec(trustCmd);

      // Claude launch via tmux send-keys -t <name> -l "..." (literal mode so
      // the env-vars don't get interpreted by the shell before tmux sees them)
      const claudeCmd = `${CLAUDE_LAUNCH_CMD_PREFIX} claude --dangerously-skip-permissions`;
      await exec(`tmux send-keys -t ${opts.name} -l ${shellSingleQuote(claudeCmd)}`);

      // Separate Enter (Nelly §1(e): two distinct send-keys calls)
      await exec(`tmux send-keys -t ${opts.name} Enter`);

      // Sleep 2s before starting the Enter train (Nelly §1(f))
      await sleep(STEP_3_SLEEP_MS);
    });

    // -----------------------------------------------------------------------
    // Step 4: Blind Enter train × ENTER_TRAIN_COUNT at ENTER_TRAIN_SPACING_MS
    // Deliberately fire-and-forget, timing-based, NOT scrape-based (Nelly §1(g)).
    // Overshoot at an empty REPL is a no-op. Scrape detection is explicitly
    // excluded — sequence is deliberately dumb per Nelly: timing-based only.
    // -----------------------------------------------------------------------
    await runStep(4, async () => {
      for (let i = 0; i < ENTER_TRAIN_COUNT; i++) {
        await exec(`tmux send-keys -t ${opts.name} Enter`);
        if (i < ENTER_TRAIN_COUNT - 1) {
          await sleep(ENTER_TRAIN_SPACING_MS);
        }
      }
    });

    // -----------------------------------------------------------------------
    // Step 5: Send /id <name> then Enter (Nelly §1(h-i))
    // -----------------------------------------------------------------------
    await runStep(5, async () => {
      await exec(`tmux send-keys -t ${opts.name} -l ${shellSingleQuote(`/id ${opts.name}`)}`);
      await exec(`tmux send-keys -t ${opts.name} Enter`);
    });

    // All 5 steps completed successfully
    emit({ type: "ended", ok: true, identityId, sessionName: opts.name });
  } catch (e) {
    if (e instanceof BirthAborted) {
      // Failure event already emitted by runStep — no re-emit
      return;
    }
    // Unexpected error outside a step
    emit({ type: "ended", ok: false });
  } finally {
    // Always clean up SSH connection if we opened one
    if (conn) {
      try {
        (conn as SSHClient & { end: () => void }).end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
