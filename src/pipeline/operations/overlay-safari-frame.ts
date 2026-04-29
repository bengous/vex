import type { ImageArtifact, SafariFrameOptions } from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import { writeFile } from "node:fs/promises";
import { renderSafariFrame } from "../../core/safari-frame.js";
import { OperationError } from "../types.js";

export type OverlaySafariFrameInput = {
  readonly image: ImageArtifact;
};

export type OverlaySafariFrameOutput = {
  readonly artifacts: {
    readonly image: ImageArtifact;
  };
};

export const overlaySafariFrameOperation: Operation<
  OverlaySafariFrameInput,
  OverlaySafariFrameOutput,
  SafariFrameOptions
> = {
  name: "overlay-safari-frame",
  description: "Render a Safari iOS single-shot frame around a page capture",
  inputSpecs: {
    image: { channel: "artifact", type: "image" },
  },
  outputSpecs: {
    image: { channel: "artifact", type: "image" },
  },

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      ctx.logger.info(`Rendering Safari iOS frame for ${input.image.path}`);

      const result = yield* Effect.tryPromise({
        try: async () => renderSafariFrame(input.image, config),
        catch: (e) =>
          new OperationError({
            operation: "overlay-safari-frame",
            detail: e instanceof Error ? e.message : "Failed to render Safari frame",
            cause: e,
          }),
      });

      const outputPath = yield* ctx.getArtifactPath("safariFrame").pipe(
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "overlay-safari-frame",
              detail: "Failed to get output path",
              cause: e,
            }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => writeFile(outputPath, result.buffer),
        catch: (e) =>
          new OperationError({
            operation: "overlay-safari-frame",
            detail: "Failed to save Safari frame image",
            cause: e,
          }),
      });

      const artifact = ctx.createArtifact<ImageArtifact>({
        type: "image",
        path: outputPath,
        createdBy: "overlay-safari-frame",
        metadata: {
          ...input.image.metadata,
          width: result.metadata.width,
          height: result.metadata.height,
          safariFrame: {
            name: config.name,
            style: config.style,
            topChromeCss: result.metadata.topChromeCss,
            bottomChromeCss: result.metadata.bottomChromeCss,
            foldY: result.metadata.foldY,
            scale: result.metadata.scale,
            approximate: true,
          },
        },
      });

      return { artifacts: { image: artifact } };
    }),
};
