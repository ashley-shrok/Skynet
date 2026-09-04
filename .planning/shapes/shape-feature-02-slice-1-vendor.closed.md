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

---

## Close-Out

**Closed:** 2026-09-04
**Vehicle used:** inline (harness task tracking) — single atomic commit 6e19c839 on feat/tab-title-from-tmux
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · canonical copy of the 15 items lives at /substrate; Dockerfile copies it into the built image
- **Shape: truth moves into Skynet's code tree at a top-level folder mirroring install layout** — present · new /substrate/{skills,scripts}/ at repo root mirrors ~/.claude/skills/ and standalone-scripts install shape
- **Shape: image build learns to copy that folder into a known place inside the built image** — present · Dockerfile line 79 adds COPY --chown=node:node substrate /app/fleet-substrate
- **Shape: image build stays self-contained (reproducible from fresh clone, no fleet deps, no network at build)** — present · only local COPY used; no curl/git-submodule/network fetch introduced
- **Shape: nothing runs the equipment differently yet** — present · no entrypoint/service/reconcile changes; nothing calls into /app/fleet-substrate at runtime
- **Philosophy: single source of truth in app's own repo** — present · no artifacts repo, no submodule, no build-time fetch — Skynet repo owns it
- **Philosophy: vendored layout mirrors install layout** — present · skills/ vs scripts/ split matches managed-host layout
- **Philosophy: substrate as a peer of application source, not tucked in docker inputs** — present · substrate/ sits at repo root, not under docker/
- **Philosophy: no behavior change in this slice** — present · commit touches only shape doc, one Dockerfile line, and vendored bytes
- **Prior context: harness-auth vendored is the setup-token + settings.json body, not the /login-based pre-redesign baseline** — present · vendored SKILL.md is byte-identical to staging (redesigned body) and matches the described flow; the pre-redesign-baseline sibling was excluded
- **Prior context: sibling files (README.md, REDESIGN-NOTES.md, SKILL.md.pre-redesign-baseline, user-onboarding/) do not vendor** — present · none of these appear in /substrate or in the commit
- **Prior context: all 15 items land — identity system, messaging surface, seven single-file skills, six standalone scripts** — present · 9 skill folders (id + 3 companions, agent-relay + recv.sh, plus 7 single-file skills) and 6 helper scripts — 19 files total
- **What would make it wrong: image build reaches out to the tailnet or the role folder during build** — present · guarded — Dockerfile change is a local COPY only, no network calls added
- **What would make it wrong: vendored layout doesn't mirror install layout** — present · guarded — skills/ vs scripts/ split preserved; internal folder shape matches host layout
- **What would make it wrong: sibling metadata files ride along by accident** — present · guarded — no README.md, REDESIGN-NOTES.md, SKILL.md.pre-redesign-baseline, or user-onboarding/ in the vendored tree
- **What would make it wrong: image ends up NOT containing substrate at the expected location** — present · guarded — .dockerignore does not exclude substrate/; Dockerfile line copies it to /app/fleet-substrate/; commit message asserts a temp-tagged build showed 19 files at expected paths and correct ownership
- **What would make it wrong: behavior changes leak in** — present · guarded — commit adds no runtime code, no push mechanism, no entrypoint changes; only bytes-on-disk and one COPY line
- **Scope edges IN: 15 items in tree, image copy step, sanity check, commit on working branch** — present · all four IN items delivered in atomic commit 6e19c839 on feat/tab-title-from-tmux
- **Scope edges OUT: reconcile loop, host-table column, admin surface, push, self-update-block retirement** — present · none of these appear in the commit — correctly deferred to later slices
- **Scope edges OUT: per-identity CLAUDE.md manifest** — present · no manifest-templating code introduced
- **Scope edges OUT: fleet-substrate-artifacts github repo (task #22)** — present · no separate artifacts repo — in-tree vendoring replaces it as intended
- **Scope edges DEFERRED: staging area at ~/.claude/roles/box-maintainer/substrate/ not pruned** — present · staging area still intact with all its contents including the excluded sibling files

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Clean slice. Every one of the 19 vendored files is byte-identical to the staging area at `~/.claude/roles/box-maintainer/substrate/` (verified via diff -q). Commit is tightly scoped: shape doc + one Dockerfile line + vendored bytes, nothing else. The 'lightweight sanity check' from the IN scope is documented in the commit message rather than committed as a script (commit asserts a temp-tagged build showed 19 files at expected paths, correct ownership, and the redesigned harness-auth body); the image itself is not retained locally, so the check exists as an assertion in commit history — consistent with the 'quiet slice' philosophy. Working tree has an unrelated stray folder named `""/` with a `.tmp` file at repo root; it is untracked and NOT part of the slice's commit — noted for hygiene only. This slice sets up later slices cleanly: canonical path `/app/fleet-substrate/` inside the image, mirrored install layout, no translation glue needed for rsync/byte-compare.
