# Plan 09-04 — Ashley UAT (human-verify checkpoint)

**Status:** ✓ APPROVED
**Approved:** 2026-07-22
**Approval verbatim:** "compose box looks good!" (post-#117 round)

## Deploy sequence walked

1. **First deploy** (image sha `3e0d08f7f96d`, ~07:35Z): shipped patches
   #106-#116 (fleet-native list + F1-F4 batch + thumbs-up "yes" + Phase 9
   09-01 restructure + 09-02 meter rotation).
2. **UAT round 1 findings** (Ashley in-line):
   - Textarea rendered ~2.5 button-heights tall, not ~1 (shadcn Textarea
     base `min-h-[80px]` overrode the `rows={1}` prop).
   - Reset cell was on the RIGHT of the meter, not LEFT (09-02 kept the
     original child order after flex-col → flex-row flip).
   - Meter showed three colors at once (per-position banding); Ashley
     preferred the prototype's uniform-by-current-band coloring.
3. **Patch #117 fix + redeploy** (image sha `b064a626ef1d`, ~07:47Z):
   `min-h-8!` on textarea + JSX child reorder + uniform-band coloring.
4. **UAT round 2**: approved.

## Also captured this session

- **Submit-bug incident logged** (`bounties/messages-land-in-box-not-submitting/`):
  Ashley reported the "message lands in Claude Code composer without
  submitting" bug fired again during UAT with a NON-paste typed message.
  Critical new signal — the paste-detection framing behind patches
  #110/#111a is misdiagnosing the root cause. Bounty stays URGENT; needs
  a dedicated fresh investigation session.
- **New URGENT bounty parked** (`bounties/pretty-view-plan-mode-not-rendering/`):
  Vicky was live in plan mode when Ashley filed via `/bounty` — plan-mode
  message doesn't render in pretty view. Captured verbatim; investigation
  deferred to next wake per bounty skill.

## Pin

Full patch write-ups landed in `~/.claude/identities/tina/termix-patches.md`
for #106-#117 in the same turn as this approval per fleet-standing rule.
Header count updated `ONE HUNDRED FIVE` → `ONE HUNDRED SEVENTEEN`.

## Self-Check: PASSED
