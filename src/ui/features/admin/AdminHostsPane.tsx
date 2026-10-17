/**
 * Admin → Hosts: one card per machine Skynet knows about — reachability,
 * CPU / memory / disk, and (agent hosts) agent counts, substrate sync and
 * the agent supervisor. Machines that need attention sort to the top.
 * Polls while the pane is open; the backend probes on demand.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getAdminHosts,
  type AdminHostOverview,
  type AdminHostsResponse,
} from "@/api/admin-hosts-api";
import { KitBanner, KitChip, KitEmpty, KitLoading } from "@/components/kit";
import { adminErrorMessage } from "./admin-ui";

const POLL_MS = 15_000;
const WARN = 0.75;
const CRIT = 0.9;
// CPU is load average per core: 1.0 = every core busy. Busy agent hosts sit
// near 0.8 routinely, so only saturation is worth flagging.
const CPU_WARN = 1.0;
const CPU_CRIT = 1.5;

// Kit tokens only. Text classes for status words, fill classes for meters.
const TEXT = {
  text: "text-[var(--k-t1)]",
  muted: "text-[var(--k-t3)]",
  ok: "text-[var(--k-ok)]",
  warn: "text-[var(--k-warn)]",
  bad: "text-[var(--k-danger-text)]",
};
const FILL = {
  ok: "bg-[var(--k-ok)]",
  warn: "bg-[var(--k-warn)]",
  bad: "bg-[var(--k-danger)]",
};

type Level = "ok" | "warn" | "bad";
const level = (f: number, warn = WARN, crit = CRIT): Level =>
  f >= crit ? "bad" : f >= warn ? "warn" : "ok";

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function size(kb: number): string {
  const gb = kb / 1024 / 1024;
  if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

interface Fractions {
  cpu: number | null;
  mem: number | null;
  disk: number | null;
}

function fractions(h: AdminHostOverview): Fractions {
  const r = h.resources;
  if (!r) return { cpu: null, mem: null, disk: null };
  return {
    cpu: r.load1 !== null && r.cores ? r.load1 / r.cores : null,
    mem:
      r.memTotalKb && r.memAvailKb !== null
        ? (r.memTotalKb - r.memAvailKb) / r.memTotalKb
        : null,
    disk:
      r.diskUsedKb !== null && r.diskAvailKb !== null && r.diskUsedKb + r.diskAvailKb > 0
        ? r.diskUsedKb / (r.diskUsedKb + r.diskAvailKb)
        : null,
  };
}

function substrateFailing(h: AdminHostOverview): boolean {
  const s = h.substrate;
  return !!s && !s.inFlight && s.lastFailureAt !== null && s.lastFailureAt > (s.lastSuccessAt ?? 0);
}

export function needsAttention(h: AdminHostOverview): boolean {
  if (!h.online) return true;
  const f = fractions(h);
  if (f.cpu !== null && f.cpu >= CPU_WARN) return true;
  if ([f.mem, f.disk].some((x) => x !== null && x >= WARN)) return true;
  if (substrateFailing(h)) return true;
  return !!h.fleet && !h.fleet.supervisorRunning;
}

/** A labelled usage bar. Kit candidate: KitMeter. */
function Meter({
  label,
  frac,
  detail,
  testId,
  warn = WARN,
  crit = CRIT,
}: {
  label: string;
  frac: number;
  detail: string;
  testId: string;
  warn?: number;
  crit?: number;
}) {
  const lv = level(frac, warn, crit);
  // CPU can exceed 1.0; the bar fills at the critical mark.
  const fill = frac / Math.max(1, crit);
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]" data-testid={testId}>
      <span className={`w-[52px] shrink-0 ${TEXT.muted}`}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--k-s3)] overflow-hidden">
        <div
          className={`h-full rounded-full ${FILL[lv]}`}
          // Width is data, not styling.
          style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }}
        />
      </div>
      <span
        className={`w-[130px] shrink-0 text-right tabular-nums ${frac >= warn ? TEXT[lv] : TEXT.text}`}
      >
        {detail}
      </span>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={ok ? TEXT.ok : TEXT.bad}>
      {ok ? "✓" : "✕"} {children}
    </span>
  );
}

function noteText(h: AdminHostOverview): string | null {
  if (!h.online || h.resources) return null;
  const latency = h.latencyMs !== null ? ` · ${h.latencyMs} ms` : "";
  switch (h.resourcesNote) {
    case "no_ssh":
      return h.protocols.length > 0
        ? `No resource readings — reachable over ${h.protocols.map((p) => p.toUpperCase()).join(" / ")} only${latency}`
        : `No resource readings — no connections enabled${latency}`;
    case "no_access":
      return `No resource readings — you don't hold this host's SSH credentials${latency}`;
    default:
      return `Couldn't read resources over SSH${latency}`;
  }
}

function SubstrateStatus({ h, now }: { h: AdminHostOverview; now: number }) {
  const s = h.substrate;
  if (!s) return <span className={TEXT.muted}>substrate not synced yet</span>;
  if (s.inFlight) return <span className={TEXT.muted}>substrate syncing…</span>;
  if (substrateFailing(h)) {
    return <Check ok={false}>substrate sync failed {ago(s.lastFailureAt!, now)}</Check>;
  }
  if (s.lastSuccessAt !== null) {
    return <Check ok>substrate synced {ago(s.lastSuccessAt, now)}</Check>;
  }
  return <span className={TEXT.muted}>substrate not synced yet</span>;
}

function HostCard({ h, now }: { h: AdminHostOverview; now: number }) {
  const attn = needsAttention(h);
  const f = fractions(h);
  const r = h.resources;
  const note = noteText(h);
  const meta = [
    r?.os,
    r?.arch,
    r?.uptimeSec != null ? `up ${duration(r.uptimeSec)}` : null,
  ].filter(Boolean);

  return (
    <div
      className={
        "k-group px-3.5 py-3 " +
        (attn ? "ring-1 ring-inset ring-[rgba(229,85,76,0.45)] " : "") +
        (h.online ? "" : "opacity-60")
      }
      data-testid={`admin-host-${h.key}`}
      data-attention={attn ? "true" : "false"}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="k-status" data-status={h.online ? "ok" : "bad"} aria-hidden="true" />
        <span className={`text-[14px] font-semibold truncate ${TEXT.text}`}>{h.name}</span>
        <KitChip className="shrink-0">{h.agentHost ? "agent host" : "remote target"}</KitChip>
        <span
          className={`ml-auto text-[12px] shrink-0 text-right ${h.online ? TEXT.muted : TEXT.bad}`}
          data-testid={`admin-host-${h.key}-status`}
        >
          {h.online
            ? "online"
            : h.lastSeenAt !== null
              ? `unreachable · last seen ${ago(h.lastSeenAt, now)}`
              : "unreachable · not seen since Skynet started"}
        </span>
      </div>

      {meta.length > 0 && (
        <div className={`mt-0.5 ml-4 text-[12px] ${TEXT.muted}`}>{meta.join(" · ")}</div>
      )}

      {r && (
        <div className="flex flex-col gap-1.5 mt-2.5">
          {f.cpu !== null && (
            <Meter
              label="CPU"
              frac={f.cpu}
              detail={`load ${r.load1!.toFixed(1)} / ${r.cores} cores`}
              testId={`admin-host-${h.key}-cpu`}
              warn={CPU_WARN}
              crit={CPU_CRIT}
            />
          )}
          {f.mem !== null && (
            <Meter
              label="Memory"
              frac={f.mem}
              detail={`${size(r.memTotalKb! - r.memAvailKb!)} / ${size(r.memTotalKb!)}`}
              testId={`admin-host-${h.key}-mem`}
            />
          )}
          {f.disk !== null && (
            <Meter
              label="Disk"
              frac={f.disk}
              detail={`${size(r.diskAvailKb!)} free`}
              testId={`admin-host-${h.key}-disk`}
            />
          )}
        </div>
      )}

      {note && <div className={`mt-2 text-[12.5px] ${TEXT.muted}`}>{note}</div>}

      {h.agentHost && h.online && (
        <>
          <div
            className={`flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5 pt-2 border-t border-[var(--k-hair)] text-[12.5px] ${TEXT.text}`}
          >
            {h.fleet && (
              <span>
                {h.fleet.agents} agents ·{" "}
                <span className={TEXT.ok}>{h.fleet.running} running</span> ·{" "}
                {h.fleet.apps} app{h.fleet.apps === 1 ? "" : "s"}
              </span>
            )}
            <SubstrateStatus h={h} now={now} />
            {h.fleet && (
              <Check ok={h.fleet.supervisorRunning}>
                {h.fleet.supervisorRunning ? "supervisor running" : "supervisor down"}
              </Check>
            )}
          </div>
          {substrateFailing(h) && h.substrate?.lastError && (
            <div className={`mt-1 text-[12px] font-mono ${TEXT.bad}`}>{h.substrate.lastError}</div>
          )}
        </>
      )}
    </div>
  );
}

export function AdminHostsPane() {
  const [data, setData] = useState<AdminHostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await getAdminHosts());
      setError(null);
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to load hosts."));
    }
    setNow(Date.now());
  }, []);

  // Poll only while the browser tab is visible; refresh on return.
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const hosts = data
    ? [...data.hosts].sort(
        (a, b) =>
          Number(needsAttention(b)) - Number(needsAttention(a)) ||
          a.name.localeCompare(b.name),
      )
    : [];
  const online = hosts.filter((h) => h.online).length;
  const attention = hosts.filter(needsAttention).length;

  return (
    <div className="flex flex-col gap-3 px-6 py-5 max-sm:px-5" data-testid="admin-hosts-pane">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h3 className="k-group-title m-0">Hosts</h3>
        {data && (
          <span className={`text-[13px] ${TEXT.text}`} data-testid="admin-hosts-summary">
            {hosts.length} host{hosts.length === 1 ? "" : "s"} ·{" "}
            <span className={TEXT.ok}>{online} online</span>
            {attention > 0 && (
              <>
                {" "}· <span className={TEXT.bad}>{attention} need attention</span>
              </>
            )}
          </span>
        )}
        {data && (
          <span className={`ml-auto text-[12px] ${TEXT.muted}`}>
            updated {ago(data.generatedAt, now)}
          </span>
        )}
      </div>

      {error && (
        <KitBanner tone="danger" data-testid="admin-hosts-error">
          {error}
        </KitBanner>
      )}
      {!data && !error && <KitLoading label="Checking hosts…" />}
      {data && hosts.length === 0 && <KitEmpty title="No hosts yet." />}

      {hosts.map((h) => (
        <HostCard key={h.key} h={h} now={now} />
      ))}
    </div>
  );
}
