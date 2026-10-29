import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client, ClientChannel } from "ssh2";
import { sshLogger } from "../utils/logger.js";

/**
 * One long-lived exec channel per SSH connection, running the skynet-hostd
 * helper (substrate/scripts/skynet-hostd.py). This is how Skynet runs routine
 * commands on every host it keeps a long-lived connection to.
 *
 * Why: over Tailscale SSH every exec channel is a fresh login on the host (a
 * logind session per command). Skynet's pollers send several commands a
 * second per host; on a busy multi-user box that churn drove a polkitd leak. Routing every
 * routine command through one helper channel makes the whole stream cost one
 * login per connection.
 *
 * Which connections: the owner of a long-lived connection calls
 * `enableHostd(conn)` once after connecting. Short one-shot connections run
 * plain execs (they're one login anyway).
 *
 * Nothing is installed on the host: the helper's source travels with the
 * channel open (`python3 -c '<source>'`), so its version always matches the
 * running Skynet and a brand-new host works with no distributor sweep. The
 * host needs python3, which every fleet host already has.
 *
 * No fallback: if the helper can't start, commands on that connection fail
 * with a HostdUnavailableError naming why. A request the helper never
 * received is retried once on a fresh channel; one that was already sent is
 * never re-run (commands aren't all idempotent) and fails with a
 * HostdChannelLostError.
 *
 * Protocol: see the docblock in skynet-hostd.py. Keep the two in lockstep.
 */

export const HOSTD_PROTOCOL_VERSION = 1;
const HELLO_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 10_000;
/** Client-side grace past the helper's own time limit before we give up. */
const CLIENT_DEADLINE_GRACE_MS = 5_000;
/** Sanity cap on a stdin body (sent base64 inside one JSON line). */
export const HOSTD_MAX_STDIN_BYTES = 64 * 1024 * 1024;
/** After this many channel deaths within DEATH_WINDOW_MS, fail fast instead
 *  of reopening until the window passes. */
const MAX_DEATHS_IN_WINDOW = 3;
const DEATH_WINDOW_MS = 60_000;

/** Where the helper's source lives: bundled in the image, or the repo in dev/tests. */
const HOSTD_SOURCE_CANDIDATES = [
  "/app/fleet-substrate/scripts/skynet-hostd.py",
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../substrate/scripts/skynet-hostd.py"),
];

let cachedCommand: string | null = null;

/** Shell-quote for a POSIX shell: wrap in single quotes, escape embedded ones. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The exec command that starts the helper: its whole source as one argv
 * element (~10 KB, far under the 128 KB per-argument limit).
 */
export function hostdCommand(): string {
  if (cachedCommand) return cachedCommand;
  for (const p of HOSTD_SOURCE_CANDIDATES) {
    try {
      const src = readFileSync(p, "utf-8");
      cachedCommand = `exec python3 -c ${shQuote(src)}`;
      return cachedCommand;
    } catch {
      /* try the next */
    }
  }
  throw new Error(`skynet-hostd source not found (looked in ${HOSTD_SOURCE_CANDIDATES.join(", ")})`);
}

export interface HostdResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  ms: number;
  timeout: boolean;
  truncated: boolean;
}

/** The request never reached the helper (it couldn't start, or died first). */
export class HostdUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`skynet-hostd unavailable: ${reason}`);
    this.name = "HostdUnavailableError";
  }
}

/** The request was sent but the channel died before its result came back. */
export class HostdChannelLostError extends Error {
  constructor(readonly reason: string) {
    super(`skynet-hostd channel lost: ${reason}`);
    this.name = "HostdChannelLostError";
  }
}

/** The helper's own result never arrived within the time limit + grace. */
export class HostdDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`skynet-hostd gave no result within ${timeoutMs}ms`);
    this.name = "HostdDeadlineError";
  }
}

interface Pending {
  resolve: (r: HostdResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  preview: string;
}

interface Queued {
  line: string;
  id: string;
  pending: Pending;
}

type State = "starting" | "ready" | "dead";

let nextChannelSeq = 1;

export class HostdChannel {
  private state: State = "starting";
  private stream: ClientChannel | null = null;
  private buf = "";
  private stderrTail = "";
  private pending = new Map<string, Pending>();
  private queuedUntilReady: Queued[] = [];
  private nextId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly seq = nextChannelSeq++;
  private readonly startedAt = Date.now();

  constructor(
    private readonly conn: Client,
    private readonly peer: string,
    private readonly onDeath: (ch: HostdChannel, reason: string, neverReady: boolean) => void,
  ) {
    this.start();
  }

  get isDead(): boolean {
    return this.state === "dead";
  }

  private start(): void {
    sshLogger.info(`[hostd] open peer=${this.peer} ch=${this.seq}`, {
      operation: "hostd_open",
      peer: this.peer,
      channel: this.seq,
    });
    this.helloTimer = setTimeout(() => this.die("no hello", true), HELLO_TIMEOUT_MS);
    this.helloTimer.unref?.();
    try {
      this.conn.exec(hostdCommand(), (err, stream) => {
        if (err) {
          this.die(`exec failed: ${err.message}`, true);
          return;
        }
        if (this.state === "dead") {
          try {
            stream.close();
          } catch {
            /* ignore */
          }
          return;
        }
        this.stream = stream;
        stream.on("data", (d: Buffer) => this.onData(d));
        stream.stderr.on("data", (d: Buffer) => {
          this.stderrTail = (this.stderrTail + d.toString("utf-8")).slice(-500);
        });
        stream.on("error", (e: Error) => this.die(`stream error: ${e.message}`, this.state === "starting"));
        stream.on("close", (code: number | undefined) =>
          this.die(`helper exited code=${code ?? "none"}`, this.state === "starting"),
        );
      });
    } catch (e) {
      this.die(`exec threw: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  private onData(d: Buffer): void {
    this.buf += d.toString("utf-8");
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.trim()) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Login banners / MOTD noise ahead of the hello are ignored; after
      // the hello, stdout is ours alone.
      if (this.state === "ready") {
        sshLogger.warn(`[hostd] unparseable line peer=${this.peer} ch=${this.seq}`, {
          operation: "hostd_bad_line",
          peer: this.peer,
        });
      }
      return;
    }
    switch (msg.t) {
      case "hello": {
        if (this.state !== "starting") return;
        if (msg.v !== HOSTD_PROTOCOL_VERSION) {
          this.die(`protocol v${String(msg.v)} != v${HOSTD_PROTOCOL_VERSION}`, true);
          return;
        }
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.state = "ready";
        sshLogger.info(
          `[hostd] ready peer=${this.peer} ch=${this.seq} pid=${String(msg.pid)} startMs=${Date.now() - this.startedAt} queued=${this.queuedUntilReady.length}`,
          { operation: "hostd_ready", peer: this.peer, channel: this.seq },
        );
        const queued = this.queuedUntilReady;
        this.queuedUntilReady = [];
        for (const q of queued) {
          this.pending.set(q.id, q.pending);
          this.write(q.line);
        }
        this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
        this.pingTimer.unref?.();
        return;
      }
      case "pong": {
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        return;
      }
      case "result": {
        const id = String(msg.id);
        const p = this.pending.get(id);
        if (!p) return; // already timed out client-side
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.resolve({
          code: typeof msg.code === "number" ? msg.code : null,
          stdout: Buffer.from(String(msg.out ?? ""), "base64"),
          stderr: Buffer.from(String(msg.err ?? ""), "base64"),
          ms: typeof msg.ms === "number" ? msg.ms : 0,
          timeout: msg.timeout === true,
          truncated: msg.truncated === true,
        });
        return;
      }
      case "error": {
        sshLogger.warn(`[hostd] helper error peer=${this.peer} ch=${this.seq} msg="${String(msg.msg)}"`, {
          operation: "hostd_helper_error",
          peer: this.peer,
        });
        const id = msg.id == null ? null : String(msg.id);
        const p = id ? this.pending.get(id) : undefined;
        if (id && p) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.reject(new Error(`skynet-hostd rejected the request: ${String(msg.msg)}`));
        }
        return;
      }
      default:
        return;
    }
  }

  private ping(): void {
    if (this.state !== "ready" || this.pongTimer) return;
    this.pongTimer = setTimeout(() => this.die("no pong", false), PONG_TIMEOUT_MS);
    this.pongTimer.unref?.();
    this.write(JSON.stringify({ t: "ping", id: `p${this.nextId++}` }));
  }

  private write(line: string): void {
    try {
      this.stream?.write(line + "\n");
    } catch (e) {
      this.die(`write failed: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  run(command: string, timeoutMs: number, stdin?: Buffer): Promise<HostdResult> {
    if (this.state === "dead") {
      return Promise.reject(new HostdUnavailableError("channel dead"));
    }
    if (stdin && stdin.length > HOSTD_MAX_STDIN_BYTES) {
      return Promise.reject(new HostdUnavailableError("stdin too large"));
    }
    const id = String(this.nextId++);
    const req: Record<string, unknown> = { t: "exec", id, cmd: command, timeout_ms: timeoutMs };
    if (stdin) req.stdin = stdin.toString("base64");
    const line = JSON.stringify(req);
    return new Promise<HostdResult>((resolve, reject) => {
      const deadlineMs = timeoutMs + CLIENT_DEADLINE_GRACE_MS;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queuedUntilReady = this.queuedUntilReady.filter((q) => q.id !== id);
        reject(new HostdDeadlineError(timeoutMs));
      }, deadlineMs);
      timer.unref?.();
      const pending: Pending = { resolve, reject, timer, preview: command.slice(0, 80) };
      if (this.state === "starting") {
        this.queuedUntilReady.push({ line, id, pending });
      } else {
        this.pending.set(id, pending);
        this.write(line);
      }
    });
  }

  /** Close the channel; the helper sees stdin EOF and kills what it runs. */
  close(reason = "closed by caller"): void {
    this.die(reason, false);
  }

  private die(reason: string, neverReady: boolean): void {
    if (this.state === "dead") return;
    const wasStarting = this.state === "starting";
    this.state = "dead";
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    try {
      this.stream?.close();
    } catch {
      /* ignore */
    }
    const stderr = this.stderrTail.trim().replace(/\s+/g, " ").slice(0, 200);
    sshLogger.warn(
      `[hostd] ${wasStarting ? "unavailable" : "lost"} peer=${this.peer} ch=${this.seq} reason="${reason}" inFlight=${this.pending.size} queued=${this.queuedUntilReady.length} ageMs=${Date.now() - this.startedAt}${stderr ? ` stderr="${stderr}"` : ""}`,
      {
        operation: wasStarting ? "hostd_unavailable" : "hostd_lost",
        peer: this.peer,
        channel: this.seq,
        reason,
        inFlight: this.pending.size,
      },
    );
    // Never-sent requests may be retried on a fresh channel; sent ones can't
    // be safely re-run.
    for (const q of this.queuedUntilReady) {
      clearTimeout(q.pending.timer);
      q.pending.reject(new HostdUnavailableError(reason));
    }
    this.queuedUntilReady = [];
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new HostdChannelLostError(reason));
    }
    this.pending.clear();
    this.onDeath(this, reason, neverReady && wasStarting);
  }
}

interface ConnState {
  channel: HostdChannel | null;
  deaths: number[];
  lastDeathReason: string;
}

const enabled = new WeakMap<Client, ConnState>();

function peerOf(conn: Client): string {
  try {
    const sock = (conn as unknown as { _sock?: { remoteAddress?: string; remotePort?: number } })._sock;
    if (sock?.remoteAddress) return sock.remoteAddress.replace(/^::ffff:/, "");
  } catch {
    /* ignore */
  }
  return "?";
}

/**
 * Mark a long-lived connection so its commands go through the helper. Call
 * once, right after the connection opens. Idempotent. The helper channel
 * itself opens lazily on the first command and closes with the connection.
 */
export function enableHostd(conn: Client): void {
  if (enabled.has(conn)) return;
  const state: ConnState = { channel: null, deaths: [], lastDeathReason: "" };
  enabled.set(conn, state);
  // A closed connection never gets a new helper; its later execs fail the
  // plain way, as they always have.
  const drop = () => {
    state.channel?.close("connection closed");
    state.channel = null;
    enabled.delete(conn);
  };
  try {
    conn.once?.("close", drop);
    conn.once?.("end", drop);
  } catch {
    /* fake clients in tests may not be emitters */
  }
}

/** Whether commands on `conn` go through the helper. */
export function hostdEnabled(conn: Client): boolean {
  return enabled.has(conn);
}

/**
 * The helper channel for `conn`, opening one if needed. Null when `conn`
 * isn't enabled (plain exec). Throws HostdUnavailableError when the helper
 * has died repeatedly in the last minute (fail fast rather than reopen).
 */
export function hostdChannelFor(conn: Client, now = Date.now()): HostdChannel | null {
  const state = enabled.get(conn);
  if (!state) return null;
  if (state.channel && !state.channel.isDead) return state.channel;
  state.deaths = state.deaths.filter((d) => now - d < DEATH_WINDOW_MS);
  if (state.deaths.length >= MAX_DEATHS_IN_WINDOW) {
    throw new HostdUnavailableError(
      `${state.deaths.length} helper failures in the last ${DEATH_WINDOW_MS / 1000}s, last: ${state.lastDeathReason}`,
    );
  }
  const peer = peerOf(conn);
  state.channel = new HostdChannel(conn, peer, (ch, reason) => {
    if (state.channel === ch) state.channel = null;
    if (reason === "connection closed") return;
    state.deaths.push(Date.now());
    state.lastDeathReason = reason;
  });
  return state.channel;
}

/** TEST-ONLY: drop a connection's helper state. */
export function __resetHostdForTests(conn: Client): void {
  enabled.get(conn)?.channel?.close("test reset");
  enabled.delete(conn);
}
