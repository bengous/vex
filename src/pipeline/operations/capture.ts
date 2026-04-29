/**
 * Capture operation - takes a screenshot of a URL.
 */

import type {
  CaptureResult,
  DOMCaptureResult,
  FullPageScrollFixOptions,
  PlaceholderMediaOptions,
} from "../../core/capture.js";
import type {
  BrowserType,
  DOMSnapshotArtifact,
  FoldOcclusionOptions,
  ImageArtifact,
  ViewportConfig,
} from "../../core/types.js";
import type { Operation } from "../types.js";
import type { Browser } from "playwright";
import { Effect } from "effect";
import { dirname } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { captureScreenshot, captureWithDOM } from "../../core/capture.js";
import { OperationError } from "../types.js";

export function getBrowserTypeForViewport(viewport: ViewportConfig): BrowserType {
  return viewport.defaultBrowserType ?? "chromium";
}

async function launchBrowser(browserType: BrowserType): Promise<Browser> {
  if (browserType === "webkit") {
    return webkit.launch();
  }
  if (browserType === "firefox") {
    return firefox.launch();
  }
  return chromium.launch();
}

type BrowserLaunchResult = {
  readonly browser: Browser;
  readonly actualBrowserType: BrowserType;
  readonly fallbackReason?: string;
};

// Avoid retrying a known-broken engine on every capture in the same process.
const fallbackCache = new Map<BrowserType, string>();

async function launchBrowserForViewportWithFallback(
  viewport: ViewportConfig,
): Promise<BrowserLaunchResult> {
  const requestedBrowserType = getBrowserTypeForViewport(viewport);
  const cachedReason = fallbackCache.get(requestedBrowserType);
  if (cachedReason !== undefined) {
    return {
      browser: await chromium.launch(),
      actualBrowserType: "chromium",
      fallbackReason: cachedReason,
    };
  }
  try {
    return {
      browser: await launchBrowser(requestedBrowserType),
      actualBrowserType: requestedBrowserType,
    };
  } catch (error) {
    if (requestedBrowserType === "chromium") {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    fallbackCache.set(requestedBrowserType, reason);
    return {
      browser: await chromium.launch(),
      actualBrowserType: "chromium",
      fallbackReason: reason,
    };
  }
}

export type CaptureConfig = {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly withDOM?: boolean;
  /** Resolved placeholder media options (undefined = disabled) */
  readonly placeholderMedia?: PlaceholderMediaOptions;
  /** Expand internal scroll container(s) before fullPage capture */
  readonly fullPageScrollFix?: FullPageScrollFixOptions;
  /** Detect fixed/sticky viewport occlusion for fold line spacing */
  readonly foldOcclusion?: FoldOcclusionOptions;
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
    const {
      url,
      viewport,
      withDOM = false,
      placeholderMedia,
      fullPageScrollFix,
      foldOcclusion,
    } = config;
    const browserType = getBrowserTypeForViewport(viewport);

    ctx.logger.info(`Capturing ${url} at ${viewport.width}x${viewport.height} via ${browserType}`);

    return Effect.acquireUseRelease(
      // acquire: launch browser
      Effect.tryPromise({
        try: async () => launchBrowserForViewportWithFallback(viewport),
        catch: (e) =>
          new OperationError({
            operation: "capture",
            detail: "Failed to launch browser",
            cause: e,
          }),
      }),

      // use: all capture logic — browser.close() is NOT called here
      (launched) =>
        Effect.gen(function* () {
          if (launched.fallbackReason !== undefined) {
            ctx.logger.warn(
              `Falling back from ${browserType} to ${launched.actualBrowserType}: ${launched.fallbackReason}`,
            );
          }

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
              capture(launched.browser, {
                url,
                viewport,
                outputDir: dirname(screenshotPath),
                filename: "01-screenshot.png",
                ...(placeholderMedia !== undefined ? { placeholderMedia } : {}),
                ...(fullPageScrollFix !== undefined ? { fullPageScrollFix } : {}),
                ...(foldOcclusion !== undefined ? { foldOcclusion } : {}),
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
            metadata: {
              ...result.artifact.metadata,
              actualBrowserType: launched.actualBrowserType,
              ...(launched.fallbackReason !== undefined
                ? { browserFallbackReason: launched.fallbackReason }
                : {}),
            },
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
      (launched) => Effect.promise(async () => launched.browser.close()).pipe(Effect.orDie),
    );
  },
};
