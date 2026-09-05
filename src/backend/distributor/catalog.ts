/**
 * catalog.ts — Hand-maintained catalog of the fleet-substrate items that the
 * per-host sweep in Plan 03 will iterate over.
 *
 * SHAPE SOURCE OF TRUTH:
 *   .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 *   (and, via that CONTEXT.md, the locked feature-02 design doc under
 *    ~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/
 *    feature-02-skynet-distributor.md and the closed slice-1 shape doc.)
 *
 * PURE-LIB DISCIPLINE:
 *   This module contains NO filesystem access, NO SSH, NO child process
 *   execution, NO logger — it is data + type declaration only. Zero runtime
 *   imports. Every downstream consumer (byte-compare, push mechanism, restart
 *   hook fire) injects the transport it needs and reads the shape it wants
 *   off these entries.
 *
 * MODE IS NOT DECLARED PER ENTRY:
 *   The push helpers in Plan 03 read each bundled file's mode from disk at
 *   push time and mirror it onto the installed side. Git IS the mode source
 *   of truth per the shape doc's mode-preservation invariant — declaring it
 *   here would just create a second, drift-prone source.
 *
 * RESTART HOOK CONTRACT:
 *   `restartHook` is passed verbatim to `systemctl --user restart <hook>` on
 *   the managed host. This module does no interpretation. Two entries carry
 *   non-null hooks: agent-supervisor.sh (the binary) and
 *   agent-supervisor.service (the unit file). The service entry's restart
 *   works correctly because runBootstrapForHost unconditionally runs
 *   `systemctl --user daemon-reload` at the start of every sweep, so systemd
 *   has already re-read the unit before the restart hook fires.
 *
 * ROW-COUNT RECONCILIATION (15 items vs. 20 rows):
 *   The shape doc counts "15 items" — that's 7 single-file skills + 1 skill
 *   with 1 companion (agent-relay: SKILL.md + recv.sh) + 1 skill with 3
 *   companions (id: SKILL.md + actor-status-prompt + clone-picker-prompt +
 *   coordinator-instructions) + 6 helper scripts. The byte-compare mechanism
 *   in Plan 03 pushes files, not "items", so this catalog has one row per
 *   file. The bootstrap bounty adds 1 more row (agent-supervisor.service):
 *     - 4 rows for id/          (SKILL.md + 3 companions)
 *     - 2 rows for agent-relay/ (SKILL.md + recv.sh)
 *     - 7 rows for the single-file skills (backlog, bounty,
 *       claude-code-harness-auth, next-bounty, promote-to-coordinator,
 *       queue, role)
 *     - 6 rows for helper scripts under scripts/
 *     - 1 row for user-onboarding/agent-supervisor.service
 *   Total = 20.
 */

/**
 * A single reconciled fleet-substrate item: the bundled bytes inside the
 * container image, the target install path on a managed host (relative to
 * the ubuntu user's HOME), and — if the item needs re-execution to take
 * effect after its bytes change — the systemd --user unit to restart.
 */
export interface CatalogEntry {
  /**
   * Unique kebab-case identifier, used only in log lines and test assertions.
   * Not written to disk on the managed host.
   */
  slug: string;

  /**
   * Absolute path inside the container image where the canonical bytes live.
   * Always under /app/fleet-substrate/ (established by slice 1).
   */
  bundledPath: string;

  /**
   * Target path on the managed host, expressed with a leading "~/" that the
   * remote shell will expand against the ubuntu user's HOME. Skill entries
   * land under ~/.claude/skills/<slug>/... and helper scripts under
   * ~/.local/bin/<name>.
   */
  installPath: string;

  /**
   * Systemd --user unit name to restart after the file's bytes change on the
   * managed host. Passed verbatim to `systemctl --user restart <hook>`. Null
   * for items with no restart requirement (they pick up new bytes on the
   * next natural read — identity reload for skills, next invocation for
   * on-demand scripts).
   */
  restartHook: string | null;
}

/**
 * The 20-row hand-maintained catalog. Ordered skills-side first, then
 * scripts-side, then user-onboarding/ files. Within skills, multi-file skills
 * (id, agent-relay) appear before single-file skills for reviewability.
 */
export const FLEET_SUBSTRATE_CATALOG: readonly CatalogEntry[] = [
  // --- id skill (4 rows: SKILL.md + 3 companion prompts) ---
  {
    slug: "id-skill",
    bundledPath: "/app/fleet-substrate/skills/id/SKILL.md",
    installPath: "~/.claude/skills/id/SKILL.md",
    restartHook: null,
  },
  {
    slug: "id-actor-status-prompt",
    bundledPath: "/app/fleet-substrate/skills/id/actor-status-prompt.md",
    installPath: "~/.claude/skills/id/actor-status-prompt.md",
    restartHook: null,
  },
  {
    slug: "id-clone-picker-prompt",
    bundledPath: "/app/fleet-substrate/skills/id/clone-picker-prompt.md",
    installPath: "~/.claude/skills/id/clone-picker-prompt.md",
    restartHook: null,
  },
  {
    slug: "id-coordinator-instructions",
    bundledPath: "/app/fleet-substrate/skills/id/coordinator-instructions.md",
    installPath: "~/.claude/skills/id/coordinator-instructions.md",
    restartHook: null,
  },

  // --- agent-relay skill (2 rows: SKILL.md + recv.sh receiver) ---
  {
    slug: "agent-relay-skill",
    bundledPath: "/app/fleet-substrate/skills/agent-relay/SKILL.md",
    installPath: "~/.claude/skills/agent-relay/SKILL.md",
    restartHook: null,
  },
  {
    slug: "agent-relay-recv",
    bundledPath: "/app/fleet-substrate/skills/agent-relay/recv.sh",
    installPath: "~/.claude/skills/agent-relay/recv.sh",
    restartHook: null,
  },

  // --- single-file skills (7 rows, one SKILL.md each) ---
  {
    slug: "backlog-skill",
    bundledPath: "/app/fleet-substrate/skills/backlog/SKILL.md",
    installPath: "~/.claude/skills/backlog/SKILL.md",
    restartHook: null,
  },
  {
    slug: "bounty-skill",
    bundledPath: "/app/fleet-substrate/skills/bounty/SKILL.md",
    installPath: "~/.claude/skills/bounty/SKILL.md",
    restartHook: null,
  },
  {
    slug: "claude-code-harness-auth-skill",
    bundledPath:
      "/app/fleet-substrate/skills/claude-code-harness-auth/SKILL.md",
    installPath: "~/.claude/skills/claude-code-harness-auth/SKILL.md",
    restartHook: null,
  },
  {
    slug: "next-bounty-skill",
    bundledPath: "/app/fleet-substrate/skills/next-bounty/SKILL.md",
    installPath: "~/.claude/skills/next-bounty/SKILL.md",
    restartHook: null,
  },
  {
    slug: "promote-to-coordinator-skill",
    bundledPath:
      "/app/fleet-substrate/skills/promote-to-coordinator/SKILL.md",
    installPath: "~/.claude/skills/promote-to-coordinator/SKILL.md",
    restartHook: null,
  },
  {
    slug: "queue-skill",
    bundledPath: "/app/fleet-substrate/skills/queue/SKILL.md",
    installPath: "~/.claude/skills/queue/SKILL.md",
    restartHook: null,
  },
  {
    slug: "role-skill",
    bundledPath: "/app/fleet-substrate/skills/role/SKILL.md",
    installPath: "~/.claude/skills/role/SKILL.md",
    restartHook: null,
  },

  // --- helper scripts (6 rows, all under ~/.local/bin/) ---
  // agent-supervisor is the sole entry with a restart hook: bytes must be
  // re-executed for the daemon to run the new version, and its unit is
  // KillMode=process so `systemctl --user restart agent-supervisor` does not
  // reap its supervised tmux sessions.
  {
    slug: "agent-supervisor",
    bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
    installPath: "~/.local/bin/agent-supervisor",
    restartHook: "agent-supervisor.service",
  },
  {
    slug: "wakeup-scheduler",
    bundledPath: "/app/fleet-substrate/scripts/wakeup-scheduler.py",
    installPath: "~/.local/bin/wakeup-scheduler",
    restartHook: null,
  },
  {
    slug: "context-watch",
    bundledPath: "/app/fleet-substrate/scripts/context-watch.py",
    installPath: "~/.local/bin/context-watch",
    restartHook: null,
  },
  {
    slug: "usage-reporter",
    bundledPath: "/app/fleet-substrate/scripts/usage-reporter.sh",
    installPath: "~/.local/bin/usage-reporter",
    restartHook: null,
  },
  {
    slug: "install-usage-reporter",
    bundledPath: "/app/fleet-substrate/scripts/install-usage-reporter.sh",
    installPath: "~/.local/bin/install-usage-reporter",
    restartHook: null,
  },
  {
    slug: "claude-usage-collector",
    bundledPath: "/app/fleet-substrate/scripts/claude-usage-collector.py",
    installPath: "~/.local/bin/claude-usage-collector",
    restartHook: null,
  },

  // --- user-onboarding/ (1 row) ---
  // The .service unit file must land in ~/.config/systemd/user/ on every
  // managed host. runBootstrapForHost runs `systemctl --user daemon-reload`
  // unconditionally at the start of each sweep, so when bytes here change
  // systemd has already re-read the unit before the restart hook fires.
  {
    slug: "agent-supervisor-service-unit",
    bundledPath: "/app/fleet-substrate/user-onboarding/agent-supervisor.service",
    installPath: "~/.config/systemd/user/agent-supervisor.service",
    restartHook: "agent-supervisor.service",
  },
] as const;
