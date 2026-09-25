/**
 * catalog.ts — Hand-maintained catalog of the fleet-substrate items that the
 * per-host sweep in Plan 03 will iterate over.
 *
 * SHAPE SOURCE OF TRUTH:
 *   .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 *   (and, via that CONTEXT.md, the locked feature-02 design doc under
 *    ~/fleet/roles/box-maintainer/bounties/ai-plus-mvp-project/
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
 * ROW-COUNT RECONCILIATION (19 items vs. 52 rows):
 *   The shape doc counts "15 items" — that was 7 single-file skills + 1 skill
 *   with 1 companion (agent-relay: SKILL.md + recv.sh) + 1 skill with 3
 *   companions (id: SKILL.md + actor-status-prompt + clone-picker-prompt +
 *   coordinator-instructions) + 6 helper scripts. claude-code-harness-auth
 *   was subsequently removed, bringing the single-file skill count to 6.
 *   Phase 92 appends fleet-status-sweep and Phase 95 appends
 *   pv-context-pct-sweep, bringing the conceptual helper-script count to 8.
 *   The mega-monitor phase adds a ninth helper script — `ambient-monitor` —
 *   bringing the conceptual count to 16. (As of 2026-09-14 the
 *   agent-supervisor, not the agent, launches ambient-monitor; that changed
 *   the caller, not the row count.)
 *   The byte-compare mechanism in Plan 03 pushes files, not "items",
 *   so this catalog has one row per file. The bootstrap bounty adds 1 more
 *   row (agent-supervisor.service):
 *     - 1 row for id/           (SKILL.md; 3 companions retired 2026-09-20
 *       with coord-as-mode retirement — coordinator became its own role)
 *     - 2 rows for agent-relay/ (SKILL.md + recv.sh)
 *     - 2 rows for the single-file skills (queue, role) — backlog, bounty,
 *       and next-bounty retired 2026-09-20 with the bounty-concept
 *       retirement; promote-to-coordinator retired 2026-09-20 with the
 *       coord-as-mode retirement
 *     - 1 row for image-gen skill (Phase 116 file-drop broker SKILL.md)
 *     - 26 rows for app-development/ (SKILL.md + 5 helper scripts +
 *       20 starter-template files including a pre-generated initial
 *       Drizzle migration; first-class-apps campaign shape 1, 2026-09-17)
 *     - 11 rows for helper scripts under scripts/
 *       (role-file-watch is one of the four ambient watchers, all four
 *       spawned as children of ambient-monitor rather than launched
 *       individually per identity;
 *       fleet-status-sweep is the Phase 92 batch sweep for the fleet-status
 *       poller; pv-context-pct-sweep is the Phase 95 batch sweep for the
 *       PV context-pct poller;
 *       image-gen is the Phase 116 file-drop broker helper)
 *     - 1 row for user-onboarding/agent-supervisor.service
 *     - 1 row for instance-policy-claude-md (Phase 114 twinkie — runtime-sourced,
 *       system-root-installed)
 *   Total = 45 (was 52 before 2026-09-20 retirements — 3 bounty-adjacent
 *   skills, 3 id/ coord companions, and promote-to-coordinator).
 *
 * TWO NEW AXES (Phase 114 D-12 + RESEARCH.md § Pattern 1):
 *   Phase 114 introduces two orthogonal axes to CatalogEntry:
 *
 *   1. `sourceKind` (values: bundled | runtime) — DISCRIMINATED UNION on this
 *      axis because it fundamentally changes which source-side fields are present:
 *        - BundledCatalogEntry (51 of the 52 rows) carries `bundledPath`
 *          (bytes live at /app/fleet-substrate/… inside the image, static).
 *        - RuntimeCatalogEntry (the Phase 114 twinkie row) carries `resolverKey`
 *          (bytes resolved at sweep time by looking up the key in the
 *          composer's `deps.resolvedRuntimeBytes` map). The catalog stays
 *          runtime-free per PURE-LIB DISCIPLINE — the resolver key is a
 *          lookup string, not a function.
 *      The discriminated-union shape gives the type-checker the strongest
 *      guarantee that the 51 bundled rows can never accidentally be treated
 *      as runtime rows (no resolverKey field) and vice-versa (no
 *      bundledPath access on runtime rows without narrowing).
 *
 *   2. `installMode: "user-home" | "system-root"` — OPTIONAL FIELD with
 *      default "user-home" because it only affects post-write behavior
 *      (path quoting + ownership + directory creation), not source shape.
 *      The 51 bundled rows omit the field and inherit the "user-home" default,
 *      keeping the diff minimal. The twinkie row sets it explicitly to
 *      "system-root" (writes to /etc/claude-code/CLAUDE.md root:root 0644,
 *      gated on hosts.username === "root" per Plan 05).
 */

/**
 * A single reconciled fleet-substrate item, bundled-source variant: the
 * bundled bytes inside the container image, the target install path on a
 * managed host (relative to the ubuntu user's HOME by default), and — if the
 * item needs re-execution to take effect after its bytes change — the systemd
 * --user unit to restart.
 */
export interface BundledCatalogEntry {
  /**
   * Unique kebab-case identifier, used only in log lines and test assertions.
   * Not written to disk on the managed host.
   */
  slug: string;

  /**
   * Discriminant: bundled rows carry `bundledPath`; the source bytes live
   * statically inside the container image at that path.
   */
  sourceKind: "bundled";

  /**
   * Absolute path inside the container image where the canonical bytes live.
   * Always under /app/fleet-substrate/ (established by slice 1).
   */
  bundledPath: string;

  /**
   * Target path on the managed host. For `installMode: "user-home"` (default),
   * expressed with a leading "~/" that the remote shell will expand against
   * the ubuntu user's HOME. Skill entries land under ~/.claude/skills/<slug>/…
   * and helper scripts under ~/.local/bin/<name>.
   */
  installPath: string;

  /**
   * Where the file is installed on the managed host. Optional; defaults to
   * "user-home" (path prefixed `~/`, ubuntu-user-owned, no root elevation
   * needed). Existing bundled rows omit this field. Future bundled rows MAY
   * opt into "system-root" if they need an absolute path under /etc/ or
   * similar — the discriminant here is orthogonal to sourceKind.
   */
  installMode?: "user-home" | "system-root";

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
 * A single reconciled fleet-substrate item, runtime-source variant: the
 * source bytes are NOT static in the container image. Instead, the sweep
 * composer looks up `resolverKey` in a pre-resolved runtime-bytes map
 * (`deps.resolvedRuntimeBytes`) that a caller populates ONCE per sweep at
 * orchestrator scope. Keeps this data module free of runtime imports per
 * PURE-LIB DISCIPLINE: the resolver is a STRING KEY, not a function.
 */
export interface RuntimeCatalogEntry {
  /**
   * Unique kebab-case identifier, used only in log lines and test assertions.
   * Not written to disk on the managed host.
   */
  slug: string;

  /**
   * Discriminant: runtime rows carry `resolverKey` instead of `bundledPath`.
   * The sweep composer maps the key to a resolver dep at orchestrator wire
   * time; the catalog module stays a pure data + type module.
   */
  sourceKind: "runtime";

  /**
   * Lookup key the composer resolves to source bytes at sweep time. Extend
   * this string-literal union when new runtime rows land (e.g. adding a
   * second runtime resolver later would be `"instance-policy" | "other-key"`).
   */
  resolverKey: "instance-policy";

  /**
   * Absolute path on the managed host where the file is installed. For
   * `installMode: "system-root"` rows this is an absolute path under /etc/
   * (or similar); the remote shell MUST NOT tilde-expand it.
   */
  installPath: string;

  /**
   * Where the file is installed on the managed host. Runtime rows MUST
   * declare this explicitly (no default) because the whole point of adding
   * the runtime source axis was to accommodate a system-root twinkie.
   */
  installMode: "user-home" | "system-root";

  /**
   * Systemd --user unit name to restart after the file's bytes change on the
   * managed host. Null for items with no restart requirement — e.g. the
   * instance-policy CLAUDE.md is discovered natively by Claude Code at every
   * new session start (per Phase 114 D-14 + D-20), so no daemon restart is
   * needed on byte change.
   */
  restartHook: string | null;
}

/**
 * Discriminated union on `sourceKind`. Bundled rows (51 of the 52) narrow
 * to `BundledCatalogEntry` (bundledPath accessible); the runtime row narrows
 * to `RuntimeCatalogEntry` (resolverKey accessible, no bundledPath).
 *
 * See file-level docstring "TWO NEW AXES" for the type-theory rationale.
 */
export type CatalogEntry = BundledCatalogEntry | RuntimeCatalogEntry;

/**
 * The 50-row hand-maintained catalog. Ordered skills-side first (id,
 * agent-relay, single-file skills, then app-development), then scripts-side,
 * then user-onboarding/ files, then Phase 92 additions (fleet-status-sweep),
 * then Phase 95 additions (pv-context-pct-sweep), then the mega-monitor
 * ambient-monitor launcher, then the Phase 114 twinkie
 * (instance-policy-claude-md — the first runtime-sourced row and the first
 * system-root-installed row).
 * Within skills, multi-file skills (id, agent-relay) appear before single-file
 * skills for reviewability. app-development is a multi-file skill with a
 * bundled starter template — the 26 rows for it are grouped and commented as
 * a single block after the single-file skills to keep the diff clean.
 */
export const FLEET_SUBSTRATE_CATALOG: readonly CatalogEntry[] = [
  // --- id skill (1 row: SKILL.md — companions retired 2026-09-20 with
  //     the coord-as-mode retirement; coordinator became its own role) ---
  {
    slug: "id-skill",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/id/SKILL.md",
    installPath: "~/.claude/skills/id/SKILL.md",
    restartHook: null,
  },

  // --- agent-relay skill (2 rows: SKILL.md + recv.sh receiver) ---
  {
    slug: "agent-relay-skill",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/agent-relay/SKILL.md",
    installPath: "~/.claude/skills/agent-relay/SKILL.md",
    restartHook: null,
  },
  {
    slug: "agent-relay-recv",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/agent-relay/recv.sh",
    installPath: "~/.claude/skills/agent-relay/recv.sh",
    restartHook: null,
  },

  // --- single-file skills (2 rows, one SKILL.md each; promote-to-coordinator
  //     retired 2026-09-20 with the coord-as-mode retirement) ---
  {
    slug: "queue-skill",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/queue/SKILL.md",
    installPath: "~/.claude/skills/queue/SKILL.md",
    restartHook: null,
  },
  {
    slug: "role-skill",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/role/SKILL.md",
    installPath: "~/.claude/skills/role/SKILL.md",
    restartHook: null,
  },
  // Phase 116: file-drop broker skill body — carries the D-17 PHI directive
  // at top primacy plus the D-18 recency echo inline in the invocation
  // section. No restart hook — on-demand-loaded skill file (Claude Code
  // re-reads on next skill invocation).
  {
    slug: "image-gen-skill",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/image-gen/SKILL.md",
    installPath: "~/.claude/skills/image-gen/SKILL.md",
    restartHook: null,
  },

  // --- helper scripts (8 rows prior to Phase 95 addition, 9 total — all under ~/.local/bin/) ---
  // agent-supervisor is the sole entry with a restart hook: bytes must be
  // re-executed for the daemon to run the new version, and its unit is
  // KillMode=process so `systemctl --user restart agent-supervisor` does not
  // reap its supervised tmux sessions.
  {
    slug: "agent-supervisor",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
    installPath: "~/.local/bin/agent-supervisor",
    restartHook: "agent-supervisor.service",
  },
  {
    slug: "wakeup-scheduler",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/wakeup-scheduler.py",
    installPath: "~/.local/bin/wakeup-scheduler",
    restartHook: null,
  },
  {
    slug: "context-watch",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/context-watch.py",
    installPath: "~/.local/bin/context-watch",
    restartHook: null,
  },
  {
    slug: "role-file-watch",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/role-file-watch.py",
    installPath: "~/.local/bin/role-file-watch",
    restartHook: null,
  },
  {
    slug: "usage-reporter",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/usage-reporter.sh",
    installPath: "~/.local/bin/usage-reporter",
    restartHook: null,
  },
  {
    slug: "usage-report",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/usage-report.js",
    installPath: "~/.local/bin/usage-report",
    restartHook: null,
  },
  {
    slug: "claude-usage-collector",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/claude-usage-collector.py",
    installPath: "~/.local/bin/claude-usage-collector",
    restartHook: null,
  },
  // Phase 116: file-drop broker helper for the image-gen skill. On-demand
  // executable — no restart hook. Callers invoke as `image-gen "..."`;
  // helper drops a request file into ~/fleet/image-gen-requests/ and polls
  // for the response before printing paths on stdout / JSON on stderr.
  {
    slug: "image-gen-helper",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/image-gen",
    installPath: "~/.local/bin/image-gen",
    restartHook: null,
  },

  // task-field-check: UserPromptSubmit hook that nudges the agent when its
  // identity file's `task:` frontmatter is still "Untitled conversation".
  // Reads $FLEET_IDENTITY (exported by agent-supervisor.sh into every
  // claude launch env) to locate the identity file; silent no-op if the
  // env var is absent (unsupervised claude sessions) or the field is
  // already filled. Wired via the run-bootstrap.ts settings.json patch —
  // hook execution is driven by ~/.claude/settings.json .hooks.UserPromptSubmit,
  // not by any restart. No restart hook — new bytes picked up on next fire.
  {
    slug: "task-field-check",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/task-field-check.sh",
    installPath: "~/.local/bin/task-field-check",
    restartHook: null,
  },

  // --- user-onboarding/ (1 row) ---
  // The .service unit file must land in ~/.config/systemd/user/ on every
  // managed host. runBootstrapForHost runs `systemctl --user daemon-reload`
  // unconditionally at the start of each sweep, so when bytes here change
  // systemd has already re-read the unit before the restart hook fires.
  {
    slug: "agent-supervisor-service-unit",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/user-onboarding/agent-supervisor.service",
    installPath: "~/.config/systemd/user/agent-supervisor.service",
    restartHook: "agent-supervisor.service",
  },

  // --- fleet-status-sweep (1 row: python batch sweep for fleet-status poller — Phase 92) ---
  // On-demand batch sweep invoked by the fleet-status poller (one exec per host,
  // not one per agent). No restart hook — the sweep is a short-lived script the
  // caller runs on demand, so new bytes are picked up on the next invocation.
  {
    slug: "fleet-status-sweep",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/fleet-status-sweep.py",
    installPath: "~/.local/bin/fleet-status-sweep",
    restartHook: null,
  },

  // --- pv-context-pct-sweep (1 row: python batch sweep for PrettyView context-pct — Phase 95) ---
  // On-demand batch sweep invoked by claude-session-server.ts contextPctTimer per WS per 3s tick.
  // Collapses up to 4 tail -c execs per identity per tick down to 1 exec per WS per tick.
  // No restart hook — short-lived on-demand script; new bytes are picked up on next invocation.
  {
    slug: "pv-context-pct-sweep",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/pv-context-pct-sweep.py",
    installPath: "~/.local/bin/pv-context-pct-sweep",
    restartHook: null,
  },

  // --- app-development skill (26 rows: SKILL.md + 5 helper scripts + 20 starter template files) ---
  // First-class-apps campaign, shape 1 (2026-09-17). Ships the canonical
  // app-development skill that teaches fleet agents to build user-facing apps
  // under ~/fleet/apps/<slug>/. The skill folder on managed boxes lands at
  // ~/.claude/skills/app-development/. No restart hook — skills are read at
  // /id load time; new bytes land on the identity's next recycle.
  // The 20 template files include a pre-generated initial Drizzle migration
  // (SQL + meta journal + meta snapshot) alongside the 17 source files.
  {
    slug: "app-development-skill",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/SKILL.md",
    installPath: "~/.claude/skills/app-development/SKILL.md",
    restartHook: null,
  },
  {
    slug: "app-development-bootstrap",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/bootstrap.sh",
    installPath: "~/.claude/skills/app-development/bootstrap.sh",
    restartHook: null,
  },
  {
    slug: "app-development-create-app",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/create-app.sh",
    installPath: "~/.claude/skills/app-development/create-app.sh",
    restartHook: null,
  },
  {
    slug: "app-development-archive-app",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/archive-app.sh",
    installPath: "~/.claude/skills/app-development/archive-app.sh",
    restartHook: null,
  },
  {
    slug: "app-development-restore-app",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/restore-app.sh",
    installPath: "~/.claude/skills/app-development/restore-app.sh",
    restartHook: null,
  },
  {
    slug: "app-development-backup-app",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/backup-app.sh",
    installPath: "~/.claude/skills/app-development/backup-app.sh",
    restartHook: null,
  },
  {
    slug: "app-development-template-gitignore",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/.gitignore",
    installPath: "~/.claude/skills/app-development/templates/app-starter/.gitignore",
    restartHook: null,
  },
  {
    slug: "app-development-template-readme",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/README.md",
    installPath: "~/.claude/skills/app-development/templates/app-starter/README.md",
    restartHook: null,
  },
  {
    slug: "app-development-template-service",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/app-SLUG.service.template",
    installPath: "~/.claude/skills/app-development/templates/app-starter/app-SLUG.service.template",
    restartHook: null,
  },
  {
    slug: "app-development-template-app-json",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/app.json",
    installPath: "~/.claude/skills/app-development/templates/app-starter/app.json",
    restartHook: null,
  },
  {
    slug: "app-development-template-drizzle-config",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/drizzle.config.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/drizzle.config.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-package-json",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/package.json",
    installPath: "~/.claude/skills/app-development/templates/app-starter/package.json",
    restartHook: null,
  },
  {
    slug: "app-development-template-app-css",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/app.css",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/app.css",
    restartHook: null,
  },
  {
    slug: "app-development-template-app-html",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/app.html",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/app.html",
    restartHook: null,
  },
  {
    slug: "app-development-template-db-index",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/lib/server/db/index.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/lib/server/db/index.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-db-schema",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/lib/server/db/schema.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/lib/server/db/schema.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-layout",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/routes/+layout.svelte",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/routes/+layout.svelte",
    restartHook: null,
  },
  {
    slug: "app-development-template-page-server",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/routes/+page.server.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/routes/+page.server.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-page-svelte",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/routes/+page.svelte",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/routes/+page.svelte",
    restartHook: null,
  },
  {
    slug: "app-development-template-favicon",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/static/favicon.svg",
    installPath: "~/.claude/skills/app-development/templates/app-starter/static/favicon.svg",
    restartHook: null,
  },
  {
    slug: "app-development-template-svelte-config",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/svelte.config.js",
    installPath: "~/.claude/skills/app-development/templates/app-starter/svelte.config.js",
    restartHook: null,
  },
  {
    slug: "app-development-template-tsconfig",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/tsconfig.json",
    installPath: "~/.claude/skills/app-development/templates/app-starter/tsconfig.json",
    restartHook: null,
  },
  {
    slug: "app-development-template-vite-config",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/vite.config.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/vite.config.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-migration-sql",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/drizzle/0000_panoramic_micromax.sql",
    installPath: "~/.claude/skills/app-development/templates/app-starter/drizzle/0000_panoramic_micromax.sql",
    restartHook: null,
  },
  {
    slug: "app-development-template-migration-journal",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/drizzle/meta/_journal.json",
    installPath: "~/.claude/skills/app-development/templates/app-starter/drizzle/meta/_journal.json",
    restartHook: null,
  },
  {
    slug: "app-development-template-migration-snapshot",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/drizzle/meta/0000_snapshot.json",
    installPath: "~/.claude/skills/app-development/templates/app-starter/drizzle/meta/0000_snapshot.json",
    restartHook: null,
  },

  // Pane-safe starter files (2026-09-25) — Ivory's proven pattern packaged
  // into the scaffold so a first-try agent gets pane-safety without knowing
  // the mechanism. pane.ts + server.js carry `__HOSTID__` / `__SLUG__`
  // markers that create-app.sh substitutes at scaffold time; the other
  // files reference PANE_BASE symbolically. See substrate/skills/
  // app-development/SKILL.md § How the pane mounts your app.
  {
    slug: "app-development-template-lib-pane",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/lib/pane.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/lib/pane.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-hooks",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/hooks.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/hooks.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-hooks-server",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/hooks.server.ts",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/hooks.server.ts",
    restartHook: null,
  },
  {
    slug: "app-development-template-server-js",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/server.js",
    installPath: "~/.claude/skills/app-development/templates/app-starter/server.js",
    restartHook: null,
  },
  {
    slug: "app-development-template-about-page",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/skills/app-development/templates/app-starter/src/routes/about/+page.svelte",
    installPath: "~/.claude/skills/app-development/templates/app-starter/src/routes/about/+page.svelte",
    restartHook: null,
  },

  // --- ambient-monitor (1 row: the single launcher that spawns the four ambient watchers) ---
  // Replaces what were once four separate Monitor invocations (relay receiver, wake-up scheduler,
  // context-watch, role-file-watch) with a single launch. The four watchers stay as their own
  // canonical entries above (still distributed, still on-disk at their existing paths);
  // ambient-monitor invokes them via those entry points.
  //
  // 2026-09-14: the AGENT-SUPERVISOR now starts this, not the agent — one launcher per harness it
  // brings up (fresh / recycle / dormant-wake), passing --inject-to <session> --harness-pid <pid>.
  // In that mode the launcher delivers each wake line INTO the session as a <task-notification>
  // envelope rather than writing to stdout, because with no harness-owned Monitor there is nothing
  // to raise events through. Motivating constraint: one Skynet instance is barred from having the
  // Monitor tool present in harnesses at all, so its identities cannot receive real monitor events.
  //
  // No restart hook, and it deliberately needs none: the supervisor starts a fresh launcher on every
  // harness launch and each launcher dies with the harness it watches, so new bytes land on an
  // identity's next recycle. A restart hook here would be actively WRONG — it would have to kill
  // live launchers, orphaning their identities mid-session.
  {
    slug: "ambient-monitor",
    sourceKind: "bundled",
    bundledPath: "/app/fleet-substrate/scripts/ambient-monitor.py",
    installPath: "~/.local/bin/ambient-monitor",
    restartHook: null,
  },

  // --- instance-policy-claude-md (1 row: Phase 114 twinkie — runtime-sourced, system-root-installed) ---
  // FIRST runtime-sourced row: bytes come from readInstancePolicyBytes() at sweep time
  // (via deps.resolvedRuntimeBytes.get("instance-policy")), NOT from /app/fleet-substrate/…
  // in the container image. See RuntimeCatalogEntry docstring above.
  //
  // FIRST system-root-installed row: writes to /etc/claude-code/CLAUDE.md as root:root 0644.
  // Gated on hosts.username === "root" per Plan 05's D-13 gate — non-root SSH hosts are
  // skipped with a structured sshLogger.info log line and no push is attempted. Non-root
  // hosts will receive the twinkie automatically on their next sweep once they migrate to
  // root-SSH (via the box-maintainer org-migration bounty).
  //
  // restartHook: null because Claude Code discovers managed-policy at every new session start
  // natively (per Phase 114 D-14 + D-20 + code.claude.com/docs/en/memory) — no daemon to
  // restart. Running sessions do NOT reload mid-session; that's expected behavior.
  {
    slug: "instance-policy-claude-md",
    sourceKind: "runtime",
    resolverKey: "instance-policy",
    installPath: "/etc/claude-code/CLAUDE.md",
    installMode: "system-root",
    restartHook: null,
  },
] as const;
