import type {
  FoldOcclusionEdge,
  FoldOcclusionMetrics,
  FoldOcclusionOptions,
  FoldOcclusionRegion,
} from "./types.js";
import type { Page } from "playwright";

type EdgeInterval = {
  readonly start: number;
  readonly end: number;
};

type DetectedRegion = FoldOcclusionRegion;

type DetectionResult = {
  readonly viewportHeight: number;
  readonly regions: readonly DetectedRegion[];
};

type DetectionOptions = {
  readonly minHeight: number;
  readonly sampleScrolls?: readonly number[];
};

// Browser chrome is outside Playwright screenshots, but fixed/sticky page UI is
// part of the captured page. The first fold remains the raw viewport height;
// later folds advance by the viewport height minus repeated top/bottom
// occlusion.
function mergeIntervals(intervals: readonly EdgeInterval[]): readonly EdgeInterval[] {
  const sorted = [...intervals].toSorted((a, b) => a.start - b.start);
  const merged: EdgeInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || interval.start > previous.end) {
      merged.push(interval);
      continue;
    }
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, interval.end),
    };
  }

  return merged;
}

function computeEdgeOcclusion(
  regions: readonly FoldOcclusionRegion[],
  edge: FoldOcclusionEdge,
  viewportHeight: number,
  minHeight: number,
): number {
  // Multiple detected regions can overlap, for example a sticky header and a
  // sticky child inside it. Merging intervals prevents double-counting them.
  const intervals = regions
    .filter((region) => region.edge === edge)
    .map(
      (region): EdgeInterval => ({
        start: Math.max(0, region.top),
        end: Math.min(viewportHeight, region.bottom),
      }),
    )
    .filter((interval) => interval.end - interval.start >= minHeight);

  return mergeIntervals(intervals).reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
}

export function computeFoldOcclusionMetrics(
  viewportHeight: number,
  regions: readonly FoldOcclusionRegion[],
  minHeight: number,
): FoldOcclusionMetrics {
  const top = computeEdgeOcclusion(regions, "top", viewportHeight, minHeight);
  const bottom = computeEdgeOcclusion(regions, "bottom", viewportHeight, minHeight);

  return {
    mode: "auto",
    top,
    bottom,
    usableViewportHeight: Math.max(1, viewportHeight - top - bottom),
    regions,
  };
}

function dedupeRegions(regions: readonly FoldOcclusionRegion[]): readonly FoldOcclusionRegion[] {
  const seen = new Set<string>();
  const result: FoldOcclusionRegion[] = [];

  for (const region of regions) {
    const key = [
      region.selector,
      region.position,
      region.edge,
      Math.round(region.top),
      Math.round(region.bottom),
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(region);
  }

  return result;
}

async function detectFoldOcclusionRegions(
  page: Page,
  options: DetectionOptions,
): Promise<DetectionResult> {
  return page.evaluate(async (evaluationOptions): Promise<DetectionResult> => {
    const minHeight = Math.max(1, evaluationOptions.minHeight);
    const edgeEpsilon = 1;
    const viewportHeight = window.innerHeight;
    const finiteNumber = (value: number): number => (Number.isFinite(value) ? value : 0);
    const sampleScrolls = [
      ...new Set(
        [0, ...(evaluationOptions.sampleScrolls ?? [viewportHeight])]
          .map((value) => Math.max(0, Math.round(value)))
          .toSorted((a, b) => a - b),
      ),
    ];

    const cssEscape = (value: string): string => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&");
    };

    const selectorFor = (element: Element): string => {
      if (element.id.length > 0) {
        return `#${cssEscape(element.id)}`;
      }

      const testId =
        element.getAttribute("data-testid") ??
        element.getAttribute("data-test") ??
        element.getAttribute("data-qa");
      if (testId !== null && testId.length > 0) {
        return `[data-testid="${cssEscape(testId)}"]`;
      }

      const tag = element.tagName.toLowerCase();
      const classSelector = Array.from(element.classList)
        .slice(0, 3)
        .map((className) => `.${cssEscape(className)}`)
        .join("");
      return `${tag}${classSelector}`;
    };

    const waitForFrame = async (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const originalX = window.scrollX;
    const originalY = window.scrollY;
    const regions: DetectedRegion[] = [];

    try {
      // Keep the zero-scroll sample: apps with internal scroll containers can
      // report window.scrollY as 0 even after scroll attempts, but their sticky
      // chrome still occludes repeated visual folds.
      for (const targetScrollY of sampleScrolls) {
        window.scrollTo(originalX, targetScrollY);
        await waitForFrame();

        document.querySelectorAll("body *").forEach((element) => {
          if (!(element instanceof HTMLElement)) {
            return;
          }

          const styles = window.getComputedStyle(element);
          const position = styles.position;
          if (position !== "fixed" && position !== "sticky") {
            return;
          }
          if (
            styles.display === "none" ||
            styles.visibility === "hidden" ||
            styles.visibility === "collapse" ||
            Number.parseFloat(styles.opacity) === 0
          ) {
            return;
          }

          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height < minHeight) {
            return;
          }

          const edge =
            rect.top <= edgeEpsilon && rect.bottom >= minHeight
              ? "top"
              : rect.bottom >= viewportHeight - edgeEpsilon &&
                  viewportHeight - rect.top >= minHeight
                ? "bottom"
                : undefined;

          if (edge === undefined) {
            return;
          }

          regions.push({
            selector: selectorFor(element),
            tagName: element.tagName.toLowerCase(),
            position,
            edge,
            source: "auto",
            scrollY: window.scrollY,
            top: finiteNumber(rect.top),
            bottom: finiteNumber(rect.bottom),
            height: finiteNumber(rect.height),
          });
        });
      }
    } finally {
      window.scrollTo(originalX, originalY);
      await waitForFrame();
    }

    return { viewportHeight, regions };
  }, options);
}

export async function collectFoldOcclusionMetrics(
  page: Page,
  options: FoldOcclusionOptions,
): Promise<FoldOcclusionMetrics> {
  const detection = await detectFoldOcclusionRegions(page, {
    minHeight: options.minHeight,
    ...(options.sampleScrolls !== undefined ? { sampleScrolls: options.sampleScrolls } : {}),
  });

  return computeFoldOcclusionMetrics(
    detection.viewportHeight,
    dedupeRegions(detection.regions),
    options.minHeight,
  );
}
