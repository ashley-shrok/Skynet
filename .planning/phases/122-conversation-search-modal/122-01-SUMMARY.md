# Phase 122 Plan 01 — SUMMARY

**Objective:** Wave 0 empirical checkpoint. Verify Assumption A1 from RESEARCH.md — does `discoverIdentitySessionFile(null, identityKey)` return a non-null path for known-archived identities on t1000, and does the JSONL truly belong to that identity?

**Outcome:** verdict is `go-same-helper`. All 3 probed archived identities (beacon, andromeda, apollo) returned a non-null path, and each first-user command-args tag matched the identity name. See `122-01-CHECKPOINT-RESULTS.md` for the full evidence.

**Wave 1 implications:**
- Use `discoverIdentitySessionFile` uniformly for live AND archived identity keys — no branching in the corpus-discovery path.
- The archive-vs-live distinction comes from WHICH enumerator surfaced the key (`listIdentityKeysOnHost` for live, `listArchivedIdentityKeysOnHost` for archived), not from any transcript-side signal.
- No sidecar file needed. No mtime-fallback walker needed. Skip the corresponding `go-mtime-fallback` / `go-sidecar-required` implementation branches.
- Search response should carry `isArchived: true` per result (sourced from the enumerator, not the JSONL) so the frontend can route archived-result clicks to the D-15 "coming soon" alert.
