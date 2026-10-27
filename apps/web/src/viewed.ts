const KEY = "ws-viewed";

/** When this device last opened each project (Home sorts by it, like "last viewed" in a docs app). */
export function viewedAt(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

// Coming back within this window (switching tabs, a quick look elsewhere) doesn't count as a new visit.
const VISIT_GAP_MS = 30 * 60_000;
const PREVIOUS_KEY = "ws-viewed-before";

function previousVisits(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PREVIOUS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markViewed(id: string) {
  const last = viewedAt()[id];
  if (last && Date.now() - Date.parse(last) > VISIT_GAP_MS) localStorage.setItem(PREVIOUS_KEY, JSON.stringify({ ...previousVisits(), [id]: last }));
  localStorage.setItem(KEY, JSON.stringify({ ...viewedAt(), [id]: new Date().toISOString() }));
}

/** When the visit before this one was: what "since your last visit" counts from. */
export function lastVisit(id: string): string | undefined {
  return previousVisits()[id];
}
