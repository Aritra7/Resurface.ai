import { describe, expect, it } from "vitest";
import { parseBookmarkHtml } from "./bookmark-import";

const SAMPLE_EXPORT = `
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://example.com/root-link" ADD_DATE="1690000000">Root link</A>
    <DT><H3 ADD_DATE="1690000000">Cooking recipes</H3>
    <DL><p>
        <DT><A HREF="https://example.com/pasta" ADD_DATE="1690000100">Pasta recipe</A>
        <DT><A HREF="javascript:void(0)">Broken bookmarklet</A>
    </DL><p>
    <DT><H3>Fitness</H3>
    <DL><p>
        <DT><A HREF="https://example.com/workout">Shoulder workout</A>
    </DL><p>
</DL><p>
`;

describe("parseBookmarkHtml", () => {
  it("extracts URL, title, folder path, and saved timestamp", () => {
    const result = parseBookmarkHtml(SAMPLE_EXPORT);

    const pasta = result.entries.find((entry) => entry.url === "https://example.com/pasta");
    expect(pasta).toBeDefined();
    expect(pasta?.title).toBe("Pasta recipe");
    expect(pasta?.folderPath).toContain("Cooking recipes");
    expect(pasta?.savedAt).toBe(new Date(1690000100 * 1000).toISOString());
  });

  it("keeps a root-level bookmark without treating it as belonging to any folder", () => {
    const result = parseBookmarkHtml(SAMPLE_EXPORT);
    const root = result.entries.find((entry) => entry.url === "https://example.com/root-link");
    expect(root).toBeDefined();
    expect(root?.folderPath).toBeUndefined();
  });

  it("drops non-http(s) links and counts them as unsupported", () => {
    const result = parseBookmarkHtml(SAMPLE_EXPORT);
    expect(result.entries.some((entry) => entry.url.startsWith("javascript:"))).toBe(false);
    expect(result.unsupportedCount).toBe(1);
  });

  it("scopes folder paths correctly across sibling folders", () => {
    const result = parseBookmarkHtml(SAMPLE_EXPORT);
    const workout = result.entries.find((entry) => entry.url === "https://example.com/workout");
    expect(workout?.folderPath).toEqual(["Fitness"]);
  });

  it("returns no entries for an empty document", () => {
    expect(parseBookmarkHtml("<html></html>").entries).toHaveLength(0);
  });
});
