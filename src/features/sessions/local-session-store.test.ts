import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listStoredSessions, loadStoredSession, saveStoredSession, type StoredSession } from "./local-session-store";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function session(id: string): StoredSession {
  return {
    id,
    createdAt: "2026-09-12T12:00:00.000Z",
    timeBudgetMinutes: 5,
    energyMode: "balanced",
    totalMinutes: 0,
    persisted: false,
    usingDemoResources: true,
    items: [],
    outcomes: {},
    currentIndex: 0,
  };
}

describe("local session index", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("indexes new sessions once and returns newest first", () => {
    saveStoredSession(session("first"));
    saveStoredSession(session("second"));
    saveStoredSession({ ...session("first"), currentIndex: 2 });

    expect(listStoredSessions().map((item) => item.id)).toEqual(["second", "first"]);
    expect(loadStoredSession("first")?.currentIndex).toBe(2);
  });

  it("ignores a corrupt session instead of breaking the history", () => {
    saveStoredSession(session("valid"));
    storage.setItem("resurface-session-index", JSON.stringify(["missing", "valid"]));

    expect(listStoredSessions().map((item) => item.id)).toEqual(["valid"]);
  });
});
