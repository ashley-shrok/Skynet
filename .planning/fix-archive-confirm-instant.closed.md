# Fix: archive confirm opens instantly

**Opened:** 2026-10-30

- **Observed wrong behavior:** pressing Archive (sidebar row menu, task pill, drop lane, whole project, whole role) waits for the wake-up check before the confirm appears — a noticeable extra second (up to 4s for one agent, 8s for a project or role) with nothing on screen.
- **Correct behavior after the fix:** the confirm appears at once with today's text; its Archive button is greyed out and, after a short beat, shows a small spinner — nothing that names what it's waiting for — until the check is back (same limits as now); then the wake-up warning (if any) appears in the confirm and Archive turns on. Cancel always works. The warning can still never be clicked past unseen. Phone swipe unchanged.
- **Suspected files:** the app's shared confirm dialog (kit dialogs), the archive check helper, the single-agent archive paths (sidebar panel, open-agent archive), the project archive in the sidebar panel, the role archive actions; plus their tests.

## Change made

The shared confirm dialog gained a "not ready yet" mode: it opens at once with its text, the main button is greyed out (a spinner appears in it only if the wait passes a short beat), Enter does nothing, Cancel works, and when the work finishes its text is replaced and the button turns on (a failure just turns it on). The single-agent archive (row menu, task pill, drop lane), whole-project and whole-role archives now open their confirm at once and hand the wake-up check to that mode; a role with no agents has nothing to wait for. Phone swipe unchanged. Id skill notes the brief greyed-out Archive.

done: the confirm appears immediately; Archive is greyed out (spinner after 0.3s) until the check is back, then the warning (if any) fills in and Archive turns on — covered by real-render dialog tests and the archive-route tests (40 files, 779 tests green).
