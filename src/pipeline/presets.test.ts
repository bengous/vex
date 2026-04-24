import type { PipelineDefinition } from "./types.js";
import { afterAll, describe, expect, it } from "bun:test";
import { Exit } from "effect";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEffectExit } from "../testing/effect-helpers.js";
import { captureOnly, fullAnnotation, responsiveComparison, simpleAnalysis } from "./presets.js";
import { runPipeline } from "./runtime.js";

const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false };
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true };

function nodeIds(pipeline: PipelineDefinition): string[] {
  return pipeline.nodes.map((node) => node.id);
}

function nodeOutputs(pipeline: PipelineDefinition): string[][] {
  return pipeline.nodes.map((node) => [...node.outputs]);
}

function edgeRefs(pipeline: PipelineDefinition): string[] {
  return pipeline.edges.map((edge) =>
    edge.input !== undefined && edge.input.length > 0
      ? `${edge.from}->${edge.to}:${edge.output}:${edge.input}`
      : `${edge.from}->${edge.to}:${edge.output}`,
  );
}

type TestCaptureConfig = Record<string, unknown> & {
  readonly withDOM?: unknown;
};

function captureConfig(pipeline: PipelineDefinition, nodeId = "capture"): TestCaptureConfig {
  const node = pipeline.nodes.find((candidate) => candidate.id === nodeId);
  expect(node).toBeDefined();
  return node?.config ?? {};
}

describe("simpleAnalysis preset", () => {
  it("preserves graph shape and enables DOM capture", () => {
    const pipeline = simpleAnalysis("https://example.com", viewport, "codex-cli", "gpt-5.4", "low");

    expect(pipeline.name).toBe("simple-analysis");
    expect(pipeline.outputs).toEqual(["analysis"]);
    expect(nodeIds(pipeline)).toEqual(["capture", "folds", "grid", "analyze"]);
    expect(nodeOutputs(pipeline)).toEqual([
      ["image", "domSnapshot"],
      ["image"],
      ["image"],
      ["analysis", "result"],
    ]);
    expect(edgeRefs(pipeline)).toEqual([
      "capture->folds:image",
      "folds->grid:image",
      "grid->analyze:image",
    ]);
    expect(captureConfig(pipeline).withDOM).toBe(true);
  });
});

describe("fullAnnotation preset", () => {
  it("preserves graph shape and enables DOM capture", () => {
    const pipeline = fullAnnotation("https://example.com", viewport, "codex-cli", "gpt-5.4", "low");

    expect(pipeline.name).toBe("full-annotation");
    expect(pipeline.outputs).toEqual(["annotated-image"]);
    expect(nodeIds(pipeline)).toEqual([
      "capture",
      "folds",
      "grid",
      "analyze",
      "annotate",
      "render",
    ]);
    expect(nodeOutputs(pipeline)).toEqual([
      ["image", "domSnapshot"],
      ["image"],
      ["image"],
      ["analysis", "result"],
      ["annotations", "toolCalls"],
      ["image"],
    ]);
    expect(edgeRefs(pipeline)).toEqual([
      "capture->folds:image",
      "folds->grid:image",
      "grid->analyze:image",
      "analyze->annotate:result",
      "grid->render:image",
      "annotate->render:toolCalls",
    ]);
    expect(captureConfig(pipeline).withDOM).toBe(true);
  });
});

describe("responsiveComparison preset", () => {
  it("preserves graph shape and leaves DOM capture disabled", () => {
    const pipeline = responsiveComparison("https://example.com", viewport, mobileViewport);

    expect(pipeline.name).toBe("responsive-comparison");
    expect(pipeline.outputs).toEqual(["diff-report"]);
    expect(nodeIds(pipeline)).toEqual(["capture-desktop", "capture-mobile", "diff"]);
    expect(nodeOutputs(pipeline)).toEqual([["image"], ["image"], ["report", "pixelDiffPercent"]]);
    expect(edgeRefs(pipeline)).toEqual([
      "capture-desktop->diff:image:baseImage",
      "capture-mobile->diff:image:compareImage",
    ]);
    expect(captureConfig(pipeline, "capture-desktop").withDOM).toBeUndefined();
    expect(captureConfig(pipeline, "capture-mobile").withDOM).toBeUndefined();
  });
});

describe("captureOnly preset", () => {
  it("includes folds and grid by default without DOM capture", () => {
    const pipeline = captureOnly("https://example.com", viewport);

    expect(pipeline.outputs).toEqual(["image-with-grid"]);
    expect(nodeIds(pipeline)).toEqual(["capture", "folds", "grid"]);
    expect(nodeOutputs(pipeline)).toEqual([["image"], ["image"], ["image"]]);
    expect(edgeRefs(pipeline)).toEqual(["capture->folds:image", "folds->grid:image"]);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  it("supports folds only", () => {
    const pipeline = captureOnly("https://example.com", viewport, true, false);
    expect(pipeline.outputs).toEqual(["image-with-folds"]);
    expect(nodeIds(pipeline)).toEqual(["capture", "folds"]);
    expect(edgeRefs(pipeline)).toEqual(["capture->folds:image"]);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  it("supports grid only", () => {
    const pipeline = captureOnly("https://example.com", viewport, false, true);
    expect(pipeline.outputs).toEqual(["image-with-grid"]);
    expect(nodeIds(pipeline)).toEqual(["capture", "grid"]);
    expect(edgeRefs(pipeline)).toEqual(["capture->grid:image"]);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  it("supports raw capture with no overlays", () => {
    const pipeline = captureOnly("https://example.com", viewport, false, false);
    expect(pipeline.outputs).toEqual(["image"]);
    expect(nodeIds(pipeline)).toEqual(["capture"]);
    expect(edgeRefs(pipeline)).toEqual([]);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  describe("artifact lifecycle", () => {
    const tempDirs: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response("<!doctype html><html><body><main>Capture only</main></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });

    afterAll(async () => {
      await server.stop();
      await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
    });

    it("writes fold and grid artifacts with stable filenames", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "capture-only-artifacts-"));
      tempDirs.push(testDir);

      const exit = await runEffectExit(
        runPipeline(captureOnly(server.url.href, viewport, true, true), testDir),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const artifactPaths = Object.values(exit.value.artifacts).map((artifact) => artifact.path);
        const foldsPath = artifactPaths.find((path) => path.endsWith("03-with-folds.png"));
        const gridPath = artifactPaths.find((path) => path.endsWith("04-with-grid.png"));

        expect(foldsPath).toBeDefined();
        expect(gridPath).toBeDefined();
        expect(existsSync(foldsPath ?? "")).toBe(true);
        expect(existsSync(gridPath ?? "")).toBe(true);
      }
    });
  });
});
