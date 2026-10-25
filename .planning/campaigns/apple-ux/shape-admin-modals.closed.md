# Shape: the admin panel and the admin user modal

**Opened:** 2026-10-21
**Campaign:** apple-ux (shape 8 of 14)

## What this is

The Admin window (crown icon in the sidebar footer, admins only) becomes a sibling of Preferences: "Admin" over a side list, each section opening with a header that says what it's for, settings that save as they change. The separate window that opened for one user goes away — a user opens one level deeper inside the Admin window, as one page. Hosts get the same treatment: grouped by whether they need attention, each row saying why, and a host opens one level deeper with its full readings. The instance file is read first and edited on purpose.

## Shape

**Window**
- Side list: "Admin" small at the top; then Users, Hosts, Sign-in, Instance file; **System** pinned at the bottom (where About sits in Preferences).
- Opens on Users each time.
- Each section opens with a header: an icon tile, the section's name, one line saying what it's for. Views one level deeper (a user, a host) show no header.
- No Close button at the bottom — the X closes; settings save as they change. The only foot is the instance file's Edit / Cancel / Save.
- Picking the open section again in the side list goes back to its top level.
- Phone: full screen, "Admin" as a large title over the sections as a grouped list with icon tiles and arrows (System in its own group); tapping one opens it with "‹ Admin" back. A user or host one level deeper keeps its own "‹ Users" / "‹ Hosts" back as well.

**Users**
- Two groups: **Admins · N** and **Members · N**, alphabetical in each. Each row: picture (or initial), name, Matrix ID under it, "You" on your own row ("OIDC" too where the instance uses OIDC), arrow.
- A search box (name or Matrix ID) appears once there are more than eight users; "No matches" when nothing fits.
- Clicking a row opens that user one level deeper in the same window.

**A user** (one level deeper; "‹ Users" or Esc goes back)
- Top: large picture, name, and "Administrator" or "Member", plus "You" and "Signs in with OIDC" where they apply.
- **Access**: Admin switch (asks first; can't remove your own), Push notifications switch (always on for admins), Two-factor authentication shown On / Off ("They turn it on or off themselves.").
- **Phone**: Number edited in place; **Save** appears only once it's changed. Under the group: include the country code; setting one turns the phone feature on for them. After saving: "Saved. They can remove it themselves from Preferences."
- **Agent service keys**: as today (only when services declare per-user keys).
- **Signed in · N**: every live sign-in — device, "Active 3h ago · signed in <date>", "This browser" on the one you're using, a **Log out** button each (asks first). Under it, a red row: **Log out everywhere** (or **Log out other devices** on your own page), asking first. "Not signed in anywhere" when there are none.
- **Hosts · N**: the hosts they own — status dot, name, user@address:port, the connection type when it isn't SSH. Under it: "Hosts they added to Skynet. Only they can change them." "None" when there are none.
- **Details**: Matrix ID and User ID; under it: the Matrix ID is set when the account is made and can't be changed here.
- **Delete user…** as a red row in its own group at the bottom; the line under it says why it's blocked (yourself, the only admin) or that it removes everything and can't be undone. Asks for the username, as today.

**Hosts**
- Under the header: "10 hosts · 8 online · 3 need attention · updated just now".
- **Needs attention**: each row — a red (unreachable) or amber dot, name, and why, in words: "Unreachable · last seen …", "Agent supervisor down", "Substrate sync failing since …", "Disk 82% full", "Memory 80% used", "CPU busy · load 4.3 on 4 cores". "Agents" or "Remote" on the right, arrow.
- **Running fine**: green dot, name, one quiet line — agent hosts: "6 of 26 agents running · memory 31% · 26 GB free"; remote hosts: how Skynet reaches them and how fast ("RDP · 3 ms").
- Still refreshes every 15 seconds while open, only while the browser tab is visible.

**A host** (one level deeper; "‹ Hosts" or Esc goes back)
- Top: a host tile, the name, status ("Online" or why it's unreachable) and "Runs agents" or "Remote host".
- An amber note listing why it needs attention, when it does.
- **Resources**: CPU, Memory, Disk — each the reading on the right of its name and a bar under it (green / amber / red as today).
- **Agents** (agent hosts that are online): agents running of total, apps, agent supervisor Running / Down, substrate sync ("Synced 24h ago" / "Failing since …", with the last error under the group when failing).
- **About**: address, connections, system (OS · architecture), up for, response time; the "no readings" reason under it when Skynet can't read resources.

**Sign-in**
- **Accounts**: Allow registration, Allow password reset (and the two OIDC switches only where OIDC is in use), as today.
- **Staying signed in**: "Sign-ins last [24] hours" — saves when the box is left or Enter is pressed; no Save button. Under it: 1 to 720 hours, applies to new sign-ins; after saving, says so. An out-of-range number shows what's allowed.

**Instance file**
- Shown formatted for reading, in a group. Foot: **Edit**; while editing, **Cancel** and **Save** (Save greyed until something changed), with a line saying saving sends it to every host right away and agents pick it up the next time they start; saving it empty removes it everywhere.
- Nothing written: "Nothing written yet" with **Write it**.
- After saving: "Saved — sending it to every host."
- The window is its usual size while reading and grows to the editor size only while editing.
- Leaving the editor with unsaved edits asks "Discard your changes?" — Cancel, Esc, another section, going back on a phone, the X.

**System**
- Version (Skynet x.y.z, update status, **Check for updates**), Database health, Log level, Voice services — as today, under the section header.

## Philosophy

- Admin is the same family as Preferences: same window, same side list, same section headers, same save-as-you-go.
- One window, deeper levels inside it — never a second window stacked over the first.
- The list says what's wrong in words, so the admin knows where to look before opening anything.
- "Hosts" is the app's term and admins see it that way.
- Apple's interfaces are the reference for behaviour; the look stays Skynet's (look A, kit parts only).
- Nothing the admin panel or the user window can do today is lost; backend guards stay authoritative and the controls mirror them.

## Prior context

- Today (after shape-ux-foundation): Admin is a side-list window — Users, Sign-in, System, Hosts, Instance file — with a Close button at the bottom. A user opens a second window over it with its own side list (Account / Sessions / Hosts). Hosts are full cards with meters, red-ringed when they need attention. Session length has its own Save button and a "Saved" banner. The instance file is always an open editor with a Save button.
- Tasting with the owner 2026-10-21 (real build over the live app with her real data; screenshots in `workspace/tastings/admin/new/` in the identity workspace): "this is fantastic all around. No notes whatsoever", except the section stays **Hosts**, not "Machines" — it's the official term in the app.
- Admin-only: no id-skill edit and no what's-new note.
- Window sizes are not settled here — shape-modal-sizing walks every modal at the end.

## What would make it wrong

- A second window opening over Admin for a user or a host.
- The word "Machines" anywhere in the Admin window.
- A Close button at the bottom, or a Save button anywhere but the instance file.
- A host that needs attention without its row saying why.
- The instance file opening straight into the editor, or edits lost without asking.
- Anything an admin can do today missing: making / removing admins, push access, phone, service keys, logging out one device or everywhere, seeing a user's hosts, deleting a user (with its guards), registration / password reset / OIDC switches, session length, update check, log level, the host readings.

## Scope edges

- In: the Admin window, the user view (replacing the user window), the Hosts list and host view, Sign-in, Instance file, System's place in the list.
- Out: anything outside Admin; what the backend reports about hosts or users (no new readings, no new actions).
- Deferred: window sizes (shape-modal-sizing); shared skill / role host targeting (shape-host-targeting).
- Tempting but no: adding users from here, editing someone's hosts, renaming the instance file.

## Handoff notes

- copper-box-maintainer-2, in-session after the tasting; the tasting code is the starting point (Admin window, user view, hosts list + host view, instance file read → Edit, sign-in save-on-leave).
- Tests: the admin window, users, user view, hosts, instance file and sign-in suites need rewriting for the new flows (one level deeper, no Close, save on leave, read → Edit with the leave guard).
- Admin-only: no id-skill edit, no what's-new note.
- Local only — campaign shipping rule: committed, not pushed, not deployed.

---

## Close-Out

**Closed:** 2026-10-21
**Overall verdict:** closed-hit (three small additions endorsed by the owner as a change of mind)

### Shape features (conformance)

- **What this is** — present · Admin in the Preferences family; users and hosts one level deeper; the separate user window gone; the instance file read first, edited on purpose.
- **Shape: Window** — present · "Admin" over Users, Hosts, Sign-in, Instance file, System pinned last; opens on Users; section headers (none on deeper views); no Close button; picking the open section again returns to its top level; phone grouped list with "‹ Admin" and the deeper "‹ Users" / "‹ Hosts".
- **Shape: Users** — present · Admins · N / Members · N, alphabetical; picture, name, Matrix ID, You, OIDC only where used; search past eight users with "No matches"; opens in the same window.
- **Shape: A user** — present · top, Access, Phone (Save only once changed), service keys, Signed in · N with Log out each and the red everywhere / other-devices row, Hosts · N, Details, Delete user… with its guards; "‹ Users" and Esc go back.
- **Shape: Hosts** — present · summary line; Needs attention rows say why in the agreed words; Running fine rows' quiet line; refresh every 15 seconds only while the tab is visible.
- **Shape: A host** — present · tile, name, status, Runs agents / Remote host; amber reasons; Resources with readings and bars; Agents; About; "‹ Hosts" and Esc go back.
- **Shape: Sign-in** — present · Accounts switches (OIDC ones only where used); "Sign-ins last [N] hours" saves on leaving the box or Enter, no Save button; range note, saved note, out-of-range message.
- **Shape: Instance file** — present · read view with Edit; Cancel / Save (greyed until changed) with the explanatory line; Nothing written yet → Write it; saved note; window grows only while editing; Discard prompt on every route out.
- **Shape: System** — present · as today under the section header.
- **Philosophy** — present · same family as Preferences, one window with deeper levels, problems in words, "Hosts", kit parts only, backend guards mirrored.
- **Prior context** — present · old Close button, second window, session-length Save, always-open editor all gone; section is Hosts; admin-only, no id-skill or what's-new edits.
- **What would make it wrong: a second window over Admin** — present (not violated).
- **What would make it wrong: "Machines" anywhere in Admin** — present (not violated).
- **What would make it wrong: a Close button, or a Save anywhere but the instance file** — present (not violated; phone Save and service-key saves are agreed).
- **What would make it wrong: a host needing attention without saying why** — present (not violated).
- **What would make it wrong: instance file straight into the editor, or edits lost** — present (not violated).
- **What would make it wrong: anything an admin can do today missing** — present (not violated; side-by-side read against the old user window found nothing dropped).
- **Scope edges** — present · confined to the Admin window; no new readings or actions.

### Additions (in the result, not in the shape)

- When every host is healthy, the list has no "Running fine" heading — endorsed-as-drift
- A host's substrate row carries a line explaining what substrate is — endorsed-as-drift
- The red log-out-everywhere / other-devices row only shows when there's something for it to log out — endorsed-as-drift

### Follow-ups

None.

### Notes

Settled by reading only. The phone number can't be cleared from the admin side (as before); the shape's "they can remove it themselves" agrees. Tasting screenshots predate the Hosts rename.
