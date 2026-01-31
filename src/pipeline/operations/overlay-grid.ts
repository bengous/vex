/**
 * Grid overlay operation - adds cell reference grid to an image.
 */

import { Effect } from 'effect';
import sharp from 'sharp';
import { addGridOverlay } from '../../core/overlays.js';
import type { ImageArtifact } from '../../core/types.js';
import type { Operation, OperationError } from '../types.js';

export interface OverlayGridConfig {
  readonly showLabels?: boolean;
}

export interface OverlayGridInput {
  readonly image: ImageArtifact;
}

export interface OverlayGridOutput {
  readonly image: ImageArtifact;
}

function makeError(message: string, cause?: unknown): OperationError {
  return { _tag: 'OperationError', operation: 'overlay-grid', message, cause };
}

export const overlayGridOperation: Operation<OverlayGridInput, OverlayGridOutput, OverlayGridConfig> = {
  name: 'overlay-grid',
  description: 'Add cell reference grid overlay to image',
  inputTypes: ['image'],
  outputTypes: ['image'],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { showLabels = true } = config;

      ctx.logger.info(`Adding grid overlay to ${input.image.path}`);

      const imageBuffer = yield* Effect.tryPromise({
        try: () => sharp(input.image.path).toBuffer(),
        catch: (e) => makeError('Failed to read image', e),
      });

      const gridBuffer = yield* Effect.tryPromise({
        try: () => addGridOverlay(imageBuffer, { showLabels }),
        catch: (e) => makeError('Failed to add grid overlay', e),
      });

      const outputPath = yield* Effect.tryPromise({
        try: () => ctx.getArtifactPath('withGrid'),
        catch: (e) => makeError('Failed to get output path', e),
      });

      yield* Effect.tryPromise({
        try: () => sharp(gridBuffer).toFile(outputPath),
        catch: (e) => makeError('Failed to save grid image', e),
      });

      const artifact: ImageArtifact = {
        id: `img_${Date.now()}`,
        type: 'image',
        path: outputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'overlay-grid',
        metadata: {
          ...input.image.metadata,
          hasGrid: true,
        },
      };

      ctx.storeArtifact(artifact);
      return { image: artifact };
    }),
};
