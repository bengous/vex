/**
 * Unit tests for overlay-folds operation.
 *
 * Tests fold line overlay addition with various viewport configurations.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Exit } from 'effect';
import sharp from 'sharp';
import { runEffectExit } from '../../testing/index.js';
import {
  createCapturingLogger,
  createMockContext,
  createMockImageArtifact,
} from '../../testing/mocks/pipeline-context.js';
import { overlayFoldsOperation } from './overlay-folds.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe('overlayFoldsOperation', () => {
  let testDir: string;
  let testImagePath: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'overlay-folds-test-'));

    // Create a tall test image (400x1200 to have multiple fold lines)
    testImagePath = join(testDir, 'test-input.png');
    await sharp({
      create: {
        width: 400,
        height: 1200,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .png()
      .toFile(testImagePath);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Success Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('success paths', () => {
    test('adds fold lines to image', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.type).toBe('image');
        expect(exit.value.image.metadata.hasFoldLines).toBe(true);
        expect(exit.value.image.createdBy).toBe('overlay-folds');

        // Verify output file exists and has correct dimensions
        const outputMeta = await sharp(exit.value.image.path).metadata();
        expect(outputMeta.width).toBe(400);
        expect(outputMeta.height).toBe(1200);
      }
    });

    test('uses custom viewportHeight config', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, { viewportHeight: 600 }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.metadata.hasFoldLines).toBe(true);
      }
    });

    test('uses custom foldConfig', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const customConfig = {
        enabled: true,
        color: '#00FF00',
        showLabels: false,
      };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, { foldConfig: customConfig }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.metadata.hasFoldLines).toBe(true);
      }
    });

    test('extracts viewport height from image metadata', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const viewport = { width: 1920, height: 800, deviceScaleFactor: 1, isMobile: false };
      const input = {
        image: createMockImageArtifact({
          path: testImagePath,
          height: 1200,
          viewport,
        }),
      };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // Fold lines should be at viewport.height (800px) intervals
        expect(exit.value.image.metadata.hasFoldLines).toBe(true);
      }
    });

    test('stores artifact in context', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const storedArtifact = ctx.getArtifact(exit.value.image.id);
        expect(storedArtifact).toBeDefined();
      }
    });

    test('logs operation progress', async () => {
      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.length).toBeGreaterThan(0);
      expect(infoMessages.some((m) => m.message.includes('fold'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error paths', () => {
    test('fails when input image does not exist', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: '/nonexistent/image.png' }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === 'Fail') {
          expect(cause.error._tag).toBe('OperationError');
          expect(cause.error.operation).toBe('overlay-folds');
          expect(cause.error.detail).toContain('Failed to read image');
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Default Value Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('default values', () => {
    test('uses default viewport height of 900 when not specified', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      // No viewport in metadata, no viewportHeight in config
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      // Should succeed with default 900px viewport height
      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
