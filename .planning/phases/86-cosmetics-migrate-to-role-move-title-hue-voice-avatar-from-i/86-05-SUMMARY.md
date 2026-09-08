---
phase: 86-cosmetics-migrate-to-role
plan: 05
subsystem: pretty-view-identity-modal-edit-block
tags:
  - frontend
  - identity-modal
  - inherit-override-affordance
  - tdd
  - d-ctx-86-surface-5
dependency_graph:
  requires:
    - Plan 86-01 (Identity.roleDefaults field on the type + publicIdentity backend merge + explicit-null-in-PUT delete semantic at identities.ts L563-574 + GET /:key/avatar role-folder fallback landed in Wave 1)
  provides:
    - "IdentityModal edit block renders per-field inherit-vs-override affordance layer (Title, Voice, ColorHue, Avatar)"
    - "Four titleReverting / voiceReverting / hueReverting / avatarReverting state slots track pending revert clicks; any true value forces Save dirty"
    - "Draft state seeded from RESOLVED value (identity ?? role default) so inherit-state fields pre-populate from the role"
    - "onSave emits meta.title/voice/colorHue/avatar = null for reverting fields — backend PUT L563-574 translates to frontmatter-key delete (identity falls back to inheriting from role via Plan 86-01 merge)"
    - "Dirty predicate + inherit detection read committed* state (not identity prop) so save-with-revert flips visual state before parent's identity prop re-renders"
  affects:
    - "Wave 3 Plan 86-06 (IdentityModal tests realignment — new inherit/override test file may inform test-scaffolding shape for adjacent IdentityModal tests)"
    - "Future role-cosmetic-edit modal bounty (deferred per Ashley 2026-09-07) — same inherit/override affordance patterns can be reused for cross-role cosmetic authoring"
tech_stack:
  added: []
  patterns:
    - "Per-field revert-pending boolean state (4x useState<boolean>) — cleaner than a single reverting Set<Field> because each field's state reads at its own JSX site without null-check pattern-matching"
    - "Draft-seeding from resolved value (identity ?? role default) so inherit-state input pre-populates without any placeholder-vs-value dance"
    - "Inherit detection reads committed* state, not identity prop, so save-with-revert flips visual before parent re-renders (test scenario tolerant; production sees a fresh prop via applyIdentityChange broadcast)"
    - "Inline render helpers renderInheritedBadge / renderRevertButton — kept inline over shared component because the four call sites live in one JSX block and the shape is deliberately simple"
    - "colorHue GET-verify guard (patch #279) bypassed via `!hueReverting` clause — after a null-delete the backend echo returns the role's colorHue (not null), which would trigger the guard spuriously"
key_files:
  created:
    - src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx (11 tests, ~440 lines)
    - .planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-05-SUMMARY.md
  modified:
    - src/ui/features/pretty-view/IdentityModal.tsx (+~250 lines net: 4 reverting state slots; draft-seed change; inherit/override compute block; renderInheritedBadge/renderRevertButton helpers; per-field JSX affordance strips; onSave revert branches; dirty predicate rewrite; onCancel reset; reset-effect deps widened)
decisions:
  - "Visual pattern for Inherited marker: small warm-toned chip (bg rgba(255,220,170,0.10), border rgba(255,220,170,0.25), text-[10px] uppercase). Aria-label encodes the resolved value ('Inherited from role: <value>') so screen readers + tests can identify which field's marker they're looking at. Text label is 'Inherited' (not 'Inherited (value)' or 'Inherited from role') — the value already appears in the pre-populated input right below, so echoing it in the chip would be visual duplication. Rationale: warm/amber tone matches Skynet's pretty-view visual language + reads as an informational (not interactive) affordance."
  - "Visual pattern for Revert affordance: small cool-toned button (bg rgba(140,180,255,0.08), border rgba(140,180,255,0.25), text-[10px] uppercase, label 'Revert'). Aria-label 'Revert <FieldLabel> to role default' encodes the field so tests can target uniquely (Test 4 / Test 8b / Test 9 all rely on this pattern). Rationale: cool/blue tone contrasts with warm Inherited chip so they're visually distinguishable when a field toggles between states; text-label 'Revert' keeps the button compact (fits inline next to the field label). Icon-only alternative (unlink / X) rejected because tests need aria-label discoverability AND non-icon-language readers benefit from a text hint."
  - "Avatar-revert heuristic: always-visible-when-role-has-avatar (plan's Task 1 Step 5 fallback), NOT backend-echo-driven. Rationale: Plan 86-01 does NOT surface a per-field overrides map in the publicIdentity response — the frontend has no way to detect whether the current identity has its own avatar frontmatter key vs is inheriting. Backend PUT L563-574 doesn't currently handle meta.avatar at all (IdentityMetadata type omits it — JSON.parse pass-through of unknown fields = silent no-op). Frontend still emits `meta.avatar = null` on Revert click so the wire is future-compatible with a backend extension; today it's a no-op that gracefully degrades to 'server no-ops if field was already absent' per plan's exact hedge language."
  - "Inherit detection + dirty predicate + onSave diff logic ALL read committed* state (identity's OWN value, refreshed on save success) rather than the identity prop directly. Rationale: after save-with-revert, applyIdentityChange broadcasts the fresh identity to the parent, but tests mock applyIdentityChange so the parent's identity prop never updates. Reading committed* (which onSave updates from the server echo) means the modal's internal visual state is coherent even when the parent doesn't re-render. Production sees the same result via the fresh prop. Alternative — using identity prop directly — would have made Test 6 unrepresentative of production behavior (the affordances would visually 'lag' by one re-render). committed* is the more robust source of truth."
  - "colorHue GET-verify guard (patch #279 defensive check) skipped when hueReverting=true. Rationale: after sending meta.colorHue = null, the backend's publicIdentity merge returns updated.colorHue = role's colorHue (per identity ?? role ?? null semantics). The guard compares updated.colorHue !== meta.colorHue and would fire spuriously (role's 216 !== null). Adding !hueReverting to the guard preserves the original defensive intent (catch silent multipart-payload no-ops) while letting the revert path succeed."
  - "Draft state initial-seed + reset-effect both changed to use resolved value (identity ?? roleDefaults ?? fallback). Alternative — keep the old seed logic (identity value directly, empty string for null) and only pre-populate on inherit-state via a separate JSX placeholder — was rejected because the plan explicitly calls for 'pre-populated as the placeholder-turned-value' and treating the value as the actual input state (rather than a placeholder) keeps the sample-play / swatch / preview all working on the resolved value automatically without any picker-side changes."
metrics:
  duration: ~79 minutes (start 2026-09-08 07:06:36 UTC, end 2026-09-08 08:25:30 UTC)
  completed_date: 2026-09-08
  tasks_completed: 1
  tests_added: 11 (all in new IdentityModal.inherit-override.test.tsx)
  tests_passing: 19 (11 new + 8 existing IdentityModal.voice.test.tsx as regression guard)
  files_created: 2
  files_modified: 1
---

# Phase 86 Plan 86-05: IdentityModal inherit/override affordance layer Summary

Wave-2 frontend delivery of D-CTX-86-surface-5. Adds the per-field
inherit-vs-override affordance layer to `IdentityModal`'s edit block — each
of the four cosmetic fields (Title, Voice, ColorHue, Avatar) now surfaces
two visible states: (1) UNSET on identity → shows the role's default with an
"Inherited" marker; (2) SET on identity → shows the value with a "Revert to
role default" affordance that, when clicked, deletes the field from the
identity's frontmatter via the explicit-null-in-multipart-PUT convention
Plan 86-01 landed at `identities.ts` L563-574.

## Completed Tasks

| Task | Commits                | Name                                                                  |
| ---- | ---------------------- | --------------------------------------------------------------------- |
| 1    | 73e79c75, d398642a     | Add per-field inherit/override affordances + revert handler (TDD)     |

Task 1 was TDD:
- **RED** (73e79c75) — colocated test file `IdentityModal.inherit-override.test.tsx` with 11 `it()` blocks covering all 10 spec'd scenarios (Test 8 split into 8/8b for inherited-vs-set parallel cases). Confirmed 10 failing before implementation (1 defensive-backstop test passed on the current build — expected).
- **GREEN** (d398642a) — IdentityModal.tsx implementation. All 11 tests + 8 IdentityModal.voice.test.tsx regression tests green.

## What Shipped

### Draft state model

`IdentityModal.tsx` L285-317:

- Four new state slots `titleReverting / voiceReverting / hueReverting /
  avatarReverting` (all `useState<boolean>(false)`) track whether the user
  has clicked the Revert affordance on that field in the current edit
  session. Reset on modal open / Cancel / save success.
- `titleDraft / voiceDraft / hueDraft` initial values re-seeded from the
  RESOLVED value (`identity.X ?? identity.roleDefaults?.X ?? fallback`) so
  inherit-state fields pre-populate with the role's value on modal open.
  The wearer sees what they're currently displaying — matches D-CTX-86-
  surface-5's "always show the RESOLVED value in the preview area."
- `committedTitle / committedVoice / committedHue` still track the
  identity's OWN value (null / "" when the identity is inheriting). The
  inherit-detection and dirty predicate below read committed* rather than
  the identity prop directly.

### Reset-on-open effect (L664-704)

Extended to (a) re-seed drafts from the resolved value (matching initial
state), (b) clear all four `*Reverting` flags, (c) widen the useEffect dep
list to include `identity.roleDefaults?.title/voice/colorHue` so the draft
re-seeds when the role's defaults change under a live modal (e.g., WS-driven
identity refresh on another tab).

### onSave revert branches (L1391-1449)

For each reverting field, the meta payload gets `meta.<field> = null`:

```
if (titleReverting) meta.title = null;
else if (titleDraft !== titleResolvedInitial) meta.title = ...;
```

Where `titleResolvedInitial` is derived from committed* (not the prop
directly) so a re-typed field that happens to equal the role default doesn't
create a redundant override. Similarly for voice + colorHue. Avatar's
revert branch emits `meta.avatar = null` (see "Avatar-revert heuristic"
decision above — no-op on today's backend, future-compatible with a delete
extension).

The colorHue GET-verify guard (patch #279 defensive check) is skipped when
`hueReverting === true` because after a delete the backend echoes back the
role's colorHue (not null), which would spuriously fire the guard.

### onSave success block (L1450-1493)

- Applies the updated identity via `applyIdentityChange` (broadcasts to all
  useIdentities() consumers).
- Re-seeds drafts from the fresh RESOLVED value (updated.title ?? role
  default) so reverted fields display the role's value with the Inherited
  marker on next edit-block open.
- Updates committed* to reflect the identity's new own value (null for
  reverted fields).
- Clears all four `*Reverting` flags.
- Closes the edit drawer (`setEditing(false)`).

### Dirty predicate (Save button disabled, L1994-2020)

Rebuilt as an IIFE to keep the branching readable:

```
const titleResolved = (committedTitle !== "" ? committedTitle : roleDefault) ?? "";
const titleDirty = titleReverting || titleDraft !== titleResolved;
// ... voice, hue, avatar ...
return !(titleDirty || voiceDirty || hueDirty || avatarDirty);
```

- Reads committed* + roleDefaults (not identity prop) — same source of
  truth as the onSave diff logic + inherit detection.
- Any `*Reverting === true` forces dirty (revert of an unmodified field
  IS a dirty change per D-CTX-86-surface-5).
- Color-field baseline uses the identity prop directly because
  committedHue defaults to the `hue` prop when identity.colorHue is null
  (existing behavior, not something this plan changed).

### Inherit-vs-override detection + render helpers (L1548-1620)

- Per-field derived booleans `titleInherited / titleSet / voiceInherited /
  voiceSet / hueInherited / hueSet / avatarRevertAvailable /
  avatarInherited` compute at each render. Read committed* (or identity
  prop for color) so test-time state without prop-refresh still flips
  correctly.
- `renderInheritedBadge(value)` — small warm-toned span with
  `aria-label="Inherited from role: <value>"` and visible text
  "Inherited". Rendered when the field is inherited-and-role-has-default.
- `renderRevertButton(fieldLabel, onRevert)` — small cool-toned button
  with `aria-label="Revert <FieldLabel> to role default"` and visible
  text "Revert". Rendered when the identity has its own value AND the
  role has a default. Clicking sets the corresponding *Reverting flag
  AND resets the draft to the role default.

### Per-field JSX strip (L1962-2085)

Each of the four fields (Title / Voice / Color / Avatar) grew a
label-row strip:

```jsx
<div className="flex items-center mb-1">
  <label htmlFor="...">Title</label>
  {titleInherited && renderInheritedBadge(roleDefaultTitle)}
  {titleSet && renderRevertButton("Title", () => { ... })}
</div>
<input value={titleDraft} onChange={(e) => { setTitleReverting(false); setTitleDraft(e.target.value); }} />
```

The onChange handler on each field clears its *Reverting flag — user edit
cancels the revert-pending state (they're overriding the role default
again with whatever they typed).

Avatar block uses the same shape but the Revert button is placed next to
the "Change avatar…" file-picker button (matches the plan's Task 1 Step 5
placement guidance).

### onCancel (L1499-1522)

Extended to reset drafts to the resolved value (not just committed*) so
Cancel correctly restores to a state where the Save button is disabled
(the dirty predicate reads resolved-baseline, so a Cancel-reset needs to
match). Also clears all four `*Reverting` flags.

## Test coverage

`src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx`
(11 tests):

1. `Test 1` — inherit state renders role's title + "Inherited from role: <value>" marker.
2. `Test 2` — override state renders custom title + "Revert Title to role default" affordance.
3. `Test 3` — defensive backstop: identity title null + role has no title → empty input, no marker.
4. `Test 4` — Revert click flips draft to role default AND marks dirty (Save enabled).
5. `Test 5` — Save-with-revert sends `meta.title === null`.
6. `Test 6` — Post-save echo re-renders field in INHERITED state (role's value visible + marker).
7. `Test 7` — Voice inherited case — VoicePicker receives resolved value (`identity.voice ?? roleDefaults.voice`); sample-play button plays currently-displayed voice.
8. `Test 8` — ColorPicker inherited case — slider bound to role's colorHue + Inherited marker.
8b. `Test 8b` — ColorPicker set case — identity's colorHue wins + Revert affordance.
9. `Test 9` — Avatar Revert affordance always visible when role has an avatar (plan's Task 1 Step 5 fallback heuristic).
10. `Test 10` — Cancel resets all revert-pending state (draft returns to committed values, Save re-disables).

Verification (scoped, per campaign constraint):

```
npx vitest run \
  src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx \
  src/ui/features/pretty-view/IdentityModal.voice.test.tsx
```

Result: `Test Files 2 passed (2) | Tests 19 passed (19)` (11 new + 8
existing voice-picker regression tests).

Additional guards:

- `npx tsc -p tsconfig.json --noEmit` — clean (`IdentityModal.tsx` typecheck
  passes with the widened `type React` import and the four new state slots).
- All 6 acceptance-criteria grep gates pass:
  - `roleDefaults` refs: 26 (≥ 6)
  - `*Reverting` refs: 27 (≥ 8)
  - `Inherited/Revert` refs: 81 (≥ 4)
  - `meta.X = null` matches: 4 code sites (title/voice/colorHue/avatar) (≥ 3)
  - test file `it(` blocks: 11 (≥ 10)
  - typecheck errors in IdentityModal.tsx: 0

## Visual pattern chosen for Inherited marker + Revert affordance

**Inherited marker:** small warm-toned inline chip next to the field's
label. Background `rgba(255,220,170,0.10)`, border
`rgba(255,220,170,0.25)`, text `rgba(255,220,170,0.75)`, font size 10px
uppercase tracking-wide. Text label reads "Inherited". Aria-label encodes
the resolved value: `Inherited from role: <value>` so screen readers +
tests can uniquely identify which field's marker they're looking at.

**Revert affordance:** small cool-toned inline button next to the field's
label. Background `rgba(140,180,255,0.08)`, border
`rgba(140,180,255,0.25)`, text `rgba(180,205,255,0.85)`, font size 10px
uppercase tracking-wide. Text label reads "Revert". Aria-label encodes
the field: `Revert <FieldLabel> to role default`. Clicking sets the
corresponding `*Reverting` flag AND resets the draft to the role default.

**Rationale for the shape (per plan's request for planner discretion on
visual):**

- Warm vs cool tones make the two states visually distinct so a wearer
  glancing at the edit block can tell inherit-vs-override at a glance
  without reading text.
- Warm tone matches Skynet's pretty-view visual language (matches the
  existing IdentityBadge glass-warm treatment); cool tone contrasts with
  it. Both use low-opacity backgrounds so they don't compete visually
  with the primary input control below.
- Text labels ("Inherited", "Revert") kept short (single word each) so
  the strip fits inline next to the field label on narrow viewports.
  Icon-only alternative (unlink / X icons) rejected because tests need
  aria-label discoverability + text hints benefit low-vision + non-
  English readers.
- Aria-labels encode the value + field name explicitly — the plan
  emphasized accessibility (`aria-label="Inherited from role: {value}"`
  per action step 9) and the tests rely on regex matches against these
  aria-labels for stable targeting.

## Avatar-revert heuristic

**Chosen approach: always-visible-when-role-has-avatar** (plan's Task 1
Step 5 fallback), NOT backend-echo-driven.

**Rationale:**

- Plan 86-01 does NOT surface a per-field overrides map in the
  publicIdentity response — the frontend has no way to detect whether
  the current identity has its own avatar frontmatter key vs is
  inheriting.
- Backend PUT L563-574 doesn't currently handle `meta.avatar` at all
  (IdentityMetadata type at identities.ts L53-65 omits it — JSON.parse
  pass-through of unknown fields = silent no-op).
- Frontend still emits `meta.avatar = null` on Revert click so the wire
  is future-compatible with a backend extension; today it's a no-op that
  gracefully degrades to "server no-ops if field was already absent" per
  plan's exact hedge language.
- UX benefit even in no-op mode: the affordance tells the wearer the
  option exists AND the plan's Wave 3 or a future backend patch can
  extend the PUT handler to read + delete the avatar key without any
  frontend change.

## Deviations from Plan

### None to D-CTX-86-surface-5

All six locked "truths" in the plan frontmatter's must-haves-truths block
are landed:

- Each of the four cosmetic edit fields surfaces its inherit vs override
  state visually ✓
- When a field is UNSET on the identity, it displays the role's default
  value with a visible "Inherited" marker ✓
- When a field IS SET on the identity, it displays a "revert to role
  default" affordance next to it ✓
- Clicking revert deletes the identity's frontmatter field via the
  multipart PUT payload's `null` convention ✓ (with the noted avatar
  exception — server no-ops the delete today, future-compatible wire)
- Voice sample playback and preview treatments always show the RESOLVED
  value ✓ (VoicePicker gets `voiceDraft` which is seeded from resolved,
  so sample-play uses it; ColorPicker swatch/slider similarly bound to
  hueDraft; avatar `<img>` src still uses `identity.avatarUrl` which
  Plan 86-01's GET /:key/avatar role-folder fallback serves as the role's
  image when identity has none)
- Dirty tracking accounts for revert-of-unmodified-field as a dirty
  change ✓ (`*Reverting` state force dirty)

### Extension to committed* as source of truth

**Not a scope deviation — a design refinement discovered during TDD GREEN.**

The plan's Task 1 Step 2 said: `titleInherited = identity.title === null &&
identity.roleDefaults?.title !== undefined`. The initial GREEN
implementation used exactly this shape. Test 6 (post-save re-render in
inherited state) failed because in the test scenario `applyIdentityChange`
is mocked, so after save-with-revert the parent's identity prop doesn't
re-render, and `identity.title` stays as the pre-save value
("custom title"). The affordance never flipped to inherited state.

Iterated: switched inherit detection + dirty predicate + onSave diff logic
to read `committedTitle === ""` (identity's OWN value, refreshed on save
success) rather than `identity.title === null` (prop, which may lag by one
render in the test scenario). Production sees the same values via
applyIdentityChange broadcast → parent re-renders → identity prop is fresh.
The refinement makes the modal's internal visual state coherent even when
the parent doesn't re-render.

This preserves all plan behavior verbatim and adds robustness. Committed*
was already the "identity's own value" source of truth for the existing
dirty predicate (patch #279); this plan extends that source of truth to the
inherit-detection layer too.

### Deferred to Plan 86-06 (test realignment) or later phases

- **Backend PUT extension for avatar delete**: today `meta.avatar = null`
  is a no-op (IdentityMetadata omits the avatar field; JSON.parse
  pass-through silently drops unknown keys). The wire is right; the
  server-side delete path is missing. A future backend patch — either in
  the deferred role-cosmetic-edit modal bounty or a small standalone
  patch — can extend the PUT handler to (a) treat `meta.avatar === null`
  as a delete of the frontmatter key AND (b) hard-delete the identity's
  avatar sibling file. The frontend wire is future-compatible and
  gracefully no-ops on today's backend.
- **Existing IdentityModal test alignment**: this plan does NOT touch
  `IdentityModal.voice.test.tsx` — 19/19 tests still pass because the
  affordance layer sits ABOVE the existing draft/save wire without
  changing the voice picker's contract. Plan 86-06 owns any needed
  test realignments across the sibling IdentityModal test files.

## Known Stubs

None. All wired data flows to a real consumer path:

- `identity.roleDefaults` comes from Plan 86-01's publicIdentity merge
  and is consumed at every render of the edit block.
- `titleReverting` etc. flags are read by the dirty predicate + JSX
  affordance strip + onSave revert branches.
- `meta.title/voice/colorHue = null` payloads are consumed by the
  backend PUT handler at identities.ts L563-574 (delete-on-null).
- `meta.avatar = null` payload is a future-compatible wire; today the
  backend silently ignores it (per plan's Task 1 Step 5 fallback
  language: "server no-ops the delete if the field was already
  absent"). Marked as a Threat Flag below rather than a stub because
  the frontend behavior is correct — the gap is on the backend side.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: partial-delete-semantics | src/backend/database/routes/identities.ts | Frontend emits `meta.avatar = null` for the Revert-avatar path, but the backend PUT handler's `IdentityMetadata` type (L53-65) omits `avatar` — JSON.parse pass-through silently drops it. Today the identity's avatar frontmatter key is never deleted via UI, so a per-identity avatar override remains "sticky" once set until manually removed from disk. Low-severity because the plan hedges this explicitly (Task 1 Step 5 fallback) and the UX still surfaces the affordance for a future backend extension. Fix path: extend IdentityMetadata to include `avatar?: string | null` + add an overlay branch at L575-587 that treats null as delete-key + optionally hard-deletes the sibling avatar file. |

## Self-Check: PASSED

- File `src/ui/features/pretty-view/IdentityModal.tsx` — FOUND (modified,
  +250 net lines)
- File `src/ui/features/pretty-view/IdentityModal.inherit-override.test.tsx`
  — FOUND (created, 440 lines, 11 `it(` blocks)
- File `.planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-05-SUMMARY.md`
  — FOUND (this file)
- Commit `73e79c75` (task1-red) — FOUND
- Commit `d398642a` (task1-green) — FOUND
- Scoped test bundle exit code 0 — FOUND (19 tests pass across 2 files:
  `Test Files 2 passed (2) | Tests 19 passed (19)`)
- `npx tsc -p tsconfig.json --noEmit` exit 0 — FOUND
- Grep gates (all pass): roleDefaults=26, *Reverting=27,
  Inherited/Revert=81, `meta.X = null`=4 code sites, test-file it()=11,
  typecheck errors in IdentityModal.tsx=0
