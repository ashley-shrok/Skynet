import { useEffect, useRef } from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Folder, GitPullRequestDraft, Pin } from "lucide-react";
import { useIdentities } from "@/state/identities-store";
import { useProjects, usePinnedIds, fleetRowId } from "@/state/conversation-store";
import { useIsMobile } from "@/hooks/use-mobile";
import type { TabType } from "@/types/ui-types";
import { armOutboundDrag, mintDragId } from "@/shell/cross-window-drag";
// Phase 68 Plan 04: avatarUrlWithHost deleted — backend bakes hostId into identity.avatarUrl.
// Phase 104 Plan 02: the `hostId` prop below is REACTIVATED for the trapped-
// work store lookup (superseding the Phase 68 "no longer used" note). Existing
// call sites already thread it (IdentitySessionPane.tsx L291,410,445); no prop
// signature change needed.
import {
  getCoordinatorWatermarkStyle,
  COORDINATOR_WATERMARK_HUE_FALLBACK,
} from "@/features/pretty-view/coordinator-watermark";
// Phase 104 Plan 02: per-identity trapped-work indicator (D-05 same visual
// across both surfaces — conv-list row + this pretty-view header badge).
import { useTrappedWork } from "@/state/trapped-work-store";

export interface IdentityBadgeProps {
  identityKey: string | null;
  /** Phase 66 Plan 05 (now superseded by Phase 68 Plan 04): hostId was previously
   *  threaded to build the avatar URL via avatarUrlWithHost. Phase 68: the backend
   *  bakes hostId into identity.avatarUrl at emit time; this prop is no longer used
   *  for URL construction. Kept for backward-compat with existing call sites that
   *  still pass it; safe to omit from new call sites. */
  hostId?: number;
  // When provided, the badge renders as a <button> with click affordance
  // (cursor-pointer, hover scale, aria-label). When absent, the badge
  // renders as a <div aria-hidden> — backward-compat with call sites
  // that don't wire the click.
  onClick?: () => void;
  // Phase 58 Plan 01: identity-badge as third-gesture drag source.
  // When provided AND useIsMobile() is false, the badge root becomes
  // draggable=true and a dragstart handler writes the wire contract
  // (text/plain: tabId + application/x-skynet-badge: JSON.stringify({tabId}))
  // to dataTransfer with effectAllowed="move". Downstream drop targets
  // discriminate on the application/x-skynet-badge MIME:
  //   - Phase 56 Pane onDrop reads text/plain and routes to
  //     openSessionInTree(tabId, path, edge) — rearranges within the tree.
  //   - Phase 58 Plan 02 conv-list onDrop reads application/x-skynet-badge
  //     and calls closeTab(tabId) — full close.
  // Absent tabId OR mobile viewport → draggable=false, no handler wired.
  tabId?: string;
  // Optional descriptor for cross-window drag support. When present AND the
  // badge is a drag source, the dragstart payload includes these fields so a
  // drop in a DIFFERENT same-origin Skynet window can open a fresh session
  // for the same (host + identity + session kind) rather than plant a leaf
  // pointing at this window's tabId (which the target doesn't know about,
  // producing the "Session no longer exists" placeholder). Absent for legacy
  // call sites and tests — same-window drag/drop works unchanged.
  dragDescriptor?: {
    tabType: TabType;
    sessionKind?: "harness" | "relay-room";
    relayRoomId?: string;
    relayRoomTitle?: string | null;
    targetTmuxSession?: string | null;
  };
  // Context-menu handler. Fires on desktop right-click and on mobile
  // long-press. On desktop the browser-native `contextmenu` event drives
  // it. On mobile we can't rely on that: iOS Safari suppresses the
  // contextmenu-event pathway when the callout is disabled via
  // `[-webkit-touch-callout:none]` (which we DO set to hide the magnifier /
  // share sheet), and Chrome Android's contextmenu-on-long-press dispatch
  // is inconsistent on <button> + select-none. So when `isMobile` is true
  // we drive this via a 500ms pointerdown timer inside the component and
  // synthesize the call with a minimal event-shaped object
  // ({preventDefault, currentTarget, clientX, clientY}) — the fields both
  // call sites (PrettyView + IdentitySessionPane) actually read. Wired to
  // both render branches (<button> + <div>).
  onContextMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
}

// Quick 260806-lzd — single-variant refactor. The former `md` branch
// (patch #17/#38 terminal-pane treatment, 120px pill, 80px round avatar,
// hover-opacity-fade) is REMOVED entirely. Only the former `lg` treatment
// renders (glass pill, 56px avatar left, name+title right, hue-driven
// rim/glow, pv-identity-breathe 5s animation). The `size` prop is gone;
// no default value, no branch. This ships user's "one identity badge
// treatment across terminal + pretty-view" decision.
export function IdentityBadge({
  identityKey,
  hostId,
  onClick,
  tabId,
  dragDescriptor,
  onContextMenu,
}: IdentityBadgeProps) {
  const { byKey, byHostKey } = useIdentities();
  // Cosmetics consumer: prefer byHostKey composite lookup (quick-260912-0t4)
  // so cross-host name collisions (e.g. two identities named "wren" on
  // different fleet hosts) resolve to the right row's cosmetics. byKey
  // fallback preserves compat with call sites that don't thread hostId and
  // with older test fixtures whose useIdentities mock omits byHostKey.
  const nameLc = identityKey ? identityKey.toLowerCase() : null;
  const identity = nameLc
    ? typeof hostId === "number" && Number.isFinite(hostId)
      ? (byHostKey?.get(`${hostId}::${nameLc}`) ?? byKey.get(nameLc))
      : byKey.get(nameLc)
    : null;
  // Phase 58 Plan 01 (PV58-GESTURE-COEXISTENCE): mobile viewport suppresses
  // the drag source entirely — SplitView is desktop-only per
  // AppShell.tsx:2372 `{!isMobile && (<SplitView…/>)}`, so a draggable badge
  // on mobile would land on nothing useful. Explicit gate here matches the
  // shell-level mount gate.
  const isMobile = useIsMobile();
  const isDragSource = !!tabId && !isMobile;

  // Mobile-only long-press → synthesized onContextMenu call. See prop
  // docstring above for why the browser-native contextmenu path can't
  // carry mobile: iOS Safari suppresses it when the callout is disabled,
  // and Chrome Android is inconsistent. This 500ms pointerdown timer
  // restores desktop right-click parity on touch devices.
  //   longPressTimerRef  — the setTimeout id while armed; null once
  //                        cleared or fired.
  //   longPressFiredRef  — true from the moment the timer fired until the
  //                        trailing synthetic click resets it. Used to
  //                        swallow the click so a completed long-press
  //                        does not also open IdentityModal.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);
  const wireLongPress = isMobile && !!onContextMenu;
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const handleLongPressPointerDown = wireLongPress
    ? (e: ReactPointerEvent<HTMLElement>) => {
        // Mouse right-click on a touch-capable laptop should not fight the
        // timer — desktop's onContextMenu path handles that. `button` is
        // 0 for touch/pen taps.
        if (e.pointerType === "mouse" && e.button !== 0) return;
        longPressFiredRef.current = false;
        clearLongPressTimer();
        const target = e.currentTarget;
        const startX = e.clientX;
        const startY = e.clientY;
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          longPressTimerRef.current = null;
          onContextMenu?.({
            preventDefault: () => {},
            currentTarget: target,
            clientX: startX,
            clientY: startY,
          } as unknown as ReactMouseEvent<HTMLElement>);
        }, 500);
      }
    : undefined;
  const handleLongPressPointerMove = wireLongPress
    ? clearLongPressTimer
    : undefined;
  const handleLongPressPointerUp = wireLongPress
    ? clearLongPressTimer
    : undefined;
  const handleLongPressPointerCancel = wireLongPress
    ? clearLongPressTimer
    : undefined;

  // Phase 104 Plan 02 (D-05, D-06, D-07): per-identity trapped-work snapshot.
  // hostId prop is reactivated here (Pattern 4 in RESEARCH.md — Phase 68 made
  // it a no-op for avatar-URL construction, Phase 104 puts it to work for the
  // store lookup). Undefined pre-fetch AND {hasTrappedWork:false} both render
  // nothing — the JSX below gates on strict `=== true`.
  //
  // ⚠️ Called BEFORE the `if (!identity) return null` early return below —
  // React's Rules of Hooks require every hook to be called on every render
  // in a stable order. Calling this after the early return would fire on
  // some renders but not others (whenever identity resolves late from the
  // store), producing "Rendered more/fewer hooks than during the previous
  // render" errors. Hook handles identityKey=null gracefully (returns
  // undefined). Phase 104 code-review finding #1.
  const trappedWork = useTrappedWork(identityKey, hostId ?? null);

  // Project display-name lookup — identity carries `project` as a slug string
  // (Phase 117 M6); projects list carries {slug, displayName, hostId} rows.
  // Match on slug AND identity's own hostId (projects are per-host; two hosts
  // can hold same-slug projects that mean different things). ProjectRow.hostId
  // is a stringified id; identity.hostId is a number — coerce for the compare.
  // Called before the `if (!identity) return null` early return to satisfy
  // Rules of Hooks (same discipline as useTrappedWork above).
  // Pinned-state subscription — mirrors the sidebar's row-level pin check so
  // the badge's indicator flips in lockstep with the row's. Checked against
  // BOTH the open-tab id and the shadow fleet-row id (same both-sources check
  // PrettyConversationsPanel's handleSetPinned uses), so pinning via either
  // route surfaces here. Called BEFORE the `if (!identity) return null` early
  // return to satisfy Rules of Hooks (same discipline as the other hooks
  // above).
  const pinnedIds = usePinnedIds();
  const shadowFleetId =
    typeof hostId === "number" &&
    Number.isFinite(hostId) &&
    dragDescriptor?.targetTmuxSession
      ? fleetRowId(hostId, dragDescriptor.targetTmuxSession)
      : null;
  const rawPinned =
    (tabId != null && pinnedIds.has(tabId)) ||
    (shadowFleetId != null && pinnedIds.has(shadowFleetId));

  const projects = useProjects();
  const projectSlug = identity?.project ?? null;
  const projectDisplayName = projectSlug
    ? (projects.find(
        (p) =>
          p.slug === projectSlug &&
          identity != null &&
          p.hostId === String(identity.hostId),
      )?.displayName ?? null)
    : null;
  // Pinned and in-a-project are mutually exclusive; project outranks a stale
  // pin, same as the sidebar (which files the row under its project, unpinned).
  const isPinned = rawPinned && projectDisplayName === null;

  if (!identity) return null;

  // Identity hue drives border + inset rim + outer glow. NULL colorHue
  // falls back to hue 35 (warm amber, matches PrettyView's neutral
  // --pv-id-hue fallback).
  const hue = identity.colorHue ?? 35;
  // `[-webkit-touch-callout:none]` suppresses iOS Safari's native long-
  // press callout (magnifier, share sheet, "Look Up") so our own context
  // menu is the only surface that appears on mobile long-press. Matches
  // the pattern established for MicButton (ComposeBox.hold-to-mic.test —
  // Test 12 locks the class token). `select-none` already prevents text
  // selection on all platforms; the callout guard is iOS-specific.
  const rootClassName = `pv-identity-breathe absolute top-4 right-5 z-[101] flex flex-row items-center gap-[11px] select-none [-webkit-touch-callout:none] transition-transform hover:scale-[1.015] active:scale-[0.995] hover:shadow-[0_8px_24px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,220,170,0.22),_0_0_56px_hsla(${hue},65%,55%,0.42)]`;
  const rootStyle: React.CSSProperties = {
    // Pill shape: border-radius 32 + padding 7 16 7 7 makes a capsule
    // where the 50px avatar circle sits concentric to the left curve.
    borderRadius: 32,
    overflow: "hidden", // Phase 67: clip coordinator watermark bleed at pill edge
    padding: "7px 16px 7px 7px",
    background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
    backdropFilter: "blur(24px) saturate(1.4)",
    WebkitBackdropFilter: "blur(24px) saturate(1.4)",
    border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
    boxShadow: `0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 40px hsla(${hue}, 65%, 55%, 0.28)`,
    color: "#e8e4d8",
    animation: "pv-identity-breathe 5s ease-in-out infinite",
  };
  // Phase 68 Plan 04: avatarUrlWithHost deleted — backend bakes hostId into
  // identity.avatarUrl at emit time. Render directly; the hostId prop is kept
  // on IdentityBadgeProps for backward-compat with existing call sites but is
  // no longer used to build the URL here.
  const avatarSrc = identity.avatarUrl;
  const inner = (
    <>
      {/* Pin indicator — mirrors the sidebar row's `.pv-pin-indicator` (dark
          circular bubble + warm-off-white Pin glyph + hue drop-shadow halo on
          the svg). Positioned at top:7 left:7 so it sits concentric with the
          avatar's top-left curve (the avatar origin IS 7,7 inside the pill
          per the `padding: 7px 16px 7px 7px` above). z-index: 3 keeps it above
          the coordinator watermark (z:0) and the trapped-work indicator (z:2).
          Renders iff `isPinned` — gated by usePinnedIds above. */}
      {isPinned && (
        <span
          aria-hidden="true"
          data-testid="pv-identity-badge-pin-indicator"
          style={{
            position: "absolute",
            top: 7,
            left: 7,
            width: 20,
            height: 20,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(10, 12, 20, 0.75)",
            boxShadow: "inset 0 0 0 1px rgba(220, 225, 245, 0.12)",
            color: "rgba(232, 228, 216, 0.95)",
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          <Pin
            width={12}
            height={12}
            strokeWidth={2}
            aria-hidden="true"
            style={{
              filter: `drop-shadow(0 0 3px hsla(${hue}, 80%, 60%, 0.55))`,
            }}
          />
        </span>
      )}
      {/* Phase 67 Plan 67-02 Track B: coordinator watermark. Renders iff the
          badge's resolved identity carries `coordinator: true` on the wire
          (Phase 67 Plan 67-01 backend contract). Placed at the TOP of the
          `inner` fragment so both branches (interactive <button> + non-
          interactive <div>) get it without needing two separate branches.
          Non-interactive (pointer-events: none) — never fights the pill's
          click/hover/focus machinery. Sized larger than the
          conversation-row treatment (opacity 0.14 vs 0.16, width 148 vs 96,
          bleed -28/-32 vs -18/-22) per shape file tasting-v5 option-C.
          Phase 67 /close 2026-09-01 follow-up (M2 + M3): SVG + style moved
          to the shared coordinator-watermark helper; the watermark's null-
          hue fallback is unified to 216 across all three surfaces (was 35
          here, mismatching the row's CSS 216 default). Chrome hue (border,
          glow, bg) still falls back to 35 at L99 above — that's a separate
          concern with a broader blast radius. */}
      {identity.coordinator === true && (
        <span
          aria-hidden="true"
          data-testid="coordinator-watermark"
          style={getCoordinatorWatermarkStyle(
            identity.colorHue ?? COORDINATOR_WATERMARK_HUE_FALLBACK,
            "badge",
          )}
        />
      )}
      {/* Phase 104 Plan 02 — trapped-work indicator (D-05 same visual as the
          conv-list row's indicator, D-06 start-absent, D-07 tooltip copy).
          Positioning math: the pill is padding 8px 18px 8px 8px around a 56px
          avatar. Placing the 18px indicator at the avatar's bottom-right
          corner means top/left = 8px (avatar origin) + 56px - ~14px overhang.
          Both z-index: 2 (coordinator watermark is z-index: 0) so this stays
          above. Coordinator watermark + this indicator are non-overlapping
          semantic layers (identity role vs repo state) — coexistence is safe.
          pointerEvents defaults to auto: the browser needs mouseover to
          dispatch on this span so the native `title` attribute tooltip can
          fire (D-07). Setting pointerEvents: "none" would silently break the
          tooltip. Pill-level click still fires because DOM events
          bubble from the indicator through the pill; the indicator has no
          onClick to compete. Phase 104 code-review finding #2. */}
      {trappedWork?.hasTrappedWork === true && (
        <span
          aria-hidden="true"
          data-testid="pv-trapped-work-indicator"
          title="Has local work not yet pushed to any remote"
          style={{
            position: "absolute",
            left: "calc(7px + 50px - 13px)",
            top: "calc(7px + 50px - 13px)",
            width: 16,
            height: 16,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "hsla(35, 65%, 55%, 0.85)",
            boxShadow: "0 0 12px hsla(35, 65%, 55%, 0.4)",
            zIndex: 2,
          }}
        >
          <GitPullRequestDraft
            width={12}
            height={12}
            color="#f0ebe0"
            aria-hidden="true"
          />
        </span>
      )}
      {/* Phase 67 /close 2026-09-01 follow-up (M4): explicit z-index: 1 on
          the avatar img + name/title stack pins them above the coordinator
          watermark's z-index: 0 sibling. Previously relied on auto vs 0
          emergent stacking — a future hover state that added `z-index: -1`
          or a container that set `isolation: isolate` could have flipped
          the watermark above primaries. `position: relative` gives z-index
          bite on the flex items. */}
      <img
        src={avatarSrc}
        alt=""
        className="object-cover shrink-0"
        style={{
          position: "relative",
          zIndex: 1,
          width: 50,
          height: 50,
          borderRadius: "50%",
          boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.4)`,
        }}
        draggable={false}
      />
      <div
        className="flex flex-col min-w-0"
        style={{ position: "relative", zIndex: 1 }}
      >
        <span
          className="font-semibold truncate leading-tight"
          style={{ fontSize: 13.5, color: "#f0ebe0" }}
        >
          {identity.displayName}
        </span>
        {identity.title && (
          <span
            className="truncate leading-tight"
            style={{ fontSize: 10.8, color: "#a89a80" }}
          >
            {identity.title}
          </span>
        )}
        {projectDisplayName && (
          <span
            data-testid="pv-identity-project-breadcrumb"
            className="truncate inline-flex items-center gap-1"
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: `hsla(${hue}, 40%, 78%, 0.85)`,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              lineHeight: 1,
              marginTop: 3,
            }}
          >
            <Folder width={9} height={9} aria-hidden="true" />
            {projectDisplayName}
          </span>
        )}
      </div>
    </>
  );

  // Phase 58 Plan 01: dragstart handler. Wired only when isDragSource is true
  // (both render branches, <button> and <div>, share the same handler).
  //
  // dataTransfer payload contract (PV58-BADGE-PAYLOAD-DUAL-MIME):
  //   1. text/plain: tabId               — matches Phase 56 Pane onDrop
  //                                        text/plain branch at SplitView.tsx
  //                                        which routes to openSessionInTree
  //                                        (rearrange path — reused as-is).
  //   2. application/x-skynet-badge:
  //        JSON.stringify({tabId})       — NEW MIME distinct from patch #511's
  //                                        row-drag MIME. Phase 58 Plan 02
  //                                        conv-list onDrop reads this to
  //                                        discriminate badge-close from
  //                                        stray row drags. Payload minimal.
  //   3. effectAllowed = "move"          — matches conv-list row convention.
  //
  // Structured log (PV58-STRUCTURED-LOGGING, T-58-01-01 mitigation):
  // Explicit-field extraction ONLY — tabId + hasIdentity boolean. Do NOT
  // JSON.stringify the DragEvent (leaks React SyntheticEvent internals and
  // fights the fleet logging directive user 2026-08-11). No PII (no
  // displayName, no colorHue, no avatar url).
  const onDragStart = isDragSource
    ? (e: ReactDragEvent<HTMLElement>) => {
        // tabId is non-null when isDragSource is true (the !!tabId gate),
        // but TS narrows it via the ternary above — assert here.
        const id = tabId!;
        // Cross-window drag: mint a dragId + carry enough descriptor for a
        // target window to open a fresh session for the same identity on the
        // same host without needing to consult a source-window session
        // registry. hostId + identityKey are always emitted (they're first-
        // class props); dragDescriptor is optional and only emitted when the
        // parent supplies it. armOutboundDrag records the {dragId → tabId}
        // pair locally so the accept-subscriber in AppShell can close this
        // window's source tab when the target echoes the dragId back over
        // BroadcastChannel (hard-move semantics per user directive 2026-09-17).
        const dragId = mintDragId();
        armOutboundDrag(dragId, id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.setData(
          "application/x-skynet-badge",
          JSON.stringify({
            tabId: id,
            dragId,
            identityKey,
            hostId: hostId ?? null,
            descriptor: dragDescriptor ?? null,
          }),
        );
        e.dataTransfer.effectAllowed = "move";
        console.info(
          `[badge-drag] tabId=${id} dragId=${dragId} hasIdentity=${identity !== null} hasDescriptor=${dragDescriptor !== undefined}`,
        );
      }
    : undefined;

  if (onClick) {
    // Interactive branch: <button> with click affordance. Tailwind v4
    // does NOT default `<button>` to cursor: pointer, so `cursor-pointer`
    // is explicit on the button className (patch #89 rationale carried
    // through the consolidation).
    // A completed mobile long-press synthesizes onContextMenu; the trailing
    // synthetic click that mobile browsers fire after pointerup on a
    // <button> must NOT also open the modal on top of the menu we just
    // opened. Reset the flag so subsequent taps still work.
    const handleClick = () => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      onClick();
    };
    return (
      <button
        type="button"
        data-testid="identity-badge-root"
        onClick={handleClick}
        onPointerDown={handleLongPressPointerDown}
        onPointerMove={handleLongPressPointerMove}
        onPointerUp={handleLongPressPointerUp}
        onPointerCancel={handleLongPressPointerCancel}
        draggable={isDragSource}
        onDragStart={onDragStart}
        onContextMenu={onContextMenu}
        aria-label="Open agent info"
        title="Agent info"
        className={`${rootClassName} cursor-pointer`}
        style={rootStyle}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      data-testid="identity-badge-root"
      aria-hidden="true"
      draggable={isDragSource}
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
      onPointerDown={handleLongPressPointerDown}
      onPointerMove={handleLongPressPointerMove}
      onPointerUp={handleLongPressPointerUp}
      onPointerCancel={handleLongPressPointerCancel}
      className={rootClassName}
      style={rootStyle}
    >
      {inner}
    </div>
  );
}
