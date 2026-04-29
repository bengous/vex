import type { FoldOcclusionRegion } from "./types.js";
import { describe, expect, test } from "bun:test";
import { computeFoldOcclusionMetrics } from "./fold-occlusion.js";

function region(overrides: Partial<FoldOcclusionRegion>): FoldOcclusionRegion {
  return {
    selector: "header.site",
    tagName: "header",
    position: "sticky",
    edge: "top",
    source: "auto",
    scrollY: 740,
    top: 0,
    bottom: 76,
    height: 76,
    ...overrides,
  };
}

describe("computeFoldOcclusionMetrics", () => {
  test("uses top sticky height as viewport occlusion", () => {
    const metrics = computeFoldOcclusionMetrics(740, [region({})], 24);

    expect(metrics.top).toBe(76);
    expect(metrics.bottom).toBe(0);
    expect(metrics.usableViewportHeight).toBe(664);
  });

  test("uses bottom fixed height as viewport occlusion", () => {
    const metrics = computeFoldOcclusionMetrics(
      740,
      [region({ edge: "bottom", top: 684, bottom: 740, height: 56 })],
      24,
    );

    expect(metrics.top).toBe(0);
    expect(metrics.bottom).toBe(56);
    expect(metrics.usableViewportHeight).toBe(684);
  });

  test("does not double-count nested sticky regions", () => {
    const metrics = computeFoldOcclusionMetrics(
      740,
      [
        region({ selector: "header.site", top: 0, bottom: 76, height: 76 }),
        region({ selector: "header.site nav", top: 12, bottom: 64, height: 52 }),
      ],
      24,
    );

    expect(metrics.top).toBe(76);
    expect(metrics.usableViewportHeight).toBe(664);
  });

  test("does not double-count duplicate samples of the same sticky region", () => {
    const metrics = computeFoldOcclusionMetrics(
      740,
      [
        region({ scrollY: 0, top: 0, bottom: 76, height: 76 }),
        region({ scrollY: 0, top: 0, bottom: 76, height: 76 }),
      ],
      24,
    );

    expect(metrics.top).toBe(76);
    expect(metrics.usableViewportHeight).toBe(664);
  });

  test("ignores regions below the minimum height", () => {
    const metrics = computeFoldOcclusionMetrics(740, [region({ bottom: 12, height: 12 })], 24);

    expect(metrics.top).toBe(0);
    expect(metrics.usableViewportHeight).toBe(740);
  });
});
