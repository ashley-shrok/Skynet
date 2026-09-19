# Phase 121: Workspace file browser - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `121-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-09-19
**Phase:** 121-workspace-file-browser
**Areas discussed:** entry point, change semantics (blind vs announced), destructive-action rails, refresh model (snapshot vs live), hidden-file handling, feature scope, multimodal handling (file open), permissions, audience/register, failure-mode framing, vehicle

**Provenance note:** This phase's decisions were extracted via a `/build` → `/open` session with the user (Ashley) rather than through the standard discuss-phase interactive flow. The `/open` grill produced `.planning/shape-workspace-file-browser.md` (Ashley's-conceptual-model style), which drove 121-CONTEXT.md. A tasting prototype at `~/fleet/roles/box-maintainer/bounties/workspace-file-browser/prototype/modal.html` was iterated with the user across two revisions before the shape was locked. The alternatives-and-selections below are reconstructed from that session for audit continuity.

---

## Entry point (how the user reaches the workspace)

| Option | Description | Selected |
|--------|-------------|----------|
| Badge left-click menu | Left-clicking the identity badge opens a small menu (Profile / Bounties / Workspace) → Workspace opens a separate modal | |
| Badge right-click context menu addition | Add Workspace to the existing right-click context menu on the badge | |
| Button inside IdentityModal body | The badge continues to open IdentityModal; a button inside opens the workspace elsewhere | |
| Tab inside IdentityModal (bottom icon-bar section switcher) | New section joins Identity file / Wakeups / [Telegram], follows the existing patch #191 pattern | ✓ |

**User's choice:** Tab inside IdentityModal — "this is sexy. like, i feel like this is exactly where we would want it to be. meaning a part of the identity modal."
**Notes:** Prior badge left-click already opens IdentityModal (patch #87); adding a menu on left-click would break that. The bottom icon-bar tab pattern from patch #191 was the natural fit.

---

## Change semantics — user → agent (blind vs announced)

| Option | Description | Selected |
|--------|-------------|----------|
| Blind | User's actions reach the filesystem directly. Agent finds out when it next looks. Same as SSHing in. | ✓ |
| Announced | Some kind of "user just did X" signal surfaces to the agent (system message in chat, harness event, etc.) | |

**User's choice:** Blind.
**Notes:** Matches the "plain file manager" stance and is load-bearing — any code path that notifies the agent has broken the abstraction.

---

## Destructive-action rails

| Option | Description | Selected |
|--------|-------------|----------|
| No rails | Click delete → gone. Trust the user completely. | |
| Generic confirm on all deletes | Standard "are you sure?" — no smarts about what's being deleted | ✓ |
| Confirm only on risky targets | `.git`, `node_modules`, large folders, big files trigger extra beat; ordinary deletes go through | |
| Some paths protected outright | Certain paths refuse to delete in this UI (would need SSH) | |

**User's choice:** Generic confirm on all deletes.
**Notes:** "as long as there's a confirm that's enough for me on anything." No path-specific smarts.

---

## Refresh model (agent → user)

| Option | Description | Selected |
|--------|-------------|----------|
| Live subscription | Agent writes → user's view updates near-realtime | |
| Poll every N seconds | Cheap, small delay, still automatic | |
| Manual refresh only | Refresh button in the header/toolbar; view is a snapshot until pressed | ✓ |
| Refresh on tab-switch back | Snapshot while active, re-fetch when user leaves + returns | |

**User's choice:** Manual refresh button.
**Notes:** Cheapest, simplest, matches OS file explorer conventions. No websocket or polling infra needed.

---

## Hidden-file handling

| Option | Description | Selected |
|--------|-------------|----------|
| Show everything, no distinction | Dotfiles inline with regular files, no filtering | ✓ |
| Hide by default with toggle | `.git`, `.env`, `node_modules` filtered out; toggle in toolbar brings them back | |
| Show dimmed with visual demotion | Everything visible but dotfiles + noisy folders rendered muted (what the prototype's earlier iteration did) | |

**User's choice:** Show everything.
**Notes:** Matches "just a file manager" stance.

---

## Feature scope (in / out for V1)

| Feature | In V1? |
|---------|--------|
| Recursive browsing + breadcrumb navigation | ✓ |
| Sortable columns (name, size, modified) | ✓ |
| Upload via button AND drag-drop | ✓ |
| New folder, new file | ✓ |
| Rename, delete (with confirm), download | ✓ |
| Text file inline edit (reuses existing editor) | ✓ |
| Markdown file inline edit (reuses existing MarkdownEditor) | ✓ |
| Image file inline view (view-only) | ✓ |
| Manual refresh button | ✓ |
| Host-reachability chip in header | ✓ |
| Search across files | ✗ (deferred) |
| Multi-select + bulk operations | ✗ (deferred) |
| Explicit keyboard nav beyond browser defaults | ✗ (deferred) |
| Syntax highlighting in text editor | ✗ (deferred) |
| Image thumbnails inline in list | ✗ (deferred — view-on-click covers the need) |
| Copy/paste or drag-to-move across folders | ✗ (deferred) |
| Git-aware view (diff, history, status) | ✗ (deferred) |
| Folder-as-zip download | ✗ (deferred) |
| File counts on folder rows | ✗ (deferred) |
| Live subscription / auto-refresh | ✗ (deferred; forbidden — see change semantics) |
| Hidden-file filtering | ✗ (deferred — show everything, no smart hiding) |

**User's choice:** As above. "the image previews would be nice" (view-only) → in. "maybe we could... not include those other features."
**Notes:** Consumer-user register drives the "leave it out" calls — power-user affordances belong absent, not just hidden behind a menu.

---

## Multimodal handling (file open)

| Option | Description | Selected |
|--------|-------------|----------|
| Nested modal on top of IdentityModal | Editor modal opens on top of IdentityModal — preserves browsing context but breaks app's one-modal-at-a-time convention | |
| Modal replacement (app's existing convention) | Editor modal replaces IdentityModal — consistent with app's convention but loses browsing context ("just deal with it") | |
| Inline swap within the Workspace tab body | Tab body swaps from list-mode to viewer-mode with a back affordance — preserves BOTH the one-modal convention AND browsing context | ✓ |

**User's choice:** Inline swap within tab body — "okay if you think we can do that then i'm down for it."
**Notes:** User's initial lean was toward modal replacement for consistency, until the inline-swap option was surfaced. The load-bearing insight: the one-modal convention only fires when the child action opens a SEPARATE modal; a tab-body swap doesn't count as a second modal.

---

## Permissions in multi-tenant deployments

| Option | Description | Selected |
|--------|-------------|----------|
| Chat access = workspace access | Rides on top of the existing per-host access model; no new permission layer | ✓ |
| Owner-only | You only see workspaces of agents on hosts you own. Admins see all. Chat ≠ workspace. | |
| Admin-only | Non-admin users don't see the Workspace tab at all (like Telegram tab today) | |

**User's choice:** Chat access = workspace access.
**Notes:** "as a user you can have any number of hosts assigned to you and as long as you have a host assigned to you then you can work with the agents on it and if you can work with an agent then you can open the workspace tab." Workspace authorization derives from existing per-host access, no new concept introduced.

---

## Failure-mode framing

**Prompt:** "Imagine a user opens the Workspace tab, and within 30 seconds they close it and think 'screw this, I'll just SSH in.' What would have caused that reaction?"

**User's response:** "well i think they're more likely to say screw this i'll ask the agent because all of the users of this app are more like consumer users than like development users like they don't even know what s s h is but to try to answer the question um i mean i don't know the answer is probably that they go in there to do something and they can't actually do it or it's really annoying but i feel like i'm gonna have to use this for a while to figure out what that is."

**Extracted:** (a) audience is consumer-user, not developer — reframes register throughout the feature; (b) failure mode = "went to do something, couldn't do it or it was annoying" — must be complete enough for common needs.

---

## Vehicle

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Too big for inline | |
| Harness plan mode | More than a single planned change | |
| `/gsd:quick` | Phase-sized work needs a phase (per fleet rule) | |
| Single GSD phase | Backend + frontend end-to-end in one phase | ✓ |
| Two GSD phases (backend + frontend split) | Split into phases for peer parallelism | |
| Bounty (park) | User is ready to build | |

**User's choice:** Single GSD phase.
**Notes:** Backend + frontend tied by wire contract; splitting means the backend phase ships endpoints with no consumer. Total surface is modest. No peer-parallelism gain since container mutations serialize at deploy anyway.

---

## Claude's Discretion

- Sort tie-breaker when two rows have equal sort key (implementer's call).
- Exact keyboard behavior beyond browser defaults (as long as no power-user affordance surface is added).
- Refresh button spinner vs subtle pulse during re-fetch.
- Inline upload progress: per-file percentage vs single indeterminate indicator.
- Large-file download strategy: stream vs fetch-into-memory-first.
- Exact wording of delete confirmation prompt (subject to consumer register).
- New-folder/new-file inline prompt: `window.prompt` vs in-tab input row (as long as it doesn't open a separate modal).

## Deferred Ideas

Captured in 121-CONTEXT.md § Deferred Ideas. Notably: search, multi-select, syntax highlighting, image thumbnails inline, cross-folder copy/paste, git-aware view, zip download, file counts, live subscription, hidden-file filtering.

## Explicitly forbidden (violates the stance)

- Any notification to the agent that the user acted (blind is load-bearing).
- Any protected-path or protected-file logic that refuses to let the user delete something.
- Any second modal opened on top of IdentityModal from within this feature.
- Any auto-refresh mechanism.
