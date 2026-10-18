// "Start a conversation with this role" — asked for from wherever a role is
// shown (the roles window opens from the sidebar AND from an agent's window),
// answered by the conversation list, which owns the new-conversation dialog.

export const NEW_CONVERSATION_REQUEST_EVENT = "skynet:new-conversation-request";

export interface NewConversationRequest {
  hostId: number;
  role: string;
}

export function requestNewConversation(detail: NewConversationRequest): void {
  console.info({ operation: "new_conversation_requested", hostId: detail.hostId, role: detail.role });
  window.dispatchEvent(new CustomEvent<NewConversationRequest>(NEW_CONVERSATION_REQUEST_EVENT, { detail }));
}
