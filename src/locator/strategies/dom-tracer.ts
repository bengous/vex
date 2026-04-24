/**
 * DOM Tracer Strategy - maps visual issues to code via DOM snapshot analysis.
 *
 * Core algorithm:
 * 1. Find element at issue.region position in DOMSnapshot
 * 2. Build CSS selectors from element (id, classes, tag)
 * 3. Grep codebase for selectors
 * 4. Return CodeLocation[] with confidence scores
 */

import type { CodeLocation, DOMSnapshot, Issue, Region } from "../../core/types.js";
import type { ElementMatch, LocatorContext, LocatorStrategy } from "../types.js";
import type { DomTracerSearcher } from "./dom/search.js";
import { Effect } from "effect";
import { LocatorError } from "../types.js";
import { findAllElementsAtPosition, findElementAtPosition, regionToCenter } from "./dom/region.js";
import { buildReasoning, calculateConfidence, sortByConfidence } from "./dom/scoring.js";
import { batchGrepForSelectors, DEFAULT_FILE_PATTERNS } from "./dom/search.js";
import { buildSelectors, createElementMatch } from "./dom/selectors.js";

// Compatibility facade preserves existing dom-tracer imports.
export { findAllElementsAtPosition, findElementAtPosition, regionToCenter } from "./dom/region.js";
export {
  batchGrepForSelectors,
  DEFAULT_FILE_PATTERNS,
  type DomTracerSearcher,
} from "./dom/search.js";
export { buildSelectors } from "./dom/selectors.js";

export type DomTracerStrategyOptions = {
  readonly searcher?: DomTracerSearcher;
  readonly maxElements?: number;
};

function makeError(detail: string, cause?: unknown): LocatorError {
  return new LocatorError({ strategy: "dom-tracer", detail, cause });
}

export function createDomTracerStrategy(options: DomTracerStrategyOptions = {}): LocatorStrategy {
  const searcher = options.searcher ?? batchGrepForSelectors;
  const maxElements = Math.max(0, options.maxElements ?? 3);

  return {
    name: "dom-tracer",
    description:
      "Traces visual regions to code via DOM snapshot element positions and CSS selector grep",
    priority: 100,

    canHandle: (issue: Issue, ctx: LocatorContext): boolean => {
      return ctx.domSnapshot !== undefined && issue.region !== undefined;
    },

    locate: (
      issue: Issue,
      ctx: LocatorContext,
    ): Effect.Effect<readonly CodeLocation[], LocatorError> => {
      return Effect.gen(function* () {
        const { domSnapshot, projectRoot, filePatterns } = ctx;

        if (domSnapshot === undefined) {
          return yield* makeError("No DOM snapshot available");
        }

        const viewport = domSnapshot.viewport;
        const center = regionToCenter(issue.region, viewport.width, viewport.height);
        const elements = findAllElementsAtPosition(domSnapshot.elements, center.x, center.y);

        if (elements.length === 0) {
          return [];
        }

        const locations: CodeLocation[] = [];
        const seenFiles = new Set<string>();
        const patterns = filePatterns.length > 0 ? filePatterns : DEFAULT_FILE_PATTERNS;

        for (const element of elements.slice(0, maxElements)) {
          const selectors = buildSelectors(element);

          if (selectors.length === 0) {
            continue;
          }

          const grepResults = yield* Effect.tryPromise({
            try: async () => searcher(selectors, projectRoot, patterns),
            catch: (e) => makeError("Grep failed", e),
          });

          for (const [selector, matches] of grepResults) {
            for (const match of matches) {
              const key = `${match.file}:${match.line}`;
              if (seenFiles.has(key)) {
                continue;
              }
              seenFiles.add(key);

              locations.push({
                file: match.file,
                lineNumber: match.line,
                selector,
                confidence: calculateConfidence(selector, matches.length, element),
                reasoning: buildReasoning(selector, match, element),
                strategy: "dom-tracer",
              });
            }
          }
        }

        sortByConfidence(locations);

        return locations;
      });
    },
  };
}

export const domTracerStrategy: LocatorStrategy = createDomTracerStrategy();

/**
 * Utility to find element match for debugging/inspection.
 */
export function findElementMatch(domSnapshot: DOMSnapshot, region: Region): ElementMatch | null {
  const center = regionToCenter(region, domSnapshot.viewport.width, domSnapshot.viewport.height);
  const element = findElementAtPosition(domSnapshot.elements, center.x, center.y);

  if (element === null) {
    return null;
  }

  const selectors = buildSelectors(element);
  return createElementMatch(element, selectors);
}
