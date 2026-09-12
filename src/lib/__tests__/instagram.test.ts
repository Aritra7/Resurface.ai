import { describe, expect, it } from "vitest";
import { mergeCollections, parsePermalinkList, parseSavedPosts } from "../connectors/instagram";

const exportShape = {
  saved_saved_media: [
    {
      title: "fitnesscreator",
      string_map_data: {
        "Saved on": { href: "https://www.instagram.com/reel/ABC123/", timestamp: 1757000000 },
      },
    },
    {
      title: "chefaccount",
      string_map_data: {
        "Saved on": { href: "https://www.instagram.com/p/XYZ789/", timestamp: 1750000000 },
      },
    },
  ],
};

describe("parseSavedPosts", () => {
  it("extracts url, shortcode, author and savedAt from the export shape", () => {
    const posts = parseSavedPosts(exportShape);
    expect(posts).toHaveLength(2);
    expect(posts[0].shortcode).toBe("ABC123");
    expect(posts[0].author).toBe("fitnesscreator");
    expect(posts[0].savedAt).toBe(new Date(1757000000 * 1000).toISOString());
  });

  it("tolerates a renamed string_map_data key", () => {
    // Instagram has shipped several spellings; keying on "Saved on" alone would
    // silently yield zero items after a rename.
    const renamed = {
      saved_saved_media: [
        { title: "x", string_map_data: { Saved: { href: "https://instagram.com/reel/QQQ/" } } },
      ],
    };
    expect(parseSavedPosts(renamed)).toHaveLength(1);
  });

  it("skips malformed entries instead of throwing", () => {
    const messy = {
      saved_saved_media: [
        { title: "ok", string_map_data: { "Saved on": { href: "https://instagram.com/reel/AAA/" } } },
        { title: "no href" },
        { string_map_data: { "Saved on": { href: "https://example.com/not-instagram" } } },
      ],
    };
    expect(parseSavedPosts(messy)).toHaveLength(1);
  });

  it("returns an empty array for junk rather than throwing", () => {
    expect(parseSavedPosts(null)).toEqual([]);
    expect(parseSavedPosts({ unexpected: true })).toEqual([]);
    expect(parseSavedPosts("a string")).toEqual([]);
  });
});

describe("mergeCollections", () => {
  it("attaches the user's own collection name by shortcode", () => {
    const posts = parseSavedPosts(exportShape);
    const collections = {
      saved_collections: [
        {
          title: "Workouts",
          string_map_data: { "Saved on": { href: "https://www.instagram.com/reel/ABC123/" } },
        },
      ],
    };
    const merged = mergeCollections(posts, collections);
    expect(merged.find((p) => p.shortcode === "ABC123")?.collection).toBe("Workouts");
    // Posts absent from the collections file keep no collection.
    expect(merged.find((p) => p.shortcode === "XYZ789")?.collection).toBeUndefined();
  });

  it("leaves posts untouched when the collections file is unusable", () => {
    const posts = parseSavedPosts(exportShape);
    expect(mergeCollections(posts, null)).toEqual(posts);
  });
});

describe("parsePermalinkList", () => {
  it("reads a newline-delimited list and ignores blanks and comments", () => {
    const text = [
      "https://www.instagram.com/p/DYx7lq1vb0o/",
      "",
      "# a comment",
      "https://www.instagram.com/reel/DRRy-XMjNRt/",
      "not a url",
    ].join("\n");
    const posts = parsePermalinkList(text);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.shortcode)).toEqual(["DYx7lq1vb0o", "DRRy-XMjNRt"]);
  });
});
