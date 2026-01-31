/**
 * Render operation - renders annotations onto an image.
 */

import { Effect } from 'effect';
import sharp from 'sharp';
import { renderAnnotations } from '../../core/overlays.js';
import type { ImageArtifact, ToolCall } from '../../core/types.js';
import type { Operation, OperationError } from '../types.js';

export type RenderConfig = Record<string, never>;

export interface RenderInput {
  readonly image: ImageArtifact;
  readonly toolCalls: readonly ToolCall[];
}

export interface RenderOutput {
  readonly image: ImageArtifact;
}

function makeError(message: string, cause?: unknown): OperationError {
  return { _tag: 'OperationError', operation: 'render', message, cause };
}

export const renderOperation: Operation<RenderInput, RenderOutput, RenderConfig> = {
  name: 'render',
  description: 'Render annotations onto image',
  inputTypes: ['image'],
  outputTypes: ['annotated-image'],

  execute: (input, _config, ctx) =>
    Effect.gen(function* () {
      if (input.toolCalls.length === 0) {
        ctx.logger.info('No annotations to render');
        return { image: input.image };
      }

      ctx.logger.info(`Rendering ${input.toolCalls.length} annotations onto ${input.image.path}`);

      const imageBuffer = yield* Effect.tryPromise({
        try: () => sharp(input.image.path).toBuffer(),
        catch: (e) => makeError('Failed to read image', e),
      });

      const annotatedBuffer = yield* Effect.tryPromise({
        try: () => renderAnnotations(imageBuffer, input.toolCalls),
        catch: (e) => makeError('Failed to render annotations', e),
      });

      const outputPath = yield* Effect.tryPromise({
        try: () => ctx.getArtifactPath('annotated'),
        catch: (e) => makeError('Failed to get output path', e),
      });

      yield* Effect.tryPromise({
        try: () => sharp(annotatedBuffer).toFile(outputPath),
        catch: (e) => makeError('Failed to save annotated image', e),
      });

      const artifact: ImageArtifact = {
        id: `img_${Date.now()}`,
        type: 'annotated-image',
        path: outputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'render',
        metadata: {
          ...input.image.metadata,
          hasAnnotations: true,
        },
      };

      ctx.storeArtifact(artifact);
      return { image: artifact };
    }),
};
