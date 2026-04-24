import type { ViewportConfig } from "../core/types.js";
import type { ResolvedFullPageScrollFix, ResolvedPlaceholderMedia } from "./resolve.js";
import { describe, expect, test } from "bun:test";
import { buildScanPipeline } from "./scan-pipeline.js";

const viewport: ViewportConfig = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
};

const placeholderMedia: ResolvedPlaceholderMedia = {
  enabled: true,
  svgMinSize: 128,
  preserve: [".logo"],
};

const fullPageScrollFix: ResolvedFullPageScrollFix = {
  enabled: true,
  selectors: ["#page-scroll-container"],
  settleMs: 750,
  preserveHorizontalOverflow: true,
};

describe("buildScanPipeline", () => {
  test("builds capture-only with fold and grid overlays", () => {
    const pipeline = buildScanPipeline({
      url: "https://example.com",
      viewport,
      mode: "capture-only",
      full: false,
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoning: "low",
      placeholderMedia,
      fullPageScrollFix,
    });

    expect(pipeline.name).toBe("capture-only");
    expect(pipeline.nodes.map((node) => node.id)).toEqual(["capture", "folds", "grid"]);
    expect(pipeline.nodes[0]?.config).toMatchObject({
      url: "https://example.com",
      viewport,
      placeholderMedia,
      fullPageScrollFix,
    });
  });

  test("builds simple analysis with provider passthrough", () => {
    const pipeline = buildScanPipeline({
      url: "https://example.com",
      viewport,
      mode: "analyze",
      full: false,
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoning: "medium",
      placeholderMedia,
      fullPageScrollFix,
    });

    expect(pipeline.name).toBe("simple-analysis");
    expect(pipeline.nodes.find((node) => node.id === "capture")?.config).toMatchObject({
      placeholderMedia,
      fullPageScrollFix,
    });
    expect(pipeline.nodes.find((node) => node.id === "analyze")?.config).toEqual({
      provider: "codex-cli",
      model: "gpt-5.4",
      reasoning: "medium",
    });
  });

  test("builds full annotation with analysis and render nodes", () => {
    const pipeline = buildScanPipeline({
      url: "https://example.com",
      viewport,
      mode: "analyze",
      full: true,
      provider: "ollama",
      model: undefined,
      reasoning: undefined,
      placeholderMedia: undefined,
      fullPageScrollFix: undefined,
    });

    expect(pipeline.name).toBe("full-annotation");
    expect(pipeline.nodes.map((node) => node.id)).toEqual([
      "capture",
      "folds",
      "grid",
      "analyze",
      "annotate",
      "render",
    ]);
    expect(pipeline.nodes.find((node) => node.id === "analyze")?.config).toEqual({
      provider: "ollama",
      model: undefined,
      reasoning: undefined,
    });
  });
});
