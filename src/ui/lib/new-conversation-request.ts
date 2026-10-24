// "Start a conversation with this role" — asked for from wherever a role is
// shown (the roles window opens from the sidebar AND from an agent's window),
// answered by the conversation list, which owns the new-conversation dialog.
// The request is also held until the list takes it: where the list can be
// unmounted (a narrow mouse window's slide-out), the shell opens the list and
// the list picks the request up as it mounts.

export const NEW_CONVERSATION_REQUEST_EVENT = "skynet:new-conversation-request";

export interface NewConversationRequest {
  hostId: number;
  role: string;
}

let pending: NewConversationRequest | null = null;

/** The request not yet answered, if any — taking it answers it. */
export function takeNewConversationRequest(): NewConversationRequest | null {
  const p = pending;
  pending = null;
  return p;
}

export function requestNewConversation(detail: NewConversationRequest): void {
  console.info({ operation: "new_conversation_requested", hostId: detail.hostId, role: detail.role });
  pending = detail;
  window.dispatchEvent(new CustomEvent<NewConversationRequest>(NEW_CONVERSATION_REQUEST_EVENT, { detail }));
}
