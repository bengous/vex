/**
 * Unit tests for overlay-grid operation.
 *
 * Tests grid overlay addition to images with various configurations.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Exit } from 'effect';
import sharp from 'sharp';
import { runEffectExit } from '../../testing/effect-helpers.js';
import {
  createCapturingLogger,
  createMockContext,
  createMockImageArtifact,
} from '../../testing/mocks/pipeline-context.js';
import { overlayGridOperation } from './overlay-grid.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe('overlayGridOperation', () => {
  let testDir: string;
  let testImagePath: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'overlay-grid-test-'));

    // Create a simple test image (100x100 white square)
    testImagePath = join(testDir, 'test-input.png');
    await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
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
    test('adds grid overlay to image', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(overlayGridOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.type).toBe('image');
        expect(exit.value.image.metadata.hasGrid).toBe(true);
        expect(exit.value.image.createdBy).toBe('overlay-grid');

        // Verify output file exists and is valid
        const outputMeta = await sharp(exit.value.image.path).metadata();
        expect(outputMeta.width).toBe(400);
        expect(outputMeta.height).toBe(400);
      }
    });

    test('respects showLabels config', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      // With showLabels = false
      const exit = await runEffectExit(overlayGridOperation.execute(input, { showLabels: false }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // Output should still be valid (labels just not shown)
        expect(exit.value.image.metadata.hasGrid).toBe(true);
      }
    });

    test('stores artifact in context', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(overlayGridOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const storedArtifact = ctx.getArtifact(exit.value.image.id);
        expect(storedArtifact).toBeDefined();
        expect(storedArtifact?.id).toBe(exit.value.image.id);
      }
    });

    test('logs operation progress', async () => {
      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      await runEffectExit(overlayGridOperation.execute(input, {}, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.length).toBeGreaterThan(0);
      expect(infoMessages.some((m) => m.message.includes('grid'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error paths', () => {
    test('fails when input image does not exist', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: '/nonexistent/image.png' }) };

      const exit = await runEffectExit(overlayGridOperation.execute(input, {}, ctx));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === 'Fail') {
          expect(cause.error._tag).toBe('OperationError');
          expect(cause.error.operation).toBe('overlay-grid');
          expect(cause.error.detail).toContain('Failed to read image');
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metadata Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('metadata preservation', () => {
    test('preserves input metadata in output', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false };
      const input = {
        image: createMockImageArtifact({
          path: testImagePath,
          width: 400,
          height: 400,
          viewport,
        }),
      };

      const exit = await runEffectExit(overlayGridOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.metadata.viewport).toEqual(viewport);
        expect(exit.value.image.metadata.width).toBe(400);
        expect(exit.value.image.metadata.height).toBe(400);
      }
    });
  });
});
