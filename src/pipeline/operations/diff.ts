/**
 * Diff operation - compares two images for visual differences.
 */

import type { DiffReportArtifact, ImageArtifact } from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import sharp from "sharp";
import { OperationError } from "../types.js";

export type DiffConfig = {
  readonly threshold?: number;
};

export type DiffInput = {
  readonly baseImage: ImageArtifact;
  readonly compareImage: ImageArtifact;
};

export type DiffOutput = {
  readonly artifacts: {
    readonly report: DiffReportArtifact;
  };
  readonly data: {
    readonly pixelDiffPercent: number;
  };
};

export const diffOperation: Operation<DiffInput, DiffOutput, DiffConfig> = {
  name: "diff",
  description: "Compare two images for visual differences",
  inputSpecs: {
    baseImage: { channel: "artifact", type: "image" },
    compareImage: { channel: "artifact", type: "image" },
  },
  outputSpecs: {
    report: { channel: "artifact", type: "diff-report" },
    pixelDiffPercent: { channel: "data" },
  },

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { threshold = 0.1 } = config;

      ctx.logger.info(`Comparing ${input.baseImage.path} with ${input.compareImage.path}`);

      const [baseBuffer, compareBuffer] = yield* Effect.all([
        Effect.tryPromise({
          try: async () => sharp(input.baseImage.path).raw().toBuffer({ resolveWithObject: true }),
          catch: (e) =>
            new OperationError({
              operation: "diff",
              detail: "Failed to read base image",
              cause: e,
            }),
        }),
        Effect.tryPromise({
          try: async () =>
            sharp(input.compareImage.path).raw().toBuffer({ resolveWithObject: true }),
          catch: (e) =>
            new OperationError({
              operation: "diff",
              detail: "Failed to read compare image",
              cause: e,
            }),
        }),
      ]);

      const basePixels = baseBuffer.data;
      const comparePixels = compareBuffer.data;

      if (basePixels.length !== comparePixels.length) {
        ctx.logger.warn("Images have different sizes, using smaller size for comparison");
      }

      const pixelCount = Math.min(basePixels.length, comparePixels.length) / 4; // RGBA
      let diffCount = 0;

      for (let i = 0; i < pixelCount * 4; i += 4) {
        const rDiff = Math.abs((basePixels[i] ?? 0) - (comparePixels[i] ?? 0));
        const gDiff = Math.abs((basePixels[i + 1] ?? 0) - (comparePixels[i + 1] ?? 0));
        const bDiff = Math.abs((basePixels[i + 2] ?? 0) - (comparePixels[i + 2] ?? 0));

        // If any channel differs significantly, count as different
        if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
          diffCount++;
        }
      }

      const pixelDiffPercent = (diffCount / pixelCount) * 100;

      ctx.logger.info(`Pixel difference: ${pixelDiffPercent.toFixed(2)}%`);

      const reportPath = yield* ctx.getArtifactPath("diffReport").pipe(
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "diff",
              detail: "Failed to get output path",
              cause: e,
            }),
        ),
      );

      const reportData = {
        baseImage: input.baseImage.path,
        compareImage: input.compareImage.path,
        pixelDiffPercent,
        threshold,
        significant: pixelDiffPercent > threshold,
        timestamp: new Date().toISOString(),
      };

      yield* Effect.tryPromise({
        try: async () => Bun.write(reportPath, JSON.stringify(reportData, null, 2)),
        catch: (e) =>
          new OperationError({ operation: "diff", detail: "Failed to save diff report", cause: e }),
      });

      const artifact = ctx.createArtifact<DiffReportArtifact>({
        type: "diff-report",
        path: reportPath,
        createdBy: "diff",
        metadata: {
          baseImageId: input.baseImage.id,
          compareImageId: input.compareImage.id,
          pixelDiffPercent,
        },
      });

      return { artifacts: { report: artifact }, data: { pixelDiffPercent } };
    }),
};
