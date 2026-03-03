import { describe, expect, test } from 'bun:test';
import { getAllDeviceIds, lookupDevice } from './devices.js';

describe('lookupDevice iPhone SE variants', () => {
  test('iphone-se-2016 maps to 320x568', () => {
    const result = lookupDevice('iphone-se-2016');
    expect(result).toBeDefined();
    expect(result?.preset.viewport.width).toBe(320);
    expect(result?.preset.viewport.height).toBe(568);
  });

  test('iphone-se-2022 maps to 375x667', () => {
    const result = lookupDevice('iphone-se-2022');
    expect(result).toBeDefined();
    expect(result?.preset.viewport.width).toBe(375);
    expect(result?.preset.viewport.height).toBe(667);
  });

  test('iphone-se alias is intentionally undefined', () => {
    const result = lookupDevice('iphone-se');
    expect(result).toBeUndefined();
  });
});
