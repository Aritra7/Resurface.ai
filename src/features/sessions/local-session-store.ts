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
};

const STORAGE_PREFIX = "resurface-session:";

export function saveStoredSession(session: StoredSession): void {
  window.localStorage.setItem(`${STORAGE_PREFIX}${session.id}`, JSON.stringify(session));
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
