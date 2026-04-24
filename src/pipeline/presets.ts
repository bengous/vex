/**
 * Pipeline presets - common pipeline configurations.
 */

import type { FullPageScrollFixOptions, PlaceholderMediaOptions } from "../core/capture.js";
import type { ViewportConfig } from "../core/types.js";
import type { PipelineDefinition, PipelineEdge, PipelineNode } from "./types.js";

type CaptureNodeOptions = {
  readonly id: string;
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly filename: string;
  readonly withDOM?: true | undefined;
  readonly includeCaptureOptions?: true | undefined;
  readonly placeholderMedia?: PlaceholderMediaOptions | undefined;
  readonly fullPageScrollFix?: FullPageScrollFixOptions | undefined;
};

type CaptureNodeConfig = Record<string, unknown> & {
  withDOM?: true;
  placeholderMedia?: PlaceholderMediaOptions;
  fullPageScrollFix?: FullPageScrollFixOptions;
};

function edge(from: string, to: string, output: string, input?: string): PipelineEdge {
  return input !== undefined && input.length > 0
    ? { from, to, output, input }
    : { from, to, output };
}

function captureNode(options: CaptureNodeOptions): PipelineNode {
  const config: CaptureNodeConfig = {
    url: options.url,
    viewport: options.viewport,
    filename: options.filename,
  };

  if (options.withDOM === true) {
    config.withDOM = true;
  }

  if (options.includeCaptureOptions === true) {
    if (options.placeholderMedia !== undefined) {
      config.placeholderMedia = options.placeholderMedia;
    }
    if (options.fullPageScrollFix !== undefined) {
      config.fullPageScrollFix = options.fullPageScrollFix;
    }
  }

  return {
    id: options.id,
    operation: "capture",
    config,
    inputs: [],
    outputs: options.withDOM === true ? ["image", "domSnapshot"] : ["image"],
  };
}

function foldsNode(viewport: ViewportConfig): PipelineNode {
  return {
    id: "folds",
    operation: "overlay-folds",
    config: { viewportHeight: viewport.height },
    inputs: ["image"],
    outputs: ["image"],
  };
}

function gridNode(input: string): PipelineNode {
  return {
    id: "grid",
    operation: "overlay-grid",
    config: { showLabels: true },
    inputs: [input],
    outputs: ["image"],
  };
}

function analyzeNode(provider: string, model?: string, reasoning?: string): PipelineNode {
  return {
    id: "analyze",
    operation: "analyze",
    config: {
      provider,
      ...(model !== undefined ? { model } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    },
    inputs: ["image-with-grid"],
    outputs: ["analysis", "result"],
  };
}

function annotateNode(provider: string): PipelineNode {
  return {
    id: "annotate",
    operation: "annotate",
    config: { provider },
    inputs: ["analysis"],
    outputs: ["annotations", "toolCalls"],
  };
}

function renderNode(): PipelineNode {
  return {
    id: "render",
    operation: "render",
    config: {},
    inputs: ["image-with-grid", "toolCalls"],
    outputs: ["image"],
  };
}

function screenshotCaptureNode(
  url: string,
  viewport: ViewportConfig,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineNode {
  return captureNode({
    id: "capture",
    url,
    viewport,
    filename: "screenshot.png",
    includeCaptureOptions: true,
    placeholderMedia,
    fullPageScrollFix,
  });
}

function domScreenshotCaptureNode(
  url: string,
  viewport: ViewportConfig,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineNode {
  return captureNode({
    id: "capture",
    url,
    viewport,
    filename: "screenshot.png",
    withDOM: true,
    includeCaptureOptions: true,
    placeholderMedia,
    fullPageScrollFix,
  });
}

function analysisBaseNodes(
  url: string,
  viewport: ViewportConfig,
  provider: string,
  model?: string,
  reasoning?: string,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineNode[] {
  return [
    domScreenshotCaptureNode(url, viewport, placeholderMedia, fullPageScrollFix),
    foldsNode(viewport),
    gridNode("image-with-folds"),
    analyzeNode(provider, model, reasoning),
  ];
}

function analysisBaseEdges(): PipelineEdge[] {
  return [
    edge("capture", "folds", "image"),
    edge("folds", "grid", "image"),
    edge("grid", "analyze", "image"),
  ];
}

/**
 * Simple analysis pipeline: capture -> folds -> grid -> analyze
 */
export function simpleAnalysis(
  url: string,
  viewport: ViewportConfig,
  provider: string,
  model?: string,
  reasoning?: string,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineDefinition {
  return {
    name: "simple-analysis",
    description: "Capture screenshot and analyze for issues",
    inputs: ["url", "viewport", "provider"],
    outputs: ["analysis"],
    nodes: analysisBaseNodes(
      url,
      viewport,
      provider,
      model,
      reasoning,
      placeholderMedia,
      fullPageScrollFix,
    ),
    edges: analysisBaseEdges(),
  };
}

/**
 * Full annotation pipeline: capture -> folds -> grid -> analyze -> annotate -> render
 */
export function fullAnnotation(
  url: string,
  viewport: ViewportConfig,
  provider: string,
  model?: string,
  reasoning?: string,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineDefinition {
  return {
    name: "full-annotation",
    description: "Capture, analyze, and render annotated screenshot",
    inputs: ["url", "viewport", "provider"],
    outputs: ["annotated-image"],
    nodes: [
      ...analysisBaseNodes(
        url,
        viewport,
        provider,
        model,
        reasoning,
        placeholderMedia,
        fullPageScrollFix,
      ),
      annotateNode(provider),
      renderNode(),
    ],
    edges: [
      ...analysisBaseEdges(),
      edge("analyze", "annotate", "result"),
      edge("grid", "render", "image"),
      edge("annotate", "render", "toolCalls"),
    ],
  };
}

/**
 * Responsive comparison pipeline: capture(desktop) + capture(mobile) -> diff
 */
export function responsiveComparison(
  url: string,
  desktopViewport: ViewportConfig,
  mobileViewport: ViewportConfig,
): PipelineDefinition {
  return {
    name: "responsive-comparison",
    description: "Compare desktop and mobile screenshots",
    inputs: ["url", "desktopViewport", "mobileViewport"],
    outputs: ["diff-report"],
    nodes: [
      captureNode({
        id: "capture-desktop",
        url,
        viewport: desktopViewport,
        filename: "desktop.png",
      }),
      captureNode({
        id: "capture-mobile",
        url,
        viewport: mobileViewport,
        filename: "mobile.png",
      }),
      {
        id: "diff",
        operation: "diff",
        config: { threshold: 5 },
        inputs: ["desktop-image", "mobile-image"],
        outputs: ["report", "pixelDiffPercent"],
      },
    ],
    edges: [
      edge("capture-desktop", "diff", "image", "baseImage"),
      edge("capture-mobile", "diff", "image", "compareImage"),
    ],
  };
}

/**
 * Capture only pipeline - just take screenshots.
 */
export function captureOnly(
  url: string,
  viewport: ViewportConfig,
  withFolds = true,
  withGrid = true,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineDefinition {
  const nodes: PipelineNode[] = [
    screenshotCaptureNode(url, viewport, placeholderMedia, fullPageScrollFix),
  ];
  const edges: PipelineEdge[] = [];
  let currentOutput = "image";

  if (withFolds) {
    nodes.push(foldsNode(viewport));
    edges.push(edge("capture", "folds", "image"));
    currentOutput = "image-with-folds";
  }

  if (withGrid) {
    nodes.push(gridNode(currentOutput));
    edges.push(edge(withFolds ? "folds" : "capture", "grid", "image"));
    currentOutput = "image-with-grid";
  }

  return {
    name: "capture-only",
    description:
      withFolds && withGrid
        ? "Capture screenshot with fold lines and grid"
        : withFolds
          ? "Capture screenshot with fold lines"
          : withGrid
            ? "Capture screenshot with grid"
            : "Capture screenshot without fold lines",
    inputs: ["url", "viewport"],
    outputs: [currentOutput],
    nodes,
    edges,
  };
}
