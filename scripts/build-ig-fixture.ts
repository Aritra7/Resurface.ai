/**
 * Builds an Instagram DYI-shaped fixture from a plain list of permalinks.
 *
 * The output is schema-identical to `saved_posts.json` inside Instagram's official
 * "Download your information" export, so the parser that consumes this is the same
 * parser that consumes the real export — and the same one Meta's EYI destination
 * program would feed in production. Only the transport differs.
 *
 *   pnpm tsx scripts/build-ig-fixture.ts fixtures/reels.txt fixtures/saved_posts.json
 */
import { readFileSync, writeFileSync } from "node:fs";

type SavedMediaEntry = {
  title: string;
  string_map_data: {
    "Saved on": { href: string; timestamp: number };
  };
};

const [, , inputPath = "fixtures/reels.txt", outputPath = "fixtures/saved_posts.json"] =
  process.argv;

const urls = readFileSync(inputPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (urls.length === 0) {
  console.error(`No URLs found in ${inputPath}`);
  process.exit(1);
}

// Real exports carry genuine save times. Spread synthetic ones over the past ~8 months
// so age-boost and backlog-decay behaviour are exercised rather than flat.
const now = Math.floor(Date.now() / 1000);
const SPREAD_SECONDS = 60 * 60 * 24 * 240;

const entries: SavedMediaEntry[] = urls.map((url, index) => {
  const fraction = urls.length === 1 ? 0 : index / (urls.length - 1);
  const timestamp = now - Math.floor(fraction * SPREAD_SECONDS);

  // The export's `title` is the creator's username. We cannot know it from a permalink
  // alone, so leave it empty rather than invent one; the parser already handles absence.
  return {
    title: "",
    string_map_data: { "Saved on": { href: url, timestamp } },
  };
});

writeFileSync(outputPath, JSON.stringify({ saved_saved_media: entries }, null, 2));
console.log(`Wrote ${entries.length} saved posts to ${outputPath}`);
