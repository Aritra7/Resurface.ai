import type { EnergyMode, ScoredResource } from "@/features/recommendations";

export type SessionOutcome = "completed" | "snoozed" | "archived" | "skipped";

export type StoredSession = {
  id: string;
  createdAt: string;
  timeBudgetMinutes: number;
  energyMode: EnergyMode;
  totalMinutes: number;
  persisted: boolean;
  usingDemoResources: boolean;
  items: ScoredResource[];
  outcomes: Record<string, SessionOutcome>;
  currentIndex?: number;
  userModified?: boolean;
};

const STORAGE_PREFIX = "resurface-session:";
const INDEX_KEY = "resurface-session-index";

export function saveStoredSession(session: StoredSession): void {
  window.localStorage.setItem(`${STORAGE_PREFIX}${session.id}`, JSON.stringify(session));
  const ids = readIndex();
  if (!ids.includes(session.id)) window.localStorage.setItem(INDEX_KEY, JSON.stringify([session.id, ...ids]));
  window.dispatchEvent(new Event("resurface:state-changed"));
}

export function loadStoredSession(id: string): StoredSession | null {
  const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as StoredSession;
  } catch {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
    return null;
  }
}

export function listStoredSessions(): StoredSession[] {
  return readIndex().map((id) => loadStoredSession(id)).filter((session): session is StoredSession => Boolean(session));
}

function readIndex(): string[] {
  const stored = window.localStorage.getItem(INDEX_KEY);
  if (!stored) return [];
  try {
    const ids = JSON.parse(stored) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
