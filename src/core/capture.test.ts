import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { cropScreenshotToViewportWidth, getImageDimensionsFromBuffer } from './capture.js';

describe('getImageDimensionsFromBuffer', () => {
  test('uses actual image dimensions from screenshot buffer', async () => {
    const buffer = await sharp({
      create: {
        width: 768,
        height: 6706,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const dimensions = await getImageDimensionsFromBuffer(buffer, { width: 320, height: 568 });
    expect(dimensions).toEqual({ width: 768, height: 6706 });
  });

  test('crops screenshot width to the emulated viewport when needed', async () => {
    const buffer = await sharp({
      create: {
        width: 658,
        height: 1200,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const cropped = await cropScreenshotToViewportWidth(buffer, { width: 320, deviceScaleFactor: 2 });
    const dimensions = await getImageDimensionsFromBuffer(cropped, { width: 320, height: 568 });
    expect(dimensions).toEqual({ width: 640, height: 1200 });
  });
});
