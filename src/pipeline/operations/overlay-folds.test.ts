/**
 * Unit tests for overlay-folds operation.
 *
 * Tests fold line overlay addition with various viewport configurations.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Exit } from "effect";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { runEffectExit } from "../../testing/effect-helpers.js";
import {
  createCapturingLogger,
  createMockContext,
  createMockImageArtifact,
} from "../../testing/mocks/pipeline-context.js";
import { overlayFoldsOperation } from "./overlay-folds.js";

async function countRedPixelsAtRow(imagePath: string, row: number): Promise<number> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let x = 0; x < info.width; x += 1) {
    const offset = (row * info.width + x) * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (
      red !== undefined &&
      green !== undefined &&
      blue !== undefined &&
      alpha !== undefined &&
      alpha > 160 &&
      red > 220 &&
      green < 110 &&
      blue < 110
    ) {
      count += 1;
    }
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

describe("overlayFoldsOperation", () => {
  let testDir: string;
  let testImagePath: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), "overlay-folds-test-"));

    // Create a tall test image (400x1200 to have multiple fold lines)
    testImagePath = join(testDir, "test-input.png");
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

  describe("success paths", () => {
    test("adds fold lines to image", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.artifacts.image.type).toBe("image");
        expect(exit.value.artifacts.image.metadata.hasFoldLines).toBe(true);
        expect(exit.value.artifacts.image.createdBy).toBe("overlay-folds");

        // Verify output file exists and has correct dimensions
        const outputMeta = await sharp(exit.value.artifacts.image.path).metadata();
        expect(outputMeta.width).toBe(400);
        expect(outputMeta.height).toBe(1200);
      }
    });

    test("uses custom viewportHeight config", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const exit = await runEffectExit(
        overlayFoldsOperation.execute(input, { viewportHeight: 600 }, ctx),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.artifacts.image.metadata.hasFoldLines).toBe(true);
      }
    });

    test("uses custom foldConfig", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const customConfig = {
        enabled: true,
        color: "#00FF00",
        showLabels: false,
      };

      const exit = await runEffectExit(
        overlayFoldsOperation.execute(input, { foldConfig: customConfig }, ctx),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.artifacts.image.metadata.hasFoldLines).toBe(true);
      }
    });

    test("extracts viewport height from image metadata", async () => {
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
        expect(exit.value.artifacts.image.metadata.hasFoldLines).toBe(true);
      }
    });

    test("prefers screen height from image metadata when present", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const viewport = {
        width: 390,
        height: 739,
        screen: { width: 390, height: 932 },
        deviceScaleFactor: 1,
        isMobile: true,
      };
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
        expect(exit.value.artifacts.image.metadata.hasFoldLines).toBe(true);
        expect(await countRedPixelsAtRow(exit.value.artifacts.image.path, 739)).toBe(0);
        expect(await countRedPixelsAtRow(exit.value.artifacts.image.path, 932)).toBeGreaterThan(50);
      }
    });

    test("returns artifact for runtime storage without mutating context", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.artifacts.image.id).toBeDefined();
        expect(ctx.artifacts.size).toBe(0);
      }
    });

    test("logs operation progress", async () => {
      const logger = createCapturingLogger();
      const ctx = createMockContext({ sessionDir: testDir, logger });
      const input = { image: createMockImageArtifact({ path: testImagePath }) };

      await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      const infoMessages = logger.messages.filter((m) => m.level === "info");
      expect(infoMessages.length).toBeGreaterThan(0);
      expect(infoMessages.some((m) => m.message.includes("fold"))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("error paths", () => {
    test("fails when input image does not exist", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      const input = { image: createMockImageArtifact({ path: "/nonexistent/image.png" }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        if (cause._tag === "Fail") {
          expect(cause.error._tag).toBe("OperationError");
          expect(cause.error.operation).toBe("overlay-folds");
          expect(cause.error.detail).toContain("Failed to read image");
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Default Value Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("default values", () => {
    test("uses default viewport height of 900 when not specified", async () => {
      const ctx = createMockContext({ sessionDir: testDir });
      // No viewport in metadata, no viewportHeight in config
      const input = { image: createMockImageArtifact({ path: testImagePath, height: 1200 }) };

      const exit = await runEffectExit(overlayFoldsOperation.execute(input, {}, ctx));

      // Should succeed with default 900px viewport height
      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
