import type { GrepMatch } from "../../types.js";
import { $ } from "bun";

export const DEFAULT_FILE_PATTERNS = [
  "*.liquid",
  "*.css",
  "*.scss",
  "*.html",
  "*.jsx",
  "*.tsx",
  "*.vue",
  "*.svelte",
];

export type DomTracerSearcher = (
  selectors: readonly string[],
  projectRoot: string,
  patterns: readonly string[],
) => Promise<Map<string, GrepMatch[]>>;

export async function batchGrepForSelectors(
  selectors: readonly string[],
  projectRoot: string,
  patterns: readonly string[],
): Promise<Map<string, GrepMatch[]>> {
  const results = new Map<string, GrepMatch[]>();

  if (selectors.length === 0) {
    return results;
  }

  const escapedSelectors = selectors.map((s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const combinedPattern = escapedSelectors.join("|");
  const globArgs = patterns.flatMap((p) => ["--glob", p]);

  const result = await $`rg -n --no-heading ${combinedPattern} ${globArgs} ${projectRoot}`
    .quiet()
    .nothrow();
  const stdout = result.stdout.toString();

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    const lineMatch = line.match(/^(.+?):(\d+):(.*)$/);
    if (lineMatch === null) {
      continue;
    }

    const [, filePath, lineNum, content] = lineMatch;
    if (
      filePath === undefined ||
      filePath.length === 0 ||
      lineNum === undefined ||
      lineNum.length === 0 ||
      content === undefined
    ) {
      continue;
    }

    for (const selector of selectors) {
      if (!content.includes(selector)) {
        continue;
      }

      let matches = results.get(selector);
      if (matches === undefined) {
        matches = [];
        results.set(selector, matches);
      }
      matches.push({
        file: filePath,
        line: Number.parseInt(lineNum, 10),
        content,
        selector,
      });
    }
  }

  return results;
}
