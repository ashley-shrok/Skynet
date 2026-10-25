# Shape: the scheduled tasks window — a list by machine, each task one level deeper

**Opened:** 2026-10-19
**Campaign:** apple-ux (shape 6 of 14)

## What this is

The scheduled tasks window (clock icon in the sidebar footer) becomes a calm list of every task the user has, grouped by machine, with each task opening one level deeper in the same window — the same way a wake-up opens inside the agent window. The new-task form is that same view, empty. The schedule control the two share gets its agreed wording and order.

## Shape

**List**
- Title "Scheduled Tasks", a one-line note under it ("Conversations that start themselves on a schedule, to carry out instructions you write now."), **New** and the close X in the header.
- One search box: matches a task's name, its roles (by name or display name) and its instructions. It replaces the role and host dropdowns.
- Tasks grouped by machine, each group titled with the machine's name and its task count. With only one machine there are no group titles.
- Inside a group: tasks that are on first, soonest next run at the top; switched-off tasks after them.
- Each row: the role's picture (two overlapped for a two-role task; a clock tile for no roles; dimmed when off), the task's name, a line with the schedule and the next run ("Daily at 11:30 · Next in 14 hours", or "Off" when switched off), one quiet line of the instructions, the on/off switch, and an arrow. The whole row opens the task. On a phone the name wraps and there's no arrow.
- No three-dots button on rows. Right-clicking a row gives Run now (not for one-time tasks), Open and Delete….
- Empty: "No scheduled tasks" with a line on what one is and a New scheduled task button. Search with no hits: "No matches".
- Sensor-fired tasks keep their sensor line (status, last fired, waiting) in place of the schedule.

**A task (one level deeper, same window)**
- Header: "‹ Scheduled Tasks" back, the task's name, "On <machine>" under it, close X.
- A group at the top: **On** switch (saves at once, as the list's switch does), described with the schedule, when it last ran and when it runs next. Under it, a row saying "Start a conversation for it right away. The schedule carries on as usual." with a **Run now** button (shows "Starting…" while it goes; hidden for one-time tasks). A started run says so briefly, as today.
- **Name** — shown, can't be changed, with "To rename it, delete it and create a new one."
- **Roles** — "No roles" first, then the machine's roles, tap to pick; the same rules as today (No roles and roles exclude each other; one or the other must be picked).
- **When** — the shared schedule control with every per-kind field: times (add a time), "Only on" days, every-N, window, start, ends. **Time zone** field under it, as in the wake-up view (blank = yours). One-time tasks say their time is in your time zone.
- **Instructions** — a tall text box, "Each run's new agent starts with these, word for word."
- **Archive if nothing to report** — a switch row with its description.
- **Delete scheduled task…** at the bottom; it asks first.
- Foot: **Cancel** and **Save** (Save enabled once something changed).
- Sensor-fired tasks: When says it runs when its sensor fires and shows the sensor's details read-only, as today.

**New scheduled task** — the same view titled "New scheduled task" ("Starts a conversation on a schedule" under it): On (on by default), Name, **Machine** (a short list of machines that can run agents, tap one — only when there's more than one), Roles (once a machine is picked), When, Time zone, Instructions, Archive if nothing to report. Foot: Cancel and **Create**.

**Leaving:** unsaved changes ask "Discard your changes?" on every way out (back, Cancel, Esc, X). Esc in a task goes back to the list; Esc in the list clears the search, then closes.

**Schedule control (shared with wake-ups):** the kinds read Daily / Weekly / Monthly / Yearly / Every… / Once — "Interval" becomes "Every…" and moves after Yearly. Changes in the agent window's wake-up view too.

**Wording:** schedule lines in this window drop "(box-local)".

**Phone:** full screen; the same views.

## Philosophy

- A sibling of the agent window's wake-ups: list, then the thing itself one level deeper, then back.
- What's coming next is what a schedule list answers, so the list is ordered by it.
- Finding a task is one search, not a row of dropdowns.
- Running a task now is a real button, next to the switch that governs when it runs.
- Apple's interfaces are the reference for behaviour; the look stays Skynet's (look A, kit parts only).
- Nothing the window does today is lost.

## Prior context

- Today: list with search + role + host dropdowns, rows with role chips, last / next, switch and a three-dots menu (Run now, Edit, Delete); the form replaces the list with Name, Instructions, Archive checkbox, Roles chips, Host chips, Schedule, and never shows time zone or "only on" days (it keeps them on save).
- Tasting with the owner 2026-10-19 (`workspace/tastings/sched/` in the identity workspace, the 26 real tasks across thenasty, Skynet and workstation): "this looks pretty good … the Run Now thing should be like an actual button. But otherwise, this is good." Run now moved to a button.
- Window sizes are not settled here — shape-modal-sizing walks every modal at the end.
- id skill: the scheduled-tasks description (clock icon modal) changes with this — non-admin visible.

## What would make it wrong

- Role or host dropdowns still there, or search misses roles or instructions.
- Rows in name order, or switched-off tasks mixed in among the on ones.
- The editor replaces the list without a way back, or opens anywhere but inside the same window.
- Run now only in a menu, or looks like plain text instead of a button, or offered on a one-time task.
- Time zone or "only on" days hidden from the editor, or lost on save.
- The schedule kinds still start with "Interval", or wake-ups and scheduled tasks show them differently.
- Unsaved edits vanish without asking.
- A new task asks for a machine when there's only one.

---

## Close-Out

**Closed:** 2026-10-21
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · one window: the list grouped by machine, each task one level deeper, New is the same view empty, the shared schedule section gets its wording and order.
- **List: header** — present · "Scheduled Tasks", the agreed note, New, close X.
- **List: one search box** — present · matches names, instructions, role names and each machine's role display names; both dropdowns gone.
- **List: grouped by machine** — present · machine name and task count, titles only with more than one machine.
- **List: order** — present · on tasks soonest-next first, off ones after.
- **List rows** — present · role pictures (two overlapped, clock tile for no roles, dimmed when off), name, schedule + next or Off, one line of instructions, switch, arrow; on a phone the name wraps and there's no arrow.
- **List: right-click menu** — present · Run now (not on one-time tasks), Open, Delete…; no three-dots button.
- **List: empty and no-match states** — present.
- **List: sensor line** — present.
- **Task: header** — present · back, name, "On <machine>", close X.
- **Task: On + Run now** — present · switch saves at once; Run now is a real button, "Starting…", hidden on one-time tasks; a started run says so briefly.
- **Task: Name, Roles, When, Time zone, Instructions, Archive switch, Delete, Cancel / Save** — present.
- **Task: sensor-fired** — present · read-only sensor details, schedule written back unchanged.
- **New scheduled task** — present · machine list only with more than one machine; Create.
- **Leaving** — present · discard prompt on back, Cancel, Esc, X; Esc order as agreed.
- **Schedule control** — present · Daily / Weekly / Monthly / Yearly / Every… / Once, shared with wake-ups.
- **Wording: "(box-local)" dropped** — present.
- **Phone** — present.
- **Philosophy** (sibling of wake-ups, ordered by next run, one search, Run now a real button, kit parts only, nothing lost) — present.
- **Prior context** (time zone and "only on" days shown and kept; id skill updated) — present.
- **What would make it wrong** (each of the eight) — present · none of them happens.
- **Time zone "blank = yours"** — drifted (endorsed) · after code review, blank means the machine's own zone for a task or wake-up that was saved without a zone, so a save never moves its run time; new ones still default to yours, and the help text says which.

### Additions (in the result, not in the shape)

- The app's machine list now carries the "can run agents" mark it had been dropping, which reaches anything else that filters on it (e.g. new conversations) — endorsed-as-drift
- The wake-up view's schedule section heading reads "When", its days row reads "Only on", and on a phone the six kinds sit in two rows of three — endorsed-as-drift

### Follow-ups

- A new task when no machine can run agents showed nothing and gave no reason — fixed in-session (a message says so).
- A just-created task's schedule line is blank until the next re-read — accepted-as-drift (minor).
- A search that narrows to one machine keeps that group's title — accepted-as-drift.

### Notes

Reviewer read the whole commit and found every shape item; the only divergences were the two additions above (the owner: thumbs up). Unbiased code review found nine real issues — the worst a zone-less task's run time moving on save — all fixed with tests (e8a83fa6). The owner endorsed the time-zone drift and both additions 2026-10-21.
