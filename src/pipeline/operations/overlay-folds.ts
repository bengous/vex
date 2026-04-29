/**
 * Fold lines overlay operation - adds above-the-fold markers.
 */

import type { FoldConfig, ImageArtifact } from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import sharp from "sharp";
import { addFoldOverlay } from "../../core/overlays.js";
import { DEFAULT_FOLD_CONFIG } from "../../core/types.js";
import { OperationError } from "../types.js";

export type OverlayFoldsConfig = {
  readonly foldConfig?: FoldConfig;
  readonly viewportHeight?: number;
};

export type OverlayFoldsInput = {
  readonly image: ImageArtifact;
};

export type OverlayFoldsOutput = {
  readonly artifacts: {
    readonly image: ImageArtifact;
  };
};

export const overlayFoldsOperation: Operation<
  OverlayFoldsInput,
  OverlayFoldsOutput,
  OverlayFoldsConfig
> = {
  name: "overlay-folds",
  description: "Add fold line markers to image",
  inputSpecs: {
    image: { channel: "artifact", type: "image" },
  },
  outputSpecs: {
    image: { channel: "artifact", type: "image" },
  },

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const foldConfig = config.foldConfig ?? DEFAULT_FOLD_CONFIG;
      const cssViewportHeight =
        config.viewportHeight ?? input.image.metadata.viewport?.height ?? 900;

      ctx.logger.info(`Adding fold lines to ${input.image.path}`);

      const imageBuffer = yield* Effect.tryPromise({
        try: async () => sharp(input.image.path).toBuffer(),
        catch: (e) =>
          new OperationError({
            operation: "overlay-folds",
            detail: "Failed to read image",
            cause: e,
          }),
      });

      const imageMetadata = yield* Effect.tryPromise({
        try: async () => sharp(imageBuffer).metadata(),
        catch: (e) =>
          new OperationError({
            operation: "overlay-folds",
            detail: "Failed to read image metadata",
            cause: e,
          }),
      });

      const cssViewportWidth = input.image.metadata.viewport?.width;
      const deviceScaleFactor = input.image.metadata.viewport?.deviceScaleFactor ?? 1;
      const expectedDeviceWidth =
        cssViewportWidth !== undefined
          ? Math.round(cssViewportWidth * deviceScaleFactor)
          : undefined;
      const isDeviceScale =
        expectedDeviceWidth !== undefined &&
        imageMetadata.width !== undefined &&
        Math.abs(imageMetadata.width - expectedDeviceWidth) <= 2;
      const viewportHeight = isDeviceScale
        ? Math.round(cssViewportHeight * deviceScaleFactor)
        : cssViewportHeight;

      const foldBuffer = yield* Effect.tryPromise({
        try: async () => addFoldOverlay(imageBuffer, viewportHeight, foldConfig, cssViewportHeight),
        catch: (e) =>
          new OperationError({
            operation: "overlay-folds",
            detail: "Failed to add fold lines",
            cause: e,
          }),
      });

      const outputPath = yield* ctx.getArtifactPath("withFolds").pipe(
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "overlay-folds",
              detail: "Failed to get output path",
              cause: e,
            }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => sharp(foldBuffer).toFile(outputPath),
        catch: (e) =>
          new OperationError({
            operation: "overlay-folds",
            detail: "Failed to save fold image",
            cause: e,
          }),
      });

      const artifact = ctx.createArtifact<ImageArtifact>({
        type: "image",
        path: outputPath,
        createdBy: "overlay-folds",
        metadata: {
          ...input.image.metadata,
          hasFoldLines: true,
        },
      });

      return { artifacts: { image: artifact } };
    }),
};
