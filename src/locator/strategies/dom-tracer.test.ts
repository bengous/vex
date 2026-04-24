/**
 * Unit tests for DOM Tracer strategy.
 *
 * Tests pure functions (buildSelectors, findElementAtPosition, regionToCenter)
 * and strategy integration using temp directories for grep matching.
 */

import type { BoundingBox, DOMElement, DOMSnapshot, Issue } from "../../core/types.js";
import type { LocatorContext } from "../types.js";
import type { DomTracerSearcher } from "./dom-tracer.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssue } from "../../testing/factories.js";
import {
  batchGrepForSelectors,
  buildSelectors,
  createDomTracerStrategy,
  domTracerStrategy,
  findAllElementsAtPosition,
  findElementAtPosition,
  regionToCenter,
} from "./dom-tracer.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function createElement(overrides: Partial<DOMElement> = {}): DOMElement {
  return {
    tagName: "div",
    classes: [],
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    computedStyles: {},
    attributes: {},
    ...overrides,
  };
}

function createDOMSnapshot(elements: DOMElement[] = []): DOMSnapshot {
  return {
    url: "https://example.com",
    timestamp: new Date().toISOString(),
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false },
    html: "<html></html>",
    elements,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// regionToCenter Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("regionToCenter", () => {
  // Grid calculation: GRID_CONFIG.cellSize=200, maxColumns=26, maxRows=99
  // For 1920x1080: cols = min(26, ceil(1920/200)) = 10, rows = min(99, ceil(1080/200)) = 6
  // cellWidth = 1920/10 = 192, cellHeight = 1080/6 = 180

  test("converts grid ref A1 to top-left area center", () => {
    const center = regionToCenter("A1", 1920, 1080);

    // A=col 0, 1=row 0
    // Center of A1 = (cellWidth/2, cellHeight/2) = (96, 90)
    expect(center.x).toBeCloseTo(96, 0);
    expect(center.y).toBeCloseTo(90, 0);
  });

  test("converts grid ref B2 to correct position", () => {
    const center = regionToCenter("B2", 1920, 1080);

    // B=col 1, 2=row 1
    // Center = (192 + 96, 180 + 90) = (288, 270)
    expect(center.x).toBeCloseTo(288, 0);
    expect(center.y).toBeCloseTo(270, 0);
  });

  test("converts grid ref J6 to bottom-right area", () => {
    const center = regionToCenter("J6", 1920, 1080);

    // J=col 9 (last), 6=row 5 (last for 6 rows)
    // Center = (9*192 + 96, 5*180 + 90) = (1824, 990)
    expect(center.x).toBeCloseTo(1824, 0);
    expect(center.y).toBeCloseTo(990, 0);
  });

  test("converts bounding box to center", () => {
    const box: BoundingBox = { x: 100, y: 200, width: 50, height: 80 };
    const center = regionToCenter(box);

    expect(center.x).toBe(125);
    expect(center.y).toBe(240);
  });

  test("handles lowercase grid refs", () => {
    const center = regionToCenter("a1", 1920, 1080);
    expect(center.x).toBeCloseTo(96, 0);
    expect(center.y).toBeCloseTo(90, 0);
  });

  test("invalid grid ref returns image center", () => {
    const center = regionToCenter("AA99", 1920, 1080);
    expect(center.x).toBe(960);
    expect(center.y).toBe(540);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findElementAtPosition Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("findElementAtPosition", () => {
  test("finds element containing point", () => {
    const element = createElement({ boundingBox: { x: 0, y: 0, width: 100, height: 100 } });
    const found = findElementAtPosition([element], 50, 50);

    expect(found).toBe(element);
  });

  test("returns null when no element contains point", () => {
    const elements = [createElement({ boundingBox: { x: 200, y: 200, width: 100, height: 100 } })];
    const found = findElementAtPosition(elements, 50, 50);

    expect(found).toBeNull();
  });

  test("finds smallest element when multiple contain point", () => {
    const elements = [
      createElement({ tagName: "section", boundingBox: { x: 0, y: 0, width: 500, height: 500 } }),
      createElement({ tagName: "div", boundingBox: { x: 10, y: 10, width: 100, height: 100 } }),
      createElement({ tagName: "span", boundingBox: { x: 20, y: 20, width: 30, height: 30 } }),
    ];
    const found = findElementAtPosition(elements, 30, 30);

    expect(found?.tagName).toBe("span");
  });

  test("prefers element with id at equal size", () => {
    const elements = [
      createElement({ tagName: "div", boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      createElement({
        tagName: "div",
        id: "hero",
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ];
    const found = findElementAtPosition(elements, 50, 50);

    expect(found?.id).toBe("hero");
  });

  test("prefers element with classes at equal size", () => {
    const elements = [
      createElement({ tagName: "div", boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      createElement({
        tagName: "div",
        classes: ["hero-section"],
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ];
    const found = findElementAtPosition(elements, 50, 50);

    expect(found?.classes).toContain("hero-section");
  });

  test("handles empty elements array", () => {
    const found = findElementAtPosition([], 50, 50);
    expect(found).toBeNull();
  });

  test("point on edge is inside", () => {
    const element = createElement({ boundingBox: { x: 0, y: 0, width: 100, height: 100 } });

    expect(findElementAtPosition([element], 0, 0)).toBe(element); // top-left corner
    expect(findElementAtPosition([element], 100, 100)).toBe(element); // bottom-right corner
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findAllElementsAtPosition Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("findAllElementsAtPosition", () => {
  test("returns all elements containing point", () => {
    const elements = [
      createElement({ tagName: "body", boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } }),
      createElement({ tagName: "section", boundingBox: { x: 0, y: 0, width: 500, height: 500 } }),
      createElement({ tagName: "div", boundingBox: { x: 10, y: 10, width: 100, height: 100 } }),
      createElement({ tagName: "aside", boundingBox: { x: 600, y: 0, width: 200, height: 200 } }),
    ];
    const found = findAllElementsAtPosition(elements, 50, 50);

    expect(found.length).toBe(3);
    expect(found.map((e) => e.tagName)).not.toContain("aside");
  });

  test("returns elements sorted by area ascending", () => {
    const elements = [
      createElement({ tagName: "body", boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } }),
      createElement({ tagName: "div", boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      createElement({ tagName: "section", boundingBox: { x: 0, y: 0, width: 500, height: 500 } }),
    ];
    const found = findAllElementsAtPosition(elements, 50, 50);

    expect(found[0]?.tagName).toBe("div"); // smallest: 10000
    expect(found[1]?.tagName).toBe("section"); // medium: 250000
    expect(found[2]?.tagName).toBe("body"); // largest: 1000000
  });

  test("returns empty array when no elements contain point", () => {
    const elements = [createElement({ boundingBox: { x: 200, y: 200, width: 100, height: 100 } })];
    const found = findAllElementsAtPosition(elements, 50, 50);

    expect(found).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSelectors Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("buildSelectors", () => {
  test("generates ID selectors", () => {
    const element = createElement({ id: "hero-banner" });
    const selectors = buildSelectors(element);

    expect(selectors).toContain("#hero-banner");
    expect(selectors).toContain('id="hero-banner"');
  });

  test("generates class selectors", () => {
    const element = createElement({ classes: ["hero-section", "banner"] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain(".hero-section");
    expect(selectors).toContain('class="hero-section"');
    expect(selectors).toContain(".banner");
    expect(selectors).toContain('class="banner"');
  });

  test("skips short classes (2 chars or less)", () => {
    const element = createElement({ classes: ["a", "ab", "abc"] });
    const selectors = buildSelectors(element);

    expect(selectors).not.toContain(".a");
    expect(selectors).not.toContain(".ab");
    expect(selectors).toContain(".abc");
  });

  test("skips js- prefixed classes", () => {
    const element = createElement({ classes: ["js-toggle", "real-class"] });
    const selectors = buildSelectors(element);

    expect(selectors).not.toContain(".js-toggle");
    expect(selectors).toContain(".real-class");
  });

  test("generates partial class matches", () => {
    const element = createElement({ classes: ["hero-section"] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('class="hero-section '); // start of multi-class
    expect(selectors).toContain(' hero-section"'); // end of multi-class
    expect(selectors).toContain(" hero-section "); // middle of multi-class
  });

  test("generates tag.class selector for main class", () => {
    const element = createElement({ tagName: "section", classes: ["hero-banner"] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain("section.hero-banner");
  });

  test("generates data attribute selectors", () => {
    const element = createElement({
      attributes: { "data-section-id": "hero", "data-type": "banner" },
    });
    const selectors = buildSelectors(element);

    expect(selectors).toContain('data-section-id="hero"');
    expect(selectors).toContain('[data-section-id="hero"]');
    expect(selectors).toContain('data-type="banner"');
  });

  test("skips data attributes with long values", () => {
    const longValue = "a".repeat(60);
    const element = createElement({
      attributes: { "data-content": longValue },
    });
    const selectors = buildSelectors(element);

    expect(selectors).not.toContain(`data-content="${longValue}"`);
  });

  test("generates semantic tag selector for semantic elements with classes", () => {
    const element = createElement({ tagName: "header", classes: ["site-header"] });
    const selectors = buildSelectors(element);

    expect(selectors).toContain("<header class=");
  });

  test("returns empty array for element with no identifiers", () => {
    const element = createElement({ tagName: "div" });
    const selectors = buildSelectors(element);

    expect(selectors).toEqual([]);
  });

  test("preserves selector specificity order", () => {
    const element = createElement({
      tagName: "section",
      id: "hero",
      classes: ["hero-section"],
      attributes: { "data-section-id": "hero" },
    });
    const selectors = buildSelectors(element);

    expect(selectors).toEqual([
      "#hero",
      'id="hero"',
      ".hero-section",
      'class="hero-section"',
      'class="hero-section ',
      ' hero-section"',
      " hero-section ",
      "section.hero-section",
      'data-section-id="hero"',
      '[data-section-id="hero"]',
      "<section class=",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Strategy Integration Tests (with temp files)
// ═══════════════════════════════════════════════════════════════════════════

describe("domTracerStrategy", () => {
  describe("canHandle", () => {
    test("returns true when domSnapshot and region present", () => {
      const issue = createIssue({ region: "A1" });
      const ctx: LocatorContext = {
        projectRoot: "/tmp",
        domSnapshot: createDOMSnapshot(),
        filePatterns: [],
      };

      expect(domTracerStrategy.canHandle(issue, ctx)).toBe(true);
    });

    test("returns false when no domSnapshot", () => {
      const issue = createIssue({ region: "A1" });
      const ctx: LocatorContext = {
        projectRoot: "/tmp",
        filePatterns: [],
      };

      expect(domTracerStrategy.canHandle(issue, ctx)).toBe(false);
    });

    test("returns false when no region", () => {
      const issue = { ...createIssue(), region: undefined } as unknown as Issue;
      const ctx: LocatorContext = {
        projectRoot: "/tmp",
        domSnapshot: createDOMSnapshot(),
        filePatterns: [],
      };

      expect(domTracerStrategy.canHandle(issue, ctx)).toBe(false);
    });
  });

  describe("locate (with grep)", () => {
    let testDir: string;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), "dom-tracer-test-"));

      await writeFile(
        join(testDir, "hero.liquid"),
        '<div id="hero" class="hero-section banner">Hero content</div>',
      );

      await writeFile(
        join(testDir, "styles.css"),
        `.hero-section {
  background: blue;
}
#hero {
  padding: 20px;
}`,
      );

      await writeFile(
        join(testDir, "product.liquid"),
        '<div data-product-id="123" class="product-card">Product</div>',
      );
    });

    afterAll(async () => {
      await rm(testDir, { recursive: true });
    });

    test("returns error when no domSnapshot", async () => {
      const issue = createIssue();
      const ctx: LocatorContext = {
        projectRoot: testDir,
        filePatterns: ["*.liquid"],
      };

      const exit = await Effect.runPromiseExit(domTracerStrategy.locate(issue, ctx));
      expect(exit._tag).toBe("Failure");
    });

    test("returns empty when no element at position", async () => {
      const issue = createIssue({ region: "J10" }); // bottom-right, no elements there
      const snapshot = createDOMSnapshot([
        createElement({ id: "hero", boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ["*.liquid"],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));
      expect(result).toEqual([]);
    });

    test("finds ID selector in liquid file", async () => {
      // A1 center is around (96, 54) on 1920x1080
      const issue = createIssue({ region: "A1" });
      const snapshot = createDOMSnapshot([
        createElement({
          id: "hero",
          classes: ["hero-section", "banner"],
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ["*.liquid", "*.css"],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      expect(result.length).toBeGreaterThan(0);

      const heroLiquidMatch = result.find((r) => r.file.includes("hero.liquid"));
      expect(heroLiquidMatch).toBeDefined();
      expect(heroLiquidMatch?.confidence).toBe("high"); // ID match
    });

    test("finds class selector in CSS file", async () => {
      const issue = createIssue({ region: "A1" });
      const snapshot = createDOMSnapshot([
        createElement({
          classes: ["hero-section"],
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ["*.css"],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      const cssMatch = result.find((r) => r.file.includes("styles.css"));
      expect(cssMatch).toBeDefined();
    });

    test("finds data attribute selector", async () => {
      const issue = createIssue({ region: "A1" });
      const snapshot = createDOMSnapshot([
        createElement({
          classes: ["product-card"],
          attributes: { "data-product-id": "123" },
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ["*.liquid"],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      const productMatch = result.find((r) => r.file.includes("product.liquid"));
      expect(productMatch).toBeDefined();
    });

    test("results are sorted by confidence", async () => {
      const issue = createIssue({ region: "A1" });
      const snapshot = createDOMSnapshot([
        createElement({
          id: "hero",
          classes: ["hero-section", "banner"],
          boundingBox: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ]);
      const ctx: LocatorContext = {
        projectRoot: testDir,
        domSnapshot: snapshot,
        filePatterns: ["*.liquid", "*.css"],
      };

      const result = await Effect.runPromise(domTracerStrategy.locate(issue, ctx));

      // Verify high confidence results come first
      const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1];
        const curr = result[i];
        if (prev !== undefined && curr !== undefined) {
          const prevOrder = confidenceOrder[prev.confidence] ?? 2;
          const currOrder = confidenceOrder[curr.confidence] ?? 2;
          expect(prevOrder).toBeLessThanOrEqual(currOrder);
        }
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Strategy Tests (with injected searcher)
// ═══════════════════════════════════════════════════════════════════════════

describe("createDomTracerStrategy", () => {
  function createContext(elements: DOMElement[]): LocatorContext {
    return {
      projectRoot: "/project",
      domSnapshot: createDOMSnapshot(elements),
      filePatterns: ["*.tsx"],
    };
  }

  test("uses the injected searcher and preserves selector order", async () => {
    const mutableCalls: string[][] = [];
    const searcher: DomTracerSearcher = async (selectors) => {
      mutableCalls.push([...selectors]);
      return new Map([
        [
          selectors[0] ?? "",
          [{ file: "/project/Hero.tsx", line: 10, content: "", selector: selectors[0] ?? "" }],
        ],
      ]);
    };
    const strategy = createDomTracerStrategy({ searcher });
    const issue = createIssue({ region: { x: 0, y: 0, width: 20, height: 20 } });
    const ctx = createContext([
      createElement({
        tagName: "section",
        id: "hero",
        classes: ["hero-section"],
        attributes: { "data-section-id": "hero" },
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);

    const result = await Effect.runPromise(strategy.locate(issue, ctx));

    expect(result).toHaveLength(1);
    expect(mutableCalls[0]).toEqual([
      "#hero",
      'id="hero"',
      ".hero-section",
      'class="hero-section"',
      'class="hero-section ',
      ' hero-section"',
      " hero-section ",
      "section.hero-section",
      'data-section-id="hero"',
      '[data-section-id="hero"]',
      "<section class=",
    ]);
  });

  test("processes at most three elements by default", async () => {
    const calls: string[][] = [];
    const searcher: DomTracerSearcher = async (selectors) => {
      calls.push([...selectors]);
      const selector = selectors[0] ?? "";
      return new Map([
        [selector, [{ file: `/project/${selector.slice(1)}.tsx`, line: 1, content: "", selector }]],
      ]);
    };
    const strategy = createDomTracerStrategy({ searcher });
    const issue = createIssue({ region: { x: 0, y: 0, width: 20, height: 20 } });
    const ctx = createContext([
      createElement({ classes: ["fourth"], boundingBox: { x: 0, y: 0, width: 400, height: 400 } }),
      createElement({ classes: ["third"], boundingBox: { x: 0, y: 0, width: 300, height: 300 } }),
      createElement({ classes: ["second"], boundingBox: { x: 0, y: 0, width: 200, height: 200 } }),
      createElement({ classes: ["first"], boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
    ]);

    const result = await Effect.runPromise(strategy.locate(issue, ctx));

    expect(calls).toHaveLength(3);
    expect(calls.map((selectors) => selectors[0])).toEqual([".first", ".second", ".third"]);
    expect(result).toHaveLength(3);
  });

  test("supports custom maxElements", async () => {
    const calls: string[][] = [];
    const searcher: DomTracerSearcher = async (selectors) => {
      calls.push([...selectors]);
      return new Map();
    };
    const strategy = createDomTracerStrategy({ searcher, maxElements: 2 });
    const issue = createIssue({ region: { x: 0, y: 0, width: 20, height: 20 } });
    const ctx = createContext([
      createElement({ classes: ["third"], boundingBox: { x: 0, y: 0, width: 300, height: 300 } }),
      createElement({ classes: ["second"], boundingBox: { x: 0, y: 0, width: 200, height: 200 } }),
      createElement({ classes: ["first"], boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
    ]);

    await Effect.runPromise(strategy.locate(issue, ctx));

    expect(calls.map((selectors) => selectors[0])).toEqual([".first", ".second"]);
  });

  test("sorts locations by confidence", async () => {
    const searcher: DomTracerSearcher = async () =>
      new Map([
        [
          ".hero-section",
          [
            { file: "/project/one.tsx", line: 1, content: "", selector: ".hero-section" },
            { file: "/project/two.tsx", line: 2, content: "", selector: ".hero-section" },
          ],
        ],
        ["#hero", [{ file: "/project/Hero.tsx", line: 3, content: "", selector: "#hero" }]],
      ]);
    const strategy = createDomTracerStrategy({ searcher });
    const issue = createIssue({ region: { x: 0, y: 0, width: 20, height: 20 } });
    const ctx = createContext([
      createElement({
        id: "hero",
        classes: ["hero-section"],
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);

    const result = await Effect.runPromise(strategy.locate(issue, ctx));

    expect(result.map((location) => location.confidence)).toEqual(["high", "medium", "medium"]);
    expect(result[0]?.selector).toBe("#hero");
  });

  test("dedupes locations by file and line keeping the first selector match", async () => {
    const searcher: DomTracerSearcher = async () =>
      new Map([
        ["#hero", [{ file: "/project/Hero.tsx", line: 12, content: "", selector: "#hero" }]],
        [
          'id="hero"',
          [{ file: "/project/Hero.tsx", line: 12, content: "", selector: 'id="hero"' }],
        ],
      ]);
    const strategy = createDomTracerStrategy({ searcher });
    const issue = createIssue({ region: { x: 0, y: 0, width: 20, height: 20 } });
    const ctx = createContext([
      createElement({ id: "hero", boundingBox: { x: 0, y: 0, width: 100, height: 100 } }),
    ]);

    const result = await Effect.runPromise(strategy.locate(issue, ctx));

    expect(result).toHaveLength(1);
    expect(result[0]?.selector).toBe("#hero");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// batchGrepForSelectors Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("batchGrepForSelectors", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), "batch-grep-test-"));

    await writeFile(
      join(testDir, "hero.liquid"),
      '<div id="hero" class="hero-section banner">Hero content</div>',
    );
    await writeFile(
      join(testDir, "product.liquid"),
      '<div data-product-id="123" class="product-card">Product</div>',
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  test("finds multiple selectors in single call", async () => {
    // Use attribute-format selectors that appear literally in HTML content
    const results = await batchGrepForSelectors(['id="hero"', 'class="hero-section'], testDir, [
      "*.liquid",
    ]);

    expect(results.has('id="hero"')).toBe(true);
    expect(results.has('class="hero-section')).toBe(true);

    const idMatches = results.get('id="hero"');
    expect(idMatches?.[0]?.file).toContain("hero.liquid");
  });

  test("attributes match to correct selector when line matches multiple", async () => {
    // hero.liquid contains both "hero-section" and "banner" as literal text
    const results = await batchGrepForSelectors(["hero-section", "product-card"], testDir, [
      "*.liquid",
    ]);

    expect(results.has("hero-section")).toBe(true);
    expect(results.has("product-card")).toBe(true);

    const heroMatches = results.get("hero-section");
    const productMatches = results.get("product-card");
    expect(heroMatches?.[0]?.file).toContain("hero.liquid");
    expect(productMatches?.[0]?.file).toContain("product.liquid");
  });

  test("returns empty map for selectors with no matches", async () => {
    const results = await batchGrepForSelectors([".nonexistent", "#missing"], testDir, [
      "*.liquid",
    ]);

    expect(results.size).toBe(0);
  });

  test("returns empty map for empty selectors array", async () => {
    const results = await batchGrepForSelectors([], testDir, ["*.liquid"]);

    expect(results.size).toBe(0);
  });

  test("escapes regex metacharacters in selectors", async () => {
    // Create files where escaping matters: CSS has literal ".product-card",
    // but a broken regex (unescaped dot) would also match "Xproduct-card"
    const metaDir = mkdtempSync(join(tmpdir(), "meta-grep-test-"));
    await writeFile(join(metaDir, "styles.css"), ".product-card { color: red; }");
    await writeFile(join(metaDir, "noise.css"), "Xproduct-card { color: blue; }");

    const results = await batchGrepForSelectors([".product-card"], metaDir, ["*.css"]);

    expect(results.has(".product-card")).toBe(true);
    const match = results.get(".product-card")?.[0];
    assert(match);
    expect(results.get(".product-card")).toHaveLength(1);
    expect(match.file).toContain("styles.css");

    await rm(metaDir, { recursive: true });
  });
});
