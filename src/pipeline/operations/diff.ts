/**
 * Diff operation - compares two images for visual differences.
 */

import { Effect } from 'effect';
import sharp from 'sharp';
import type { DiffReportArtifact, ImageArtifact } from '../../core/types.js';
import type { Operation, OperationError } from '../types.js';

export interface DiffConfig {
  readonly threshold?: number;
}

export interface DiffInput {
  readonly baseImage: ImageArtifact;
  readonly compareImage: ImageArtifact;
}

export interface DiffOutput {
  readonly report: DiffReportArtifact;
  readonly diffImage?: ImageArtifact;
  readonly pixelDiffPercent: number;
}

function makeError(message: string, cause?: unknown): OperationError {
  return { _tag: 'OperationError', operation: 'diff', message, cause };
}

export const diffOperation: Operation<DiffInput, DiffOutput, DiffConfig> = {
  name: 'diff',
  description: 'Compare two images for visual differences',
  inputTypes: ['image', 'image'],
  outputTypes: ['diff-report'],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { threshold = 0.1 } = config;

      ctx.logger.info(`Comparing ${input.baseImage.path} with ${input.compareImage.path}`);

      const [baseBuffer, compareBuffer] = yield* Effect.all([
        Effect.tryPromise({
          try: () => sharp(input.baseImage.path).raw().toBuffer({ resolveWithObject: true }),
          catch: (e) => makeError('Failed to read base image', e),
        }),
        Effect.tryPromise({
          try: () => sharp(input.compareImage.path).raw().toBuffer({ resolveWithObject: true }),
          catch: (e) => makeError('Failed to read compare image', e),
        }),
      ]);

      const basePixels = baseBuffer.data;
      const comparePixels = compareBuffer.data;

      if (basePixels.length !== comparePixels.length) {
        ctx.logger.warn('Images have different sizes, using smaller size for comparison');
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

      const reportPath = yield* Effect.tryPromise({
        try: () => ctx.getArtifactPath('diffReport'),
        catch: (e) => makeError('Failed to get output path', e),
      });

      const reportData = {
        baseImage: input.baseImage.path,
        compareImage: input.compareImage.path,
        pixelDiffPercent,
        threshold,
        significant: pixelDiffPercent > threshold,
        timestamp: new Date().toISOString(),
      };

      yield* Effect.tryPromise({
        try: () => Bun.write(reportPath, JSON.stringify(reportData, null, 2)),
        catch: (e) => makeError('Failed to save diff report', e),
      });

      const artifact: DiffReportArtifact = {
        id: `diff_${Date.now()}`,
        type: 'diff-report',
        path: reportPath,
        createdAt: new Date().toISOString(),
        createdBy: 'diff',
        metadata: {
          baseImageId: input.baseImage.id,
          compareImageId: input.compareImage.id,
          pixelDiffPercent,
        },
      };

      ctx.storeArtifact(artifact);
      return { report: artifact, pixelDiffPercent };
    }),
};
