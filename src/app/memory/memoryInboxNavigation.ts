const MEMORY_INBOX_OPEN_EVENT = 'polaris:memory-inbox-open';

export function openMemoryInbox() {
  window.dispatchEvent(new Event(MEMORY_INBOX_OPEN_EVENT));
}

export function subscribeMemoryInboxOpen(listener: () => void) {
  window.addEventListener(MEMORY_INBOX_OPEN_EVENT, listener);
  return () => window.removeEventListener(MEMORY_INBOX_OPEN_EVENT, listener);
}
