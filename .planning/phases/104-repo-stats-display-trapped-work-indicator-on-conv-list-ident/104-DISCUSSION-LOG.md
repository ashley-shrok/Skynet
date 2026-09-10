# Phase 104 — Discussion Log

Human-reference log; NOT consumed by downstream agents (they read CONTEXT.md).

## Session context

- **Opened via**: `/build repo-stats-display` → `/open` (shape file) → `/gsd:phase add` (slot 103, rescue-rebased to 104 after coord-room collision with tabitha's P103) → `/gsd:discuss-phase 104`
- **Prior artifact**: `.planning/shapes/shape-repo-stats-display.md` (comprehensive; seeded 104-CONTEXT.md verbatim)
- **Codebase scouting**: revealed the actual detection wire path is `claude-session-server`, not `fleet-status` — corrected in CONTEXT.md

## Areas discussed (Ashley: "all three, give me your recommendations")

### 1. Tooltip copy

**Options presented:**
- "Unshipped local work" (shape placeholder, terse)
- "Trapped local work — not yet shipped" (uses Ashley's own "trapped" framing; potentially alarmist)
- "Local work not yet pushed to any remote" (direct, no jargon requirement)
- "Unpushed work in this workspace" (short, git-native, adds workspace context)

**Recommendation given**: "Local work not yet pushed to any remote" — direct answer to what-does-this-icon-mean, no requirement of prior git knowledge.

**Decision**: "**Has** local work not yet pushed to any remote" — Ashley agreed, requested addition of "Has" to lead the sentence.

### 2. First-load behavior

**Options presented:**
- A. Start absent, appear when probe completes
- B. Load-then-render (hold rendering until first probe)
- C. Loading state (spinner/dim placeholder)

**Recommendation given**: A — brief load-window ambiguity accepted as small cost vs. the visual complexity of loading affordance on every row.

**Decision**: A. Agreed.

### 3. Poll cadence

**Options presented:**
- ~30s (match existing fleet-status cadence)
- Slower (60s / 5min)
- Faster (5-10s)
- Manual refresh trigger (git-hook)

**Recommendation given**: ~30s match existing cadence.

**Decision**: ~30s. Agreed. Manual-refresh-trigger deferred as a later optimization idea.

## Deferred ideas (captured for future consideration)

- Manual-refresh-on-git-hook for near-immediate post-push update
- Loading-state affordance if "start absent" turns out to feel wrong in real use
- Non-git VCS support (hg/svn/jj)
- Additional identity surfaces (identity modal header, etc.)
- Pre-convention-identity workspace migration (unrelated concern with its own timeline)

## Claude's discretion (folded into CONTEXT.md, not user-facing decisions)

- Corrected the shape's "fleet-status SSH bundle" language to point at claude-session-server as the actual analog subsystem
- Named `readIdentityBountyCounts` as the mirror-and-then-delete pattern (deletion of the count-read fn is scope, not just its frontend consumers)
- Filled in `<canonical_refs>` with concrete file paths for every artifact the executor needs
- Filled in `<code_context>` naming reusable assets (lucide-react icons already imported, existing avatar-corner slot positioning, palette tokens)
