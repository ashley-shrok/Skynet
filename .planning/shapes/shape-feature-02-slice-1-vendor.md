# Shape: Vendor the fleet's shared agent equipment into Skynet's code tree and wire the image build to carry it

**Opened:** 2026-09-04
**Vehicle:** inline (harness task tracking)

## What this is

Put a canonical copy of the fleet's shared agent equipment — the skills every agent uses (identity system, messaging surface, seven single-file skills for authoring / coordination / bounty flow, the harness authentication skill) plus six standalone helper scripts (supervisor daemon, wake-up scheduler, context watch, three usage-reporter pieces) — into Skynet's own code tree, and wire the container image build to copy them into a known place inside the built image. This is the foundation slice of feature 02 (Skynet distributor); a later slice adds the reconcile loop that pushes those bundled bytes out to managed hosts.

## Shape

- Today the canonical copy of the 15 items lives in the box-maintainer role folder's substrate staging area — a personal handoff landing zone from when fleet-substrate authorship transferred over from Nicole on 2026-09-02. That's fine as a landing zone, wrong as long-term truth.
- Slice 1 moves the truth into Skynet's own code tree, where it belongs as a first-class part of what Skynet ships. A new top-level folder in the repo holds one copy of each item in a layout mirroring where it eventually installs on a managed host (skills area vs. helper-scripts area).
- The image build learns to copy that folder into a known place inside the built image, so later slices have a stable path to read canonical bytes from at runtime.
- The image build stays self-contained: reproducible from a fresh git clone, no fleet dependencies, no network access during build. Everything it needs sits in the tree it's already building from.
- Nothing runs the equipment differently yet — no reconcile loop, no push, no self-update retirement, no admin surface. The slice ends when a freshly-built image contains the bundled bytes at the known location, and the code tree carries them as canonical source.

## Philosophy

- **Single source of truth in the app's own repo.** No separate artifacts repo, no submodule, no network fetch at build time. The Skynet repo owns the substrate. This is what makes the image reproducible and the distributor's job trivial in later slices.
- **The vendored layout mirrors the install layout.** Skills sit under a skills area, standalone scripts sit under a scripts area — matching what those items look like on a managed host. That mirroring is what lets later slices do byte-compare and rsync without a translation step.
- **The image build carries substrate as a peer of application source, not as a build-side artifact.** The vendored folder lives at the top of the repo, not tucked inside the image-build inputs folder. This signals that substrate IS what Skynet ships — not a build convenience.
- **No behavior change in this slice.** The reconcile loop, admin surface, push mechanism, self-update retirement — all deferred to later slices of feature 02. This slice is quiet: files land in the tree, the image gains one copy step, and nothing about how Skynet runs changes.

## Prior context

- Feature 02 as a whole is design LOCKED — see `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/feature-02-skynet-distributor.md`. This slice is the first of ~4 that make it up.
- The 15 items were transferred to box-maintainer authorship on 2026-09-02 as part of Nicole's handoff. Currently staged at `~/.claude/roles/box-maintainer/substrate/`. Nicole's http server that USED to serve them via self-update fetches has been 404'd since around the same date; every fleet identity is currently running cached copies. This slice does not fix that (later slices do); it just makes Skynet the authoritative home.
- The harness-authentication skill's body was rewritten inline on 2026-09-04 (this session) to the setup-token + settings.json + agent-driven-URL-and-code flow. That is the version slice 1 vendors — not the pre-redesign `/login`-based body.
- Sibling files in the staging area that are NOT part of the 15 — `README.md`, `REDESIGN-NOTES.md`, `SKILL.md.pre-redesign-baseline`, the `user-onboarding/` folder (which belongs to feature 07) — are staging aids and do not vendor.
- The complete set of 15 items enumerated as three groupings:
  - **Identity system (1 skill + 3 companion files)** — the identity-loading skill and its coordinator dispatch / clone picker / actor status companions.
  - **Messaging surface (1 skill + 1 receiver script bundled with it)** — the agent-relay skill plus the ambient receiver every identity runs on wake.
  - **Seven single-file skills** — role authoring, coordinator promotion, bounty capture, queue, next-bounty, backlog, claude-code-harness-auth.
  - **Six standalone helper scripts** — supervisor daemon, wake-up scheduler, context watch, usage-reporter, install-usage-reporter, claude-usage-collector.

## What would make it wrong

- **The image build reaches out to the tailnet or the role folder during build.** If a fresh git clone can't produce the same image, we've lost the property that makes distribution trivial in later slices.
- **The vendored layout doesn't mirror the install layout.** If skills are jumbled with scripts, or the internal folder shape doesn't match what a managed host has under `~/.claude/skills/`, later slices will need translation glue that shouldn't exist.
- **Sibling metadata files ride along by accident.** Vendoring `README.md`, `REDESIGN-NOTES.md`, or `SKILL.md.pre-redesign-baseline` would ship staging-noise as canonical substrate. The vendoring step must be selective, not "copy the whole folder."
- **The image ends up NOT containing the substrate at the expected location.** If the copy step is malformed, or a build-ignore rule excludes the folder, the build "succeeds" but the image is empty at the target location — later slices break silently.
- **Behavior changes leak in.** If the vendoring slice accidentally starts calling into the substrate at runtime, or adds any push mechanism, we've violated the "quiet slice" property — reviewers won't be sure what's actually landing.

## Scope edges

- **IN:** the 15 items land in Skynet's code tree at a top-level folder mirroring install layout; the image build's copy step places them at a stable location inside the built image; a lightweight sanity check that the built image actually contains the expected files; a commit landing this on the current working branch.
- **OUT:** the reconcile loop, the host-table column, the admin surface, the actual pushing to managed hosts, the self-update block retirement — all later slices of feature 02.
- **OUT:** the per-identity CLAUDE.md manifest piece. That's per-identity templating from a per-role list, not byte-identical bundled bytes; different shape, different later slice.
- **OUT:** the fleet-substrate-artifacts github repo (task #22 in the feature doc). Vendoring in-tree replaces the need for a separate artifacts repo entirely; task #22 is moot as of Ashley's 2026-09-04 direction.
- **DEFERRED:** cleanup of the staging area at `~/.claude/roles/box-maintainer/substrate/`. It stays where it is during the transition; git history in Skynet becomes the canonical source once slice 1 lands. Staging area gets pruned once distributor is fully live and every managed host is on the vendored version.

## Vehicle notes

**Vehicle:** inline with harness-task tracking. Slice 1 is genuinely not code-writing: it's an rsync-shaped file move (15 items from the box-maintainer staging area into a new top-level folder in Skynet's tree, minus sibling metadata) plus a one-line copy step added to the image recipe, plus a rebuild + verify + commit. GSD phase ceremony would be overkill for this shape of work; same call Ashley made for feature 07.

Later slices of feature 02 (reconcile loop backend, admin surface, per-identity manifest, self-update retirement) ARE code-writing and will get their own GSD phases as appropriate.

Working dir: `~/skynet-tiffany` (branch `feat/tab-title-from-tmux`, standard box-maintainer working tree).

Related bounty: `ai-plus-mvp-project` (feature 02 lives inside it).
