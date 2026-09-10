// Phase 92 Slice 1 (D-07): ChatSurfaceSource discriminated-union.
//
// PrettyView's `source` prop. TypeScript makes invalid states unrepresentable
// at compile time: a `kind: "harness"` variant cannot carry `roomId`, and a
// `kind: "relay"` variant cannot carry `hostId`. Every case-based branch
// inside the shared chat surface reads `source.kind` (D-08).
//
// Naming discipline (D-05 constraint): at the pane-source level we use the
// short form `"harness" | "relay"`. `Tab.sessionKind: "harness" | "relay-room"`
// stays as a separate axis at the tab level.
//
// Slice 1 lands the type + adapter contract; downstream slices (2-5) build on
// this shape. See .planning/phases/92-relay-rooms-use-the-chat-surface-one-
// surface-two-data-source/92-CONTEXT.md D-07 for the rejected alternatives
// (explicit `mode` prop; duck-typed inference from present optional props).
import type {
  MessageEvent as ChatMessageEvent,
  ImageEvent,
  RelayOutboundEvent,
  RelayInboundEvent,
  MalformedLineEvent,
} from "@/api/claude-session-api";

export type ChatSurfaceSource =
  | { kind: "harness"; hostId: number; tmuxSession: string; tabId?: string }
  | { kind: "relay"; roomId: string; roomTitle: string | null };

// Shape mirrors PrettyView's local `StreamEvent` union (declared in
// PrettyView.tsx at ~L291). Kept here so adapter authors can reason about the
// message shape without importing from PrettyView.tsx (which would create a
// circular import). Any future widening of StreamEvent should be reflected
// here.
export type ChatSurfaceMessage =
  | ChatMessageEvent
  | ImageEvent
  | RelayOutboundEvent
  | RelayInboundEvent
  | MalformedLineEvent;

// Participants shape as consumed by MultiBadgeAnchor (Slice 2). Kept here for
// symmetry between the two adapters — the harness shim returns null (harness
// case has no participants list); the relay adapter returns an actual list
// once Slice 3 lands.
export interface HumanParticipant {
  mxid: string;
  displayName: string;
}

export interface AgentParticipant {
  mxid: string;
  identityKey: string;
}

export interface ChatSurfaceParticipants {
  humans: HumanParticipant[];
  agents: AgentParticipant[];
}

// Uniform adapter return shape both `useHarnessAdapter` and `useRelayAdapter`
// conform to. `useChatSurfaceAdapter` is the unified hook that internally
// switches on `source.kind` and returns whichever adapter's state matches.
//
// Optional pagination + timing fields (hasOlder, loadOlderStatus, etc.) are
// populated by the relay adapter (Slice 3); the harness shim leaves them
// undefined. Downstream PrettyView rendering that needs pagination can read
// these fields off `adapter` case-agnostically.
export interface ChatSurfaceAdapterState {
  messages: ChatSurfaceMessage[];
  participants: ChatSurfaceParticipants | null;
  sendMessage: (body: string, mqid: string) => Promise<boolean>;
  error: string | null;
  isReady: boolean;
  /**
   * Phase 97 Finding 1: flips true on the first `history_batch` frame
   * (relay adapter) or defaults to true for the harness inert shim.
   * PrettyView's loading-veil arm reads this in the relay case as the
   * "backend has responded with historical messages" signal. `isReady`
   * flips earlier (on `session` frame — WS-auth pass) and is NOT the
   * right signal for the veil per Phase 97 Finding 1 landmines
   * (session alone would dismiss too early; messages.length > 0 would
   * never dismiss an empty room — the FRAME arrival is the signal).
   */
  isMessagesLoaded?: boolean;
  // Optional pagination fields — Slice 3's relay adapter populates them; the
  // harness shim leaves them undefined.
  hasOlder?: boolean;
  loadOlderStatus?: "idle" | "loading" | "error";
  loadOlderError?: string | null;
  fetchOlder?: () => Promise<void>;
}
