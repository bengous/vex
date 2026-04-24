/**
 * Capture operation - takes a screenshot of a URL.
 */

import { dirname } from 'node:path';
import { Effect } from 'effect';
import { chromium } from 'playwright';
import {
  type CaptureResult,
  captureScreenshot,
  captureWithDOM,
  type DOMCaptureResult,
  type FullPageScrollFixOptions,
  type PlaceholderMediaOptions,
} from '../../core/capture.js';
import type { DOMSnapshotArtifact, ImageArtifact, ViewportConfig } from '../../core/types.js';
import { type Operation, OperationError } from '../types.js';

export interface CaptureConfig {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly withDOM?: boolean;
  /** Resolved placeholder media options (undefined = disabled) */
  readonly placeholderMedia?: PlaceholderMediaOptions;
  /** Expand internal scroll container(s) before fullPage capture */
  readonly fullPageScrollFix?: FullPageScrollFixOptions;
}

export interface CaptureOutput {
  readonly image: ImageArtifact;
  /** DOM snapshot artifact, present when withDOM: true */
  readonly domSnapshot?: DOMSnapshotArtifact;
}

function hasDOMSnapshot(result: CaptureResult | DOMCaptureResult): result is DOMCaptureResult {
  return 'domSnapshot' in result;
}

export const captureOperation: Operation<void, CaptureOutput, CaptureConfig> = {
  name: 'capture',
  description: 'Capture a screenshot of a URL',
  inputTypes: [],
  outputTypes: ['image'],

  execute: (_, config, ctx) => {
    const { url, viewport, withDOM = false, placeholderMedia, fullPageScrollFix } = config;

    ctx.logger.info(`Capturing ${url} at ${viewport.width}x${viewport.height}`);

    return Effect.acquireUseRelease(
      // acquire: launch browser
      Effect.tryPromise({
        try: () => chromium.launch(),
        catch: (e) => new OperationError({ operation: 'capture', detail: 'Failed to launch browser', cause: e }),
      }),

      // use: all capture logic — browser.close() is NOT called here
      (browser) =>
        Effect.gen(function* () {
          const screenshotPath = yield* ctx
            .getArtifactPath('screenshot')
            .pipe(
              Effect.mapError(
                (e) => new OperationError({ operation: 'capture', detail: 'Failed to get screenshot path', cause: e }),
              ),
            );

          const capture = withDOM ? captureWithDOM : captureScreenshot;
          const result: CaptureResult | DOMCaptureResult = yield* Effect.tryPromise({
            try: () =>
              capture(browser, {
                url,
                viewport,
                outputDir: dirname(screenshotPath),
                filename: '01-screenshot.png',
                placeholderMedia,
                fullPageScrollFix,
              }),
            catch: (e) =>
              new OperationError({
                operation: 'capture',
                detail: withDOM ? 'Failed to capture with DOM' : 'Failed to capture screenshot',
                cause: e,
              }),
          });

          const artifact: ImageArtifact = {
            ...result.artifact,
            path: screenshotPath,
          };

          ctx.storeArtifact(artifact);

          if (withDOM) {
            const domPath = yield* ctx
              .getArtifactPath('dom')
              .pipe(
                Effect.mapError(
                  (e) => new OperationError({ operation: 'capture', detail: 'Failed to get DOM path', cause: e }),
                ),
              );

            if (!hasDOMSnapshot(result)) {
              return yield* Effect.fail(
                new OperationError({ operation: 'capture', detail: 'Capture completed without DOM snapshot' }),
              );
            }

            yield* Effect.tryPromise({
              try: () => Bun.write(domPath, JSON.stringify(result.domSnapshot, null, 2)),
              catch: (e) =>
                new OperationError({ operation: 'capture', detail: 'Failed to save DOM snapshot', cause: e }),
            });

            const domArtifact: DOMSnapshotArtifact = {
              _kind: 'artifact',
              id: crypto.randomUUID(),
              type: 'dom-snapshot',
              path: domPath,
              createdAt: new Date().toISOString(),
              createdBy: 'capture',
              metadata: {
                url: result.domSnapshot.url,
                elementCount: result.domSnapshot.elements.length,
                viewport,
              },
            };

            ctx.storeArtifact(domArtifact);

            return { image: artifact, domSnapshot: domArtifact };
          }

          return { image: artifact };
        }),

      // release: guaranteed cleanup even on error
      (browser) => Effect.promise(() => browser.close()).pipe(Effect.orDie),
    );
  },
};
