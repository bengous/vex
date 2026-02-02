/**
 * Unit tests for render operation.
 *
 * Tests annotation rendering onto images with various scenarios.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Exit } from 'effect';
import sharp from 'sharp';
import type { ToolCall } from '../../core/types.js';
import { expectOperationFailure, runEffectExit } from '../../testing/index.js';
import {
  createCapturingLogger,
  createMockContext,
  createMockImageArtifact,
} from '../../testing/mocks/pipeline-context.js';
import { renderOperation } from './render.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe('renderOperation', () => {
  let testDir: string;
  let testImagePath: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `render-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create a simple test image (400x400 white square)
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
  // Test Fixtures
  // ═══════════════════════════════════════════════════════════════════════════

  function createTestToolCalls(): ToolCall[] {
    return [
      {
        tool: 'draw_rectangle',
        params: { start: 'A1', end: 'B2', style: 'error', label: 'Test issue' },
      },
      {
        tool: 'add_label',
        params: { cell: 'C3', text: 'Test label', style: 'warning' },
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Success Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('success paths', () => {
    test('renders annotations onto image', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        image: createMockImageArtifact({ path: testImagePath }),
        toolCalls: createTestToolCalls(),
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.metadata.hasAnnotations).toBe(true);
        expect(exit.value.image.createdBy).toBe('render');

        // Verify output file exists and is valid
        const outputMeta = await sharp(exit.value.image.path).metadata();
        expect(outputMeta.width).toBe(400);
        expect(outputMeta.height).toBe(400);
      }
    });

    test('returns original image when no toolCalls', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const inputImage = createMockImageArtifact({ path: testImagePath });
      const input = {
        image: inputImage,
        toolCalls: [] as readonly ToolCall[],
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        // Should return the original image unchanged
        expect(exit.value.image).toBe(inputImage);
      }
    });

    test('logs message when no annotations', async () => {
      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = {
        image: createMockImageArtifact({ path: testImagePath }),
        toolCalls: [] as readonly ToolCall[],
      };

      await runEffectExit(renderOperation.execute(input, {}, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === 'info');
      expect(infoMessages.some((m) => m.message.includes('No annotations'))).toBe(true);
    });

    test('stores artifact in context', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        image: createMockImageArtifact({ path: testImagePath }),
        toolCalls: createTestToolCalls(),
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const storedArtifact = ctx.getArtifact(exit.value.image.id);
        expect(storedArtifact).toBeDefined();
        expect(storedArtifact?.id).toBe(exit.value.image.id);
      }
    });

    test('output type is annotated-image', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        image: createMockImageArtifact({ path: testImagePath }),
        toolCalls: createTestToolCalls(),
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.type).toBe('annotated-image');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error paths', () => {
    test('fails when input image does not exist', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        image: createMockImageArtifact({ path: '/nonexistent/image.png' }),
        toolCalls: createTestToolCalls(),
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      const error = expectOperationFailure(exit, 'render');
      expect(error.detail).toContain('Failed to read image');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metadata Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('metadata preservation', () => {
    test('preserves viewport metadata', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false };
      const input = {
        image: createMockImageArtifact({
          path: testImagePath,
          width: 400,
          height: 400,
          viewport,
        }),
        toolCalls: createTestToolCalls(),
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.metadata.viewport).toEqual(viewport);
      }
    });

    test('preserves input dimensions in output', async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = {
        image: createMockImageArtifact({
          path: testImagePath,
          width: 400,
          height: 400,
        }),
        toolCalls: createTestToolCalls(),
      };

      const exit = await runEffectExit(renderOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.image.metadata.width).toBe(400);
        expect(exit.value.image.metadata.height).toBe(400);
      }
    });
  });
});
