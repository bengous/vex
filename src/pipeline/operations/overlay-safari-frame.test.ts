import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Exit } from "effect";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { runEffectExit } from "../../testing/effect-helpers.js";
import {
  createMockContext,
  createMockImageArtifact,
} from "../../testing/mocks/pipeline-context.js";
import { overlaySafariFrameOperation } from "./overlay-safari-frame.js";

async function countRedPixelsAtRow(imagePath: string, row: number): Promise<number> {
  const image = sharp(imagePath);
  const { width } = await image.metadata();
  if (width === undefined) {
    return 0;
  }
  const { data } = await image
    .extract({ left: 0, top: row, width, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = x * 4;
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

describe("overlaySafariFrameOperation", () => {
  let testDir: string;
  let testImagePath: string;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), "overlay-safari-frame-test-"));
    testImagePath = join(testDir, "test-input.png");
    await sharp({
      create: {
        width: 1290,
        height: 3600,
        channels: 3,
        background: { r: 248, g: 246, b: 242 },
      },
    })
      .png()
      .toFile(testImagePath);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  test("renders an iPhone Pro Max Safari single-shot frame", async () => {
    const ctx = createMockContext({ sessionDir: testDir });
    const input = {
      image: createMockImageArtifact({
        path: testImagePath,
        width: 1290,
        height: 3600,
        viewport: {
          width: 430,
          height: 740,
          screen: { width: 430, height: 932 },
          deviceScaleFactor: 3,
          isMobile: true,
        },
      }),
    };

    const exit = await runEffectExit(
      overlaySafariFrameOperation.execute(input, { name: "safari-ios", style: "singleshot" }, ctx),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const artifact = exit.value.artifacts.image;
      expect(artifact.metadata.width).toBe(1290);
      expect(artifact.metadata.height).toBe(2796);
      expect(artifact.createdBy).toBe("overlay-safari-frame");
      const metadata = await sharp(artifact.path).metadata();
      expect(metadata.width).toBe(1290);
      expect(metadata.height).toBe(2796);
      expect(await countRedPixelsAtRow(artifact.path, (111 + 740) * 3)).toBeGreaterThan(50);
    }
  });
});
