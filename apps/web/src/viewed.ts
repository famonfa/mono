const KEY = "ws-viewed";

/** When this device last opened each project (Home sorts by it, like "last viewed" in a docs app). */
export function viewedAt(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markViewed(id: string) {
  localStorage.setItem(KEY, JSON.stringify({ ...viewedAt(), [id]: new Date().toISOString() }));
}
