import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "../html";

describe("decodeHtmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &quot;quoted&quot;")).toBe('Tom & Jerry "quoted"');
  });

  it("decodes the hex escapes Instagram uses for emoji", () => {
    // Real og:title seen in the wild: "HOME WORKOUTS &#x1f4aa;&#x1f3fb;"
    expect(decodeHtmlEntities("HOME WORKOUTS &#x1f4aa;")).toBe("HOME WORKOUTS 💪");
  });

  it("decodes decimal escapes", () => {
    expect(decodeHtmlEntities("D&#039;Souza")).toBe("D'Souza");
  });

  it("leaves unknown entities alone instead of mangling them", () => {
    expect(decodeHtmlEntities("a &unknownentity; b")).toBe("a &unknownentity; b");
  });

  it("does not throw on an out-of-range code point", () => {
    expect(() => decodeHtmlEntities("&#99999999;")).not.toThrow();
  });
});
