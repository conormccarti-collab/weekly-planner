const EVENT_NAME = "weekly-planner:open-chat";

/** Lets other screens (e.g. the Planning session) open the global chat pop-up. */
export function openChatPanel() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }
}

export function subscribeOpenChatPanel(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
