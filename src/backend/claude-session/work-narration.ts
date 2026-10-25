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
// on the agent's own box (one-shot Claude Code call signed in the same way the
// agent is, thinking off, no tools, no settings files or hooks, no CLAUDE.md), only while at least
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
/** A tab's replay never delays narration for longer than this. */
export const REPLAY_MAX_MS = 15_000;
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
  /** The agent's tmux session on that host (used to find its running Claude). */
  tmuxSession: string;
  conn: Client;
}

export type NarrationRunner = (conn: Client, command: string, stdin: Buffer, timeoutMs: number) => Promise<string>;

const defaultRunner: NarrationRunner = (conn, command, stdin, timeoutMs) =>
  execCommandWithStdin(conn, command, stdin, { timeoutMs });

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// Runs on the agent's box (argv[1] = the agent's tmux session) and prints
// shell lines that give the narrator the agent's sign-in, nothing else:
//   1. start from the sign-in variables of the agent's own running Claude
//      process (found under its tmux pane) — or, if it can't be found, of
//      this shell;
//   2. overlay the sign-in entries of the user settings' env block (Claude
//      applies those on top of its environment);
//   3. drop an API key the agent was asked about and turned down
//      (~/.claude.json customApiKeyResponses.rejected), as interactive
//      Claude would — one-shot mode never asks;
//   4. unset every other sign-in variable this shell has.
// Plus NARR_SETTINGS: only the credential-helper settings and the narrator's
// own switches. Plugins, remote control, push notifications, hooks and
// permissions are left behind. A normal subscription login lives in Claude's
// credential store and is found without help.
export const AUTH_EXTRACT_PY = [
  "import json,os,re,shlex,subprocess,sys",
  "A=re.compile(r'^(ANTHROPIC_[A-Z0-9_]+|AWS_[A-Z0-9_]+|CLAUDE_CODE_USE_[A-Z0-9_]+|CLAUDE_CODE_SKIP_[A-Z0-9_]+|CLOUD_ML_[A-Z0-9_]+|GOOGLE_[A-Z0-9_]+|VERTEX_[A-Z0-9_]+|CLAUDE_CODE_OAUTH_TOKEN|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|NODE_EXTRA_CA_CERTS)$')",
  "def load(p):",
  "  try: return json.load(open(os.path.expanduser(p)))",
  "  except Exception: return {}",
  "def agent_env(sess):",
  "  try:",
  "    out=subprocess.run(['tmux','list-panes','-s','-t','='+sess,'-F','#{pane_pid}'],capture_output=True,text=True,timeout=5).stdout",
  "    todo=[int(x) for x in out.split()]",
  "    while todo:",
  "      p=todo.pop(0)",
  "      try: comm=open('/proc/%d/comm'%p).read().strip()",
  "      except Exception: continue",
  "      if comm=='claude':",
  "        raw=open('/proc/%d/environ'%p,'rb').read().split(b'\\0')",
  "        return dict(x.decode('utf-8','replace').split('=',1) for x in raw if b'=' in x)",
  "      try: todo+=[int(c) for c in open('/proc/%d/task/%d/children'%(p,p)).read().split()]",
  "      except Exception: pass",
  "  except Exception: pass",
  "  return None",
  "def val(v):",
  "  if isinstance(v,bool): return '1' if v else '0'",
  "  return v if isinstance(v,str) else str(v) if isinstance(v,(int,float)) else None",
  "base=agent_env(sys.argv[1]) if len(sys.argv)>1 and sys.argv[1] else None",
  "if base is None: base=dict(os.environ)",
  "final={k:v for k,v in base.items() if A.match(k)}",
  "s=load('~/.claude/settings.json')",
  "e=s.get('env') if isinstance(s.get('env'),dict) else {}",
  "for k,v in e.items():",
  "  if isinstance(k,str) and A.match(k) and val(v) is not None: final[k]=val(v)",
  "rej=(load('~/.claude.json').get('customApiKeyResponses') or {}).get('rejected') or []",
  "if final.get('ANTHROPIC_API_KEY','')[-20:] in rej: final.pop('ANTHROPIC_API_KEY')",
  "for k in os.environ:",
  "  if A.match(k) and k not in final: print('unset %s'%k)",
  "for k,v in final.items(): print('export %s=%s'%(k,shlex.quote(v)))",
  "f={k:s[k] for k in ('apiKeyHelper','awsAuthRefresh','awsCredentialExport','gcpAuthRefresh','forceLoginMethod','forceLoginOrgUUID') if k in s}",
  "f.update(disableAllHooks=True,alwaysThinkingEnabled=False)",
  "print('NARR_SETTINGS=%s'%shlex.quote(json.dumps(f)))",
].join("\n");

const TMUX_SESSION_RE = /^[A-Za-z0-9_.-]+$/;

export function buildNarrationCommand(tmuxSession = ""): string {
  // No settings files are loaded (--setting-sources ""): a box's user settings
  // can enable plugins, remote control or push notifications. Instead the call
  // signs in exactly the way the agent does — subscription token, normal
  // login, API key, Bedrock or Vertex — by mirroring only the agent's sign-in
  // (see AUTH_EXTRACT_PY). Values travel in the environment, never on the
  // command line.
  const fallback = JSON.stringify({ disableAllHooks: true, alwaysThinkingEnabled: false });
  const session = TMUX_SESSION_RE.test(tmuxSession) ? tmuxSession : "";
  return [
    "cd /tmp 2>/dev/null;",
    'C="$HOME/.local/bin/claude"; [ -x "$C" ] || C=$(command -v claude) || exit 127;',
    `eval "$(python3 -c ${shellQuote(AUTH_EXTRACT_PY)} ${shellQuote(session)} 2>/dev/null)";`,
    `[ -n "$NARR_SETTINGS" ] || NARR_SETTINGS=${shellQuote(fallback)};`,
    // The remote end kills the call itself: an SSH channel closed on timeout
    // doesn't reliably stop a process with no terminal.
    'TO=""; command -v timeout >/dev/null 2>&1 && TO="timeout -k 5 55";',
    // Nothing that makes the call think it runs inside an agent's session.
    "env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION",
    "-u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN",
    "MAX_THINKING_TOKENS=0 CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 DISABLE_AUTOUPDATER=1",
    '$TO "$C" -p --model haiku --setting-sources "" --strict-mcp-config --tools "" --no-session-persistence --output-format text',
    '--settings "$NARR_SETTINGS"',
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
  tmuxSession: string;
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
  private replay = new Map<WebSocket, { attachedAt: number; lastAt: number; done: boolean }>();
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
    this.replay.delete(ws);
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
        key: ctx.key, hostId: ctx.hostId, tmuxSession: ctx.tmuxSession, conns: new Map(),
        newest: -Infinity, seen: new Map(), settlingUntil: 0,
        turn: 0, starter: null, steps: [], stepCount: 0, stepsSinceLine: 0,
        line: null, lineAt: 0, retryAt: 0, inFlight: false, timer: null,
      };
      this.narrators.set(ctx.key, n);
    }
    const now = this.now();
    if (!n.conns.has(ws)) {
      if (n.line) this.sendTo(ws, n.line);
      this.replay.set(ws, { attachedAt: now, lastAt: now, done: false });
    }
    // While a newly attached tab is still replaying history, each of its lines
    // pushes the settle window out; once its replay goes quiet (or after
    // REPLAY_MAX_MS, so a busy agent's live lines can't hold it off forever)
    // the tab counts as caught up and its lines no longer delay narration.
    const r = this.replay.get(ws);
    if (r && !r.done) {
      if (now - r.lastAt >= SETTLE_MS || now - r.attachedAt >= REPLAY_MAX_MS) {
        r.done = true;
      } else {
        r.lastAt = now;
        n.settlingUntil = Math.max(n.settlingUntil, now + SETTLE_MS);
      }
    }
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
          : this.runner(conn, buildNarrationCommand(n.tmuxSession), Buffer.from(input, "utf-8"), CALL_TIMEOUT_MS),
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
