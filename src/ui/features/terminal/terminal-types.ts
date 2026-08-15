import type { TerminalConfig } from "@/types";

export interface TerminalHostConfig {
  id?: number;
  instanceId?: string;
  restoredSessionId?: string | null;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  terminalConfig?: TerminalConfig;
  [key: string]: unknown;
}

// Phase 41 code-review H2: the imperative-handle surface actually
// implemented by the Terminal component. `togglePrettyMode` and
// `toggleMessageQueue` were REMOVED from Terminal in Plan 41-02 (they now
// live on the IdentitySessionPane wrapper, which conditionally hosts
// Terminal for identity-based sessions). Keeping them on TerminalHandle
// after the removal meant the type was declaring methods Terminal did not
// implement — any caller trusting the type unconditionally would get
// `undefined is not a function`. AppShell defends with optional chaining
// today, but the type-vs-reality mismatch is the actual bug. This split
// makes the surface honest: TerminalHandle = what Terminal implements,
// IdentityPaneHandle = TerminalHandle + wrapper-owned toggles.
export interface TerminalHandle {
  disconnect: () => void;
  reconnect: () => void;
  fit: () => void;
  sendInput: (data: string, messageQueueItemId?: string) => void;
  notifyResize: () => void;
  refresh: () => void;
  openFileManager: () => void;
}

// The IdentitySessionPane wrapper re-exposes the full TerminalHandle
// surface (forwarding to the inner Terminal when mounted, safe-noops when
// not) and adds the two wrapper-owned toggle methods for switching
// between the chat surface and the terminal view.
export interface IdentityPaneHandle extends TerminalHandle {
  togglePrettyMode: () => void;
  toggleMessageQueue: () => void;
}
