# Shape: on-disk tree consolidation

**Opened:** 2026-09-09
**Vehicle:** GSD phase

## What this is

Consolidate every piece of on-disk state that describes an identity or a role, along with the working directory each identity actually works in, into one canonical tree in the home directory named after the fleet. Right now the pieces are scattered: identity metadata and role knowledge homes live under a Claude-internal hidden folder, and each maintainer identity's working directory sits as its own separate top-level folder in the home directory. After this shape lands, one folder — the fleet folder — is the sole home for all of it, and every identity's metadata and working directory sit together under that identity's own folder.

## Shape

The fleet folder sits at the home directory root. Underneath it: three siblings. One holds role knowledge homes. One holds identity homes. One holds retired identities — an archive kept as a sibling of the live identities folder rather than nested inside it, so that listing "what identities live on this box" is a direct listing of a single folder with no filtering required.

Inside a given identity's folder, the layout is unchanged from today for metadata: the identity file, the handoff, the wake-up specs and their state, the context-watch state, the role-file-watch state, the relay credentials, the relay cursor — all sitting exactly where they sit today, at the identity folder's root or in the same sub-folders they use today. What's new is a workspace sub-part alongside them: the working directory where the identity does whatever work it does. For a maintainer identity that ends up containing the repository they maintain; for another kind of identity it might contain whatever they need. The workspace has no leaning toward being a code home — it is simply the identity's working directory, whatever that ends up being.

The retirement archive follows the same scope-in-name pattern as its sibling folders: named for the thing it archives. If the concept of archiving ever expands to another category, that new archive follows the same naming rule as its own top-level sibling rather than being nested somewhere ambiguous.

There is no grandfathering. Every existing top-level working directory in the home root that belongs to an identity moves into that identity's folder as its workspace. Every existing metadata folder under the Claude-internal home moves into the new tree. After this shape lands, there is exactly one canonical location for each thing, and code has exactly one path to look at.

## Philosophy

**One canonical home for everything an identity is and everything an identity does.** Today the split between "who I am" and "what I'm working on" is a physical split across two disconnected corners of the home directory. That split has no purpose — it's an accident of how these two things came into being at different times. Bringing them together under a single identity folder makes the identity the atomic unit on disk: to move an identity somewhere else, to archive it, to reason about what it owns, is to think about one folder.

**No dual-path in code — ever.** The migration is manual and per-box; the code has exactly one hardcoded path for each thing after this ships. No compatibility branch, no "try old location, fall back to new," no environment variable to override. A single canonical location is what keeps the code legible and prevents the pattern-check from rotting when someone adds a new script months later and copies whichever branch happened to be first.

**The migration is a coordinated maintenance window per box, not a live-migration.** Each maintainer takes their box down briefly, does the copies, deploys the new code, brings the box back up, and deletes the old locations after they've verified the new tree is live. Copy-then-deploy-then-delete rather than move-in-place gives them a fallback if anything looks wrong: the old locations still exist until they explicitly delete them.

**The workspace is generic.** It is the identity's working directory, full stop. The shape does not name it after code, or after a repo, or after any specific kind of work. Any convention or tooling that assumes the workspace holds code is downstream noise, not part of this shape.

## Prior context

This is Shape 3 of a four-shape campaign that revamps the identity skill. Shape 1 migrated pinned state from the Skynet database to an on-disk sentinel in each identity folder, so that agent-supervisor's idle-scan can read pin state locally without an RPC. Shape 2 extended agent-supervisor with a daily archive scan that retires identities that have gone unused for a threshold period. Both Shape 1 and Shape 2 are code-complete and verified but held from ship until the whole campaign lands together. Shape 4, still to come, is a prose polish pass on the identity skill body and its companion files. This shape lands between: after Shape 2, before Shape 4.

The tree name went through iteration during discussion. The initial instinct was to name it after the fleet manager application, but that name is brand-specific and the same code deploys under different branding on different boxes. Abbreviating the brand to two letters was considered and rejected — the abbreviation still references the brand and reads awkwardly on differently-branded deployments. The word for the collection of agents across all boxes — "fleet" — is brand-neutral, is already the operator's own vocabulary for the thing that lives there, and reads naturally under any deployment.

The archive placement also went through iteration. The initial phrasing put the archive as a top-level sibling of the identities folder. A second reading suggested nesting it inside the identities folder, since archive today is identity-specific. The final decision keeps the archive at the fleet root but names it with a scope prefix — "identities archive" as a folder name — which cleanly generalizes to future archive categories and simplifies the enumeration code that lists live identities (no folder-name filter needed).

## What would make it wrong

**If the code ever has to branch on which pattern to look at.** The whole point of doing this as a coordinated per-box migration is to end with a single canonical path in code. If the id skill body, or agent-supervisor, or any monitor script ends up with an "or check the old location" fallback, this shape has missed the point — dual-path in code is exactly what a manual migration exists to avoid.

**If the workspace picks up a lean toward repos.** Any naming, documentation, or tooling that treats the workspace as "the code home" or "the repo directory" is off-shape. The workspace is the identity's working directory. The maintainer identities happen to work in code; that is coincidence, not shape.

**If the migration leaves both old and new locations live for any length of time longer than a single maintenance window.** The old locations exist during copy-then-deploy-then-delete, but only briefly, and only until the maintainer verifies the new tree is live. A box that leaves the old locations sitting around indefinitely after the migration is off-shape — it invites confusion about which is authoritative and risks accidental writes to the wrong tree.

**If the archive gets nested inside the live identities folder as an implementation shortcut.** The whole point of the scope-in-name archive is that the enumeration code for "live identities" is a clean listing with no filter. Nesting the archive under the live folder because it happens to be one line easier to write reintroduces the exact filter this shape's naming avoids.

**If any part of the tree ends up hidden.** The fleet folder sits visibly at the home root. Nothing in this shape hides identity or role state under a dot-prefixed or otherwise hidden folder. Making the fleet visible is a stated goal.

## Scope edges

**In.** The tree itself, at the home root, named for the fleet. The three siblings underneath (roles, identities, identities-archive). Every identity's metadata migrates from the Claude-internal home into that identity's new folder. Every existing maintainer working directory moves from the home root into its identity's folder as the workspace sub-part. The identity file's internal layout stays exactly as today — no reshape of what sits at the identity folder root versus what sits in sub-folders. Every hardcoded path reference in the identity skill body, in its coordinator companion files, in agent-supervisor, in the four ambient monitor scripts (relay receiver, wake-up scheduler, context-watch, role-file-watch), and in the Skynet backend code that provisions new identities updates from the old locations to the new locations. All of these ship together as one coordinated release. Each box's maintainer executes the copy-deploy-delete sequence during a maintenance window they choose.

**Out.** Any dual-path fallback in code. Any grandfathering of existing working directories at their current locations. Any live-migration technique. Any renaming or reshaping of what sits inside the identity folder today. Any migration of state that isn't already identity-scoped or role-scoped (for example, no touching of unrelated user configuration under the Claude-internal home; only the identity and role sub-trees migrate). Any change to how coordinators are handled — they keep their identity folder and their workspace sub-part like any other identity, empty if unused.

**Deferred.** Any tooling to automate the per-box migration. Any dashboard or UI to inspect the fleet tree from within the Skynet application. Any convention for a workspace that isn't a git repository (the shape allows it, but no runbook or template is written in this phase for non-code workspaces). Any consolidation of the several skills that hardcode paths into a single path helper — the individual hardcoded rewrites in this phase are enough; a shared helper is a later refactor.

**Tempting but no.** A migration script that automates the copy-shutdown-deploy-restart sequence on a box. Tempting because it would make the migration one command; wrong because the coordination of "no sessions are busy right now" is human judgment, not something a script should race against. Each maintainer's box, each maintainer's window.

## Vehicle notes

GSD phase, following the same pipeline shape used for Shapes 1 and 2 in this campaign. The phase covers: identity skill body edits, coordinator companion file edits, agent-supervisor edits, four ambient monitor script edits, and the Skynet backend edit that updates the identity-birth SFTP write target. All of these are path-rewrite work fundamentally, with the id-skill and coordinator prose edits also incorporating the new tree in any prose that mentions specific paths.

Held from ship along with Shapes 1 and 2 until the whole four-shape campaign lands as one coordinated ship moment. At that ship moment, each box's maintainer executes the per-box migration sequence during a maintenance window they coordinate: save all active identities on that box, copy the metadata and working directories to their new locations, shut down the Skynet host, deploy the new Skynet instance (which brings the new substrate assets along), bring the host back up, verify the new tree is live, delete the old locations.

The campaign bounty workspace at the identity-skill-revamp bounty folder holds the campaign shape file, the name-pool tasting artifacts, and any staging or scratch work for the campaign as a whole. This shape file lives alongside the earlier campaign shape files in the shapes folder under the working directory's planning tree, matching the pattern of Shape 1 and Shape 2.

The close-out review, when it runs, walks this shape section-by-section against the built result to confirm every commitment landed and nothing snuck in beyond it.
