# Modal element inventory (2026-10-16, Explore agent)

I've built the inventory: 20 modals, all their tabs and panes, the file viewers, and the shared components. The main finding is that the shared primitives are barely used inside modals. `select.tsx`, `checkbox.tsx`, `badge.tsx` and `dialog.tsx` have no consumers in any modal. `textarea.tsx` isn't used in any modal; its three consumers are ComposeBox, ComposeBoxShell and MessageQueueDrawer. `Input` is only used in CreateRoleDialog, the sidebar NewSessionDialog and the session-launcher dialog. Nearly everything else is raw elements styled with long inline Tailwind/hsla classes (often a `--pv-id-hue` tint) or inline `style={{}}` objects.

Paths are relative to `/home/ubuntu/fleet/identities/copper-box-maintainer-2/workspace/skynet/src/ui/`. "Hand" means a hand-rolled raw element; "shared" means it uses a component from `components/`.

## 1. Element categories

**Dropdown / select: all hand-rolled.** `components/select.tsx` (Radix) is used nowhere.
- Native `<select>`, and several files re-declare the same option-colour constant, `OPTION_STYLE` (`#1a1a1a`): RolesListModal.tsx:532, SkillsEditorModal.tsx:804 and :827 (uses optgroups), ScheduledAgentsModal.tsx:484 and :504, PreferencesAboutYouPane.tsx:279.
- More native selects: ScheduledAgentsModalForm.tsx:862, AddWakeupDialog.tsx:187/239/295, WakeupFormShared.tsx:572/943/963/983/1038, WakeupsTab.tsx:631/683/745.
- AdminSystemPane.tsx:187 uses `adminInputClass`.
- `pickers/VoicePicker.tsx:104` is a raw select with its own option style. It's used by RoleModal, IdentityModal and PreferencesVoicePane.
- File viewers have more: DiffView:99, SubtitleEditor:338, FontViewer:157.
- Multi-select: the shared `MultiSelect` appears only once, in `sidebar/NewSessionDialog.tsx:1249`. The chip pickers in ScheduledAgentsModalForm.tsx:115-149 (role and host chips) do a multi-select job by hand with inline style tokens.

**Single-line text field**
- Shared `Input`: CreateRoleDialog.tsx:565, sidebar/NewSessionDialog.tsx:1136/1168/1351, session-launcher/NewSessionDialog.tsx.
- Hand-rolled: IdentityModal.tsx:665 (inline task edit), CreateProjectModal.tsx:212, NewConversationModal.tsx:288, ScheduledAgentsModalForm.tsx:517/844/888, AddWakeupDialog.tsx:166/217/394/413 (`INPUT_CLASS` at :58).
- Hand-rolled with inline styles: WorkspaceTab.tsx:1359 (new file) and :1602 (rename).
- Hand-rolled with other one-off styling: PreferencesVoicePane:330, PreferencesPhonePane:113, PreferencesTelegramSection:95.
- Admin: AdminUserModal:335 and AdminSignInPane:215 use `adminInputClass`.

**Multiline field**
- The shared `Textarea` isn't used in any modal.
- Raw `<textarea>`: FeedbackModal.tsx:149, CreateRoleDialog.tsx:590, ScheduledAgentsModalForm.tsx:550, WakeupsTab.
- Rich text uses the feature-level `MarkdownEditor`: AddWakeupDialog:441, RoleFileTab, IdentityFileTab, PreferencesAboutYouPane:373, and the editors inside FileView.

**Buttons: about five competing systems**
- Shared `Button`: FeedbackModal (outline/default), CreateRoleDialog:816, NewSessionDialog:1406 (outline, recoloured with an override), NewConversationModal:328, CreateProjectModal:325, AddWakeupDialog:476/487 (both outline), RoleFileTab, IdentityFileTab, WakeupsTab.
- Hand-rolled "Close" secondary, the same class string copied 8 times (`bg-black/20 border border-white/10`): RoleModal:693, IdentityModal:877, PreferencesModal:394, RunbookEditorModal:539, SkillsEditorModal:1169, EditableFileModal:270/293, ProjectModal:228.
- Hand-rolled "Save" primary, copied 4 times (`hsla(--pv-id-hue,65%,45%,.75)`): RunbookEditorModal:556, EditableFileModal:307, SkillsEditorModal:1186, ProjectModal:246.
- Other primaries that don't match each other: ScheduledAgentsModalForm:939 (inline style), FileView.tsx:309 and AboutYouPane:366 (an `80%,60%,.2` tint), SkewLockModal:105.
- Header "+ New" accent button, copied 4 times: RolesListModal:507 and :578 (empty state), ScheduledAgentsModal:432, SkillsEditorModal:768.
- Inline-style button objects: PreferencesPhonePane:26 `buttonStyle`, PreferencesTelegramSection:41 `buttonStyle()`, WorkspaceTab create/cancel/OK (:1383, :1626).
- Feature-local `AdminButton` (admin-ui.tsx:82, with a `tone="danger"` option): all Admin panes, plus ServiceSecretRow (which Preferences > Services also uses).
- Destructive: the shared `variant="destructive"` is used only at WakeupsTab:569. Elsewhere destructive actions are `AdminButton tone=danger`, kebab items marked `danger`, or a trash icon that turns red on hover (RunbookEditorModal:434).
- Text and link buttons: PreferencesVoicePane:249 (underlined reset), ConversationSearchModal:376 ("Load more"), and the "Add file" sidebar trailing button, duplicated at RunbookEditorModal:487 and SkillsEditorModal:1105.

**Icon buttons: no shared component**
- The `ModalHead` close button is the only shared one.
- RoleModal:601 and IdentityModal:777 each re-implement their own close (`size-9 rounded-full`).
- Others: Runbook delete-runbook trash :434 (size-8), SkillFileTab:99 delete (size-6), ConversationSearch clear :312 (size-7), RoleModal avatar pencil :438, IdentityModal task pencil :704, error-dismiss X (ScheduledAgentsModalForm:498 and the `pv-agent-list-error-dismiss` class), WorkspaceTab Refresh :1179.

**Toggle / switch, checkbox, radio, range**
- Shared `Switch`: AddWakeupDialog:452, AdminUserModal, AdminSignInPane.
- ScheduledAgentsModalRow.tsx:~190 uses a CSS-only `.pv-agent-row-toggle` (pretty-conversations.css:2193) instead.
- Raw checkboxes (the shared `Checkbox` is unused): NewSessionDialog:1192/1334, WakeupFormShared:811/860, WakeupsTab:904, PreferencesTelegramSection:313.
- Raw radios: PreferencesVoicePane:291/308, WakeupFormShared:916/927.
- Raw range sliders: ColorPicker:16, PreferencesVoicePane:262.
- SkillsEditor's invocation toggles are `checked` items inside a kebab menu.

**Segmented control / tabs**
- Shared `ModalTabs`: RoleModal:624, IdentityModal:800, ProjectModal:174. Each wraps it in Radix `Tabs` just to get the panels.
- `FileViewModeSwitcher` (FileView.tsx:85) uses the CSS classes `.pv-variant-tabs`/`.pv-variant-tab`.
- Hand-rolled: the schedule-kind button group in ScheduledAgentsModalForm:~736 (inline styles at :139). AddWakeupDialog:187 makes the same choice with a `<select>`, so one decision has two UIs.
- Hand-rolled: PreferencesAboutYouPane:298, a file tab strip with its own look.
- `RestrictToDaysChips` (WakeupFormShared:492) is a row of toggle chips.

**Side list / nav list**
- Shared `ModalSidebar`: AdminModal:104, AdminUserModal:122, RunbookEditorModal:466, SkillsEditorModal:1083.
- Not shared: PreferencesModal:228 (see section 3).
- Not shared: the WorkspaceTab breadcrumb `<nav>` at :1055 (inline styles).

**List rows / cards (no shared row component)**
- RolesListModal:690 and its archived row at :130 copy the `.pv-row` look in inline styles.
- ArchivedAppsModal:~175 is a slate-coloured copy of the same.
- CSS-class rows: ScheduledAgentsModalRow (`.pv-agent-row`, css:2060) and ConversationSearchRow (`.pv-search-row`, css:1844).
- Tailwind rows: AdminUsersPane:~60 and RunbooksTab:108.
- Inline-style grid rows: WorkspaceTab:1548 (`rowStyle`, :984), GitTab:162 `rowStyle`, ParticipantList:129 `rowStyle`.
- Kebab (three-dot) menu: shared and consistent. `RowKebabMenu` and `RowKebabContextMenuSurface` (built on dropdown-menu) are used in RolesList, ArchivedApps, ScheduledAgentsModalRow, ConversationSearchRow, SkillsEditor:932 and WorkspaceTab:1720.

**Search box: 6 or more variants**
- ConversationSearchModal:289 (bordered input inside a bar).
- ScheduledAgentsModal:463 (icon inside a bordered wrapper).
- WorkspaceTab:1203 (inline styles).
- ParticipantSearchInput (CSS classes `.pv-search-*`), used by NewConversationModal.
- Host-picker search, copied 3 times: CreateRoleDialog:747, NewSessionDialog:1063, CreateProjectModal:247.
- File viewers: DelimitedTable:261, XlsxViewer:272, SubtitleEditor:284.

**Host picker list (search plus selectable rows with a status dot): copied 3 times.** CreateRoleDialog:~760-800, NewSessionDialog:~1065-1115, CreateProjectModal:~260-310. These are good candidates for a single shared picker.

**Filter / toolbar bar under the header.** The same `px-4 py-2.5 bg-black/25 border-b` bar appears in ConversationSearchModal:281, ScheduledAgentsModal:453, SkillsEditorModal:796 and RolesListModal:525. File toolbars use a `toolbarBtnStyle` object defined three separate times: WorkspaceTab:942, GitTab:136, DesktopTab:126.

**Chips / badges / pills (the shared `Badge` is unused)**
- `InstanceWideChip` (InstanceWideStatus.tsx:12) is semi-shared.
- SkillsEditor "distributed" chip at :890 and "user only / agent only" chip at :903.
- `AdminBadge` (admin-ui.tsx:132).
- CSS classes: `.pv-search-archived-pill`, `.pv-agent-row-chip`.
- ParticipantChip.
- The Colour and Voice pill buttons in the Role/Identity headers (RoleModal:490/546, IdentityModal:724).

**Section headers / labels: at least 6 different label styles**
- 10px bold, tracking-widest: CreateRoleDialog:562, NewSessionDialog:1132.
- 10.5px, tracking 0.1em: NewConversationModal:53, CreateProjectModal:207.
- 10px uppercase, white/90: AddWakeupDialog:57 (`LABEL_CLASS`).
- 10px uppercase, dim: WakeupsTab:40 and RestrictToDaysChips.
- xs, medium weight, not uppercase: ScheduledAgentsModalForm:511.
- 10.5px, tracking 0.14em: the Role/Identity popover labels.
- Group headings: `AdminSection` h3 (admin-ui:37). PreferencesAboutPane:69 and PreferencesServicesPane:41 copy the same h3 look. RolesList section heading :669. RolesList collapsible "Archived roles" header :809.
- `AdminRow` (label on the left, control on the right) is the only label-plus-control row component, and only Admin uses it.

**Empty / loading / error states: all ad hoc**
- Centred text in `ModalBody`: RolesList:560-585, SkillsEditor:1044-1081 (8 branches), Runbook:451-461, AboutYouPane:328-350, ScheduledAgents:~575, ConversationSearch:338-360, ArchivedApps:~148.
- Icon, title and subtitle: WorkspaceTab:1465/1511, DesktopTab `Notice`:141, FileView `FileUnavailableNotice`:116.
- Loading shown three ways: `Skeleton` (ScheduledAgents, RoleFileTab, IdentityFileTab, RunbooksTab, WakeupsTab, ProjectFileTab, FileView), "Loading…" text (RolesList, Skills, Runbook, Workspace, AboutYou), or a `Loader2` spinner (ConversationSearch:342 and the create buttons).

**Inline error / notice**
- Bordered red boxes: ScheduledAgentsModalForm:488, ProjectModal:199, the `.pv-agent-list-error` class (ScheduledAgents:~555).
- WorkspaceTab `ErrorBanner` (:197). GitTab has its own `ErrorBanner` (:181).
- `AdminError`.
- Plain `text-red-400` text: NewConversationModal:348, CreateProjectModal:~317, ConversationSearch inside its ModalFoot (:398), RolesList:568.
- Neutral notice: WorkspaceTab:1445.

**Confirm / prompt dialogs: almost all native browser dialogs**
- `window.confirm`: AdminUserModal:204/462/478, PreferencesModal:304, RunbookEditorModal:254/345/382/405/478, SkillsEditorModal:429/599/634/682/704/729/1095, EditableFileModal:131, ProjectModal:119, RolesListModal:294/305/345/348, ScheduledAgentsModal:344, WorkspaceTab:376/895, RoleFileTab:61, IdentityFileTab:68, PreferencesPhonePane:71, PreferencesTelegramSection:234, PreferencesAboutYouPane:223, ServiceSecretRow:66.
- `window.prompt`: SkillsEditor:526/556/570 (new skill, new file), Runbook:321, AdminUserModal:244.
- `window.alert`: RolesList, Skills, Runbook, ArchivedApps, ConversationSearch:215-245, NewSessionDialog:921, WorkspaceTab:903.
- The only in-app confirm dialog is the `AlertDialog` at WakeupsTab:544.

**Colour and avatar pickers**
- `ColorPicker` (a raw range slider) appears in CreateRoleDialog:615 and in RoleModal's popover at :537.
- The avatar candidate grid is hand-rolled at CreateRoleDialog:689-730.
- Avatar upload uses a hidden file input plus a button: RoleModal:438/457, PreferencesGeneralPane:147-175.
- Avatar displays are all different: 44px header (Role/Identity), 40px disc (RolesList), 40px square (ArchivedApps), `UserAvatar` (admin), and the `.pv-agent-row-avatar` and `.pv-search-row-avatar` classes.

**File viewers** (`features/pretty-view/file-viewers/*`): roughly 60 raw buttons, inputs and selects across about 20 viewers, and none use a shared primitive. Examples: EbookViewer has 11 buttons, SubtitleEditor 8, DelimitedTable 7, FontViewer 6. The FileView toolbar is at :298.

## 2. Modal-like surfaces not built on the shared Modal
- `features/session-launcher/NewSessionDialog.tsx:49` is a fully hand-made `fixed inset-0 z-[500]` overlay with its own card and uppercase Button overrides. It's used by `shell/CommandPalette.tsx:9`.
- `shell/CommandPalette.tsx:163` is a hand-made fixed overlay (`z-[100]`, `backdrop-blur`).
- `WakeupsTab.tsx:544` uses Radix `AlertDialog` (`components/alert-dialog.tsx`), which stacks over IdentityModal with different chrome.
- `AppShell.tsx:5` uses `Sheet` (the mobile sidebar).
- `components/dialog.tsx` has no live consumers. CreateRoleDialog and NewSessionDialog only mention it in comments.
- `PrettyViewErrorOverlay.tsx` is an `absolute inset-0 z-[99]` overlay.
- The Colour and Voice popovers in RoleModal:521/575 and IdentityModal:751 are hand-made `absolute` `role="dialog"` panels, not `components/popover`.
- WorkspaceTab:495 opens a nested file-viewer Modal stacked on top of the host modal (Identity, Role or Project).
- All the native confirm/prompt/alert calls listed in section 1.

## 3. Per-modal styling that will fight a global restyle
- **PreferencesModal:228** has its own `<nav>` instead of `ModalSidebar`: rounded-lg pill items, the background and border set in inline styles, and About and Log out pinned to the bottom. It also wires up `useModalDrillIn` and `ModalDrillBack` itself and overrides the `ModalBody` padding (`p-0 flex`).
- **RoleModal:417 and IdentityModal:606** skip `ModalHead`. They build their own header (avatar, chips, popovers) with their own close button and a border set in inline styles, and both pass `className="max-h-[90vh]"`, which overrides the shell's 85vh cap. ProjectModal:158 passes the same override, and NewConversationModal passes `max-h-[720px]`.
- **ScheduledAgentsModalForm:922** draws its own footer bar with inline styles instead of `ModalFoot`. Its colours are hard-coded hsla(220…) rather than the `--pv-id-hue` variable.
- **RolesListModal and ArchivedAppsModal** rows copy a CSS design (`.pv-row`) in inline styles with hardcoded gradients, shadows and `backdropFilter`. RolesList also puts its "Archived roles" section outside `ModalBody`, at :807.
- **Rows that live in a CSS file** (`pretty-conversations.css`): ScheduledAgentsModalRow and ConversationSearchRow, plus the shared toggle, chip and pill classes.
- **WorkspaceTab, GitTab and DesktopTab** use almost entirely inline `style={{}}` with CSS variables (`--color-pv-*`). Tailwind restyles won't reach them.
- **Preferences panes** each define their own button style (PhonePane and Telegram use a `buttonStyle` object) and use hard-coded hex colours (#a89a80, #8a8678, #3a3832) that aren't tied to the hue.
- **Admin** has its own primitives in `features/admin/admin-ui.tsx` (`AdminSection`, `AdminRow`, `AdminButton`, `adminInputClass`, `AdminBadge`, `AdminError`). They could be promoted to shared components or replaced.
- **Two colour systems coexist.** Modal-native components use `hsla(var(--pv-id-hue)…)`, while CreateRoleDialog, NewSessionDialog, the Wakeup forms and the Workspace tabs use the `--color-pv-*` variables. The shared `Button` keys off `--pv-hue`, which Modal sets to match `--pv-id-hue`.
- **Three tests check the source text and will fail on structural changes:** `components/no-adhoc-modal-tabs.test.ts` (tab rows inside `*Modal*.tsx` files must use `ModalTabs`), `components/no-adhoc-modal-blocking-false.test.ts`, and `file-viewers/no-adhoc-file-viewers.test.ts`. Many tests also query by `data-testid` and the `data-slot="dialog-title"` attribute, so keep those when restructuring.