/**
 * Admin → Hosts: every host Skynet knows about, in two groups — the
 * ones that need attention (each row says why) and the ones running fine.
 * A host opens one level deeper: its CPU / memory / disk, what it is,
 * and (agent hosts) its agents, substrate sync and agent supervisor.
 * Polls while the pane is open; the backend probes on demand.
 */

import { useCallback, useEffect, useState } from "react";
import { Server } from "lucide-react";
import {
  getAdminHosts,
  type AdminHostOverview,
  type AdminHostsResponse,
} from "@/api/admin-hosts-api";
import {
  KitBanner,
  KitEmpty,
  KitLoading,
  KitSettingsGroup,
  KitSettingsRow,
} from "@/components/kit";
import { AdminBack, adminErrorMessage, useEscBack } from "./admin-ui";

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
  muted: "text-[var(--k-t2)]",
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

/** Why a host needs attention, most serious first; [] when it's fine. */
export function attentionReasons(h: AdminHostOverview, now: number): string[] {
  if (!h.online) {
    return [
      h.lastSeenAt !== null ? `Unreachable · last seen ${ago(h.lastSeenAt, now)}` : "Unreachable · not seen since Skynet started",
    ];
  }
  const out: string[] = [];
  const f = fractions(h);
  const r = h.resources;
  if (h.fleet && !h.fleet.supervisorRunning) out.push("Agent supervisor down");
  if (substrateFailing(h)) out.push(`Substrate sync failing since ${ago(h.substrate!.lastFailureAt!, now)}`);
  if (f.disk !== null && f.disk >= WARN && r) out.push(`Disk ${Math.round(f.disk * 100)}% full`);
  if (f.mem !== null && f.mem >= WARN) out.push(`Memory ${Math.round(f.mem * 100)}% used`);
  if (f.cpu !== null && f.cpu >= CPU_WARN && r) out.push(`CPU busy · load ${r.load1!.toFixed(1)} on ${r.cores} cores`);
  return out;
}

/** One line for a host that's fine. */
function summaryLine(h: AdminHostOverview): string {
  const r = h.resources;
  const f = fractions(h);
  const bits: string[] = [];
  if (h.fleet) bits.push(`${h.fleet.running} of ${h.fleet.agents} agents running`);
  if (f.mem !== null) bits.push(`memory ${Math.round(f.mem * 100)}%`);
  if (r?.diskAvailKb != null) bits.push(`${size(r.diskAvailKb)} free`);
  if (bits.length === 0) {
    // Remote hosts: how Skynet reaches them, and how quickly.
    const via = h.protocols.length > 0 ? h.protocols.map((p) => p.toUpperCase()).join(" · ") : "No connections";
    return h.latencyMs !== null ? `${via} · ${h.latencyMs} ms` : via;
  }
  return bits.join(" · ");
}

/** A labelled usage bar. Kit candidate: KitMeter. */
function Meter({
  frac,
  testId,
  warn = WARN,
  crit = CRIT,
}: {
  frac: number;
  testId: string;
  warn?: number;
  crit?: number;
}) {
  const lv = level(frac, warn, crit);
  // CPU can exceed 1.0; the bar fills at the critical mark.
  const fill = frac / Math.max(1, crit);
  return (
    <div className="w-full h-1.5 rounded-full bg-[var(--k-s3)] overflow-hidden" data-testid={testId}>
      <div
        className={`h-full rounded-full ${FILL[lv]}`}
        // Width is data, not styling.
        style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }}
      />
    </div>
  );
}

/** A resource row's top line: the name on the left, the reading on the right. */
function MeterLabel({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-3 w-full">
      <span>{label}</span>
      <span className="text-[13.5px] font-normal tabular-nums text-[var(--k-t2)]">{value}</span>
    </span>
  );
}

function noteText(h: AdminHostOverview): string | null {
  if (!h.online || h.resources) return null;
  const latency = h.latencyMs !== null ? ` · ${h.latencyMs} ms` : "";
  switch (h.resourcesNote) {
    case "no_ssh":
      return h.protocols.length > 0
        ? `No readings — reachable over ${h.protocols.map((p) => p.toUpperCase()).join(" / ")} only${latency}`
        : `No readings — no connections enabled${latency}`;
    case "no_access":
      return `No readings — you don't hold this host's SSH credentials${latency}`;
    default:
      return `Couldn't read resources over SSH${latency}`;
  }
}

function substrateText(h: AdminHostOverview, now: number): { text: string; tone?: "ok" | "bad" } {
  const s = h.substrate;
  if (!s) return { text: "Not synced yet" };
  if (s.inFlight) return { text: "Syncing…" };
  if (substrateFailing(h)) return { text: `Failing since ${ago(s.lastFailureAt!, now)}`, tone: "bad" };
  if (s.lastSuccessAt !== null) return { text: `Synced ${ago(s.lastSuccessAt, now)}`, tone: "ok" };
  return { text: "Not synced yet" };
}

function StatusDot({ h, attn }: { h: AdminHostOverview; attn: boolean }) {
  return (
    <span
      className="k-status shrink-0"
      data-status={!h.online ? "bad" : attn ? "warn" : "ok"}
      role="img"
      aria-label={!h.online ? "unreachable" : attn ? "needs attention" : "online"}
    />
  );
}

// ─── One host ───────────────────────────────────────────────────────────

function HostView({ h, now, onBack }: { h: AdminHostOverview; now: number; onBack: () => void }) {
  useEscBack(true, onBack);
  const f = fractions(h);
  const r = h.resources;
  const reasons = attentionReasons(h, now);
  const note = noteText(h);
  const sub = substrateText(h, now);
  const toneText = (t?: "ok" | "bad") => (t === "ok" ? TEXT.ok : t === "bad" ? TEXT.bad : undefined);

  return (
    <div data-testid={`admin-host-view-${h.key}`}>
      <AdminBack label="Hosts" onBack={onBack} testId="admin-host-back" />
      <div className="flex flex-col items-center text-center gap-1 pt-1 pb-6">
        <span className="size-[64px] rounded-[18px] grid place-items-center bg-[var(--k-s2)] border border-[var(--k-hair)] text-[var(--k-t2)]">
          <Server size={30} aria-hidden="true" />
        </span>
        <h2 className="m-0 mt-2 text-[22px] font-bold tracking-[-0.02em] text-[var(--k-t1)]">{h.name}</h2>
        <p className="m-0 text-[13.5px] text-[var(--k-t2)] inline-flex items-center gap-1.5" data-testid={`admin-host-${h.key}-status`}>
          <StatusDot h={h} attn={reasons.length > 0} />
          {h.online ? "Online" : reasons[0]} · {h.agentHost ? "Runs agents" : "Remote host"}
        </p>
      </div>
      <div className="flex flex-col">
        {h.online && reasons.length > 0 && (
          <KitBanner tone="warn" className="mb-5" data-testid={`admin-host-${h.key}-reasons`}>
            {reasons.join(" · ")}
          </KitBanner>
        )}
        {r && (
          <KitSettingsGroup title="Resources">
            {f.cpu !== null && (
              <KitSettingsRow
                stacked
                label={<MeterLabel label="CPU" value={<span className={f.cpu >= CPU_WARN ? TEXT[level(f.cpu, CPU_WARN, CPU_CRIT)] : undefined}>load {r.load1!.toFixed(1)} on {r.cores} cores</span>} />}
              >
                <Meter frac={f.cpu} warn={CPU_WARN} crit={CPU_CRIT} testId={`admin-host-${h.key}-cpu`} />
              </KitSettingsRow>
            )}
            {f.mem !== null && (
              <KitSettingsRow
                stacked
                label={<MeterLabel label="Memory" value={<span className={f.mem >= WARN ? TEXT[level(f.mem)] : undefined}>{size(r.memTotalKb! - r.memAvailKb!)} of {size(r.memTotalKb!)}</span>} />}
              >
                <Meter frac={f.mem} testId={`admin-host-${h.key}-mem`} />
              </KitSettingsRow>
            )}
            {f.disk !== null && (
              <KitSettingsRow
                stacked
                label={<MeterLabel label="Disk" value={<span className={f.disk >= WARN ? TEXT[level(f.disk)] : undefined}>{size(r.diskAvailKb!)} free</span>} />}
              >
                <Meter frac={f.disk} testId={`admin-host-${h.key}-disk`} />
              </KitSettingsRow>
            )}
          </KitSettingsGroup>
        )}
        {h.agentHost && h.online && (
          <KitSettingsGroup
            title="Agents"
            footer={substrateFailing(h) && h.substrate?.lastError ? <span className={`font-mono ${TEXT.bad}`}>{h.substrate.lastError}</span> : undefined}
          >
            {h.fleet && (
              <KitSettingsRow label="Agents" value={`${h.fleet.running} running of ${h.fleet.agents}`} />
            )}
            {h.fleet && <KitSettingsRow label="Apps" value={String(h.fleet.apps)} />}
            {h.fleet && (
              <KitSettingsRow
                label="Agent supervisor"
                value={<span className={h.fleet.supervisorRunning ? TEXT.ok : TEXT.bad}>{h.fleet.supervisorRunning ? "Running" : "Down"}</span>}
              />
            )}
            <KitSettingsRow
              label="Substrate"
              description="Scripts and skills Skynet keeps in step on every agent host."
              value={<span className={toneText(sub.tone)}>{sub.text}</span>}
            />
          </KitSettingsGroup>
        )}
        <KitSettingsGroup title="About" footer={note ?? undefined}>
          <KitSettingsRow label="Address" value={<span className="font-mono text-[12.5px]">{h.address}</span>} />
          <KitSettingsRow
            label="Connections"
            value={h.protocols.length > 0 ? h.protocols.map((p) => p.toUpperCase()).join(" · ") : "None"}
          />
          {r?.os && <KitSettingsRow label="System" value={[r.os, r.arch].filter(Boolean).join(" · ")} />}
          {r?.uptimeSec != null && <KitSettingsRow label="Up for" value={duration(r.uptimeSec)} />}
          {h.latencyMs !== null && <KitSettingsRow label="Response time" value={`${h.latencyMs} ms`} />}
        </KitSettingsGroup>
      </div>
    </div>
  );
}

// ─── The list ────────────────────────────────────────────────────────────

export function AdminHostsPane({
  selectedKey,
  onSelect,
}: {
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
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

  const hosts = data ? [...data.hosts].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const selected = selectedKey ? hosts.find((h) => h.key === selectedKey) : undefined;
  if (selected) return <HostView h={selected} now={now} onBack={() => onSelect(null)} />;

  const attention = hosts.filter((h) => needsAttention(h));
  const fine = hosts.filter((h) => !needsAttention(h));
  const online = hosts.filter((h) => h.online).length;

  const row = (h: AdminHostOverview, attn: boolean) => {
    const reasons = attn ? attentionReasons(h, now) : [];
    return (
      <KitSettingsRow
        key={h.key}
        data-testid={`admin-host-${h.key}`}
        leading={<StatusDot h={h} attn={attn} />}
        label={h.name}
        description={
          <span className={attn ? (h.online ? TEXT.warn : TEXT.bad) : undefined}>
            {attn ? reasons.join(" · ") || "Needs attention" : summaryLine(h)}
          </span>
        }
        truncate
        value={h.agentHost ? "Agents" : "Remote"}
        onClick={() => onSelect(h.key)}
      />
    );
  };

  return (
    <div className="flex flex-col" data-testid="admin-hosts-pane">
      {data && (
        <p className={`m-0 -mt-2 mb-5 text-[13px] ${TEXT.muted}`} data-testid="admin-hosts-summary">
          {hosts.length} host{hosts.length === 1 ? "" : "s"} · {online} online
          {attention.length > 0 ? ` · ${attention.length} need${attention.length === 1 ? "s" : ""} attention` : ""} · updated{" "}
          {ago(data.generatedAt, now)}
        </p>
      )}
      {error && (
        <KitBanner tone="danger" data-testid="admin-hosts-error">
          {error}
        </KitBanner>
      )}
      {!data && !error && <KitLoading label="Checking hosts…" />}
      {data && hosts.length === 0 && <KitEmpty title="No hosts yet." />}
      {attention.length > 0 && (
        <KitSettingsGroup title="Needs attention" data-testid="admin-hosts-attention">
          {attention.map((h) => row(h, true))}
        </KitSettingsGroup>
      )}
      {fine.length > 0 && (
        <KitSettingsGroup title={attention.length > 0 ? "Running fine" : undefined} data-testid="admin-hosts-fine">
          {fine.map((h) => row(h, false))}
        </KitSettingsGroup>
      )}
    </div>
  );
}
