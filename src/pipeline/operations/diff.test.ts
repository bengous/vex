/**
 * Unit tests for diff operation.
 *
 * Tests image comparison functionality with various scenarios.
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
import { diffOperation } from './diff.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe('diffOperation', () => {
  let testDir: string;
  let whiteImagePath: string;
  let blackImagePath: string;
  let grayImagePath: string;
  let smallImagePath: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'diff-test-'));

    // Create test images
    const imageOptions = { width: 100, height: 100, channels: 4 as const };

    // White image
    whiteImagePath = join(testDir, 'white.png');
    await sharp({
      create: { ...imageOptions, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toFile(whiteImagePath);

    // Black image
    blackImagePath = join(testDir, 'black.png');
    await sharp({
      create: { ...imageOptions, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toFile(blackImagePath);

    // Gray image (similar to white but different)
    grayImagePath = join(testDir, 'gray.png');
    await sharp({
      create: { ...imageOptions, background: { r: 245, g: 245, b: 245, alpha: 1 } },
    })
      .png()
      .toFile(grayImagePath);

    // Smaller image for size mismatch tests
    smallImagePath = join(testDir, 'small.png');
    await sharp({
      create: { width: 50, height: 50, channels: 4 as const, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toFile(smallImagePath);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Identical Images Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('identical images', () => {
    test('reports 0% difference for identical images', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: whiteImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.pixelDiffPercent).toBe(0);
        expect(exit.value.report.type).toBe('diff-report');
        expect(exit.value.report.metadata.pixelDiffPercent).toBe(0);
      }
    });

    test('stores artifact in context', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: whiteImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const storedArtifact = ctx.getArtifact(exit.value.report.id);
        expect(storedArtifact).toBeDefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Different Images Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('different images', () => {
    test('reports 100% difference for completely different images', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: blackImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // All pixels should be different (white vs black)
        expect(exit.value.pixelDiffPercent).toBe(100);
      }
    });

    test('reports small difference for similar images', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: grayImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // White (255,255,255) vs Gray (245,245,245) = 10 diff per channel
        // Should NOT count as different since diff is exactly 10 (threshold is > 10)
        expect(exit.value.pixelDiffPercent).toBe(0);
      }
    });

    test('logs pixel difference percentage', async () => {
      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: blackImagePath, id: 'compare' }),
      };

      await runEffectExit(diffOperation.execute(input, {}, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.some((m) => m.message.includes('Pixel difference'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Size Mismatch Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('size mismatch', () => {
    test('handles images with different sizes', async () => {
      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: smallImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // Should still produce a result
        expect(exit.value.report.type).toBe('diff-report');
      }

      // Should log a warning about size mismatch
      const warnMessages = logger.messages.filter((m) => m.level === 'warn');
      expect(warnMessages.some((m) => m.message.includes('different sizes'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Threshold Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('threshold config', () => {
    test('uses custom threshold', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: whiteImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, { threshold: 5.0 }, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      // With 0% diff and 5% threshold, should not be significant
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error paths', () => {
    test('fails when base image does not exist', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: '/nonexistent/base.png', id: 'base' }),
        compareImage: createMockImageArtifact({ path: whiteImagePath, id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === 'Fail') {
          expect(cause.error._tag).toBe('OperationError');
          expect(cause.error.operation).toBe('diff');
          expect(cause.error.detail).toContain('Failed to read base image');
        }
      }
    });

    test('fails when compare image does not exist', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base' }),
        compareImage: createMockImageArtifact({ path: '/nonexistent/compare.png', id: 'compare' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === 'Fail') {
          expect(cause.error._tag).toBe('OperationError');
          expect(cause.error.operation).toBe('diff');
          expect(cause.error.detail).toContain('Failed to read compare image');
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metadata Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('report metadata', () => {
    test('includes correct image IDs in report', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        baseImage: createMockImageArtifact({ path: whiteImagePath, id: 'base-123' }),
        compareImage: createMockImageArtifact({ path: whiteImagePath, id: 'compare-456' }),
      };

      const exit = await runEffectExit(diffOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.report.metadata.baseImageId).toBe('base-123');
        expect(exit.value.report.metadata.compareImageId).toBe('compare-456');
      }
    });
  });
});
