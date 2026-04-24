/**
 * Render operation - renders annotations onto an image.
 */

import type { ImageArtifact, ToolCall } from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import sharp from "sharp";
import { renderAnnotations } from "../../core/overlays.js";
import { OperationError } from "../types.js";

export type RenderConfig = Record<string, never>;

export type RenderInput = {
  readonly image: ImageArtifact;
  readonly toolCalls: readonly ToolCall[];
};

export type RenderOutput = {
  readonly artifacts: {
    readonly image: ImageArtifact;
  };
};

export const renderOperation: Operation<RenderInput, RenderOutput, RenderConfig> = {
  name: "render",
  description: "Render annotations onto image",
  inputSpecs: {
    image: { channel: "artifact", type: "image" },
    toolCalls: { channel: "data" },
  },
  outputSpecs: {
    image: { channel: "artifact", type: "annotated-image" },
  },

  execute: (input, _config, ctx) =>
    Effect.gen(function* () {
      if (input.toolCalls.length === 0) {
        ctx.logger.info("No annotations to render");
        const artifact = ctx.createArtifact<ImageArtifact>({
          type: "annotated-image",
          path: input.image.path,
          createdBy: "render",
          metadata: {
            ...input.image.metadata,
            hasAnnotations: false,
          },
        });
        return { artifacts: { image: artifact } };
      }

      ctx.logger.info(`Rendering ${input.toolCalls.length} annotations onto ${input.image.path}`);

      const imageBuffer = yield* Effect.tryPromise({
        try: async () => sharp(input.image.path).toBuffer(),
        catch: (e) =>
          new OperationError({ operation: "render", detail: "Failed to read image", cause: e }),
      });

      const annotatedBuffer = yield* Effect.tryPromise({
        try: async () => renderAnnotations(imageBuffer, input.toolCalls),
        catch: (e) =>
          new OperationError({
            operation: "render",
            detail: "Failed to render annotations",
            cause: e,
          }),
      });

      const outputPath = yield* ctx.getArtifactPath("annotated").pipe(
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "render",
              detail: "Failed to get output path",
              cause: e,
            }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => sharp(annotatedBuffer).toFile(outputPath),
        catch: (e) =>
          new OperationError({
            operation: "render",
            detail: "Failed to save annotated image",
            cause: e,
          }),
      });

      const artifact = ctx.createArtifact<ImageArtifact>({
        type: "annotated-image",
        path: outputPath,
        createdBy: "render",
        metadata: {
          ...input.image.metadata,
          hasAnnotations: true,
        },
      });

      return { artifacts: { image: artifact } };
    }),
};
