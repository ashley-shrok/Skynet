// Work narration — the short "where the agent is in the job" line shown next
// to the conversation view's work indicator.
//
// One narrator per watched agent (keyed like activeViewers, hostId::tmuxSession),
// shared by every tab viewing it. Each tab's transcript tail feeds lines in;
// lines are de-duplicated by uuid, and anything well older than the newest
// line seen is a later tab's history replay and is dropped, so the narrator
// sees each line once. (Claude Code writes some lines a millisecond out of
// timestamp order, so a strict timestamp watermark would lose real lines.)
// A small fast model writes the line
// on the agent's own box (one-shot Claude Code call on the fleet's subscription
// token, thinking off, no tools, no settings files or hooks, no CLAUDE.md), only while at least
// one tab says it is showing the work indicator.
//
// Pacing: the first line of a turn once the agent has taken FIRST_LINE_MIN_STEPS
// steps; after that, only when new steps have arrived AND MIN_INTERVAL_MS has
// passed since the last line. A new prompt starts a fresh turn — the previous
// turn's line is cleared and never fed back in. The turn-end marker (or an
// interrupt) clears it too, so a finished turn's line can't reappear when the
// next turn's indicator lights before its prompt reaches the transcript. At
// most one narration call runs per host at a time.

import type { WebSocket } from "ws";
import type { Client } from "ssh2";
import { execCommandWithStdin } from "../ssh/tmux-helper.js";
import { isPromptStart } from "./interrupt-cancel-tracker.js";
import { extractText, isInterruptMarker, normalizePastedHarnessEnvelopes } from "./session-file-parser.js";
import { sshLogger } from "../utils/logger.js";

export const FIRST_LINE_MIN_STEPS = 3;
export const MIN_INTERVAL_MS = 45_000;
/** After a tab attaches, wait for its history replay to go quiet before narrating. */
export const SETTLE_MS = 1_500;
export const MAX_STEPS_IN_PROMPT = 24;
/** A line this much older than the newest line seen is replayed history. */
export const REPLAY_SLACK_MS = 60_000;
export const SHORT_MAX_WORDS = 9;
export const LONG_MAX_WORDS = 17;
const STARTER_MAX_CHARS = 1_500;
const STEP_MAX_CHARS = 220;
// Generous: on a box saturated by builds a call can take 20-30 s instead of ~2 s.
const CALL_TIMEOUT_MS = 60_000;

export const NARRATION_SYSTEM_PROMPT = [
  "You write the live status line shown beside a coding agent's \"working\" indicator in a chat app.",
  "The reader may glance at it cold, with no other context, and wants to know how far along the job is.",
  "Write two versions of one status line: SHORT is at most 9 words, LONG is at most 17 words.",
  "Plain present tense. No \"I\". No file names, code identifiers or jargon. Do not restate the request.",
  "Lead with what is happening now; add what is already done or what comes next when that helps place it.",
  "Only claim what the steps show. Say what is next as the plan, never as already done.",
  "If a previous status line is given, it tells you what is already behind the agent; keep the story consistent with it.",
  "Output exactly two lines and nothing else:",
  "SHORT: <line>",
  "LONG: <line>",
].join("\n");

export interface NarrationLine {
  short: string;
  long: string;
}

export interface NarrationContext {
  key: string;
  hostId: number;
  conn: Client;
}

export type NarrationRunner = (conn: Client, command: string, stdin: Buffer, timeoutMs: number) => Promise<string>;

const defaultRunner: NarrationRunner = (conn, command, stdin, timeoutMs) =>
  execCommandWithStdin(conn, command, stdin, { timeoutMs });

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildNarrationCommand(): string {
  // No settings files at all (--setting-sources ""): a box's user settings can
  // enable plugins, remote control or push notifications. The subscription
  // token normally arrives through those settings' env block, so it is read
  // out of the same file on the box itself (never passes through the command
  // line or the server); a box that logs in some other way keeps that login.
  const readToken =
    'T=$(python3 -c \'import json,os;print(json.load(open(os.path.expanduser("~/.claude/settings.json"))).get("env",{}).get("CLAUDE_CODE_OAUTH_TOKEN",""))\' 2>/dev/null);' +
    ' [ -n "$T" ] && export CLAUDE_CODE_OAUTH_TOKEN="$T"; unset T;';
  return [
    "cd /tmp 2>/dev/null;",
    'C="$HOME/.local/bin/claude"; [ -x "$C" ] || C=$(command -v claude) || exit 127;',
    readToken,
    // Never an API key or another endpoint (that would be paid API spend), and
    // nothing that makes the call think it runs inside an agent's session.
    "env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT",
    "-u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN",
    "MAX_THINKING_TOKENS=0 CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 DISABLE_AUTOUPDATER=1",
    '"$C" -p --model haiku --setting-sources "" --strict-mcp-config --tools "" --no-session-persistence --output-format text',
    `--settings ${shellQuote(JSON.stringify({ disableAllHooks: true, alwaysThinkingEnabled: false }))}`,
    `--system-prompt ${shellQuote(NARRATION_SYSTEM_PROMPT)}`,
  ].join(" ");
}

export function buildNarrationInput(starter: string, previous: string | null, steps: string[]): string {
  return [
    "What started this turn:",
    starter || "(nothing readable)",
    "",
    `Previous status line: ${previous ?? "(none yet)"}`,
    "",
    "The agent's recent steps, oldest first:",
    ...steps.map((s) => `- ${s}`),
  ].join("\n");
}

const clip = (s: string, n: number): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

/** Parse the model's two-line reply. Null when neither line is usable. */
export function parseNarrationOutput(out: string): NarrationLine | null {
  const pick = (label: string): string | null => {
    const m = new RegExp(`^\\s*\\**${label}\\**\\s*:\\s*\\**\\s*(.+)$`, "im").exec(out);
    if (!m) return null;
    const v = m[1].replace(/\*+\s*$/, "").trim().replace(/^["“']|["”']$/g, "").trim();
    return v === "" ? null : v;
  };
  // The view never wraps, so hold the model to the agreed lengths.
  const cap = (v: string | null, words: number): string | null => {
    if (v === null) return null;
    const w = v.split(/\s+/);
    return w.length <= words ? v : w.slice(0, words).join(" ").replace(/[,;:\-–—]+$/, "");
  };
  const short = cap(pick("SHORT"), SHORT_MAX_WORDS);
  const long = cap(pick("LONG"), LONG_MAX_WORDS);
  if (!short && !long) return null;
  return { short: short ?? long!, long: long ?? short! };
}

/** One readable summary per step in an assistant / tool-result line. */
export function stepsFromLine(obj: Record<string, unknown>): string[] {
  const msg = obj.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  const steps: string[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    if (obj.type === "assistant" && b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      steps.push(`Said: ${clip(b.text, STEP_MAX_CHARS)}`);
    } else if (obj.type === "assistant" && b.type === "tool_use") {
      const name = typeof b.name === "string" ? b.name : "tool";
      const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
      if (name === "Agent" || name === "Task") {
        const what = [input.description, input.prompt].filter((v) => typeof v === "string").join(" — ");
        steps.push(`Handed work to a helper: ${clip(what, STEP_MAX_CHARS)}`);
        continue;
      }
      const detail = ["description", "command", "file_path", "pattern", "query", "url", "skill", "subject", "message", "prompt"]
        .map((k) => input[k])
        .find((v) => typeof v === "string" && v.trim() !== "") as string | undefined;
      steps.push(`${name}: ${clip(detail ?? JSON.stringify(input), STEP_MAX_CHARS)}`);
    } else if (obj.type === "user" && b.type === "tool_result" && b.is_error === true) {
      steps.push(`That step failed: ${clip(extractText(b.content), STEP_MAX_CHARS)}`);
    }
  }
  return steps;
}

/** The text of a turn-starting prompt, minus harness reminders. */
export function starterText(obj: Record<string, unknown>): string {
  normalizePastedHarnessEnvelopes(obj);
  const raw = extractText((obj.message as Record<string, unknown> | undefined)?.content);
  return clip(raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ""), STARTER_MAX_CHARS);
}

const SEEN_PRUNE_AT = 2_000;

/** Claude Code's end-of-turn marker, or the note an interrupt leaves. */
export function isTurnEnd(obj: Record<string, unknown>): boolean {
  if (obj.type === "system" && (obj.subtype === "turn_duration" || obj.subtype === "stop_hook_summary")) return true;
  return isInterruptMarker(obj);
}

interface Narrator {
  key: string;
  hostId: number;
  conns: Map<WebSocket, Client>;
  /** Newest line timestamp seen, and the uuids seen (with their timestamps) within REPLAY_SLACK_MS of it. */
  newest: number;
  seen: Map<string, number>;
  settlingUntil: number;
  turn: number;
  starter: string | null;
  steps: string[];
  stepCount: number;
  stepsSinceLine: number;
  line: NarrationLine | null;
  lineAt: number;
  /** No call before this time (set after a failed or unusable call). */
  retryAt: number;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export class WorkNarrationHub {
  private narrators = new Map<string, Narrator>();
  private keyByWs = new Map<WebSocket, string>();
  private watching = new Map<WebSocket, boolean>();
  private hostChains = new Map<number, Promise<unknown>>();

  constructor(
    private readonly runner: NarrationRunner = defaultRunner,
    private readonly now: () => number = Date.now,
  ) {}

  /** The tab says whether it is showing the work indicator right now. */
  setWatching(ws: WebSocket, active: boolean): void {
    this.watching.set(ws, active);
    const n = this.narratorFor(ws);
    if (!n) return;
    if (active && n.line) this.sendTo(ws, n.line);
    this.schedule(n);
  }

  /** Feed one raw transcript line from the tail of the tab `ws`. */
  observeLine(ws: WebSocket, ctx: NarrationContext, line: string): void {
    const n = this.attach(ws, ctx);
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!obj || typeof obj !== "object") return;
    const ts = typeof obj.timestamp === "string" ? Date.parse(obj.timestamp) : NaN;
    const uuid = typeof obj.uuid === "string" ? obj.uuid : null;
    if (!Number.isFinite(ts) || uuid === null) return;
    if (ts < n.newest - REPLAY_SLACK_MS || n.seen.has(uuid)) return;
    n.seen.set(uuid, ts);
    if (ts > n.newest) {
      n.newest = ts;
      if (n.seen.size > SEEN_PRUNE_AT) {
        for (const [u, t] of n.seen) if (t < n.newest - REPLAY_SLACK_MS) n.seen.delete(u);
      }
    }

    if (isTurnEnd(obj)) {
      this.endTurn(n);
      return;
    }
    if (isPromptStart(obj)) {
      const hadLine = n.line !== null;
      n.turn += 1;
      n.starter = starterText(obj);
      n.steps = [];
      n.stepCount = 0;
      n.stepsSinceLine = 0;
      n.line = null;
      n.lineAt = 0;
      n.retryAt = 0;
      if (hadLine) this.broadcast(n, null);
      this.schedule(n);
      return;
    }
    if (n.starter === null || obj.isSidechain === true) return;
    const steps = stepsFromLine(obj);
    if (steps.length === 0) return;
    n.steps.push(...steps);
    if (n.steps.length > MAX_STEPS_IN_PROMPT) n.steps.splice(0, n.steps.length - MAX_STEPS_IN_PROMPT);
    n.stepCount += steps.length;
    n.stepsSinceLine += steps.length;
    this.schedule(n);
  }

  /** The agent finished (or was interrupted): clear the line, stop narrating until the next prompt. */
  private endTurn(n: Narrator): void {
    const hadLine = n.line !== null;
    n.turn += 1;
    n.starter = null;
    n.steps = [];
    n.stepCount = 0;
    n.stepsSinceLine = 0;
    n.line = null;
    n.lineAt = 0;
    n.retryAt = 0;
    if (n.timer) {
      clearTimeout(n.timer);
      n.timer = null;
    }
    if (hadLine) this.broadcast(n, null);
  }

  /** The tab left this agent (pane switch or closed connection). */
  detach(ws: WebSocket): void {
    const key = this.keyByWs.get(ws);
    this.keyByWs.delete(ws);
    if (key === undefined) return;
    const n = this.narrators.get(key);
    if (!n) return;
    n.conns.delete(ws);
    if (n.conns.size === 0) {
      if (n.timer) clearTimeout(n.timer);
      this.narrators.delete(key);
    } else {
      this.schedule(n);
    }
  }

  /** The tab's connection closed for good. */
  forget(ws: WebSocket): void {
    this.detach(ws);
    this.watching.delete(ws);
  }

  private attach(ws: WebSocket, ctx: NarrationContext): Narrator {
    const prior = this.keyByWs.get(ws);
    if (prior !== undefined && prior !== ctx.key) this.detach(ws);
    let n = this.narrators.get(ctx.key);
    if (!n) {
      n = {
        key: ctx.key, hostId: ctx.hostId, conns: new Map(),
        newest: -Infinity, seen: new Map(), settlingUntil: 0,
        turn: 0, starter: null, steps: [], stepCount: 0, stepsSinceLine: 0,
        line: null, lineAt: 0, retryAt: 0, inFlight: false, timer: null,
      };
      this.narrators.set(ctx.key, n);
    }
    if (!n.conns.has(ws)) {
      if (n.line) this.sendTo(ws, n.line);
    }
    // Every line from a tab still replaying history pushes the settle window out;
    // once its replay goes quiet the narrator may fire.
    if (!n.conns.has(ws) || this.now() < n.settlingUntil) n.settlingUntil = this.now() + SETTLE_MS;
    n.conns.set(ws, ctx.conn);
    this.keyByWs.set(ws, ctx.key);
    return n;
  }

  private narratorFor(ws: WebSocket): Narrator | undefined {
    const key = this.keyByWs.get(ws);
    return key === undefined ? undefined : this.narrators.get(key);
  }

  private wanted(n: Narrator): boolean {
    for (const ws of n.conns.keys()) if (this.watching.get(ws) === true) return true;
    return false;
  }

  private schedule(n: Narrator): void {
    if (n.timer) {
      clearTimeout(n.timer);
      n.timer = null;
    }
    if (n.inFlight || n.starter === null || n.stepsSinceLine === 0 || !this.wanted(n)) return;
    if (n.line === null && n.stepCount < FIRST_LINE_MIN_STEPS) return;
    const now = this.now();
    const due = Math.max(n.settlingUntil, n.retryAt, n.line === null ? now : n.lineAt + MIN_INTERVAL_MS);
    n.timer = setTimeout(() => {
      n.timer = null;
      if (this.now() < n.settlingUntil) {
        this.schedule(n);
        return;
      }
      void this.fire(n);
    }, Math.max(0, due - now));
  }

  private async fire(n: Narrator): Promise<void> {
    const conn = n.conns.values().next().value as Client | undefined;
    if (!conn || this.narrators.get(n.key) !== n) return;
    n.inFlight = true;
    const turn = n.turn;
    const input = buildNarrationInput(n.starter ?? "", n.line?.long ?? null, [...n.steps]);
    const consumed = n.stepsSinceLine;
    const started = this.now();
    try {
      const out = await this.onHost(n.hostId, () =>
        // Queued behind another narrator's call: skip it if the turn moved on meanwhile.
        this.narrators.get(n.key) !== n || n.turn !== turn
          ? Promise.resolve(null)
          : this.runner(conn, buildNarrationCommand(), Buffer.from(input, "utf-8"), CALL_TIMEOUT_MS),
      );
      if (out === null || this.narrators.get(n.key) !== n || n.turn !== turn) return;
      const parsed = parseNarrationOutput(out);
      if (!parsed) {
        sshLogger.warn(`[work-narration] unparseable reply key=${n.key} out="${clip(out, 160)}"`, {
          operation: "work_narration_unparseable", hostId: n.hostId,
        });
        n.retryAt = this.now() + MIN_INTERVAL_MS;
        return;
      }
      n.line = parsed;
      n.lineAt = this.now();
      n.stepsSinceLine = Math.max(0, n.stepsSinceLine - consumed);
      sshLogger.info(`[work-narration] line key=${n.key} turn=${turn} ms=${n.lineAt - started} short="${parsed.short}"`, {
        operation: "work_narration_line", hostId: n.hostId, ms: n.lineAt - started,
      });
      this.broadcast(n, parsed);
    } catch (err) {
      sshLogger.warn(`[work-narration] call failed key=${n.key} turn=${turn} ms=${this.now() - started} err="${err instanceof Error ? clip(err.message, 200) : String(err)}"`, {
        operation: "work_narration_failed", hostId: n.hostId,
      });
      // Back off a full interval before trying again.
      if (n.turn === turn) n.retryAt = this.now() + MIN_INTERVAL_MS;
    } finally {
      n.inFlight = false;
      if (this.narrators.get(n.key) === n) this.schedule(n);
    }
  }

  /** Serialize narration calls per host. */
  private onHost<T>(hostId: number, task: () => Promise<T>): Promise<T> {
    const prev = this.hostChains.get(hostId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    const tail = next.catch(() => {});
    this.hostChains.set(hostId, tail);
    void tail.then(() => {
      if (this.hostChains.get(hostId) === tail) this.hostChains.delete(hostId);
    });
    return next;
  }

  private broadcast(n: Narrator, line: NarrationLine | null): void {
    for (const ws of n.conns.keys()) this.sendTo(ws, line);
  }

  private sendTo(ws: WebSocket, line: NarrationLine | null): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ type: "work_narration", short: line?.short ?? null, long: line?.long ?? null }));
    } catch {
      /* ws may be mid-close */
    }
  }
}

export const workNarrationHub = new WorkNarrationHub();
