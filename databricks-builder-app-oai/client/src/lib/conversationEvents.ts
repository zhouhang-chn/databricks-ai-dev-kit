/**
 * Lightweight cross-component bus for conversation list invalidation.
 * Dispatches a CustomEvent on `window` so the Sidebar (or anything else
 * holding a cached conversation list) can refresh after a title change.
 */

const EVENT_NAME = 'conversation:updated';

export interface ConversationUpdatedDetail {
  projectId: string;
  conversationId: string;
}

export function emitConversationUpdated(detail: ConversationUpdatedDetail): void {
  window.dispatchEvent(new CustomEvent<ConversationUpdatedDetail>(EVENT_NAME, { detail }));
}

export function onConversationUpdated(
  handler: (detail: ConversationUpdatedDetail) => void
): () => void {
  const listener = (event: Event) => {
    const ce = event as CustomEvent<ConversationUpdatedDetail>;
    if (ce.detail) handler(ce.detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
