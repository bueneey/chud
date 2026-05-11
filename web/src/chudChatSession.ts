const STORAGE_KEY = "chud-chat-tab-session";

/** One UUID per browser tab (`sessionStorage`). New tab = new empty chat on the server. */
export function getOrCreateChudChatTabSessionId(): string {
  try {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id || id.trim().length < 32) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
