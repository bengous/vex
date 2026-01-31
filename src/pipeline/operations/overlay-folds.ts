/**
 * Fold lines overlay operation - adds above-the-fold markers.
 */

import { Effect } from 'effect';
import sharp from 'sharp';
import { addFoldOverlay } from '../../core/overlays.js';
import type { FoldConfig, ImageArtifact } from '../../core/types.js';
import { DEFAULT_FOLD_CONFIG } from '../../core/types.js';
import type { Operation, OperationError } from '../types.js';

export interface OverlayFoldsConfig {
  readonly foldConfig?: FoldConfig;
  readonly viewportHeight?: number;
}

export interface OverlayFoldsInput {
  readonly image: ImageArtifact;
}

export interface OverlayFoldsOutput {
  readonly image: ImageArtifact;
}

function makeError(message: string, cause?: unknown): OperationError {
  return { _tag: 'OperationError', operation: 'overlay-folds', message, cause };
}

export const overlayFoldsOperation: Operation<OverlayFoldsInput, OverlayFoldsOutput, OverlayFoldsConfig> = {
  name: 'overlay-folds',
  description: 'Add fold line markers to image',
  inputTypes: ['image'],
  outputTypes: ['image'],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const foldConfig = config.foldConfig ?? DEFAULT_FOLD_CONFIG;
      const viewportHeight = config.viewportHeight ?? input.image.metadata.viewport?.height ?? 900;

      ctx.logger.info(`Adding fold lines to ${input.image.path}`);

      const imageBuffer = yield* Effect.tryPromise({
        try: () => sharp(input.image.path).toBuffer(),
        catch: (e) => makeError('Failed to read image', e),
      });

      const foldBuffer = yield* Effect.tryPromise({
        try: () => addFoldOverlay(imageBuffer, viewportHeight, foldConfig),
        catch: (e) => makeError('Failed to add fold lines', e),
      });

      const outputPath = yield* Effect.tryPromise({
        try: () => ctx.getArtifactPath('withFolds'),
        catch: (e) => makeError('Failed to get output path', e),
      });

      yield* Effect.tryPromise({
        try: () => sharp(foldBuffer).toFile(outputPath),
        catch: (e) => makeError('Failed to save fold image', e),
      });

      const artifact: ImageArtifact = {
        id: `img_${Date.now()}`,
        type: 'image',
        path: outputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'overlay-folds',
        metadata: {
          ...input.image.metadata,
          hasFoldLines: true,
        },
      };

      ctx.storeArtifact(artifact);
      return { image: artifact };
    }),
};
