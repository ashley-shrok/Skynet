// ─── archive-wakeup-check.ts ───────────────────────────────────────────────
// Before an agent is archived, look up the wake-ups that would stop with it.
// A wake-up belongs to one agent and is never moved anywhere when the agent
// is archived, so every archive confirm (single agent, phone swipe, whole
// project, whole role) names the ones that would still have fired. The check
// never blocks an archive: a failure or a slow machine (CHECK_TIMEOUT_MS)
// comes back "unknown" and the confirm says it couldn't check.

import {
  openClaudeSessionSocket,
  type IdentityListWakeupsPayload,
  type IdentityWakeupsEvent,
  type Wakeup,
} from "@/api/claude-session-api";
import { systemLogger } from "@/lib/frontend-logger";

export const CHECK_TIMEOUT_MS = 4_000;

export type ActiveWakeup = Pick<Wakeup, "slug" | "name" | "scheduleHuman">;

export type WakeupCheck =
  | { status: "checked"; active: ActiveWakeup[] }
  | { status: "unknown"; reason: string };

/** Switched on and still able to fire. `canFireAgain` comes from the
 *  backend's scheduler mirror; a row without it falls back to its switch. */
function isActive(w: Wakeup): boolean {
  return w.canFireAgain ?? w.enabled;
}

/** One agent's active wake-ups, or "unknown" after a failure or timeout. */
export function checkActiveWakeups(
  hostId: number,
  identityKey: string,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<WakeupCheck> {
  const startedAt = Date.now();
  return new Promise<WakeupCheck>((resolve) => {
    let settled = false;
    let sock: WebSocket | null = null;
    const finish = (result: WakeupCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock?.close();
      } catch {
        /* ignore */
      }
      systemLogger.info("archive wake-up check", {
        operation: "archive_wakeup_check",
        hostId,
        identityKey,
        result: result.status,
        activeCount: result.status === "checked" ? result.active.length : null,
        reason: result.status === "unknown" ? result.reason : null,
        elapsedMs: Date.now() - startedAt,
      });
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "unknown", reason: "timeout" }), timeoutMs);
    try {
      sock = openClaudeSessionSocket();
    } catch (err) {
      finish({ status: "unknown", reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    sock.onopen = () => {
      const payload: IdentityListWakeupsPayload = { type: "identity:list-wakeups", identityKey, hostId, strict: true };
      try {
        sock?.send(JSON.stringify(payload));
      } catch (err) {
        finish({ status: "unknown", reason: err instanceof Error ? err.message : String(err) });
      }
    };
    sock.onmessage = (event: MessageEvent<string>) => {
      try {
        const raw = JSON.parse(event.data) as { type?: string };
        if (raw.type !== "identity:wakeups") return; // ignore unrelated frames
        const ev = raw as IdentityWakeupsEvent;
        if (ev.error) {
          finish({ status: "unknown", reason: ev.error });
          return;
        }
        if (!Array.isArray(ev.wakeups)) {
          finish({ status: "unknown", reason: "malformed reply" });
          return;
        }
        const active = ev.wakeups
          .filter(isActive)
          .map(({ slug, name, scheduleHuman }) => ({ slug, name, scheduleHuman }));
        finish({ status: "checked", active });
      } catch {
        /* ignore parse errors — wait for a valid frame */
      }
    };
    sock.onerror = () => finish({ status: "unknown", reason: "connection failed" });
    sock.onclose = () => finish({ status: "unknown", reason: "connection closed before response" });
  });
}

/** True when the confirm has something extra to say. */
export function needsWakeupWarning(check: WakeupCheck): boolean {
  return check.status === "unknown" || check.active.length > 0;
}

const SCHEDULED_TASK_POINTER =
  "If this work should keep running, set it up as a scheduled task (clock icon) first.";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The single-agent confirm's added paragraph; "" when it has none. */
export function singleAgentWakeupWarning(check: WakeupCheck): string {
  if (check.status === "unknown") return "Couldn't check this agent's wake-ups — any it has will stop.";
  if (check.active.length === 0) return "";
  return (
    `It has ${plural(check.active.length, "wake-up")} that will never fire again:\n` +
    check.active.map((w) => `• ${w.name} — ${w.scheduleHuman}`).join("\n") +
    `\n\n${SCHEDULED_TASK_POINTER}`
  );
}

/** Today's single-agent confirm body, plus the warning when there is one. */
export const ARCHIVE_AGENT_BODY =
  "The agent is retired and its conversation leaves the sidebar. You can't undo this here.";

export function singleAgentArchiveBody(check: WakeupCheck): string {
  const warning = singleAgentWakeupWarning(check);
  return warning ? `${ARCHIVE_AGENT_BODY}\n\n${warning}` : ARCHIVE_AGENT_BODY;
}

/** At most this many checks run at once per host — each is its own SSH
 *  connection, and a big project would otherwise hit the host all at once. */
export const MULTI_CHECK_CONCURRENCY = 5;
/** The whole multi-agent check gives up after this; agents not checked by
 *  then come back "unknown". */
export const MULTI_CHECK_BUDGET_MS = 8_000;

/** Check several agents (whole project / whole role archive). */
export async function checkActiveWakeupsForAgents<T extends { hostId: number; identityKey: string }>(
  agents: T[],
): Promise<{ agent: T; check: WakeupCheck }[]> {
  const deadline = Date.now() + MULTI_CHECK_BUDGET_MS;
  const results: WakeupCheck[] = new Array(agents.length);
  const byHost = new Map<number, number[]>();
  agents.forEach((a, i) => byHost.set(a.hostId, [...(byHost.get(a.hostId) ?? []), i]));
  const worker = async (queue: number[]) => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      const left = deadline - Date.now();
      results[i] =
        left <= 0
          ? { status: "unknown", reason: "timeout" }
          : await checkActiveWakeups(agents[i].hostId, agents[i].identityKey, Math.min(CHECK_TIMEOUT_MS, left));
    }
  };
  await Promise.all(
    [...byHost.values()].flatMap((queue) =>
      Array.from({ length: Math.min(MULTI_CHECK_CONCURRENCY, queue.length) }, () => worker(queue)),
    ),
  );
  return agents.map((agent, i) => ({ agent, check: results[i] }));
}

// An agent whose archive is waiting on its check (or its confirm): a second
// Archive press on it is ignored, so two confirms can't both archive it (the
// second archive would fail and put the archived agent back in the sidebar).
const archivePromptsInFlight = new Set<string>();

/** Claims the agent's archive prompt; false when one is already open. Pair
 *  with releaseArchivePrompt in a finally. */
export function claimArchivePrompt(hostId: number, identityKey: string): boolean {
  const key = `${hostId}::${identityKey}`;
  if (archivePromptsInFlight.has(key)) {
    systemLogger.info("archive prompt already open — ignoring repeat", {
      operation: "archive_prompt_repeat_ignored",
      hostId,
      identityKey,
    });
    return false;
  }
  archivePromptsInFlight.add(key);
  return true;
}

export function releaseArchivePrompt(hostId: number, identityKey: string): void {
  archivePromptsInFlight.delete(`${hostId}::${identityKey}`);
}

/** The project / role confirm's added paragraph; "" when it has none. */
export function multiAgentWakeupWarning(results: { label: string; check: WakeupCheck }[]): string {
  const withWakeups = results.filter(
    (r): r is { label: string; check: { status: "checked"; active: ActiveWakeup[] } } =>
      r.check.status === "checked" && r.check.active.length > 0,
  );
  const unknown = results.filter((r) => r.check.status === "unknown");
  const parts: string[] = [];
  if (withWakeups.length > 0) {
    const names = withWakeups.map((r) => `${r.label} (${r.check.active.length})`).join(", ");
    parts.push(
      `${withWakeups.length} of these agents ${withWakeups.length === 1 ? "has" : "have"} wake-ups that will stop: ${names}.`,
    );
  }
  if (unknown.length > 0) {
    parts.push(
      `Couldn't check the wake-ups of ${unknown.map((r) => r.label).join(", ")} — any they have will stop.`,
    );
  }
  if (withWakeups.length > 0) parts.push(SCHEDULED_TASK_POINTER);
  return parts.join("\n\n");
}
