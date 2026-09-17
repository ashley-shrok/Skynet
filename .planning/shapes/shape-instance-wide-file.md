# Shape: Instance-wide markdown file loaded by every agent on every managed host

**Opened:** 2026-09-17
**Vehicle:** GSD phase

## What this is

A new tier of persistent instructions that gets loaded into every agent session's context on every managed host of a Skynet instance, layered above the per-user instruction file. It carries the facts that are true for the whole instance — the company running this Skynet, what kind of company it is, brand posture, and whatever other free-form context the admin decides everyone should know. Every user on every host inherits it silently; the admin owns and edits it centrally on the Skynet server. Free-form content — a "twinkie" — no schema on what goes in.

## Shape

**On the Skynet server.** A new field on the branding configuration names the twinkie's filename. The actual bytes live as a markdown file in the same host-side branding directory that already holds branding assets (icons, wordmarks, favicons) — the directory that's already bind-mounted read-only into the Skynet container. Same pattern as icons today: config carries a filename reference, the bytes live in the host-side branding directory.

**Distribution to managed hosts.** The fleet-substrate distributor gains a new catalog entry that reads the twinkie's bytes from the Skynet server's branding directory and pushes them, on its normal sweep schedule, to every managed host under that Skynet's care — landing at the system-level location Claude Code natively reads for managed-policy content, owned by root, readable by everyone, writable by no one but root.

**On the managed host.** Nothing on the agent side. Claude Code discovers the file at every session start automatically and loads its content into context above the per-user instruction file. Agents inherit the twinkie silently — no wake-up path change, no id-skill change, no read step.

**Editing.** The admin SSH-es into the Skynet server and edits the file directly. No admin UI. The next scheduled distributor sweep propagates it to every managed host.

**Not-user-editability.** On managed hosts the file is root-owned and read-only for the OS user that agents run as. Even if someone tampered, the distributor's next sweep would stomp the drift back to canonical. The chain from admin-edits-on-server → managed-host is strictly one-way.

**Per-instance-not-per-host.** Every managed host of a given Skynet instance sees the same content. Different Skynet instances see different content — because each Skynet server has its own host-side branding directory, entirely local, never shared through the repo. The two current forks (the user's on t1000, Aither's on T800) each maintain their own twinkie locally; a `git pull` between them never touches it.

## Philosophy

- **Use what Claude Code already provides.** Managed-policy instruction loading is a native mechanism on the CLI running across the fleet. Verified this session across three hosts and two auth flavors. No reinvention.
- **Free-form content, admin-authored.** No schema, no template, no variable substitution. Whatever the admin writes is exactly what every agent reads.
- **Per-instance, not per-host.** Instance-wide means every agent on every host of that instance sees the same content. Content that isn't universally true at that scope belongs one tier down.
- **Read-only from every angle except the admin.** No per-user override, no per-agent override, no per-role override. One direction only: admin → server → distributor → every managed host.
- **Distributor stays a dumb byte-mover.** No framing added, no headers, no annotations, no transformation. The admin's bytes are the agent's bytes.
- **No admin UI.** Deliberate — matches branding's current stance. The value is the mechanism landing, not a form.
- **Optional, not required.** A Skynet instance without a twinkie boots and runs the same as one with. No boot gate.

## Prior context

- The CLI running across the fleet (same version, 2.1.150, on every managed host) natively loads a managed-policy instruction file from a system-level path on session start. Loads BEFORE the per-user file, layered additively, cannot be excluded. Primary-source-verified against the official memory documentation; empirically PASS on three hosts across two auth flavors (subscription OAuth on t1000 and T800, Bedrock via IAM on a beta VM). Same mechanism, same behavior everywhere.
- Branding already establishes the pattern this piece slots into. The branding configuration holds filename references; the bytes live in a host-side branding directory bind-mounted read-only into the container; per-file fallback to bundled defaults; the loader never throws so the branding API can't crash at request time. All of that pattern is directly reusable for the twinkie's config field, with one deliberate departure: no bundled default.
- The distributor already sweeps every managed host and pushes files from the Skynet server to them, on a schedule. Every file it currently pushes lands under the OS-user's home directory. The twinkie is the first item that needs a push to a system-level path, which means the distributor's push shape needs to grow to handle a system-path install target — root-owned on the managed side.
- Each Skynet fork maintains its own host-side branding directory. Content is per-instance already, entirely local to each server. Nothing about instance-level content needs to live in the shared repo.
- The Skynet admin surface today has no in-UI branding editor — branding is entirely SSH-and-file-edit. The twinkie inherits that stance.

## What would make it wrong

- **If it becomes user-editable in practice.** An admin talks themselves into hand-patching the file on a managed host rather than on the Skynet server, drift isn't caught, an agent starts reading altered instance-facts. Every layer in the chain has to hold: root ownership on the managed side, distributor stomping drift on next sweep, admin discipline on the server side.
- **If two Skynet instances end up shipping identical content by accident.** Would mean someone tied the source-of-truth to a shared repo location instead of keeping it host-side per instance. Content must never live in the repo.
- **If a failed sweep goes unnoticed and stale content sits on a managed host.** Silence-is-success shouldn't cover failed pushes for this file. The distributor's existing error surfacing needs to cover the twinkie's push the same way it covers every other item.
- **If the tier becomes a dumping ground.** Role-specific, user-specific, or agent-specific content bleeds in and pollutes what should be universal. If a piece of content isn't true for every agent on every host of the instance, it belongs one tier down, not here.
- **If the distributor tries to be smart about content.** Inserts a header, appends a generated-at footer, wraps the markdown in framing, does variable substitution. The admin's bytes must be the agent's bytes, verbatim, or the file lies about its own identity.
- **If a boot gate treats it as required.** The tier is optional; treating it as required would mean a Skynet instance without a twinkie fails to boot, which contradicts the whole "each admin decides whether they want this" stance.

## Scope edges

**In:**
- A new field on the branding configuration referring to the twinkie's filename.
- Loading that field through the existing branding config loader, with the same byte-cap discipline branding already applies to config files.
- A new catalog entry for the fleet-substrate distributor pointing at the twinkie file.
- Distribution mechanism growth: pushing to a system-level path on managed hosts (first substrate item to require root write on the managed side).
- Tests across the schema, loader, catalog, and push paths.

**Out:**
- Any change to the id skill or any agent wake-up read step. The CLI loads managed-policy content natively; agents inherit it silently.
- Any admin UI for editing. SSH-and-file-edit is the whole editing surface, matching branding's current stance.
- Any manual "push now" affordance. Next scheduled distributor sweep is the propagation model.
- Bundled default content in the container image. When the field is unset or the file is missing on the Skynet server, distributor pushes nothing and the managed host has no managed-policy file at all — a clean unset state. Deliberate departure from the branding-asset pattern which does bundle defaults.
- Per-host variance within an instance. The tier is instance-uniform.
- Any templating, variable substitution, or content transformation.
- Propagation to non-managed hosts. Only hosts the distributor already sweeps get the file.

**Deferred / tempting-but-no:**
- Per-role or per-agent instruction overrides layered on top of this tier. Interesting later; not part of this shape.
- Delivering the content via the alternative native mechanism (inline settings-file key) instead of a standalone file. The standalone file is cleaner and matches the branding pattern; the alternative is a fallback only if the file mechanism ever fails us later.
- An in-UI admin editor for the twinkie. Deferred to whenever a Skynet admin surface returns broadly.

## Vehicle notes

**Chosen vehicle: GSD phase.** Scope spans the branding configuration schema, the branding config loader, the fleet-substrate distributor catalog and push shape, first-of-its-kind root-write plumbing on managed hosts, and tests across all of it. Multi-file, cross-subsystem, more surface than a quick task should carry.

**Handoff notes for the implementer:**

- Working tree: `~/skynet-tina` on the current feature branch. Per role standing directive: `git pull --rebase` before every push (multi-identity role).
- Seed discuss-phase from THIS file per fleet build rule — the shape's "what / how / why" is already captured here; don't re-elicit.
- Working identity: mercury on t1000 (this session).
- Primary sources verified this session: Claude Code memory documentation (managed-policy system-path exact location, load-order precedence above the user file, cannot-be-excluded semantics, additive layering) plus three empirical PASS tests confirming behavior uniformly across subscription-OAuth and Bedrock-IAM auth flavors on separate hosts.
- Branding-side patterns to mirror: the existing config loader's read-time load, per-file fallback to bundled defaults, and never-throws contract for the branding API. For the twinkie, the "bundled default" leg of that pattern is intentionally absent — see scope edges.
- Distributor-side new capability: pushing to a system-level path (owned by root on the managed host) rather than under the OS-user's home directory. First substrate item to require this — the catalog entry and push shape need to grow to accommodate.
- Deploy discipline (per role standing directives): after code + scoped tests green, the push → build → recreate → verify sequence happens as one atomic motion on the user's greenlight, not before push.

**Content of the twinkie for THIS instance (t1000) is not part of this build.** The mechanism is what gets built; the content the user'll write once the plumbing lands.
