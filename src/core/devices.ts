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

import type { ViewportConfig } from "./types.js";
import { devices } from "playwright";

/** Device preset with viewport configuration and metadata */
export type DevicePreset = {
  readonly viewport: ViewportConfig;
  readonly category: "desktop" | "phone" | "tablet";
};

/** Result from lookupDevice with source metadata */
export type DeviceLookupResult = {
  readonly preset: DevicePreset;
  readonly source: "desktop" | "playwright" | "custom";
  readonly playwrightName?: string;
};

function readDescriptorScreen(
  descriptor: Readonly<Record<string, unknown>>,
): { readonly width: number; readonly height: number } | undefined {
  const screen = descriptor["screen"];
  if (typeof screen !== "object" || screen === null) {
    return undefined;
  }
  const width = "width" in screen ? screen.width : undefined;
  const height = "height" in screen ? screen.height : undefined;
  return typeof width === "number" && typeof height === "number" ? { width, height } : undefined;
}

/**
 * Custom desktop viewport presets.
 * Playwright only provides a few desktop sizes, so we define common breakpoints.
 */
export const DESKTOP_PRESETS: Record<string, DevicePreset> = {
  "desktop-1920": {
    viewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    category: "desktop",
  },
  "desktop-b3ngous-arch": {
    viewport: {
      width: 1440,
      height: 1248,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    category: "desktop",
  },
  "desktop-1366": {
    viewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    category: "desktop",
  },
  "desktop-hidpi": {
    viewport: {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
    },
    category: "desktop",
  },
};

/**
 * Mapping from CLI-friendly kebab-case IDs to Playwright device names.
 * Playwright's `devices` registry is the source of truth for specs.
 */
export const PLAYWRIGHT_DEVICE_ALIASES: Record<
  string,
  { name: string; category: "phone" | "tablet" }
> = {
  "iphone-15-pro-max": { name: "iPhone 15 Pro Max", category: "phone" },
  "iphone-15-pro": { name: "iPhone 15 Pro", category: "phone" },
  "iphone-se-2022": { name: "iPhone SE (3rd gen)", category: "phone" },
  "iphone-se-2016": { name: "iPhone SE", category: "phone" },
  "pixel-7": { name: "Pixel 7", category: "phone" },
  "ipad-pro-11": { name: "iPad Pro 11", category: "tablet" },
};

/**
 * Custom device presets for devices not in Playwright's registry.
 * Only define devices here if they don't exist in Playwright.
 */
export const CUSTOM_MOBILE_PRESETS: Record<string, DevicePreset> = {
  "galaxy-s24": {
    viewport: {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    },
    category: "phone",
  },
  "galaxy-tab-s9": {
    viewport: {
      width: 800,
      height: 1280,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    category: "tablet",
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
  const desktop = DESKTOP_PRESETS[id];
  if (desktop !== undefined) {
    return { preset: desktop, source: "desktop" };
  }

  const alias = PLAYWRIGHT_DEVICE_ALIASES[id];
  if (alias !== undefined) {
    const playwrightDevice = devices[alias.name];
    if (playwrightDevice !== undefined) {
      const screen = readDescriptorScreen(playwrightDevice);
      return {
        preset: {
          viewport: {
            width: playwrightDevice.viewport.width,
            height: playwrightDevice.viewport.height,
            ...(screen !== undefined ? { screen } : {}),
            deviceScaleFactor: playwrightDevice.deviceScaleFactor,
            isMobile: playwrightDevice.isMobile,
            hasTouch: playwrightDevice.hasTouch,
            userAgent: playwrightDevice.userAgent,
            defaultBrowserType: playwrightDevice.defaultBrowserType,
          },
          category: alias.category,
        },
        source: "playwright",
        playwrightName: alias.name,
      };
    }
  }

  const custom = CUSTOM_MOBILE_PRESETS[id];
  if (custom !== undefined) {
    return { preset: custom, source: "custom" };
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
    if (result === undefined) {
      return `  ${id}: (unknown)`;
    }
    const { viewport } = result.preset;
    const touch = viewport.hasTouch === true ? "✓" : "✗";
    const scale =
      viewport.deviceScaleFactor !== undefined && viewport.deviceScaleFactor !== 1
        ? ` @${viewport.deviceScaleFactor}x`
        : "";
    return `  ${id.padEnd(22)} ${viewport.width}x${viewport.height}${scale.padEnd(5)} touch:${touch}`;
  };

  console.log("\nDesktops:");
  for (const id of Object.keys(DESKTOP_PRESETS)) {
    console.log(formatDevice(id));
  }

  console.log("\nPhones:");
  for (const id of Object.keys(PLAYWRIGHT_DEVICE_ALIASES)) {
    const alias = PLAYWRIGHT_DEVICE_ALIASES[id];
    if (alias?.category === "phone") {
      console.log(formatDevice(id));
    }
  }
  for (const id of Object.keys(CUSTOM_MOBILE_PRESETS)) {
    const preset = CUSTOM_MOBILE_PRESETS[id];
    if (preset?.category === "phone") {
      console.log(formatDevice(id));
    }
  }

  console.log("\nTablets:");
  for (const id of Object.keys(PLAYWRIGHT_DEVICE_ALIASES)) {
    const alias = PLAYWRIGHT_DEVICE_ALIASES[id];
    if (alias?.category === "tablet") {
      console.log(formatDevice(id));
    }
  }
  for (const id of Object.keys(CUSTOM_MOBILE_PRESETS)) {
    const preset = CUSTOM_MOBILE_PRESETS[id];
    if (preset?.category === "tablet") {
      console.log(formatDevice(id));
    }
  }

  console.log(`\nTotal: ${ALL_DEVICE_IDS.length} devices`);
}
