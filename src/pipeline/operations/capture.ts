/**
 * Capture operation - takes a screenshot of a URL.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { chromium } from 'playwright';
import { captureScreenshot, captureWithDOM } from '../../core/capture.js';
import type { DOMSnapshotArtifact, ImageArtifact, ViewportConfig } from '../../core/types.js';
import type { Operation, OperationError } from '../types.js';

export interface CaptureConfig {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly withDOM?: boolean;
}

export interface CaptureOutput {
  readonly image: ImageArtifact;
  /** DOM snapshot artifact, present when withDOM: true */
  readonly domSnapshot?: DOMSnapshotArtifact;
}

function makeError(message: string, cause?: unknown): OperationError {
  return { _tag: 'OperationError', operation: 'capture', message, cause };
}

export const captureOperation: Operation<void, CaptureOutput, CaptureConfig> = {
  name: 'capture',
  description: 'Capture a screenshot of a URL',
  inputTypes: [],
  outputTypes: ['image'],

  execute: (_, config, ctx) =>
    Effect.gen(function* () {
      const { url, viewport, withDOM = false } = config;

      ctx.logger.info(`Capturing ${url} at ${viewport.width}x${viewport.height}`);

      // Get artifact paths using new viewport-aware helpers
      const screenshotPath = yield* Effect.tryPromise({
        try: () => ctx.getArtifactPath('screenshot'),
        catch: (e) => makeError('Failed to get screenshot path', e),
      });

      // Ensure the viewport directory exists
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(screenshotPath), { recursive: true }),
        catch: (e) => makeError('Failed to create viewport directory', e),
      });

      const browser = yield* Effect.tryPromise({
        try: () => chromium.launch(),
        catch: (e) => makeError('Failed to launch browser', e),
      });

      if (withDOM) {
        const domPath = yield* Effect.tryPromise({
          try: () => ctx.getArtifactPath('dom'),
          catch: (e) => makeError('Failed to get DOM path', e),
        });

        const result = yield* Effect.tryPromise({
          try: () =>
            captureWithDOM(browser, {
              url,
              viewport,
              outputDir: dirname(screenshotPath),
              filename: '01-screenshot.png',
            }),
          catch: (e) => makeError('Failed to capture with DOM', e),
        });

        // Save DOM snapshot
        yield* Effect.tryPromise({
          try: () => Bun.write(domPath, JSON.stringify(result.domSnapshot, null, 2)),
          catch: (e) => makeError('Failed to save DOM snapshot', e),
        });

        // Update artifact path to use the new location
        const artifact: ImageArtifact = {
          ...result.artifact,
          path: screenshotPath,
        };

        ctx.storeArtifact(artifact);

        // Create and store DOM snapshot artifact
        const domArtifact: DOMSnapshotArtifact = {
          id: `dom-snapshot_${Date.now()}`,
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

        yield* Effect.tryPromise({
          try: () => browser.close(),
          catch: () => makeError('Failed to close browser'),
        });

        return { image: artifact, domSnapshot: domArtifact };
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          captureScreenshot(browser, {
            url,
            viewport,
            outputDir: dirname(screenshotPath),
            filename: '01-screenshot.png',
          }),
        catch: (e) => makeError('Failed to capture screenshot', e),
      });

      // Update artifact path to use the new location
      const artifact: ImageArtifact = {
        ...result.artifact,
        path: screenshotPath,
      };

      ctx.storeArtifact(artifact);

      yield* Effect.tryPromise({
        try: () => browser.close(),
        catch: () => makeError('Failed to close browser'),
      });

      return { image: artifact };
    }),
};
