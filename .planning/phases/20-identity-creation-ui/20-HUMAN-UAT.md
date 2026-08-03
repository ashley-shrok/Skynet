---
status: partial
phase: 20-identity-creation-ui
source: [20-VERIFICATION.md]
started: 2026-08-03T05:15:00Z
updated: 2026-08-03T05:15:00Z
---

## Current Test

[awaiting human testing — deploy-gated]

## Tests

### 1. Birth a real test identity on a remote host end-to-end
expected: All 5 steps tick green, pane switches to new session, fresh identity's `/id create-path` fires
result: [pending]

### 2. Self-birth on skynet-ec2 (local-exec branch)
expected: Birth completes using local `child_process.exec` rather than SSH; session opens and `/id` fires
result: [pending]

### 3. Skynet-side collision block
expected: Create a name that already exists in the identities table → inline red "Already exists in Skynet" appears under name field; Create button stays disabled
result: [pending]

### 4. Target-host-side collision block
expected: Name whose `~/.claude/identities/<name>/` folder exists on target host → inline red "Already exists on `<hostname>`" appears; Create button stays disabled
result: [pending]

### 5. Failure blurb at each step
expected: Kill SSH mid-step-2 → step 2 shows red X, failure blurb text matches CONTEXT.md spec verbatim, modal stays open, no auto-retry
result: [pending]

### 6. Avatar Generate/Regenerate loop in browser
expected: 3 horizontal gamma-corrected candidate images render; clicking each picks it (visual ring); Regen produces visually different set; Create disabled until a candidate is picked
result: [pending]

### 7. Voice picker sample playback in new modal
expected: Clicking Volume2 icon plays a short audio sample via `postSpeak`
result: [pending]

### 8. Focus-follow on successful birth
expected: Modal closes and conversation-list view switches to the newly-birthed session tab automatically
result: [pending]

### 9. Cancel button is ABSENT during birth and reappears after failure
expected: No Cancel button visible while birth SSE stream is in-flight; Cancel reappears after failed step so user can close
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps
