/**
 * Device presets and resolution for vex.
 *
 * Provides named device configurations for consistent viewport testing.
 * Lookup order: desktop presets → Playwright devices → custom mobile presets.
 *
 * @example
 * ```typescript
 * import { lookupDevice, listDevices } from './devices.js';
 *
 * const device = lookupDevice('iphone-15-pro');
 * if (device) {
 *   console.log(device.viewport); // { width: 393, height: 852, ... }
 * }
 *
 * listDevices(); // Pretty-print all available devices
 * ```
 */

import { devices } from 'playwright';
import type { ViewportConfig } from './types.js';

/** Device preset with viewport configuration and metadata */
export interface DevicePreset {
  readonly viewport: ViewportConfig;
  readonly category: 'desktop' | 'phone' | 'tablet';
}

/** Result from lookupDevice with source metadata */
export interface DeviceLookupResult {
  readonly preset: DevicePreset;
  readonly source: 'desktop' | 'playwright' | 'custom';
  readonly playwrightName?: string;
}

/**
 * Custom desktop viewport presets.
 * Playwright only provides a few desktop sizes, so we define common breakpoints.
 */
export const DESKTOP_PRESETS: Record<string, DevicePreset> = {
  'desktop-1920': {
    viewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    category: 'desktop',
  },
  'desktop-b3ngous-arch': {
    viewport: {
      width: 1440,
      height: 1248,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    category: 'desktop',
  },
  'desktop-1366': {
    viewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    category: 'desktop',
  },
  'desktop-hidpi': {
    viewport: {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
    },
    category: 'desktop',
  },
};

/**
 * Mapping from CLI-friendly kebab-case IDs to Playwright device names.
 * Playwright's `devices` registry is the source of truth for specs.
 */
export const PLAYWRIGHT_DEVICE_ALIASES: Record<string, { name: string; category: 'phone' | 'tablet' }> = {
  // iPhones
  'iphone-15-pro-max': { name: 'iPhone 15 Pro Max', category: 'phone' },
  'iphone-15-pro': { name: 'iPhone 15 Pro', category: 'phone' },
  'iphone-se': { name: 'iPhone SE', category: 'phone' },
  // Android phones
  'pixel-7': { name: 'Pixel 7', category: 'phone' },
  // Tablets
  'ipad-pro-11': { name: 'iPad Pro 11', category: 'tablet' },
};

/**
 * Custom device presets for devices not in Playwright's registry.
 * Only define devices here if they don't exist in Playwright.
 */
export const CUSTOM_MOBILE_PRESETS: Record<string, DevicePreset> = {
  'galaxy-s24': {
    viewport: {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    },
    category: 'phone',
  },
  'galaxy-tab-s9': {
    viewport: {
      width: 800,
      height: 1280,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    category: 'tablet',
  },
};

/** All available device IDs */
export const ALL_DEVICE_IDS = [
  ...Object.keys(DESKTOP_PRESETS),
  ...Object.keys(PLAYWRIGHT_DEVICE_ALIASES),
  ...Object.keys(CUSTOM_MOBILE_PRESETS),
] as const;

export type DeviceId = (typeof ALL_DEVICE_IDS)[number];

/**
 * Look up a device by ID.
 * Checks: desktop presets → Playwright devices → custom mobile presets.
 *
 * @returns Device preset and metadata, or undefined if not found.
 */
export function lookupDevice(id: string): DeviceLookupResult | undefined {
  // Check desktop presets first
  const desktop = DESKTOP_PRESETS[id];
  if (desktop) {
    return { preset: desktop, source: 'desktop' };
  }

  // Check Playwright device aliases
  const alias = PLAYWRIGHT_DEVICE_ALIASES[id];
  if (alias) {
    const playwrightDevice = devices[alias.name];
    if (playwrightDevice) {
      return {
        preset: {
          viewport: {
            width: playwrightDevice.viewport.width,
            height: playwrightDevice.viewport.height,
            deviceScaleFactor: playwrightDevice.deviceScaleFactor,
            isMobile: playwrightDevice.isMobile,
            hasTouch: playwrightDevice.hasTouch,
            userAgent: playwrightDevice.userAgent,
          },
          category: alias.category,
        },
        source: 'playwright',
        playwrightName: alias.name,
      };
    }
  }

  // Check custom mobile presets
  const custom = CUSTOM_MOBILE_PRESETS[id];
  if (custom) {
    return { preset: custom, source: 'custom' };
  }

  return undefined;
}

/**
 * Get all available device IDs.
 */
export function getAllDeviceIds(): string[] {
  return [...ALL_DEVICE_IDS];
}

/**
 * Print formatted list of available devices to stdout.
 * Groups devices by category (desktops, phones, tablets).
 */
export function listDevices(): void {
  const formatDevice = (id: string): string => {
    const result = lookupDevice(id);
    if (!result) return `  ${id}: (unknown)`;
    const { viewport } = result.preset;
    const touch = viewport.hasTouch ? '✓' : '✗';
    const scale = viewport.deviceScaleFactor !== 1 ? ` @${viewport.deviceScaleFactor}x` : '';
    return `  ${id.padEnd(22)} ${viewport.width}x${viewport.height}${scale.padEnd(5)} touch:${touch}`;
  };

  console.log('\nDesktops:');
  for (const id of Object.keys(DESKTOP_PRESETS)) {
    console.log(formatDevice(id));
  }

  console.log('\nPhones:');
  for (const id of Object.keys(PLAYWRIGHT_DEVICE_ALIASES)) {
    const alias = PLAYWRIGHT_DEVICE_ALIASES[id];
    if (alias?.category === 'phone') {
      console.log(formatDevice(id));
    }
  }
  for (const id of Object.keys(CUSTOM_MOBILE_PRESETS)) {
    const preset = CUSTOM_MOBILE_PRESETS[id];
    if (preset?.category === 'phone') {
      console.log(formatDevice(id));
    }
  }

  console.log('\nTablets:');
  for (const id of Object.keys(PLAYWRIGHT_DEVICE_ALIASES)) {
    const alias = PLAYWRIGHT_DEVICE_ALIASES[id];
    if (alias?.category === 'tablet') {
      console.log(formatDevice(id));
    }
  }
  for (const id of Object.keys(CUSTOM_MOBILE_PRESETS)) {
    const preset = CUSTOM_MOBILE_PRESETS[id];
    if (preset?.category === 'tablet') {
      console.log(formatDevice(id));
    }
  }

  console.log(`\nTotal: ${ALL_DEVICE_IDS.length} devices`);
}
