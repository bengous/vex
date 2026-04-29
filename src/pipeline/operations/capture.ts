/**
 * Capture operation - takes a screenshot of a URL.
 */

import type {
  CaptureResult,
  DOMCaptureResult,
  FullPageScrollFixOptions,
  PlaceholderMediaOptions,
} from "../../core/capture.js";
import type { DOMSnapshotArtifact, ImageArtifact, ViewportConfig } from "../../core/types.js";
import type { Operation } from "../types.js";
import { Effect } from "effect";
import { dirname } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { captureScreenshot, captureWithDOM } from "../../core/capture.js";
import { OperationError } from "../types.js";

export function getBrowserTypeForViewport(
  viewport: ViewportConfig,
): "chromium" | "webkit" | "firefox" {
  return viewport.defaultBrowserType ?? "chromium";
}

export async function launchBrowserForViewport(viewport: ViewportConfig) {
  const browserType = getBrowserTypeForViewport(viewport);
  if (browserType === "webkit") {
    return webkit.launch();
  }
  if (browserType === "firefox") {
    return firefox.launch();
  }
  return chromium.launch();
}

export type CaptureConfig = {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly withDOM?: boolean;
  /** Resolved placeholder media options (undefined = disabled) */
  readonly placeholderMedia?: PlaceholderMediaOptions;
  /** Expand internal scroll container(s) before fullPage capture */
  readonly fullPageScrollFix?: FullPageScrollFixOptions;
};

export type CaptureOutput = {
  readonly artifacts: {
    readonly image: ImageArtifact;
    /** DOM snapshot artifact, present when withDOM: true */
    readonly domSnapshot?: DOMSnapshotArtifact;
  };
};

function hasDOMSnapshot(result: CaptureResult | DOMCaptureResult): result is DOMCaptureResult {
  return "domSnapshot" in result;
}

export const captureOperation: Operation<void, CaptureOutput, CaptureConfig> = {
  name: "capture",
  description: "Capture a screenshot of a URL",
  inputSpecs: {},
  outputSpecs: {
    image: { channel: "artifact", type: "image" },
    domSnapshot: { channel: "artifact", type: "dom-snapshot", optional: true },
  },

  execute: (_, config, ctx) => {
    const { url, viewport, withDOM = false, placeholderMedia, fullPageScrollFix } = config;
    const browserType = getBrowserTypeForViewport(viewport);

    ctx.logger.info(`Capturing ${url} at ${viewport.width}x${viewport.height} via ${browserType}`);

    return Effect.acquireUseRelease(
      // acquire: launch browser
      Effect.tryPromise({
        try: async () => launchBrowserForViewport(viewport),
        catch: (e) =>
          new OperationError({
            operation: "capture",
            detail: "Failed to launch browser",
            cause: e,
          }),
      }),

      // use: all capture logic — browser.close() is NOT called here
      (browser) =>
        Effect.gen(function* () {
          const screenshotPath = yield* ctx.getArtifactPath("screenshot").pipe(
            Effect.mapError(
              (e) =>
                new OperationError({
                  operation: "capture",
                  detail: "Failed to get screenshot path",
                  cause: e,
                }),
            ),
          );

          const capture = withDOM ? captureWithDOM : captureScreenshot;
          const result: CaptureResult | DOMCaptureResult = yield* Effect.tryPromise({
            try: async () =>
              capture(browser, {
                url,
                viewport,
                outputDir: dirname(screenshotPath),
                filename: "01-screenshot.png",
                ...(placeholderMedia !== undefined ? { placeholderMedia } : {}),
                ...(fullPageScrollFix !== undefined ? { fullPageScrollFix } : {}),
              }),
            catch: (e) =>
              new OperationError({
                operation: "capture",
                detail: withDOM ? "Failed to capture with DOM" : "Failed to capture screenshot",
                cause: e,
              }),
          });

          const artifact = ctx.createArtifact<ImageArtifact>({
            type: "image",
            path: screenshotPath,
            metadata: result.artifact.metadata,
            createdBy: "capture",
          });

          if (withDOM) {
            const domPath = yield* ctx.getArtifactPath("dom").pipe(
              Effect.mapError(
                (e) =>
                  new OperationError({
                    operation: "capture",
                    detail: "Failed to get DOM path",
                    cause: e,
                  }),
              ),
            );

            if (!hasDOMSnapshot(result)) {
              return yield* new OperationError({
                operation: "capture",
                detail: "Capture completed without DOM snapshot",
              });
            }

            yield* Effect.tryPromise({
              try: async () => Bun.write(domPath, JSON.stringify(result.domSnapshot, null, 2)),
              catch: (e) =>
                new OperationError({
                  operation: "capture",
                  detail: "Failed to save DOM snapshot",
                  cause: e,
                }),
            });

            const domArtifact = ctx.createArtifact<DOMSnapshotArtifact>({
              type: "dom-snapshot",
              path: domPath,
              createdBy: "capture",
              metadata: {
                url: result.domSnapshot.url,
                elementCount: result.domSnapshot.elements.length,
                viewport,
              },
            });

            return { artifacts: { image: artifact, domSnapshot: domArtifact } };
          }

          return { artifacts: { image: artifact } };
        }),

      // release: guaranteed cleanup even on error
      (browser) => Effect.promise(async () => browser.close()).pipe(Effect.orDie),
    );
  },
};
