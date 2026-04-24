/**
 * Unit tests for provider introspection.
 *
 * Tests getProviderInfo and getAllProviders with mock providers
 * registered in the provider registry.
 */

import { afterAll, describe, expect, test } from "bun:test";
import assert from "node:assert";
import { runEffect } from "../../testing/effect-helpers.js";
import { createMockVisionProviderLayer } from "../../testing/mocks/vision-provider.js";
import { getAllProviders, getProviderInfo } from "./introspection.js";
import { registerProvider, unregisterProvider } from "./registry.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

const registeredProviders: string[] = [];

afterAll(() => {
  for (const name of registeredProviders) {
    unregisterProvider(name);
  }
});

/** Register a mock provider and track for cleanup */
function registerMock(
  name: string,
  metadata: {
    displayName?: string;
    type?: "http" | "cli";
    knownModels?: readonly string[];
  } = {},
  layerOptions: { isAvailable?: boolean; models?: readonly string[] } = {},
) {
  registerProvider(name, () => createMockVisionProviderLayer(layerOptions), {
    displayName: metadata.displayName ?? name,
    type: metadata.type ?? "cli",
    knownModels: metadata.knownModels,
  });
  registeredProviders.push(name);
}

// ═══════════════════════════════════════════════════════════════════════════
// getProviderInfo
// ═══════════════════════════════════════════════════════════════════════════

describe("getProviderInfo", () => {
  test("returns correct info for a registered provider", async () => {
    const name = `test-introspect-info-${Date.now()}`;
    registerMock(
      name,
      { displayName: "Test Provider", type: "cli", knownModels: ["fallback-model"] },
      { isAvailable: true, models: ["live-model-a", "live-model-b"] },
    );

    const info = await runEffect(getProviderInfo(name));

    assert(info);
    expect(info.name).toBe(name);
    expect(info.displayName).toBe("Test Provider");
    expect(info.type).toBe("cli");
    expect(info.available).toBe(true);
    expect(info.models).toEqual(["live-model-a", "live-model-b"]);
  });

  test("returns undefined for non-existent provider", async () => {
    const info = await runEffect(getProviderInfo("nonexistent-provider-xyz"));

    expect(info).toBeUndefined();
  });

  test("returns available: false when provider is unavailable", async () => {
    const name = `test-introspect-unavail-${Date.now()}`;
    registerMock(name, { knownModels: ["known-model"] }, { isAvailable: false, models: [] });

    const info = await runEffect(getProviderInfo(name));

    assert(info);
    expect(info.available).toBe(false);
    // Falls back to knownModels when live models list is empty
    expect(info.models).toEqual(["known-model"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getAllProviders
// ═══════════════════════════════════════════════════════════════════════════

describe("getAllProviders", () => {
  test("returns info for all registered providers", async () => {
    const prefix = `test-introspect-all-${Date.now()}`;
    const nameA = `${prefix}-a`;
    const nameB = `${prefix}-b`;
    registerMock(nameA, { displayName: "Provider A" }, { isAvailable: true });
    registerMock(nameB, { displayName: "Provider B" }, { isAvailable: false });

    const allInfo = await runEffect(getAllProviders());

    const testInfos = allInfo.filter((p) => p.name.startsWith(prefix));
    expect(testInfos).toHaveLength(2);

    const infoA = testInfos.find((p) => p.name === nameA);
    const infoB = testInfos.find((p) => p.name === nameB);
    expect(infoA?.available).toBe(true);
    expect(infoB?.available).toBe(false);
  });
});
