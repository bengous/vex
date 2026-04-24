/**
 * Grid overlay operation - adds cell reference grid to an image.
 */

import type { ImageArtifact } from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import sharp from "sharp";
import { addGridOverlay } from "../../core/overlays.js";
import { OperationError } from "../types.js";

export type OverlayGridConfig = {
  readonly showLabels?: boolean;
};

export type OverlayGridInput = {
  readonly image: ImageArtifact;
};

export type OverlayGridOutput = {
  readonly artifacts: {
    readonly image: ImageArtifact;
  };
};

export const overlayGridOperation: Operation<
  OverlayGridInput,
  OverlayGridOutput,
  OverlayGridConfig
> = {
  name: "overlay-grid",
  description: "Add cell reference grid overlay to image",
  inputSpecs: {
    image: { channel: "artifact", type: "image" },
  },
  outputSpecs: {
    image: { channel: "artifact", type: "image" },
  },

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { showLabels = true } = config;

      ctx.logger.info(`Adding grid overlay to ${input.image.path}`);

      const imageBuffer = yield* Effect.tryPromise({
        try: async () => sharp(input.image.path).toBuffer(),
        catch: (e) =>
          new OperationError({
            operation: "overlay-grid",
            detail: "Failed to read image",
            cause: e,
          }),
      });

      const gridBuffer = yield* Effect.tryPromise({
        try: async () => addGridOverlay(imageBuffer, { showLabels }),
        catch: (e) =>
          new OperationError({
            operation: "overlay-grid",
            detail: "Failed to add grid overlay",
            cause: e,
          }),
      });

      const outputPath = yield* ctx.getArtifactPath("withGrid").pipe(
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "overlay-grid",
              detail: "Failed to get output path",
              cause: e,
            }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => sharp(gridBuffer).toFile(outputPath),
        catch: (e) =>
          new OperationError({
            operation: "overlay-grid",
            detail: "Failed to save grid image",
            cause: e,
          }),
      });

      const artifact = ctx.createArtifact<ImageArtifact>({
        type: "image",
        path: outputPath,
        createdBy: "overlay-grid",
        metadata: {
          ...input.image.metadata,
          hasGrid: true,
        },
      });

      return { artifacts: { image: artifact } };
    }),
};
