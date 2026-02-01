/**
 * DOM Tracer Strategy - maps visual issues to code via DOM snapshot analysis.
 *
 * Core algorithm:
 * 1. Find element at issue.region position in DOMSnapshot
 * 2. Build CSS selectors from element (id, classes, tag)
 * 3. Grep codebase for selectors
 * 4. Return CodeLocation[] with confidence scores
 */

import { $ } from 'bun';
import { Effect } from 'effect';
import type { BoundingBox, CodeLocation, DOMElement, DOMSnapshot, GridRef, Issue, Region } from '../../core/types.js';
import { GRID_CONFIG } from '../../core/types.js';
import type { ElementMatch, GrepMatch, LocatorContext, LocatorError, LocatorStrategy } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Error Construction
// ═══════════════════════════════════════════════════════════════════════════

function makeError(message: string, cause?: unknown): LocatorError {
  return { _tag: 'LocatorError', strategy: 'dom-tracer', message, cause };
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid Reference Conversion
// ═══════════════════════════════════════════════════════════════════════════

function isGridRef(region: Region): region is GridRef {
  return typeof region === 'string';
}

function gridRefToCenter(gridRef: GridRef, imageWidth: number, imageHeight: number): { x: number; y: number } {
  const match = gridRef.match(/^([A-J])(\d{1,2})$/i);
  if (!match || !match[1] || !match[2]) {
    return { x: imageWidth / 2, y: imageHeight / 2 };
  }

  const col = match[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number.parseInt(match[2], 10) - 1;

  const cellWidth = imageWidth / Math.min(GRID_CONFIG.maxColumns, Math.ceil(imageWidth / GRID_CONFIG.cellSize));
  const cellHeight = imageHeight / Math.min(GRID_CONFIG.maxRows, Math.ceil(imageHeight / GRID_CONFIG.cellSize));

  return {
    x: col * cellWidth + cellWidth / 2,
    y: row * cellHeight + cellHeight / 2,
  };
}

export function regionToCenter(region: Region, imageWidth = 1920, imageHeight = 1080): { x: number; y: number } {
  if (isGridRef(region)) {
    return gridRefToCenter(region, imageWidth, imageHeight);
  }
  const box = region as BoundingBox;
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Element Finding
// ═══════════════════════════════════════════════════════════════════════════

function pointInBox(x: number, y: number, box: BoundingBox): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function boxArea(box: BoundingBox): number {
  return box.width * box.height;
}

/**
 * Find the smallest element containing the given point.
 * Prefers elements with id or class attributes for better selector building.
 */
export function findElementAtPosition(elements: readonly DOMElement[], x: number, y: number): DOMElement | null {
  let bestMatch: DOMElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const el of elements) {
    if (!pointInBox(x, y, el.boundingBox)) continue;

    const area = boxArea(el.boundingBox);
    const hasIdentifiers = el.id || el.classes.length > 0;

    if (area < bestArea || (area === bestArea && hasIdentifiers && !bestMatch?.id)) {
      bestMatch = el;
      bestArea = area;
    }
  }

  return bestMatch;
}

/**
 * Find all elements containing the given point, sorted by area (smallest first).
 */
export function findAllElementsAtPosition(elements: readonly DOMElement[], x: number, y: number): DOMElement[] {
  return elements
    .filter((el) => pointInBox(x, y, el.boundingBox))
    .sort((a, b) => boxArea(a.boundingBox) - boxArea(b.boundingBox));
}

// ═══════════════════════════════════════════════════════════════════════════
// Selector Building
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build searchable CSS selectors from an element.
 * Returns selectors in order of specificity (most specific first).
 */
export function buildSelectors(element: DOMElement): string[] {
  const selectors: string[] = [];

  // ID selector (highest specificity)
  if (element.id) {
    selectors.push(`#${element.id}`);
    selectors.push(`id="${element.id}"`);
  }

  for (const cls of element.classes) {
    if (cls.length > 2 && !cls.startsWith('js-') && !cls.match(/^\d/)) {
      selectors.push(`.${cls}`);
      selectors.push(`class="${cls}"`);
      // Match class in multi-class attributes (literal patterns that survive escaping)
      selectors.push(`class="${cls} `); // class="foo bar..."
      selectors.push(` ${cls}"`); // "...bar foo"
      selectors.push(` ${cls} `); // "...bar foo baz..."
    }
  }

  if (element.classes.length > 0) {
    const mainClass = element.classes.find((c) => c.length > 3 && !c.startsWith('js-'));
    if (mainClass) {
      selectors.push(`${element.tagName}.${mainClass}`);
    }
  }

  // Data attributes (common in component frameworks)
  for (const [attr, value] of Object.entries(element.attributes)) {
    if (attr.startsWith('data-') && value && value.length < 50) {
      selectors.push(`${attr}="${value}"`);
      selectors.push(`[${attr}="${value}"]`);
    }
  }

  const semanticTags = ['section', 'header', 'footer', 'main', 'nav', 'aside', 'article'];
  if (semanticTags.includes(element.tagName) && element.classes.length > 0) {
    selectors.push(`<${element.tagName} class=`);
  }

  return selectors;
}

// ═══════════════════════════════════════════════════════════════════════════
// Ripgrep Search
// ═══════════════════════════════════════════════════════════════════════════

const FILE_PATTERNS = ['*.liquid', '*.css', '*.scss', '*.html', '*.jsx', '*.tsx', '*.vue', '*.svelte'];

async function grepForSelector(
  selector: string,
  projectRoot: string,
  patterns: readonly string[],
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const globArgs = patterns.flatMap((p) => ['--glob', p]);

  try {
    const result = await $`rg -n --no-heading ${escapedSelector} ${globArgs} ${projectRoot}`.quiet().nothrow();
    const stdout = result.stdout.toString();

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;

      const lineMatch = line.match(/^(.+?):(\d+):(.*)$/);
      if (lineMatch) {
        const [, filePath, lineNum, content] = lineMatch;
        if (filePath && lineNum && content !== undefined) {
          matches.push({
            file: filePath,
            line: Number.parseInt(lineNum, 10),
            content,
            selector,
          });
        }
      }
    }
  } catch {
    // rg returns non-zero when no matches found
  }

  return matches;
}

async function grepForSelectors(
  selectors: string[],
  projectRoot: string,
  patterns: readonly string[],
): Promise<Map<string, GrepMatch[]>> {
  const results = new Map<string, GrepMatch[]>();

  for (const selector of selectors) {
    const matches = await grepForSelector(selector, projectRoot, patterns);
    if (matches.length > 0) {
      results.set(selector, matches);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Confidence Scoring
// ═══════════════════════════════════════════════════════════════════════════

function calculateConfidence(selector: string, matchCount: number, element: DOMElement): CodeLocation['confidence'] {
  // ID matches are highest confidence
  if (selector.startsWith('#') || selector.includes('id="')) {
    return 'high';
  }

  // Single match with specific class is high confidence
  if (matchCount === 1 && (selector.startsWith('.') || selector.includes('class="'))) {
    return 'high';
  }

  // Data attribute matches are usually reliable
  if (selector.startsWith('data-') || selector.includes('[data-')) {
    return matchCount <= 3 ? 'high' : 'medium';
  }

  // Multiple matches reduce confidence
  if (matchCount > 5) {
    return 'low';
  }

  // Tag + class is medium
  if (selector.includes('.') && element.tagName) {
    return 'medium';
  }

  return matchCount <= 2 ? 'medium' : 'low';
}

function buildReasoning(selector: string, _match: GrepMatch, element: DOMElement): string {
  const parts: string[] = [];

  if (selector.startsWith('#')) {
    parts.push(`Found ID selector "${selector}"`);
  } else if (selector.startsWith('.')) {
    parts.push(`Found class selector "${selector}"`);
  } else if (selector.includes('data-')) {
    parts.push(`Found data attribute "${selector}"`);
  } else {
    parts.push(`Found selector "${selector}"`);
  }

  parts.push(`in ${element.tagName} element`);
  if (element.id) parts.push(`with id="${element.id}"`);

  return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// Strategy Implementation
// ═══════════════════════════════════════════════════════════════════════════

function createElementMatch(element: DOMElement, selectors: string[]): ElementMatch {
  const hasId = !!element.id;
  const hasUniqueClass = element.classes.some((c) => c.length > 5);

  return {
    element: {
      tagName: element.tagName,
      id: element.id,
      classes: element.classes,
      boundingBox: element.boundingBox,
    },
    selectors,
    confidence: hasId ? 'high' : hasUniqueClass ? 'medium' : 'low',
  };
}

export const domTracerStrategy: LocatorStrategy = {
  name: 'dom-tracer',
  description: 'Traces visual regions to code via DOM snapshot element positions and CSS selector grep',
  priority: 100,

  canHandle: (issue: Issue, ctx: LocatorContext): boolean => {
    return ctx.domSnapshot !== undefined && issue.region !== undefined;
  },

  locate: (issue: Issue, ctx: LocatorContext): Effect.Effect<readonly CodeLocation[], LocatorError> => {
    return Effect.gen(function* () {
      const { domSnapshot, projectRoot, filePatterns } = ctx;

      if (!domSnapshot) {
        return yield* Effect.fail(makeError('No DOM snapshot available'));
      }

      // 1. Find element at issue position
      const viewport = domSnapshot.viewport;
      const center = regionToCenter(issue.region, viewport.width, viewport.height);

      const elements = findAllElementsAtPosition(domSnapshot.elements, center.x, center.y);

      if (elements.length === 0) {
        return [];
      }

      const locations: CodeLocation[] = [];
      const seenFiles = new Set<string>();

      // Process up to 3 elements (smallest first)
      for (const element of elements.slice(0, 3)) {
        // 2. Build selectors
        const selectors = buildSelectors(element);

        if (selectors.length === 0) continue;

        // 3. Grep for selectors
        const patterns = filePatterns.length > 0 ? filePatterns : FILE_PATTERNS;
        const grepResults = yield* Effect.tryPromise({
          try: () => grepForSelectors(selectors, projectRoot, patterns),
          catch: (e) => makeError('Grep failed', e),
        });

        // 4. Build CodeLocation results
        for (const [selector, matches] of grepResults) {
          for (const match of matches) {
            const key = `${match.file}:${match.line}`;
            if (seenFiles.has(key)) continue;
            seenFiles.add(key);

            const confidence = calculateConfidence(selector, matches.length, element);

            locations.push({
              file: match.file,
              lineNumber: match.line,
              selector,
              confidence,
              reasoning: buildReasoning(selector, match, element),
              strategy: 'dom-tracer',
            });
          }
        }
      }

      // Sort by confidence (high > medium > low)
      const confidenceOrder = { high: 0, medium: 1, low: 2 };
      locations.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

      return locations;
    });
  },
};

/**
 * Utility to find element match for debugging/inspection.
 */
export function findElementMatch(domSnapshot: DOMSnapshot, region: Region): ElementMatch | null {
  const center = regionToCenter(region, domSnapshot.viewport.width, domSnapshot.viewport.height);
  const element = findElementAtPosition(domSnapshot.elements, center.x, center.y);

  if (!element) return null;

  const selectors = buildSelectors(element);
  return createElementMatch(element, selectors);
}

export default domTracerStrategy;
