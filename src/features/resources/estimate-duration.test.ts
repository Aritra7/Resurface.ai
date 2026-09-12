import { describe, expect, it } from "vitest";
import {
  defaultEstimatedMinutes,
  estimateMinutesFromDurationSeconds,
  estimateReadingMinutes,
} from "./estimate-duration";

describe("estimateReadingMinutes", () => {
  const cases: Array<[number, number]> = [
    [0, 1],
    [1, 1],
    [220, 1],
    [221, 2],
    [440, 2],
    [441, 3],
    [2200, 10],
  ];

  for (const [words, minutes] of cases) {
    it(`rounds ${words} words up to ${minutes} minute(s) at 220 wpm`, () => {
      expect(estimateReadingMinutes(words)).toBe(minutes);
    });
  }
});

describe("estimateMinutesFromDurationSeconds", () => {
  it("clamps to a minimum of one minute", () => {
    expect(estimateMinutesFromDurationSeconds(1)).toBe(1);
    expect(estimateMinutesFromDurationSeconds(0)).toBe(1);
  });

  it("rounds to the nearest whole minute", () => {
    expect(estimateMinutesFromDurationSeconds(89)).toBe(1);
    expect(estimateMinutesFromDurationSeconds(91)).toBe(2);
  });
});

describe("defaultEstimatedMinutes", () => {
  it("defaults an Instagram Reel (short_video) to one minute", () => {
    expect(defaultEstimatedMinutes("short_video")).toBe(1);
  });

  it("has a positive default for every content type", () => {
    const types = ["short_video", "video", "social_post", "article", "newsletter", "other"] as const;
    for (const type of types) {
      expect(defaultEstimatedMinutes(type)).toBeGreaterThan(0);
    }
  });
});
