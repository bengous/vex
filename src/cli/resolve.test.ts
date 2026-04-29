/**
 * Tests for CLI override resolution logic.
 */

import type { CommonCliArgs, LoopCliArgs, ScanCliArgs } from "./resolve.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Option } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEffect, runEffectExit } from "../testing/effect-helpers.js";
import { resolveCommonOptions, resolveLoopOptions, resolveScanOptions } from "./resolve.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

const emptyScanArgs: ScanCliArgs = {
  url: Option.none(),
  preset: Option.none(),
  device: Option.none(),
  provider: Option.none(),
  model: Option.none(),
  reasoning: Option.none(),
  frame: Option.none(),
  frameStyle: Option.none(),
  foldOcclusion: Option.none(),
  providerProfile: Option.none(),
  full: false,
  placeholderMedia: false,
  output: Option.none(),
};

const emptyLoopArgs: LoopCliArgs = {
  url: Option.none(),
  preset: Option.none(),
  device: Option.none(),
  provider: Option.none(),
  model: Option.none(),
  providerProfile: Option.none(),
  maxIterations: Option.none(),
  autoFix: Option.none(),
  dryRun: false,
  placeholderMedia: false,
  output: Option.none(),
  project: "/test/project",
};

const emptyCommonArgs: CommonCliArgs = {
  url: Option.none(),
  preset: Option.none(),
  device: Option.none(),
  provider: Option.none(),
  model: Option.none(),
  providerProfile: Option.none(),
  placeholderMedia: false,
  output: Option.none(),
};

// ═══════════════════════════════════════════════════════════════════════════
// Scan Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveScanOptions", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["VEX_OUTPUT_DIR"];
    process.env["VEX_OUTPUT_DIR"] = "/test/output";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["VEX_OUTPUT_DIR"] = originalEnv;
    } else {
      delete process.env["VEX_OUTPUT_DIR"];
    }
  });

  it("uses CLI values when provided", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      device: Option.some("iphone-15-pro"),
      provider: Option.some("claude-cli"),
      model: Option.some("claude-sonnet-4-20250514"),
      reasoning: Option.some("high"),
      full: true,
      placeholderMedia: true,
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.urls).toEqual(["https://example.com"]);
    expect(result.devices).toEqual(["iphone-15-pro"]);
    expect(result.provider).toBe("claude-cli");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.reasoning).toBe("high");
    expect(result.full).toBe(true);
    expect(result.placeholderMedia).toEqual({ enabled: true, svgMinSize: 100, preserve: [] });
  });

  it("uses defaults when no CLI or preset", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.devices).toEqual(["desktop-1920"]);
    expect(result.provider).toBe("ollama");
    expect(result.model).toBeUndefined();
    expect(result.reasoning).toBeUndefined();
    expect(result.full).toBe(false);
    expect(result.frame).toBeUndefined();
    expect(result.placeholderMedia).toBeUndefined();
  });

  it("resolves Safari frame CLI options", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      frame: Option.some("safari-ios"),
      frameStyle: Option.some("singleshot"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.frame).toEqual({ name: "safari-ios", style: "singleshot" });
  });

  it("resolves fold occlusion from CLI", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      foldOcclusion: Option.some("auto"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.foldOcclusion).toEqual({ enabled: true, mode: "auto", minHeight: 24 });
  });

  it("errors when URL is missing", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
    };

    const result = await runEffectExit(resolveScanOptions(args));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const error = result.cause;
      expect(error._tag).toBe("Fail");
    }
  });

  it("errors when preset specified but no config", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      preset: Option.some("nonexistent"),
    };

    // Use a path where no config exists
    const result = await runEffectExit(resolveScanOptions(args, "/tmp/no-config-here"));

    expect(result._tag).toBe("Failure");
  });

  it("uses output from VEX_OUTPUT_DIR env", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.outputDir).toBe("/test/output");
  });

  it("CLI output overrides env", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      output: Option.some("/cli/output"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.outputDir).toBe("/cli/output");
  });

  it("resolves fullPageScrollFix defaults from boolean preset", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "vex-resolve-"));
    try {
      writeFileSync(
        join(projectRoot, "vex.config.ts"),
        `export default {
  outputDir: 'vex-output',
  scanPresets: {
    capture: {
      urls: ['https://example.com'],
      fullPageScrollFix: true
    }
  }
};`,
      );

      const args: ScanCliArgs = {
        ...emptyScanArgs,
        preset: Option.some("capture"),
      };

      const result = await runEffect(resolveScanOptions(args, projectRoot));
      expect(result.fullPageScrollFix).toEqual({
        enabled: true,
        selectors: ["#page-scroll-container"],
        settleMs: 500,
        preserveHorizontalOverflow: false,
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolves fullPageScrollFix preserveHorizontalOverflow override from preset config", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "vex-resolve-"));
    try {
      writeFileSync(
        join(projectRoot, "vex.config.ts"),
        `export default {
  outputDir: 'vex-output',
  scanPresets: {
    capture: {
      urls: ['https://example.com'],
      fullPageScrollFix: {
        selectors: ['#root-scroll'],
        settleMs: 750,
        preserveHorizontalOverflow: true
      }
    }
  }
};`,
      );

      const args: ScanCliArgs = {
        ...emptyScanArgs,
        preset: Option.some("capture"),
      };

      const result = await runEffect(resolveScanOptions(args, projectRoot));
      expect(result.fullPageScrollFix).toEqual({
        enabled: true,
        selectors: ["#root-scroll"],
        settleMs: 750,
        preserveHorizontalOverflow: true,
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolves foldOcclusion from preset config", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "vex-resolve-"));
    try {
      writeFileSync(
        join(projectRoot, "vex.config.ts"),
        `export default {
  outputDir: 'vex-output',
  scanPresets: {
    capture: {
      urls: ['https://example.com'],
      foldOcclusion: {
        mode: 'auto',
        minHeight: 32,
        sampleScrolls: [740, 1480]
      }
    }
  }
};`,
      );

      const args: ScanCliArgs = {
        ...emptyScanArgs,
        preset: Option.some("capture"),
      };

      const result = await runEffect(resolveScanOptions(args, projectRoot));
      expect(result.foldOcclusion).toEqual({
        enabled: true,
        mode: "auto",
        minHeight: 32,
        sampleScrolls: [740, 1480],
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous iphone-se device id in config (explicit ids required)", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "vex-resolve-"));
    try {
      writeFileSync(
        join(projectRoot, "vex.config.ts"),
        `export default {
  outputDir: 'vex-output',
  scanPresets: {
    capture: {
      urls: ['https://example.com'],
      devices: 'iphone-se'
    }
  }
};`,
      );

      const args: ScanCliArgs = {
        ...emptyScanArgs,
        preset: Option.some("capture"),
      };

      const result = await runEffectExit(resolveScanOptions(args, projectRoot));
      expect(result._tag).toBe("Failure");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loop Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveLoopOptions", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["VEX_OUTPUT_DIR"];
    process.env["VEX_OUTPUT_DIR"] = "/test/output";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["VEX_OUTPUT_DIR"] = originalEnv;
    } else {
      delete process.env["VEX_OUTPUT_DIR"];
    }
  });

  it("uses CLI values when provided", async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
      url: Option.some("https://example.com"),
      device: Option.some("ipad-pro-11"),
      provider: Option.some("gemini-cli"),
      model: Option.some("gemini-2.5-flash"),
      maxIterations: Option.some(10),
      autoFix: Option.some("medium"),
      dryRun: true,
      placeholderMedia: true,
    };

    const result = await runEffect(resolveLoopOptions(args));

    expect(result.urls).toEqual(["https://example.com"]);
    expect(result.devices).toEqual(["ipad-pro-11"]);
    expect(result.provider).toBe("gemini-cli");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.maxIterations).toBe(10);
    expect(result.autoFix).toBe("medium");
    expect(result.dryRun).toBe(true);
    expect(result.placeholderMedia).toEqual({ enabled: true, svgMinSize: 100, preserve: [] });
    expect(result.projectRoot).toBe("/test/project");
  });

  it("uses defaults when no CLI or preset", async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
      url: Option.some("https://example.com"),
    };

    const result = await runEffect(resolveLoopOptions(args));

    expect(result.devices).toEqual(["desktop-1920"]);
    expect(result.provider).toBe("ollama");
    expect(result.maxIterations).toBe(5);
    expect(result.autoFix).toBe("high");
    expect(result.dryRun).toBe(false);
    expect(result.placeholderMedia).toBeUndefined();
  });

  it("errors when URL is missing", async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
    };

    const result = await runEffectExit(resolveLoopOptions(args));

    expect(result._tag).toBe("Failure");
  });

  it("project is always from CLI", async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
      url: Option.some("https://example.com"),
      project: "/my/project/path",
    };

    const result = await runEffect(resolveLoopOptions(args));

    expect(result.projectRoot).toBe("/my/project/path");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Profile Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveScanOptions profile handling", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["VEX_OUTPUT_DIR"];
    process.env["VEX_OUTPUT_DIR"] = "/test/output";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["VEX_OUTPUT_DIR"] = originalEnv;
    } else {
      delete process.env["VEX_OUTPUT_DIR"];
    }
  });

  it("defaults to minimal profile", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      provider: Option.some("codex-cli"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.profile).toBe("minimal");
  });

  it("parses --provider-profile correctly", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      provider: Option.some("codex-cli"),
      providerProfile: Option.some("codex:fast"),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.profile).toBe("fast");
  });

  it("rejects mismatched profile prefix", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      provider: Option.some("codex-cli"),
      providerProfile: Option.some("claude:fast"),
    };

    const exit = await runEffectExit(resolveScanOptions(args));

    expect(exit._tag).toBe("Failure");
  });

  it("rejects invalid profile format", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      provider: Option.some("codex-cli"),
      providerProfile: Option.some("fast"), // Missing provider: prefix
    };

    const exit = await runEffectExit(resolveScanOptions(args));

    expect(exit._tag).toBe("Failure");
  });

  it("rejects nonexistent profile name", async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some("https://example.com"),
      provider: Option.some("codex-cli"),
      providerProfile: Option.some("codex:typo"),
    };

    const exit = await runEffectExit(resolveScanOptions(args));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("ProfileNotFoundError");
      expect(
        (exit.cause.error as { availableProfiles: readonly string[] }).availableProfiles,
      ).toContain("fast");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Common Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveCommonOptions", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["VEX_OUTPUT_DIR"];
    process.env["VEX_OUTPUT_DIR"] = "/test/output";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["VEX_OUTPUT_DIR"] = originalEnv;
    } else {
      delete process.env["VEX_OUTPUT_DIR"];
    }
  });

  it("resolves URL from CLI arg", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
    };

    const result = await runEffect(resolveCommonOptions(args));

    expect(result.urls).toEqual(["https://example.com"]);
  });

  it("resolves URL from preset", async () => {
    const preset = { urls: ["https://preset.com"] as readonly string[] };

    const result = await runEffect(
      resolveCommonOptions(emptyCommonArgs, preset, undefined, "mypreset"),
    );

    expect(result.urls).toEqual(["https://preset.com"]);
  });

  it("errors when URL missing from both CLI and preset", async () => {
    const result = await runEffectExit(resolveCommonOptions(emptyCommonArgs));

    expect(result._tag).toBe("Failure");
  });

  it("includes preset name in URL error message", async () => {
    const result = await runEffectExit(
      resolveCommonOptions(emptyCommonArgs, {}, undefined, "mypreset"),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      expect((result.cause.error as { message: string }).message).toContain("Preset 'mypreset'");
    }
  });

  it("resolves devices from CLI over preset", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
      device: Option.some("iphone-15-pro"),
    };
    const preset = { devices: "desktop-1920" as const };

    const result = await runEffect(resolveCommonOptions(args, preset));

    expect(result.devices).toEqual(["iphone-15-pro"]);
  });

  it("defaults devices to desktop-1920", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
    };

    const result = await runEffect(resolveCommonOptions(args));

    expect(result.devices).toEqual(["desktop-1920"]);
  });

  it("resolves provider from CLI over preset", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
      provider: Option.some("claude-cli"),
    };
    const preset = { provider: { name: "ollama" as const } };

    const result = await runEffect(resolveCommonOptions(args, preset));

    expect(result.provider).toBe("claude-cli");
  });

  it("defaults provider to ollama", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
    };

    const result = await runEffect(resolveCommonOptions(args));

    expect(result.provider).toBe("ollama");
  });

  it("resolves placeholderMedia from CLI flag", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
      placeholderMedia: true,
    };

    const result = await runEffect(resolveCommonOptions(args));

    expect(result.placeholderMedia).toEqual({ enabled: true, svgMinSize: 100, preserve: [] });
  });

  it("resolves outputDir from CLI", async () => {
    const args: CommonCliArgs = {
      ...emptyCommonArgs,
      url: Option.some("https://example.com"),
      output: Option.some("/custom/output"),
    };

    const result = await runEffect(resolveCommonOptions(args));

    expect(result.outputDir).toBe("/custom/output");
  });
});
