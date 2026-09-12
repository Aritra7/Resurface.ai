import { describe, expect, it, vi } from "vitest";
import { finishSyncRun, startSyncRun } from "../ingest";

/**
 * When no server key is configured, ingest runs under the caller's RLS session. The
 * `sync_runs` policy grants select only, so the insert is denied. That must degrade to
 * "no observability row" rather than failing the whole import.
 */
function deniedClient() {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { code: "42501", message: "new row violates row-level security policy" },
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  } as never;
}

describe("sync run tracking under RLS", () => {
  it("returns null instead of throwing when the insert is denied", async () => {
    await expect(startSyncRun(deniedClient(), "user-1", "instagram")).resolves.toBeNull();
  });

  it("finishSyncRun is a no-op for a null run id", async () => {
    const client = { from: vi.fn() } as never;
    await expect(
      finishSyncRun(client, null, { seen: 10, inserted: 10 }),
    ).resolves.toBeUndefined();
    // Never touches the database, so a denied start cannot cascade into a second failure.
    expect((client as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});
