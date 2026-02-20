/**
 * Capture operation - takes a screenshot of a URL.
 */

import { dirname } from 'node:path';
import { Effect } from 'effect';
import { chromium } from 'playwright';
import { captureScreenshot, captureWithDOM, type PlaceholderMediaOptions } from '../../core/capture.js';
import type { DOMSnapshotArtifact, ImageArtifact, ViewportConfig } from '../../core/types.js';
import { type Operation, OperationError } from '../types.js';

export interface CaptureConfig {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly withDOM?: boolean;
  /** Resolved placeholder media options (undefined = disabled) */
  readonly placeholderMedia?: PlaceholderMediaOptions;
}

export interface CaptureOutput {
  readonly image: ImageArtifact;
  /** DOM snapshot artifact, present when withDOM: true */
  readonly domSnapshot?: DOMSnapshotArtifact;
}

export const captureOperation: Operation<void, CaptureOutput, CaptureConfig> = {
  name: 'capture',
  description: 'Capture a screenshot of a URL',
  inputTypes: [],
  outputTypes: ['image'],

  execute: (_, config, ctx) => {
    const { url, viewport, withDOM = false, placeholderMedia } = config;

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

          if (withDOM) {
            const domPath = yield* ctx
              .getArtifactPath('dom')
              .pipe(
                Effect.mapError(
                  (e) => new OperationError({ operation: 'capture', detail: 'Failed to get DOM path', cause: e }),
                ),
              );

            const result = yield* Effect.tryPromise({
              try: () =>
                captureWithDOM(browser, {
                  url,
                  viewport,
                  outputDir: dirname(screenshotPath),
                  filename: '01-screenshot.png',
                  placeholderMedia,
                }),
              catch: (e) => new OperationError({ operation: 'capture', detail: 'Failed to capture with DOM', cause: e }),
            });

            yield* Effect.tryPromise({
              try: () => Bun.write(domPath, JSON.stringify(result.domSnapshot, null, 2)),
              catch: (e) =>
                new OperationError({ operation: 'capture', detail: 'Failed to save DOM snapshot', cause: e }),
            });

            const artifact: ImageArtifact = {
              ...result.artifact,
              path: screenshotPath,
            };

            ctx.storeArtifact(artifact);

            const domArtifact: DOMSnapshotArtifact = {
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

          const result = yield* Effect.tryPromise({
            try: () =>
              captureScreenshot(browser, {
                url,
                viewport,
                outputDir: dirname(screenshotPath),
                filename: '01-screenshot.png',
                placeholderMedia,
              }),
            catch: (e) =>
              new OperationError({ operation: 'capture', detail: 'Failed to capture screenshot', cause: e }),
          });

          const artifact: ImageArtifact = {
            ...result.artifact,
            path: screenshotPath,
          };

          ctx.storeArtifact(artifact);

          return { image: artifact };
        }),

      // release: guaranteed cleanup even on error
      (browser) => Effect.promise(() => browser.close()).pipe(Effect.orDie),
    );
  },
};
