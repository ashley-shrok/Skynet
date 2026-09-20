# Phase 122 Plan 01 — Wave 0 Empirical Checkpoint Results

**Assumption tested (A1 from RESEARCH.md):** For at least 3 known-archived identities on host t1000, does `discoverIdentitySessionFile(conn, identityKey)` (LOCAL branch, `conn=null`) still return a resolvable transcript path?

**Investigation method:** Rather than spinning up a `tsx`/`node` shim to import the compiled helper, I replicated its LOCAL-branch algorithm in a small shell script at `/tmp/probe-archived-discover.sh` (throwaway, not committed). The script mirrors `readLocalDiscovery` + `readFirstUserRoleLine` + `__matchesIdentityFirstTurnForTests` exactly:

1. Walk `~/.claude/projects/*/*.jsonl` (one level deep — matches the helper's `readdir(root)` + `readdir(projectDir)`).
2. Sort candidates mtime-descending (matches the helper's `candidates.sort((a,b) => b.mtime - a.mtime)`).
3. Read first 4096 bytes of each candidate; find first line containing `"role":"user"`.
4. Check the byte predicate: `"type":"user"` AND NOT `"tool_result"` AND `<command-name>/id</command-name>` AND `<command-args><identityName>` followed by `<`, ` `, `\r`, or EOL.
5. Return the first path whose first-user-role line satisfies the predicate; else `null`.

The three identities were chosen by listing `~/fleet/identities-archive/` and picking 3 that clearly had substantial activity (all have a claude-projects directory with real JSONLs).

---

## Probe results

| identityKey | `discoverIdentitySessionFile(null, key)` return | Non-null? | First-user command-args tag | Verdict per identity |
|---|---|---|---|---|
| beacon | `/home/ubuntu/.claude/projects/-home-ubuntu-fleet-identities-beacon-workspace/9e294509-4f1b-4025-b79d-8ba646655426.jsonl` (508575 bytes, mtime 2026-09-17 15:35:15Z) | yes | `<command-args>beacon` (matches identity, followed by valid delimiter) | PASS |
| andromeda | `/home/ubuntu/.claude/projects/-home-ubuntu-fleet-identities-andromeda-workspace/f9209a4b-63ab-4094-8732-4edcc884ca9f.jsonl` (868329 bytes, mtime 2026-09-16 06:37:11Z) | yes | `<command-args>andromeda` (matches identity, followed by valid delimiter) | PASS |
| apollo | `/home/ubuntu/.claude/projects/-home-ubuntu-fleet-identities-apollo-workspace/bf044c4f-d2e7-4e79-865a-ce008592a708.jsonl` (2440031 bytes, mtime 2026-09-17 16:56:22Z) | yes | `<command-args>apollo` (matches identity, followed by valid delimiter) | PASS |

**Note on content redaction:** Only the `command-args` tag (the identity name, which is not sensitive) is reported. Actual transcript content is not surfaced in this file per the plan's redaction guidance.

**Coverage rule from plan:** verdict `go-same-helper` requires ≥2 of 3 to return a non-null path AND the first-user line to reference the identity's `/id`. Actual: **3 of 3** — comfortably clears the bar.

---

verdict: go-same-helper

---

## wave-1-implications:

- Wave 1's backend endpoint should invoke `discoverIdentitySessionFile(conn, identityKey)` uniformly for BOTH live-identity keys (from `listIdentityKeysOnHost`) AND archived-identity keys (from `listArchivedIdentityKeysOnHost`). No branching in the corpus-discovery path — the helper handles both cases via the same LOCAL branch (JSONL files remain in `~/.claude/projects/<workspace-slug>/`, which is orthogonal to the archived vs live identity-metadata directory move).
- The archive move is a metadata-only relocation (`~/fleet/identities/<name>/` → `~/fleet/identities-archive/<name>/`). Claude Code's project transcript directory in `~/.claude/projects/` is NOT moved on archive. Wave 1 does not need to look in a special archive path for JSONLs.
- Wave 1 DOES still need `listArchivedIdentityKeysOnHost` (a new helper mirroring `listIdentityKeysOnHost` but rooted at `~/fleet/identities-archive/`) — the identity KEYS to iterate come from the metadata dir, even though their transcripts still live in the standard projects tree. This is what plan 02 already specifies.
- No sidecar file is needed. No mtime-fallback walker is needed. Skip the `go-mtime-fallback` and `go-sidecar-required` implementation branches entirely.
- Search results for archived identities can carry `isArchived: true` in the response payload for the frontend's D-15 "coming soon" alert routing; the archived-vs-live discriminator comes from which enumerator (`listIdentityKeysOnHost` vs `listArchivedIdentityKeysOnHost`) surfaced the key, not from any property of the JSONL itself.
- The three probed identities are all recent (mtimes within the last week) — this doesn't prove behavior for identities archived long ago, but the helper's mtime-based scan doesn't care about age, so this is not a concern.
