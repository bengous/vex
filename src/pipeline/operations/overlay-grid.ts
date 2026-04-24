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
  readonly image: ImageArtifact;
};

export const overlayGridOperation: Operation<
  OverlayGridInput,
  OverlayGridOutput,
  OverlayGridConfig
> = {
  name: "overlay-grid",
  description: "Add cell reference grid overlay to image",
  inputTypes: ["image"],
  outputTypes: ["image"],

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

      const artifact: ImageArtifact = {
        _kind: "artifact",
        id: crypto.randomUUID(),
        type: "image",
        path: outputPath,
        createdAt: new Date().toISOString(),
        createdBy: "overlay-grid",
        metadata: {
          ...input.image.metadata,
          hasGrid: true,
        },
      };

      ctx.storeArtifact(artifact);
      return { image: artifact };
    }),
};
