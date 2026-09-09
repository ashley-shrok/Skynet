# Phase 91: Relay-mediated group conversations sub-slice C — new-conversation modal + create-room flow - Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** ~14 new + 5 modified
**Analogs found:** 18 / 19

Every new file the slice ships is classified by role + data flow and paired with a concrete in-repo analog. Excerpts below are the code that plan tasks will copy from. Line numbers are load-bearing where cited; large-file grep-then-Read discipline followed.

Sub-slice C's job: front-end **new-conversation modal** (variant D — sectioned single list, mandatory room name, chips strip, type-to-filter search) + **backend create-room-and-invite flow** that (a) creates a Matrix room using the user's own relay identity, (b) invites the picked human + agent mxids, (c) inserts the new relay-room session row so slice B's observation loop + `/sessions/list` merge naturally surface it in the sidebar, (d) hands off to slice D's pane. Mobile + desktop parity is load-bearing.

---

## Integration Points With Shipped Sub-Slices

Slice C is a **thin composition layer** over primitives that A + B + D shipped. Concrete call graph:

| Slice C need | Provided by | Location |
|---|---|---|
| Every user has an mxid (viewing user's own identity) | Slice A (Phase 88) | `users.mxid` column populated at `POST /users/create`; mint-first ordering, deactivate-on-delete |
| List Skynet users with mxids (humans for the picker) | Slice A + existing route | `GET /users/list-basic` → `src/backend/database/routes/users-list-basic.ts`; frontend consumer `getUsersListBasic()` at `src/ui/api/user-management-api.ts:32` |
| List agents (agents for the picker) | Existing identities substrate | `useIdentities()` at `src/ui/state/identities-store.ts:206`; identity carries `identityKey`, `displayName`, `colorHue`, `avatarUrl` |
| Materialize a relay-room session (create-time path, avoids 10s poll wait) | Slice B (Phase 89-01) D-14 | `materializeRelayRoomSession(userId, roomId, roomTitle)` at `src/backend/relay-sessions/relay-room-sessions-store.ts:63` — `INSERT ... ON CONFLICT(user_id, room_id) DO NOTHING`; schema-is-coordinator so observation-loop safety-net is idempotent with create-time insert |
| Sidebar entry appears | Slice B (Phase 89-04) | `/sessions/list` at `src/backend/database/routes/sessions.ts` merges via `mergeRelayRoomsIntoFlat` (`sessions-merge-helper.ts`); rows carry `kind: "relay-room"` |
| Row-click opens the correct pane | Slice D (Phase 90-07) | `handleRowSelect` at `PrettyConversationsPanel.tsx:1022-1029` branches on `row.kind === "relay-room"` → `onRelayRoomRowClick(row)` → AppShell opens a tab with `sessionKind: "relay-room"` + `relayRoomId` + `relayRoomTitle`; `tabUtils.tsx` dispatches to `RelayRoomSessionPane` |
| Room-creation primitive (Matrix side) | Existing (Phase 89-02 landed this) | `createRoom({name, preset, visibility, roomAliasName})` at `src/backend/matrix/matrix-admin-client.ts:867` — POST `/_matrix/client/v3/createRoom` via admin creds; returns `{ok:true, roomId, roomAlias?}` or `AdminErr`. **NOTE: this uses ADMIN creds, not the user's own token — see gap below.** |
| Room-join primitive | Existing | `joinRoom(roomIdOrAlias, userId?)` at `src/backend/matrix/matrix-admin-client.ts:194` — POST `/_synapse/admin/v1/join/{room}` |
| Per-user token mint (if C wants to create-as-user) | Existing | `loginAsUser(mxid)` at `src/backend/matrix/matrix-admin-client.ts:135`; the D-slice `sendMessageAsUser` at L1273 already composes it for the send path |

**Two gaps slice C must fill** (no existing analog — planner will implement):

1. **`inviteToRoom(roomId, mxid, senderMxid?)` primitive** — no existing wrapper for `POST /_matrix/client/v3/rooms/{roomId}/invite`. Sends an invite via the caller's own token (if using `loginAsUser(senderMxid)`) or via admin creds. The shape file says the room is created "via the user's own relay identity" — this suggests either (a) `createRoom` should be composed with `loginAsUser` for a create-as-user path OR (b) admin creates the room and immediately transfers/invites. **Planner decides**; both endpoints already exist as primitives. The Matrix invite endpoint has no existing analog in `matrix-admin-client.ts` — closest analog for shape is `sendMessageAsUser` at L1273 (per-user token PUT via `loginAsUser`).
2. **`POST /relay-room/create` route** — no existing route on the backend for "create-a-room-and-invite-and-materialize" as one atomic-ish operation. This is the wire endpoint the modal calls.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/ui/features/pretty-conversations/NewConversationModal.tsx` | modal component | user input → API call | `src/ui/features/pretty-view/GlobalFilesModal.tsx` (radix Dialog shell) + `src/ui/features/session-launcher/NewSessionDialog.tsx` (mandatory-name input pattern) | composite match |
| `src/ui/features/pretty-conversations/NewConversationModal.test.tsx` | test | — | `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` (dialog testing) + `PrettyConversationsPanel.test.tsx` (menu-flow test pattern) | role match |
| `src/ui/features/pretty-conversations/ParticipantChip.tsx` | sub-component | render | `src/ui/features/pretty-view/AttachmentChipStrip.tsx` (chip primitive with X-remove) | exact-shape match, adapt content |
| `src/ui/features/pretty-conversations/ParticipantChipStrip.tsx` | sub-component | render + callback | `src/ui/features/pretty-view/AttachmentChipStrip.tsx` L52-83 (strip wrapper, null-when-empty, ARIA list) | exact |
| `src/ui/features/pretty-conversations/ParticipantSearchInput.tsx` | sub-component | render + controlled input | `PrettyConversationsPanel.tsx:1698-1729` (search-with-clear pattern already in this file) | exact — same feature area |
| `src/ui/features/pretty-conversations/ParticipantList.tsx` | sub-component | render (sectioned list, humans-then-agents, checkable rows) | `PrettyConversationRow.tsx` (avatar disc + hue emission) + `IdentityBadgeRow.tsx` (humans-first sort) | role + data-flow match; hue palette shared |
| `src/ui/features/pretty-conversations/ParticipantList.test.tsx` | test | — | `PrettyConversationRow.test.tsx` (row-under-test scaffold) | role match |
| `src/ui/features/pretty-conversations/useNewConversationForm.ts` | hook (form state machine) | client-side derivation | `NewSessionDialog.tsx` L26-46 (form state + validation) — but grow to hold `pickedHumans`, `pickedAgents`, `roomName`, `searchQuery`, `submitting` | partial (novel state shape) |
| `src/ui/features/pretty-conversations/useNewConversationForm.test.ts` | test | — | `useHoldToRecord.test.tsx` (hook-under-test scaffold in this codebase) | role match |
| `src/ui/api/relay-room-create-api.ts` | api client | request-response | `src/ui/api/user-management-api.ts` (authApi.post wrapper convention) | exact |
| `src/ui/api/relay-room-create-api.test.ts` | test | — | `src/ui/api/sessions-api.test.ts` | role match |
| `src/backend/database/routes/relay-room-create.ts` | backend REST route | request-response → Matrix + DB | `src/backend/database/routes/relay-room-participants.ts` (auth + Matrix + DB pattern, same subsystem) | exact — sibling route |
| `src/backend/database/routes/relay-room-create.test.ts` | test | — | `src/backend/database/routes/relay-room-participants.test.ts` (route-under-test with auth mock + DB mock + matrix-admin-client mock) | exact |
| `src/backend/matrix/matrix-admin-client.ts` (**extend**) | api client (append primitive) | request-response | in-file — new `inviteToRoom` primitive follows `joinRoom` (L194) + `sendMessageAsUser` (L1273) shape | exact (in-file extension) |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (**modify**) | panel (add menu item + modal mount) | orchestration | in-file — add "New conversation" as menu item at L2067-2072 array, mount `<NewConversationModal>` alongside existing modal mounts at L2025-2041 | in-file additions |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (**extend**) | test | — | existing "Test 5" pattern for menu-item-opens-dialog | role match |
| `src/ui/AppShell.tsx` (**modify**, minor) | orchestrator | — | in-file — pass-through: on successful create, call the same `onRelayRoomRowClick`-equivalent to open the pane (may be able to reuse the tab-open code path at L2139-2160) | in-file additions |
| `src/backend/index.ts` or route-mount site (**modify**) | infra | — | grep for `relay-room-participants` mount site — new route mounts alongside | in-file additions |

---

## Pattern Assignments

### `src/ui/features/pretty-conversations/NewConversationModal.tsx` (modal component, user-input → API)

**Primary analog (modal shell + close discipline):** `src/ui/features/pretty-view/GlobalFilesModal.tsx` — radix `DialogPrimitive.Root` + Overlay + Content with `onInteractOutside={e => e.preventDefault()}` (X + Esc only close paths), `absolute inset-4` full-screen fill on both surfaces.

**Secondary analog (mandatory-name field UX + submit validation):** `src/ui/features/session-launcher/NewSessionDialog.tsx` L20-104 — controlled name input, sanitizer, `setError` on empty, `handleSubmit` with early-return on invalid.

**Shell pattern to mirror** (GlobalFilesModal.tsx L192-223):
```tsx
<DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
  <DialogPrimitive.Portal container={container ?? undefined}>
    <DialogPrimitive.Overlay
      className={cn(
        "absolute inset-0 z-[110] bg-black/15",
        "supports-backdrop-filter:backdrop-blur-xs duration-100",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
      )}
    />
    <DialogPrimitive.Content
      onInteractOutside={(e) => {
        // Patch #111f pattern: prevent modal from closing when clicking
        // outside. X and Esc remain valid close paths.
        e.preventDefault();
      }}
      className={cn(
        "absolute inset-4 z-[120] outline-none",
        "flex flex-col overflow-hidden rounded-[24px]",
        "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
        "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
      )}
      style={{
        background: "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
        backdropFilter: "blur(28px) saturate(1.4)",
        WebkitBackdropFilter: "blur(28px) saturate(1.4)",
        border: "1px solid hsla(220, 65%, 55%, 0.32)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
        color: "#e8e4d8",
      }}
    >
      {/* header + body + footer */}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

**Notes on `absolute inset-4`:** this is the mobile-and-desktop-parity trick. `inset-4` fills the viewport minus a 16px margin. On desktop the content sits centered against the same margin (works down to phone widths); on mobile it fills the screen. This is exactly what the shape file wants — "one modal, not fundamentally different on each surface."

**Desktop max-width refinement:** per shape file "desktop dialog roughly 560px wide" — override `absolute inset-4` with a `max-w-[560px] mx-auto` variant on desktop (via `md:` prefix) OR use inline media-query style. Match the tapered-desktop pattern in `NewSessionDialog.tsx:54` (`w-full max-w-sm mx-4 relative z-10`). Compare both patterns; the shape file's "560px" tips toward `max-w-[560px] md:max-w-[560px]` — the modal fills the phone but sits centered on desktop.

**Close-button chrome (verbatim from GlobalFilesModal.tsx L253-276):**
```tsx
<DialogClose asChild>
  <button
    type="button"
    aria-label="Close"
    title="Close"
    className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
    style={{
      background: "rgba(255, 255, 255, 0.04)",
      border: "1px solid rgba(220, 225, 245, 0.10)",
    }}
    onMouseEnter={/* … */}
    onMouseLeave={/* … */}
  >
    <X className="size-4" />
  </button>
</DialogClose>
```

**Mandatory-room-name pattern (from NewSessionDialog.tsx L38-90):**
```tsx
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const trimmed = roomName.trim();
  if (!trimmed) {
    setError("Room name required");
    return;
  }
  if (pickedHumans.length + pickedAgents.length === 0) {
    setError("Pick at least one participant");
    return;
  }
  if (pickedHumans.length === 0 && pickedAgents.length === 1) {
    setError("A single agent conversation already exists — pick more participants");
    return;
  }
  onSubmit({ roomName: trimmed, pickedHumans, pickedAgents });
};
```

**Debounce on Create (per shape §What would make it wrong — "Two rapid clicks on Create produce two rooms"):**
```tsx
const [submitting, setSubmitting] = useState(false);
const handleSubmit = async (e) => {
  e.preventDefault();
  if (submitting) return; // sync guard
  setSubmitting(true);
  try {
    await createRelayRoom({ roomName, humans, agents });
  } finally {
    setSubmitting(false);
  }
};
// Disable Create button while submitting AND while gate conditions unmet
<Button disabled={submitting || !gateSatisfied}>Create</Button>
```

---

### `src/ui/features/pretty-conversations/ParticipantSearchInput.tsx` (search input, controlled)

**Analog (verbatim in-file pattern):** `PrettyConversationsPanel.tsx:1698-1729` — the existing "Search conversations" input in the same feature area. Copy the search-with-clear-affordance shape. This is a perfect analog: same feature dir, same visual language, same `Search` icon from lucide-react, same X-button-when-non-empty pattern.

**Verbatim block to adapt** (PrettyConversationsPanel.tsx:1698-1729):
```tsx
<div
  ref={searchContainerRef}
  className="pv-search-container"
  data-testid="pretty-conversations-search-container"
>
  <Search
    className="pv-search-icon"
    aria-hidden="true"
    width={16}
    height={16}
  />
  <input
    type="search"
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    placeholder="Search conversations"
    className="pv-search-input"
    data-testid="pretty-conversations-search-input"
    aria-label="Search conversations"
  />
  {searchQuery.length > 0 && (
    <button
      type="button"
      onClick={() => setSearchQuery("")}
      className="pv-search-clear"
      data-testid="pretty-conversations-search-clear"
      aria-label="Clear search"
    >
      <X width={14} height={14} aria-hidden="true" />
    </button>
  )}
</div>
```

**CSS reuse:** the `.pv-search-container`, `.pv-search-input`, `.pv-search-icon`, `.pv-search-clear` classes are already defined in `pretty-conversations.css`. Reuse verbatim — modal lives in the same feature dir, so scoping is natural.

**Case-insensitive substring filter (per shape §Shape "type-to-filter search bar"):**
```tsx
const q = searchQuery.trim().toLowerCase();
const filteredHumans = q === ""
  ? allHumans
  : allHumans.filter((h) => h.displayName.toLowerCase().includes(q));
const filteredAgents = q === ""
  ? allAgents
  : allAgents.filter((a) => a.displayName.toLowerCase().includes(q));
```

**"N of M" section-header count when filter active (per shape):**
```tsx
{q === "" ? (
  <SectionHeader>Humans</SectionHeader>
) : (
  <SectionHeader>Humans ({filteredHumans.length} of {allHumans.length})</SectionHeader>
)}
```

---

### `src/ui/features/pretty-conversations/ParticipantChipStrip.tsx` + `ParticipantChip.tsx` (chips-strip)

**Analog:** `src/ui/features/pretty-view/AttachmentChipStrip.tsx` (194 lines) — canonical chips-with-X-remove pattern already in the codebase.

**Strip wrapper pattern (AttachmentChipStrip.tsx L52-83):**
```tsx
export function ParticipantChipStrip({
  picked,
  onRemove,
  className,
}: ParticipantChipStripProps) {
  if (picked.length === 0) {
    // Empty-state placeholder text (per shape §Shape "Empty-state placeholder
    // text when nothing is picked"). Contrast with AttachmentChipStrip which
    // returns null when empty — here we render placeholder chrome instead.
    return (
      <div className="text-xs text-[color:var(--color-pv-fg-muted)] italic px-1 py-2">
        No participants selected yet
      </div>
    );
  }
  return (
    <div
      data-testid="participant-chip-strip"
      className={cn("flex flex-wrap gap-2 px-1 py-1", className)}
      role="list"
      aria-label="Selected participants"
    >
      {picked.map((p) => (
        <ParticipantChip key={p.mxid} participant={p} onRemove={onRemove} />
      ))}
    </div>
  );
}
```

**Individual chip pattern (adapted from AttachmentChipStrip.tsx L103-193):**
```tsx
function ParticipantChip({ participant, onRemove }) {
  // Color swatch — per shape "small color swatch (matching that participant's identity color)"
  // Use the same hue-to-swatch formula as ColorPicker.tsx L37 + RelayInboundBubble.tsx L82.
  const swatchColor = participant.colorHue !== null
    ? `hsl(${participant.colorHue}, 65%, 55%)`
    : "hsl(210, 8%, 50%)"; // NEUTRAL_GREY (matches RelayInboundBubble)
  return (
    <div
      data-testid="participant-chip"
      data-role={participant.role}
      className={cn(
        "inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs",
        "border shadow-[inset_0_1px_0_rgba(220,225,245,0.05)]",
        "bg-[rgba(10,12,20,0.5)] border-white/10 text-[#e8e4d8]",
      )}
      role="listitem"
    >
      <span
        aria-hidden
        className="inline-block size-3 rounded-full shrink-0"
        style={{ background: swatchColor }}
      />
      <span className="max-w-[220px] truncate">{participant.displayName}</span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={() => onRemove(participant.mxid)}
        aria-label={`Remove ${participant.displayName}`}
        title={`Remove ${participant.displayName}`}
        className="ml-1 opacity-70 hover:opacity-100 max-md:opacity-100"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
```

**Hue → swatch color derivation** — canonical formula from `RelayInboundBubble.tsx:82`:
```tsx
const avatarColor = colorHue !== null
  ? `hsl(${Number(colorHue)}, 80%, 60%)`  // resolved hue
  : "hsl(210, 8%, 50%)";                   // NEUTRAL_GREY
```
Both `65%,55%` (ColorPicker.tsx L37) and `80%,60%` (RelayInboundBubble.tsx L82) exist in the codebase — planner picks one; the RelayInboundBubble variant is more saturated and reads better against dark chrome.

---

### `src/ui/features/pretty-conversations/ParticipantList.tsx` (sectioned list with avatar + hue-tint rows)

**Analog A (avatar disc + hue tint per identity):** `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — L1084 emits `--pv-hue` custom property inline, L1195-1217 avatar disc render with `identity.avatarUrl` fallback to initial letter.

**Analog B (humans-first-alphabetical sort, no-self):** Slice D's `IdentityBadgeRow.tsx` (Phase 90 PATTERNS.md line 362-390) — even though slice D's implementation is a horizontal badge row, the sorting logic is identical to what Slice C needs for the vertical sectioned list.

**Avatar disc pattern (from PrettyConversationRow.tsx:1195-1217):**
```tsx
<div className="pv-avatar" data-testid="participant-row-avatar">
  {identity?.avatarUrl ? (
    <img
      src={identity.avatarUrl}
      alt=""
      className="pv-avatar-img"
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
      draggable={false}
    />
  ) : (
    <span className="pv-avatar-initial">{initialLetter}</span>
  )}
</div>
```

**`--pv-hue` inline emission (from PrettyConversationRow.tsx:1083-1089):**
```tsx
const bodyStyle: CSSProperties = {
  ...(hue !== null ? ({ "--pv-hue": hue } as CSSProperties) : {}),
};
// then on the row div:
<div style={bodyStyle} className={rowClassName}>
```

**Palette gradient CSS (from pretty-conversations.css:483-531 — reference; NO copy needed if reusing `.pv-row` class):**
```css
--pv-hue: 216;  /* fallback for hue-null rows */
background: linear-gradient(160deg,
  hsla(var(--pv-hue), 50%, 38%, 0.55),
  hsla(var(--pv-hue), 45%, 24%, 0.60));
border: 1px solid hsla(var(--pv-hue), 65%, 55%, 0.32);
box-shadow:
  0 0 0 0.5px hsla(var(--pv-hue), 70%, 55%, 0.20),
  0 0 32px hsla(var(--pv-hue), 70%, 52%, 0.18);
```

**Humans-first-then-agents sort + self-exclude (from Slice D IdentityBadgeRow pattern — 90-PATTERNS.md:362-390):**
```tsx
const humansOther = humans
  .filter((h) => h.mxid !== viewingUserMxid)
  .sort((a, b) => a.displayName.localeCompare(b.displayName));
const agentsSorted = [...agents].sort((a, b) =>
  a.displayName.localeCompare(b.displayName),
);
```

**Row structure — tap-to-toggle with checkbox affordance on right (per shape §Shape "a check circle on the right fills when the row is selected"):**
```tsx
function ParticipantRow({ participant, selected, onToggle }) {
  const hue = participant.colorHue;
  const rowStyle: CSSProperties = hue !== null
    ? ({ "--pv-hue": hue } as CSSProperties)
    : {};
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onToggle(participant.mxid)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(participant.mxid);
        }
      }}
      style={rowStyle}
      className={cn(
        "flex items-center gap-3 px-3 py-2 cursor-pointer",
        "border border-transparent rounded-lg",
        "hover:bg-white/5",
        selected && "bg-[hsla(var(--pv-hue,210),50%,38%,0.20)] border-[hsla(var(--pv-hue,210),65%,55%,0.32)]",
      )}
    >
      {/* Avatar disc — hue-tinted */}
      <div className="size-8 rounded-full shrink-0 overflow-hidden" style={{ background: `hsl(${hue ?? 210}, 60%, 45%)` }}>
        {participant.avatarUrl ? (
          <img src={participant.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex items-center justify-center size-full text-sm font-medium text-white">
            {participant.displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      {/* Body — name + optional agent subtitle */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#e8e4d8] truncate">{participant.displayName}</div>
        {participant.role === "agent" && participant.subtitle && (
          <div className="text-xs text-[color:var(--color-pv-fg-muted)] truncate">{participant.subtitle}</div>
        )}
      </div>
      {/* Check circle — filled when selected */}
      <div
        aria-hidden
        className={cn(
          "size-5 rounded-full border-2 shrink-0 flex items-center justify-center",
          selected
            ? "border-emerald-400 bg-emerald-400"
            : "border-white/20 bg-transparent",
        )}
      >
        {selected && <Check className="size-3 text-black" />}
      </div>
    </div>
  );
}
```

**Section header pattern:**
```tsx
<div
  role="separator"
  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)] px-3 pt-3 pb-1"
>
  {label}
  {filterActive && ` (${filtered.length} of ${total})`}
</div>
```

---

### `src/ui/features/pretty-conversations/useNewConversationForm.ts` (form state hook)

**Analog:** `NewSessionDialog.tsx` L26-46 (name-state pattern) + Slice D's `use-relay-room-stream.ts` shape (hook returning state + callbacks) — see 90-PATTERNS.md L497-513.

**Shape:**
```tsx
export type PickedParticipant = {
  mxid: string;
  displayName: string;
  colorHue: number | null;
  avatarUrl: string | null;
  role: "human" | "agent";
  userId?: string;      // present for humans (from users-list-basic)
  identityKey?: string; // present for agents (from identities-store)
  subtitle?: string;    // present for agents (per shape §Shape "(for agents) a subtitle line")
};

export type GateState =
  | { ok: true }
  | { ok: false; reason: "no-participants" | "single-agent-only" | "no-room-name" | "submitting" };

export function useNewConversationForm(opts: {
  humans: PickedParticipant[];    // from users-list-basic + mxid enrichment
  agents: PickedParticipant[];    // from identities-store, filtered to those with mxids
  viewingUserMxid: string | null; // exclude from picker
}) {
  const [roomName, setRoomName] = useState("");
  const [pickedMxids, setPickedMxids] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter available participants (exclude self, apply search)
  const availableHumans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return opts.humans
      .filter((h) => h.mxid !== opts.viewingUserMxid)
      .filter((h) => q === "" || h.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [opts.humans, opts.viewingUserMxid, searchQuery]);

  const availableAgents = useMemo(() => { /* same shape */ }, [opts.agents, searchQuery]);

  // Selected picks (for chips-strip)
  const picked = useMemo(() => {
    return [...opts.humans, ...opts.agents].filter((p) => pickedMxids.has(p.mxid));
  }, [opts.humans, opts.agents, pickedMxids]);

  // Gate — per shape §Shape "disabled until three conditions hold"
  const gate: GateState = useMemo(() => {
    if (submitting) return { ok: false, reason: "submitting" };
    if (roomName.trim() === "") return { ok: false, reason: "no-room-name" };
    if (pickedMxids.size === 0) return { ok: false, reason: "no-participants" };
    if (picked.length === 1 && picked[0].role === "agent") {
      return { ok: false, reason: "single-agent-only" };
    }
    return { ok: true };
  }, [submitting, roomName, pickedMxids.size, picked]);

  const toggle = useCallback((mxid: string) => {
    setPickedMxids((prev) => {
      const next = new Set(prev);
      if (next.has(mxid)) next.delete(mxid);
      else next.add(mxid);
      return next;
    });
  }, []);

  return {
    roomName, setRoomName,
    searchQuery, setSearchQuery,
    picked,
    availableHumans, availableAgents,
    toggle,
    remove: (mxid: string) => setPickedMxids((s) => { const n = new Set(s); n.delete(mxid); return n; }),
    gate,
    submitting, setSubmitting,
    error, setError,
  };
}
```

**Hint text per shape §Shape "Hint text below the button explains the current blocker":**
```tsx
function gateHint(gate: GateState): string | null {
  if (gate.ok) return null;
  switch (gate.reason) {
    case "no-participants": return "Pick at least one participant";
    case "single-agent-only": return "A single-agent conversation already exists in your list";
    case "no-room-name": return "Enter a name for this conversation";
    case "submitting": return "Creating…";
  }
}
```

---

### `src/ui/api/relay-room-create-api.ts` (frontend API client)

**Analog:** `src/ui/api/user-management-api.ts` — canonical `authApi.post(...)` wrapper convention with `handleApiError`.

**Shape:**
```tsx
import { authApi } from "@/main-axios";
import { handleApiError } from "./error-utils"; // grep for import convention

export interface CreateRelayRoomRequest {
  roomName: string;
  humanMxids: string[];
  agentMxids: string[];
}

export interface CreateRelayRoomResponse {
  ok: true;
  roomId: string;
  sessionId: string;     // the relay_room_sessions.id row Skynet inserted
  roomTitle: string;
}

export async function createRelayRoom(
  req: CreateRelayRoomRequest,
): Promise<CreateRelayRoomResponse> {
  try {
    const response = await authApi.post("/relay-room/create", req);
    return response.data as CreateRelayRoomResponse;
  } catch (error) {
    handleApiError(error, "create relay room");
  }
}
```

---

### `src/backend/database/routes/relay-room-create.ts` (backend REST route)

**Analog:** `src/backend/database/routes/relay-room-participants.ts` (this exact file — sibling route in the same subsystem; auth, matrix-admin-client integration, mxid lookup, DB access, error patterns are all identical).

**Full-fidelity mirror structure to adopt:**

**Preamble (imports + auth wiring — from `relay-room-participants.ts` L47-63):**
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  createRoom,
  inviteToRoom,       // NEW primitive slice C adds to matrix-admin-client.ts
  loginAsUser,        // for creating room as-user if planner picks that path
} from "../../matrix/matrix-admin-client.js";
import { materializeRelayRoomSession } from "../../relay-sessions/relay-room-sessions-store.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**Viewing user mxid lookup (verbatim from `relay-room-participants.ts` L78-99):**
```typescript
async function lookupViewingUserMxid(userId: string): Promise<string | null> {
  try {
    const rows = (await db
      .select({ mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ mxid: string | null }>;
    const row = rows[0];
    if (row === undefined) return null;
    return typeof row.mxid === "string" && row.mxid.length > 0 ? row.mxid : null;
  } catch (err) {
    databaseLogger.warn("relay-room-create: lookupViewingUserMxid failed", {
      operation: "relay_room_create_lookup_viewer_mxid_failed",
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}
```

**Route body (composite of relay-room-participants.ts pattern + shape file requirements):**
```typescript
router.post("/create", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  // ─── Validate body ───────────────────────────────────────────────────
  const body = req.body as {
    roomName?: unknown;
    humanMxids?: unknown;
    agentMxids?: unknown;
  };
  if (typeof body.roomName !== "string" || body.roomName.trim() === "") {
    return res.status(400).json({ ok: false, error: "room_name_required" });
  }
  if (!Array.isArray(body.humanMxids) || !Array.isArray(body.agentMxids)) {
    return res.status(400).json({ ok: false, error: "invalid_participants" });
  }
  // Mxid grammar validation — reuse the MXID_RE from matrix-admin-routes.ts:30
  // (see canonical_refs in 88-CONTEXT.md).
  const humanMxids = body.humanMxids.filter((s) => typeof s === "string" && MXID_RE.test(s));
  const agentMxids = body.agentMxids.filter((s) => typeof s === "string" && MXID_RE.test(s));

  // Gate: zero-participant disallowed
  if (humanMxids.length === 0 && agentMxids.length === 0) {
    return res.status(400).json({ ok: false, error: "no_participants" });
  }
  // Gate: single-agent-alone disallowed (UX coherence per shape §Philosophy)
  if (humanMxids.length === 0 && agentMxids.length === 1) {
    return res.status(400).json({ ok: false, error: "single_agent_disallowed" });
  }

  // ─── Look up viewing user's mxid ─────────────────────────────────────
  const viewerMxid = await lookupViewingUserMxid(userId);
  if (viewerMxid === null) {
    return res.status(400).json({ ok: false, error: "viewer_no_mxid" });
  }

  // ─── Create room via user's own token ────────────────────────────────
  // Per shape §Shape "A room is created on the relay via the user's own
  // relay identity". Two path options for planner:
  //   Option A: admin creates + immediately invites viewer to auto-join
  //             (uses existing createRoom + inviteToRoom via admin creds).
  //   Option B: mint per-user token via loginAsUser(viewerMxid), then
  //             POST /_matrix/client/v3/createRoom with that token — the
  //             viewer is the room creator (PL100), matches shape verbatim.
  // Slice D's sendMessageAsUser (matrix-admin-client.ts:1273) already
  // establishes the loginAsUser-then-authenticated-request pattern; slice
  // C's inviteToRoom + createRoomAsUser should mirror it.
  const roomResult = await createRoom({
    name: body.roomName.trim(),
    preset: "private_chat",
    visibility: "private",
  });
  if (!roomResult.ok) {
    databaseLogger.warn("relay_room_create: createRoom failed", {
      operation: "relay_room_create_room_failed",
      userId,
      downstreamStatus: roomResult.status,
      downstreamError: roomResult.error,
    });
    return res.status(502).json({ ok: false, error: "proxy" });
  }
  const roomId = roomResult.roomId;

  // ─── Invite all picked participants ──────────────────────────────────
  // Best-effort: log per-mxid failures but proceed (partial-room is worse
  // than no-room but not catastrophic — the user can see who joined).
  // Alternatively: strict — refuse-on-any-invite-failure + rollback the
  // room creation. Planner picks; shape file §What would make it wrong
  // rules out "producing a room" as a bad-final-state, which weakly
  // suggests strict + rollback is safer. Debate at plan time.
  const allInvites = [...humanMxids, ...agentMxids];
  for (const mxid of allInvites) {
    const inviteResult = await inviteToRoom(roomId, mxid);
    if (!inviteResult.ok) {
      databaseLogger.warn("relay_room_create: invite failed", {
        operation: "relay_room_create_invite_failed",
        userId, roomId, inviteeMxid: mxid,
        downstreamStatus: inviteResult.status,
      });
      // Optional rollback: call deactivateRoom or similar. See planner.
    }
  }

  // ─── Materialize the session row (D-14 schema-as-coordinator) ────────
  // This is the create-time fast-path per Phase 89 D-14. The observation
  // loop is the safety net — if this insert fails mid-way, the next tick
  // (~10s) will see the room membership and materialize it via the same
  // primitive. Uniqueness on (user_id, room_id) makes the two paths idempotent.
  await materializeRelayRoomSession(userId, roomId, body.roomName.trim());

  // ─── Look up the just-inserted row id for the response ───────────────
  const sessionRow = db.$client
    .prepare(`SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?`)
    .get(userId, roomId) as { id?: string } | undefined;

  databaseLogger.info("relay_room_create ok", {
    operation: "relay_room_create_ok",
    userId,
    roomId,
    humansCount: humanMxids.length,
    agentsCount: agentMxids.length,
  });

  return res.status(201).json({
    ok: true,
    roomId,
    sessionId: sessionRow?.id ?? "",
    roomTitle: body.roomName.trim(),
  });
});

export default router;
```

---

### `src/backend/matrix/matrix-admin-client.ts` (extend with `inviteToRoom`)

**Analog A (in-file preamble discipline):** L1-46 preamble locks the six per-primitive invariants — every new primitive MUST follow them (per Slice D PATTERNS.md § Shared Patterns 4-6).

**Analog B (closest existing primitive):** `joinRoom` at L194-235 — same admin-Bearer POST shape.

**Analog C (loginAsUser + per-user token, if inviting as-user):** `sendMessageAsUser` at L1273 (Slice D shipped this) — the mint-per-user-token pattern.

**Endpoint:** `POST /_matrix/client/v3/rooms/{roomId}/invite` with `{ user_id: mxidToInvite }` body. Auth: caller's own token if using loginAsUser-style path OR admin token.

**Shape (mirror joinRoom's structure, adapt endpoint + payload):**
```typescript
export type InviteToRoomOk = { ok: true };

/**
 * Invite a Matrix user to a room. Called from Slice C's
 * `POST /relay-room/create` after room creation succeeds.
 *
 * POST /_matrix/client/v3/rooms/{roomId}/invite
 *
 * Body: { user_id: mxidToInvite }
 *
 * If `senderMxid` is provided, the invite is sent via that user's own
 * token (minted via `loginAsUser`) — matches the shape file's "the room
 * is created via the user's own relay identity" requirement. If omitted,
 * the invite is sent via admin creds (functional but attributes the
 * invite to @skynet-admin, which may confuse recipients).
 */
export async function inviteToRoom(
  roomId: string,
  mxidToInvite: string,
  senderMxid?: string,
): Promise<InviteToRoomOk | AdminErr> {
  let accessToken: string;
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: ERR_CREDS_MISSING };

  if (senderMxid !== undefined) {
    const login = await loginAsUser(senderMxid);
    if (!login.ok) return login;
    accessToken = login.accessToken;
  } else {
    accessToken = creds.accessToken;
  }

  const url = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: mxidToInvite }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: ERR_NON_2XX };
    return { ok: true };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_invite_to_room",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**Similar: `createRoomAsUser` variant** — if planner decides to have the viewer be the actual creator (option B above, cleaner semantics), a `createRoomAsUser(senderMxid, opts)` primitive can be added following the same `loginAsUser`-then-authenticated-POST shape. Look at the existing `createRoom` at L867-930 as the base; the ONLY change is swapping the Bearer token from admin to `login.accessToken`.

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (modify — add menu item + mount modal)

**Add menu item** (at L2067-2072, per shape §Shape "The compose action lives inside the existing three-dot menu"):
```tsx
{[
  { label: "New conversation", onClick: () => setNewConversationModalOpen(true) }, // NEW
  { label: "New agent", onClick: () => setNewSessionDialogOpen(true) },
  { label: "New role", onClick: () => setCreateRoleDialogOpen(true) },
  { label: "Edit global files…", onClick: () => setGlobalFilesModalOpen(true) },
  { label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) },
].map(/* … */)}
```

Note existing lock: `KEEP ORDER: New agent → New role → Edit global files… → Edit skills… (Phase 44 Pitfall 8 guard — do not alphabetize or reshuffle)`. Placing "New conversation" **first** is a clean addition; discuss with Ashley if item order matters, but the shape file's "three-dot menu" placement doesn't lock order relative to existing items.

**Mount modal** (sibling of `GlobalFilesModal` at L2025-2041):
```tsx
{/* Phase 91 — NewConversationModal — portal-mounted sibling of existing
    modal mounts. Opened via the header MoreVertical menu's "New
    conversation" item. Controlled state; the modal itself owns form state
    via useNewConversationForm hook. On successful create, calls
    onCreateRelayRoom which threads through AppShell to open the pane. */}
<NewConversationModal
  open={newConversationModalOpen}
  onOpenChange={setNewConversationModalOpen}
  onCreated={(result) => {
    setNewConversationModalOpen(false);
    onCreateRelayRoom?.(result); // AppShell-side handler opens the tab
  }}
/>
```

**State declaration** (add alongside existing state at ~L578-586):
```tsx
const [newConversationModalOpen, setNewConversationModalOpen] = useState(false);
```

**Add prop to `PrettyConversationsPanelProps`** (near existing `onCreateSession`, `onRdpRowClick`, `onRelayRoomRowClick`):
```tsx
onCreateRelayRoom?: (result: CreateRelayRoomResponse) => void;
```

**Gate on menu-item visibility** — the menu button is gated on `showPencilButton = typeof onCreateSession === "function"` (L978). Slice C could add a separate gate OR ride the same one (simpler; both surfaces coexist). Ashley discussed this in the shape as a v1-throwaway placement, so riding the existing gate is fine.

---

### `src/ui/AppShell.tsx` (modify — wire onCreateRelayRoom handler)

**Analog:** existing `onRelayRoomRowClick` handler at L2139-2160 (Slice D). On successful create, we want the same effect as a row-click on a relay-room row that already exists.

**Add prop handler alongside existing wiring:**
```tsx
onCreateRelayRoom={(result: CreateRelayRoomResponse) => {
  // Open a new tab pointing at the just-created room. Mirrors the
  // onRelayRoomRowClick shape (L2139-2160) but with roomId + roomTitle
  // from the create-response instead of from a sidebar row.
  openTabForSession({
    hostId: null,
    tmuxSession: result.sessionId,
    sessionKind: "relay-room",
    relayRoomId: result.roomId,
    relayRoomTitle: result.roomTitle,
  });
}}
```

**Note on sidebar refresh:** the observation loop (Slice B Phase 89-03) refreshes `/sessions/list` on its own ~10s tick. The create-time fast path via `materializeRelayRoomSession` writes the row synchronously, so the NEXT `/sessions/list` fetch (whenever it happens — some `useFleetSessions` cycle) surfaces the row. Consider whether Slice C should trigger an explicit refresh to shrink the window between "modal closes" and "sidebar entry visible." Look at how `NewSessionDialog` triggers a fleet-refresh on submit — similar pattern applies.

---

## Shared Patterns (cross-cutting)

Six patterns from Slice D's PATTERNS.md carry over verbatim; Slice C inherits them.

### 1. React text children — NEVER `dangerouslySetInnerHTML`

**Apply to:** `ParticipantChip.tsx`, `ParticipantList.tsx` (participant `displayName`s from strangers are untrusted), `NewConversationModal.tsx` (`roomName` field).
**Source:** RelayInboundBubble.tsx L186 comment "T-17-03-01".

### 2. Structured logging at boundaries — explicit fields, NEVER `JSON.stringify(event)`

**Apply to:** the create route's success + failure paths.
**Pattern:**
```typescript
databaseLogger.info("relay_room_create ok", {
  operation: "relay_room_create_ok",
  userId,
  roomId,
  humansCount: humanMxids.length,
  agentsCount: agentMxids.length,
});
```

### 3. Backend-proxied Matrix — NEVER leak admin or per-user tokens to browser

**Apply to:** `POST /relay-room/create` response body — never include Matrix response bodies, tokens, or admin creds. Response fields are: `ok`, `roomId`, `sessionId`, `roomTitle` — all Skynet-owned identifiers.

### 4. Discriminated-union `{ok:true, ...} | {ok:false, status, error}` return shape

**Apply to:** `inviteToRoom` primitive. Same `ERR_CREDS_MISSING` / `ERR_NON_2XX` / `ERR_TIMEOUT` / `ERR_PROXY` constants.

### 5. AbortController + 30s timeout on every backend fetch

**Apply to:** `inviteToRoom` implementation. Same `clearTimeout` in BOTH success + error paths pattern from Slice D shared pattern #5 (90-PATTERNS.md L911-931).

### 6. `encodeURIComponent` on every externally-supplied path arg

**Apply to:** `inviteToRoom` (encode `roomId` in the URL — the mxid goes in the JSON body so no encoding needed there).

### 7. `DatabaseSaveTrigger.forceSave` after any user-row write

**Apply to:** the create route inserts via `materializeRelayRoomSession` which already handles forceSave internally (per relay-room-sessions-store.ts:87). No additional forceSave needed at the route level, BUT verify — planner should grep-confirm.

### 8. Test-file structure — vitest + testing-library + fixture-factory pattern

**Apply to:** every new `*.test.tsx` and `*.test.ts` in slice C.
**Source:** `PrettyConversationsPanel.relay-room.test.tsx` L37-77 (recent, in-feature-dir example — has all the mocks slice C's tests need).
**Pattern:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
// mocks BEFORE component import (Vitest hoists vi.mock)
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({ byKey: new Map(), identities: [], loaded: true, refresh: async () => {} }),
}));
vi.mock("@/api/user-management-api", () => ({
  getUsersListBasic: vi.fn(async () => []),
}));
vi.mock("@/api/relay-room-create-api", () => ({
  createRelayRoom: vi.fn(async () => ({ ok: true, roomId: "!room:server", sessionId: "s-1", roomTitle: "Test" })),
}));
```

---

## Mobile-vs-Desktop Layout Switching

Shape file: "The modal must work equally well as a mobile full-screen modal and as a centered desktop dialog." Concretely:

**Primary pattern — CSS-only via `absolute inset-4` + `md:` breakpoint modifier** (from GlobalFilesModal.tsx L203-214):
- `absolute inset-4` — the base fills the viewport minus 16px on all sides. Works uniformly on both surfaces.
- On desktop, add `md:max-w-[560px] md:left-1/2 md:-translate-x-1/2 md:right-auto md:inset-y-8` (or equivalent) so it centers at 560px width instead of filling.
- Alternative simpler pattern (from NewSessionDialog.tsx L49-54): `fixed inset-0 flex items-center justify-center z-[500]` outer + inner `w-full max-w-sm mx-4` — automatic centering, natural mobile behavior.

**Reactive breakpoint hook (if needed for logic branching):** `useIsMobile()` at `src/ui/hooks/use-mobile.ts:5` — `window.innerWidth < 768`, subscribes to `matchMedia`. Widely used in the codebase (`AppShell.tsx:363`, `IdentityBadge.tsx:73`, `Terminal.tsx:268`, `PrettyConversationRow.tsx`). Slice C's modal probably doesn't need JS-based branching — CSS media queries + Tailwind `md:` prefixes suffice for the layout adaptations described in the shape file.

**Compare with also-viable pattern in NewSessionDialog.tsx L54:**
```tsx
<div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-sm mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
```
This is a lighter-weight, no-radix pattern. On desktop it caps at `max-w-sm` (384px) — too narrow for the modal shape described. Use GlobalFilesModal's `absolute inset-4` + `md:max-w-[560px]` refinement instead, OR bump `max-w-sm` to `max-w-[560px]` on the NewSessionDialog pattern.

**Recommendation:** GlobalFilesModal's radix Dialog approach is more robust (a11y, focus trap, portal, X + Esc close discipline all handled) and is the newer/canonical pattern in the codebase. Take that path.

---

## Palette Reference — `--color-pv-*` + hue conventions

**Token list** (from `pretty-conversations.css` + `RelayInboundBubble.tsx`):
- `--color-pv-fg` — primary text (`#f0ebe0`-ish warm cream)
- `--color-pv-fg-muted` — secondary text
- `--color-pv-fg-dim` — tertiary text
- `--color-pv-border-quiet` — subtle borders
- `--color-pv-border-quiet-strong` — slightly-heavier borders
- `--color-pv-surface-quiet`, `--color-pv-surface-quiet-alt` — background gradients
- `--color-pv-code-fg` — amber accent
- `--radius-pv-bubble`, `--radius-pv-card` — corner radii

**Hue convention** (identity-scoped custom property):
- `--pv-hue` set inline per row/badge based on `identity.colorHue: number | null`
- Fallback: 216 (blue-cool) for hue-null identities
- Recipe for tinted bubbles/rows (from `pretty-conversations.css:503`):
  ```css
  background: linear-gradient(160deg,
    hsla(var(--pv-hue), 50%, 38%, 0.55),
    hsla(var(--pv-hue), 45%, 24%, 0.60));
  border: 1px solid hsla(var(--pv-hue), 65%, 55%, 0.32);
  ```
- Recipe for participant avatar circle (from `RelayInboundBubble.tsx:82`):
  ```tsx
  const avatarColor = colorHue !== null
    ? `hsl(${Number(colorHue)}, 80%, 60%)`
    : "hsl(210, 8%, 50%)"; // NEUTRAL_GREY
  ```

**Human hue derivation** — CAUTION: `users.mxid` and `users.username` exist, but there's no `users.colorHue`. Humans in Skynet's data model **do not have a persisted colorHue today** — this is likely a gap slice C needs to address. Options:
1. Derive hue at render time from mxid via a deterministic hash (like `hueFromSessionName` at `src/ui/features/terminal/session-hue.ts:12` — a DJB2 mod 360). This is the fallback pattern already used for unresolved-identity bubbles.
2. Persist a per-user colorHue in `users.color_hue` — a new schema column. Bigger scope; probably out of scope for slice C given shape file's "v1-throwaway placement" tone.

**Recommendation:** derive at render time via hash — matches the existing `hueFromSessionName` approach and avoids schema changes. Use the mxid or `userId` as the hash input for determinism.

---

## User-Flow Test Pattern (modal open → pick → confirm → sidebar-appears)

**Analog:** `PrettyConversationsPanel.test.tsx` "Test 5" (Phase 23 GEFM-01 repoint; L1259+) — the canonical test for menu-item-opens-dialog pattern already in this feature dir.

**Test structure to mirror:**
```tsx
it("Test N: clicking MoreVertical + selecting 'New conversation' opens NewConversationModal", async () => {
  render(<PrettyConversationsPanel {...props} onCreateSession={vi.fn()} onCreateRelayRoom={vi.fn()} />);
  // 1. Click the header menu button
  const menuButton = screen.getByTestId("pv-header-menu-button");
  fireEvent.click(menuButton);
  // 2. Assert menu shows "New conversation"
  const newConversationItem = screen.getByRole("menuitem", { name: /New conversation/i });
  expect(newConversationItem).toBeInTheDocument();
  // 3. Click it
  fireEvent.click(newConversationItem);
  // 4. Assert modal is visible
  const modal = await screen.findByRole("dialog", { name: /New conversation/i });
  expect(modal).toBeInTheDocument();
});
```

**End-to-end flow test (modal → pick → confirm → callback fired):**
```tsx
it("Test N+1: pick one human + one agent + name + click Create → onCreated fires with response", async () => {
  const mockCreated = vi.fn();
  vi.mocked(getUsersListBasic).mockResolvedValueOnce([
    { id: "u-1", username: "alice" }, { id: "u-2", username: "bob" },
  ]);
  vi.mocked(createRelayRoom).mockResolvedValueOnce({
    ok: true, roomId: "!room:s", sessionId: "s-1", roomTitle: "Chat",
  });
  render(<NewConversationModal open={true} onOpenChange={vi.fn()} onCreated={mockCreated} />);
  // 1. Enter name
  fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: "Chat" } });
  // 2. Click bob row (participant list)
  fireEvent.click(screen.getByText("bob"));
  // 3. Click an agent row
  fireEvent.click(screen.getByText("mockAgent"));
  // 4. Click Create
  fireEvent.click(screen.getByRole("button", { name: /create/i }));
  // 5. Assert onCreated fired
  await waitFor(() => expect(mockCreated).toHaveBeenCalledWith({
    ok: true, roomId: "!room:s", sessionId: "s-1", roomTitle: "Chat",
  }));
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason / Recommendation |
|---|---|---|---|
| `inviteToRoom` primitive in matrix-admin-client.ts | api client (append primitive) | request-response | No existing Matrix-invite primitive in the file. Slice C ADDS it. Shape mirrors `joinRoom` (L194) + `sendMessageAsUser` (L1273) as documented above. |
| `POST /relay-room/create` route | REST | request-response | No existing route creates a relay room. Slice C creates it. Shape mirrors `relay-room-participants.ts` (auth + mxid lookup + Matrix + DB pattern). |
| Human-side colorHue derivation | derivation helper | pure | No `users.color_hue` column exists today; humans have no persisted hue. Recommend deterministic hash of `mxid` via `hueFromSessionName`-style DJB2 formula (session-hue.ts:12). Alternative: schema change (out of scope for slice C). |

---

## Component-Tree File Layout

```
src/ui/features/pretty-conversations/         # SAME feature dir as the panel
├── NewConversationModal.tsx                  # NEW — the modal shell
├── NewConversationModal.test.tsx             # NEW
├── ParticipantChip.tsx                       # NEW — single chip
├── ParticipantChipStrip.tsx                  # NEW — strip wrapper
├── ParticipantSearchInput.tsx                # NEW — search input with clear
├── ParticipantList.tsx                       # NEW — sectioned list w/ tap-to-toggle
├── ParticipantList.test.tsx                  # NEW
├── useNewConversationForm.ts                 # NEW — form state hook
├── useNewConversationForm.test.ts            # NEW
├── PrettyConversationsPanel.tsx              # MODIFY — add menu item + mount modal
└── PrettyConversationsPanel.test.tsx         # MODIFY — extend with new tests

src/ui/api/
├── relay-room-create-api.ts                  # NEW — createRelayRoom() client
└── relay-room-create-api.test.ts             # NEW

src/backend/matrix/matrix-admin-client.ts     # EXTEND — inviteToRoom primitive

src/backend/database/routes/
├── relay-room-create.ts                      # NEW — POST /relay-room/create
└── relay-room-create.test.ts                 # NEW

src/backend/index.ts (or route-mount site)    # MODIFY — mount /relay-room prefix
src/ui/AppShell.tsx                           # MODIFY — thread onCreateRelayRoom handler
```

**Note on route mounting:** the existing `relay-room-participants.ts` route lives at `/relay-room/:roomId/participants`. Slice C's `/relay-room/create` should mount on the same prefix. Grep for the mount site (likely `src/backend/index.ts` or `src/backend/routes-mount.ts`) to see how `relay-room-participants` is wired; slice C adds a sibling `router.use("/relay-room", relayRoomCreateRouter)` mount OR merges into the same router.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-conversations/` — feature dir, primary landing site for slice C
- `src/ui/features/pretty-view/` — modal shells (GlobalFilesModal, IdentityModal), chip strip (AttachmentChipStrip), inbound bubble hue pattern (RelayInboundBubble)
- `src/ui/features/session-launcher/` — NewSessionDialog for lighter modal pattern + mandatory-name discipline
- `src/ui/features/terminal/` — session-hue derivation helpers
- `src/ui/api/` — authApi.post + handleApiError convention (user-management-api)
- `src/ui/state/` — identities-store (useIdentities), conversation-store (FleetSession/kind marker)
- `src/ui/hooks/` — useIsMobile (mobile-vs-desktop hook — probably unused; CSS suffices)
- `src/backend/matrix/` — matrix-admin-client.ts (createRoom, joinRoom, loginAsUser, sendMessageAsUser)
- `src/backend/database/routes/` — relay-room-participants.ts (sibling route pattern), sessions.ts (auth-JWT middleware pattern), users-list-basic.ts (picker-facing user list)
- `src/backend/relay-sessions/` — relay-room-sessions-store.ts (materialize primitive)
- `.planning/phases/88..90-*/` — sub-slice context + summaries + Slice D PATTERNS.md

**Files read (grep + Read):** ~28 files sampled at load-bearing line ranges. No re-reads.

**Pattern extraction date:** 2026-09-09

---

## PATTERN MAPPING COMPLETE

**Phase:** 91 - Relay-mediated group conversations sub-slice C — new-conversation modal + create-room flow
**Files classified:** 14 new + 5 modified = 19 total
**Analogs found:** 18 / 19

### Coverage

- Files with exact analog: 12 (route, chip strip, search input, radix Dialog shell, materialize primitive, test scaffolds, hue-tint patterns, sessions-api wire types)
- Files with role-match / composite analog: 5 (modal orchestrator, participant list layout, form-state hook, in-file modifications on the panel + AppShell)
- Files with NO analog (slice C introduces the pattern): 3 (inviteToRoom primitive in matrix-admin-client, POST /relay-room/create route, human-side colorHue derivation)

### Key Patterns Identified

- **Modal shell** — radix `DialogPrimitive.Root` + `Overlay` + `Content` with `onInteractOutside={e => e.preventDefault()}` (X + Esc only close paths), `absolute inset-4` for mobile+desktop parity, `md:max-w-[560px]` for desktop centering. Canonical: `GlobalFilesModal.tsx`.
- **Search-with-clear** — verbatim pattern from `PrettyConversationsPanel.tsx:1698-1729` (in the same feature dir). Reuses `.pv-search-container`/`.pv-search-input`/`.pv-search-clear` CSS classes.
- **Chips strip** — pattern from `AttachmentChipStrip.tsx`; adapt content for participant chips with color swatch, name, X-remove.
- **Hue-tinted rows** — `--pv-hue` custom property emitted inline; CSS palette gradient recipe from `pretty-conversations.css:483-531`. Avatar circle uses `hsl(${colorHue}, 80%, 60%)` per `RelayInboundBubble.tsx:82`.
- **Backend integration** — `relay-room-participants.ts` is the exact sibling-pattern for `POST /relay-room/create`: same auth middleware, same viewer-mxid lookup, same matrix-admin-client + relay-room-sessions-store composition, same error patterns.
- **Slice B integration** — `materializeRelayRoomSession(userId, roomId, roomTitle)` at `relay-room-sessions-store.ts:63` is idempotent (INSERT ... ON CONFLICT DO NOTHING); slice C calls it at create-time; observation loop is the safety net.
- **Slice D handoff** — on successful create, thread `sessionKind: "relay-room"` + `relayRoomId` + `relayRoomTitle` onto the tab; `tabUtils.tsx` dispatches to `RelayRoomSessionPane` (Slice D). No new pane orchestration needed.
- **Mobile-vs-desktop** — CSS-only via `absolute inset-4` + `md:` breakpoint prefixes suffices. `useIsMobile()` hook available at `src/ui/hooks/use-mobile.ts:5` if JS-side branching is ever needed (probably isn't).

### Files Requiring Creation (No Existing Analog)

- **`inviteToRoom` primitive** in `matrix-admin-client.ts` — the file has no Matrix-invite wrapper. Slice C adds it. Shape mirrors `joinRoom` (L194) + `sendMessageAsUser` (L1273). Follows the six per-primitive invariants at L1-46.
- **`POST /relay-room/create` route** — new endpoint. Sibling `relay-room-participants.ts` is the exact structural analog.
- **Human colorHue derivation** — `users.color_hue` doesn't exist. Recommend deterministic hash (`hueFromSessionName`-style DJB2 mod 360) on the mxid at render time; avoids schema change.

### File Created

`/home/ubuntu/skynet-taylor/.planning/phases/91-relay-mediated-group-conversations-sub-slice-c-new-conversat/91-PATTERNS.md`

### Ready for Planning

Pattern mapping complete. Planner can now reference concrete analog patterns (with file paths + line numbers) in each PLAN.md action section. Slice C's diff is composition-heavy over existing primitives from sub-slices A + B + D; the only genuinely new code is the modal component tree, the `inviteToRoom` primitive, and the `POST /relay-room/create` route.
