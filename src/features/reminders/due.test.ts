import { describe, expect, it } from "vitest";
import { isReminderDue, reminderDateKey } from "./due";

describe("daily reminder timing", () => {
  const now = new Date("2026-09-12T22:30:00.000Z");

  it("evaluates the chosen time in the saved timezone", () => {
    expect(isReminderDue("18:00", "America/New_York", now)).toBe(true);
    expect(isReminderDue("19:00", "America/New_York", now)).toBe(false);
  });

  it("uses the reminder timezone for the dismissal date", () => {
    expect(reminderDateKey("America/New_York", now)).toBe("2026-09-12");
    expect(reminderDateKey("Asia/Tokyo", now)).toBe("2026-09-13");
  });
});
