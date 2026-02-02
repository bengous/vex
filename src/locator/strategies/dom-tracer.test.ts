/**
 * Unit tests for DOM Tracer strategy.
 *
 * Tests pure functions (buildSelectors, findElementAtPosition, regionToCenter)
 * and strategy integration using temp directories for grep matching.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { BoundingBox, DOMElement, DOMSnapshot, Issue } from '../../core/types.js';
import type { LocatorContext } from '../types.js';
import {
  buildSelectors,
  domTracerStrategy,
  findAllElementsAtPosition,
  findElementAtPosition,
  regionToCenter,
} from './dom-tracer.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function createElement(overrides: Partial<DOMElement> = {}): DOMElement {
  return {
    tagName: 'div',
    classes: [],
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    computedStyles: {},
    attributes: {},
    ...overrides,
  };
}

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1,
    description: 'Test issue',
    severity: 'medium',
    region: 'A1',
    ...overrides,
  };
}

function createDOMSnapshot(elements: DOMElement[] = []): DOMSnapshot {
  return {
    url: 'https://example.com',
    timestamp: new Date().toISOString(),
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false },
    html: '<html></html>',
    elements,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// regionToCenter Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('regionToCenter', () => {
  // Grid calculation: GRID_CONFIG.cellSize=200, maxColumns=10, maxRows=99
  // For 1920x1080: cols = min(10, ceil(1920/200)) = 10, rows = min(99, ceil(1080/200)) = 6
  // cellWidth = 1920/10 = 192, cellHeight = 1080/6 = 180

  test('converts grid ref A1 to top-left area center', () => {
    const center = regionToCenter('A1', 1920, 1080);

    // A=col 0, 1=row 0
    // Center of A1 = (cellWidth/2, cellHeight/2) = (96, 90)
    expect(center.x).toBeCloseTo(96, 0);
    expect(center.y).toBeCloseTo(90, 0);
  });

  test('converts grid ref B2 to correct position', () => {
    const center = regionToCenter('B2', 1920, 1080);

    // B=col 1, 2=row 1
    // Center = (192 + 96, 180 + 90) = (288, 270)
    expect(center.x).toBeCloseTo(288, 0);
    expect(center.y).toBeCloseTo(270, 0);
  });

  test('converts grid ref J6 to bottom-right area', () => {
    const center = regionToCenter('J6', 1920, 1080);

    // J=col 9 (last), 6=row 5 (last for 6 rows)
    // Center = (9*192 + 96, 5*180 + 90) = (1824, 990)
    expect(center.x).toBeCloseTo(1824, 0);
    expect(center.y).toBeCloseTo(990, 0);
  });

  test('converts bounding box to center', () => {
    const box: BoundingBox = { x: 100, y: 200, width: 50, height: 80 };
    const center = regionToCenter(box);

    expect(center.x).toBe(125);
    expect(center.y).toBe(240);
  });

  test('handles lowercase grid refs', () => {
    const center = regionToCenter('a1', 1920, 1080);
    expect(center.x).toBeCloseTo(96, 0);
    expect(center.y).toBeCloseTo(90, 0);
  });

  test('invalid grid ref returns image center', () => {
    const center = regionToCenter('Z99', 1920, 1080);
    expect(center.x).toBe(960);
    expect(center.y).toBe(540);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findElementAtPosition Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('findElementAtPosition', () => {
  test('finds element containing point', () => {
    const element = createElement({ boundingBox: { x: 0, y: 0, width: 100, height: 100 } });
    const found = findElementAtPosition([element], 50, 50);

    expect(found).toBe(element);
  });

  test('returns null when no element contains point', () => {
    const elements = [createElement({ boundingBox: { x: 200, y: 200, width: 100, height: 100 } })];
    const found = findElementAtPosition(elements, 50, 50);

    expect(found).toBeNull();
  });

  test('finds smallest element when multiple contain point', () => {
    const elements = [
      createElement({ tagName: 'section', boundingBox: { x: 0, y: 0, width: 500, height: 500 } }),
      createElement({ tagName: 'div', boundingBox: { x: 10, y: 10, width: 100, height: 100 } }),
      createElement({ tagName: 'span', boundingBox: { x: 20, y: 20, width: 30, height: 30 } }),
    ];
    const found = findElementAtPosition(elements, 30, 30);

    expect(found?.tagName).toBe('span');
  });

  test('prefers element with id at equal size', () => {
    const elements = [
      createElement({ tagName: 'div', boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      createElement({ tagName: 'div', id: 'hero', boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
    ];
    const found = findElementAtPosition(elements, 50, 50);

    expect(found?.id).toBe('hero');
  });

  test('prefers element with classes at equal size', () => {
    const elements = [
      createElement({ tagName: 'div', boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      createElement({
        tagName: 'div',
        classes: ['hero-section'],
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ];
    const found = findElementAtPosition(elements, 50, 50);

    expect(found?.classes).toContain('hero-section');
  });

  test('handles empty elements array', () => {
    const found = findElementAtPosition([], 50, 50);
    expect(found).toBeNull();
  });

  test('point on edge is inside', () => {
    const element = createElement({ boundingBox: { x: 0, y: 0, width: 100, height: 100 } });

    expect(findElementAtPosition([element], 0, 0)).toBe(element); // top-left corner
    expect(findElementAtPosition([element], 100, 100)).toBe(element); // bottom-right corner
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findAllElementsAtPosition Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('findAllElementsAtPosition', () => {
  test('returns all elements containing point', () => {
    const elements = [
      createElement({ tagName: 'body', boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } }),
      createElement({ tagName: 'section', boundingBox: { x: 0, y: 0, width: 500, height: 500 } }),
      createElement({ tagName: 'div', boundingBox: { x: 10, y: 10, width: 100, height: 100 } }),
      createElement({ tagName: 'aside', boundingBox: { x: 600, y: 0, width: 200, height: 200 } }),
    ];
    const found = findAllElementsAtPosition(elements, 50, 50);

    expect(found.length).toBe(3);
    expect(found.map((e) => e.tagName)).not.toContain('aside');
  });

  test('returns elements sorted by area ascending', () => {
    const elements = [
      createElement({ tagName: 'body', boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } }),
      createElement({ tagName: 'div', boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      createElement({ tagName: 'section', boundingBox: { x: 0, y: 0, width: 500, height: 500 } }),
    ];
    const found = findAllElementsAtPosition(elements, 50, 50);

    expect(found[0]?.tagName).toBe('div'); // smallest: 10000
    expect(found[1]?.tagName).toBe('section'); // medium: 250000
    expect(found[2]?.tagName).toBe('body'); // largest: 1000000
  });

  test('returns empty array when no elements contain point', () => {
    const elements = [createElement({ boundingBox: { x: 200, y: 200, width: 100, height: 100 } })];
    const found = findAllElementsAtPosition(elements, 50, 50);

    expect(found).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSelectors Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('buildSelectors', () => {
  test('generates ID selectors', () => {
    const element = createElement({ id: 'hero-banner' });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('#hero-banner');
    expect(selectors).toContain('id="hero-banner"');
  });

  test('generates class selectors', () => {
    const element = createElement({ classes: ['hero-section', 'banner'] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('.hero-section');
    expect(selectors).toContain('class="hero-section"');
    expect(selectors).toContain('.banner');
    expect(selectors).toContain('class="banner"');
  });

  test('skips short classes (2 chars or less)', () => {
    const element = createElement({ classes: ['a', 'ab', 'abc'] });
    const selectors = buildSelectors(element);

    expect(selectors).not.toContain('.a');
    expect(selectors).not.toContain('.ab');
    expect(selectors).toContain('.abc');
  });

  test('skips js- prefixed classes', () => {
    const element = createElement({ classes: ['js-toggle', 'real-class'] });
    const selectors = buildSelectors(element);

    expect(selectors).not.toContain('.js-toggle');
    expect(selectors).toContain('.real-class');
  });

  test('generates partial class matches', () => {
    const element = createElement({ classes: ['hero-section'] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('class="hero-section '); // start of multi-class
    expect(selectors).toContain(' hero-section"'); // end of multi-class
    expect(selectors).toContain(' hero-section '); // middle of multi-class
  });

  test('generates tag.class selector for main class', () => {
    const element = createElement({ tagName: 'section', classes: ['hero-banner'] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('section.hero-banner');
  });

  test('generates data attribute selectors', () => {
    const element = createElement({
      attributes: { 'data-section-id': 'hero', 'data-type': 'banner' },
    });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('data-section-id="hero"');
    expect(selectors).toContain('[data-section-id="hero"]');
    expect(selectors).toContain('data-type="banner"');
  });

  test('skips data attributes with long values', () => {
    const longValue = 'a'.repeat(60);
    const element = createElement({
      attributes: { 'data-content': longValue },
    });
    const selectors = buildSelectors(element);

    expect(selectors).not.toContain(`data-content="${longValue}"`);
  });

  test('generates semantic tag selector for semantic elements with classes', () => {
    const element = createElement({ tagName: 'header', classes: ['site-header'] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('<header class=');
  });

  test('returns empty array for element with no identifiers', () => {
    const element = createElement({ tagName: 'div' });
    const selectors = buildSelectors(element);

    expect(selectors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Strategy Integration Tests (with temp files)
// ═══════════════════════════════════════════════════════════════════════════

describe('domTracerStrategy', () => {
  describe('canHandle', () => {
    test('returns true when domSnapshot and region present', () => {
      const issue = createIssue({ region: 'A1' });
      const ctx: LocatorContext = {
        projectRoot: '/tmp',
        domSnapshot: createDOMSnapshot(),
        filePatterns: [],
      };

      expect(domTracerStrategy.canHandle(issue, ctx)).toBe(true);
    });

    test('returns false when no domSnapshot', () => {
      const issue = createIssue({ region: 'A1' });
      const ctx: LocatorContext = {
        projectRoot: '/tmp',
        filePatterns: [],
      };

      expect(domTracerStrategy.canHandle(issue, ctx)).toBe(false);
    });

    test('returns false when no region', () => {
      const issue = { ...createIssue(), region: undefined } as unknown as Issue;
      const ctx: LocatorContext = {
        projectRoot: '/tmp',
        domSnapshot: createDOMSnapshot(),
        filePatterns: [],
      };

      expect(domTracerStrategy.canHandle(issue, ctx)).toBe(false);
    });
  });

  describe('locate (with grep)', () => {
    let testDir: string;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), 'dom-tracer-test-'));

      await writeFile(join(testDir, 'hero.liquid'), '<div id="hero" class="hero-section banner">Hero content</div>');

      await writeFile(
        join(testDir, 'styles.css'),
        `.hero-section {
  background: blue;
}
#hero {
  padding: 20px;
}`,
      );

      await writeFile(join(testDir, 'product.liquid'), '<div data-product-id="123" class="product-card">Product</div>');
    });

    afterAll(async () => {
      await rm(testDir, { recursive: true });
    });

    test('returns error when no domSnapshot', async () => {
      const issue = createIssue();
      const ctx: LocatorContext = {
        projectRoot: testDir,
        filePatterns: ['*.liquid'],
      };

      const exit = await Effect.runPromiseExit(domTracerStrategy.locate(issue, ctx));
      expect(exit._tag).toBe('Failure');
    });

    test('returns empty when no element at position', async () => {
      const issue = createIssue({ region: 'J10' }); // bottom-right, no elements there
      const snapshot = createDOMSnapshot([
        createElement({ id: 'hero', boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ['*.liquid'],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));
      expect(result).toEqual([]);
    });

    test('finds ID selector in liquid file', async () => {
      // A1 center is around (96, 54) on 1920x1080
      const issue = createIssue({ region: 'A1' });
      const snapshot = createDOMSnapshot([
        createElement({
          id: 'hero',
          classes: ['hero-section', 'banner'],
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ['*.liquid', '*.css'],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      expect(result.length).toBeGreaterThan(0);

      const heroLiquidMatch = result.find((r) => r.file.includes('hero.liquid'));
      expect(heroLiquidMatch).toBeDefined();
      expect(heroLiquidMatch?.confidence).toBe('high'); // ID match
    });

    test('finds class selector in CSS file', async () => {
      const issue = createIssue({ region: 'A1' });
      const snapshot = createDOMSnapshot([
        createElement({
          classes: ['hero-section'],
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ['*.css'],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      const cssMatch = result.find((r) => r.file.includes('styles.css'));
      expect(cssMatch).toBeDefined();
    });

    test('finds data attribute selector', async () => {
      const issue = createIssue({ region: 'A1' });
      const snapshot = createDOMSnapshot([
        createElement({
          classes: ['product-card'],
          attributes: { 'data-product-id': '123' },
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ['*.liquid'],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      const productMatch = result.find((r) => r.file.includes('product.liquid'));
      expect(productMatch).toBeDefined();
    });

    test('results are sorted by confidence', async () => {
      const issue = createIssue({ region: 'A1' });
      const snapshot = createDOMSnapshot([
        createElement({
          id: 'hero',
          classes: ['hero-section', 'banner'],
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ['*.liquid', '*.css'],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      // Verify high confidence results come first
      const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1];
        const curr = result[i];
        if (prev && curr) {
          const prevOrder = confidenceOrder[prev.confidence] ?? 2;
          const currOrder = confidenceOrder[curr.confidence] ?? 2;
          expect(prevOrder).toBeLessThanOrEqual(currOrder);
        }
      }
    });
  });
});
