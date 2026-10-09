/**
 * harness-pin.ts — The single Claude Code harness version every fleet host runs.
 *
 * The harness reconciler (harness-reconciler.ts) moves every Linux substrate
 * host to exactly this version on each Skynet lifetime: hosts with no harness
 * get it installed, hosts on any other version (newer OR older) are moved to
 * it. Bumping this string + deploying Skynet moves the whole fleet at once;
 * moving it down is a rollback and works the same way.
 *
 * ALWAYS an exact version — never "latest" / "stable". The whole point is one
 * version across the fleet, chosen on purpose. The harness's own
 * self-updater is disabled fleet-wide (run-bootstrap.ts sets
 * DISABLE_AUTOUPDATER), so nothing moves a host off the pin between sweeps.
 *
 * Skynet never carries the harness bytes: each host fetches them straight
 * from Anthropic via Anthropic's own installer (see harness-script.ts).
 */
export const HARNESS_PIN = "2.1.286";

/** Exact `MAJOR.MINOR.PATCH` — the only pin shape the reconciler accepts. */
export const HARNESS_PIN_PATTERN = /^\d+\.\d+\.\d+$/;
