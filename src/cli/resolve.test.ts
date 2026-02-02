/**
 * Tests for CLI override resolution logic.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Option } from 'effect';
import { runEffect, runEffectExit } from '../testing/index.js';
import type { LoopCliArgs, ScanCliArgs } from './resolve.js';
import { resolveLoopOptions, resolveScanOptions } from './resolve.js';

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
  project: '/test/project',
};

// ═══════════════════════════════════════════════════════════════════════════
// Scan Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveScanOptions', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.VEX_OUTPUT_DIR;
    process.env.VEX_OUTPUT_DIR = '/test/output';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.VEX_OUTPUT_DIR = originalEnv;
    } else {
      delete process.env.VEX_OUTPUT_DIR;
    }
  });

  it('uses CLI values when provided', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      device: Option.some('iphone-15-pro'),
      provider: Option.some('claude-cli'),
      model: Option.some('claude-sonnet-4-20250514'),
      reasoning: Option.some('high'),
      full: true,
      placeholderMedia: true,
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.urls).toEqual(['https://example.com']);
    expect(result.devices).toEqual(['iphone-15-pro']);
    expect(result.provider).toBe('claude-cli');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.reasoning).toBe('high');
    expect(result.full).toBe(true);
    expect(result.placeholderMedia).toBe(true);
  });

  it('uses defaults when no CLI or preset', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.devices).toEqual(['desktop-1920']);
    expect(result.provider).toBe('ollama');
    expect(result.model).toBeUndefined();
    expect(result.reasoning).toBeUndefined();
    expect(result.full).toBe(false);
    expect(result.placeholderMedia).toBe(false);
  });

  it('errors when URL is missing', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
    };

    const result = await runEffectExit(resolveScanOptions(args));

    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      const error = result.cause;
      expect(error._tag).toBe('Fail');
    }
  });

  it('errors when preset specified but no config', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      preset: Option.some('nonexistent'),
    };

    // Use a path where no config exists
    const result = await runEffectExit(resolveScanOptions(args, '/tmp/no-config-here'));

    expect(result._tag).toBe('Failure');
  });

  it('uses output from VEX_OUTPUT_DIR env', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.outputDir).toBe('/test/output');
  });

  it('CLI output overrides env', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      output: Option.some('/cli/output'),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.outputDir).toBe('/cli/output');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loop Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveLoopOptions', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.VEX_OUTPUT_DIR;
    process.env.VEX_OUTPUT_DIR = '/test/output';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.VEX_OUTPUT_DIR = originalEnv;
    } else {
      delete process.env.VEX_OUTPUT_DIR;
    }
  });

  it('uses CLI values when provided', async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
      url: Option.some('https://example.com'),
      device: Option.some('ipad-pro-11'),
      provider: Option.some('gemini-cli'),
      model: Option.some('gemini-2.5-flash'),
      maxIterations: Option.some(10),
      autoFix: Option.some('medium'),
      dryRun: true,
      placeholderMedia: true,
    };

    const result = await runEffect(resolveLoopOptions(args));

    expect(result.urls).toEqual(['https://example.com']);
    expect(result.devices).toEqual(['ipad-pro-11']);
    expect(result.provider).toBe('gemini-cli');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.maxIterations).toBe(10);
    expect(result.autoFix).toBe('medium');
    expect(result.dryRun).toBe(true);
    expect(result.placeholderMedia).toBe(true);
    expect(result.projectRoot).toBe('/test/project');
  });

  it('uses defaults when no CLI or preset', async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
      url: Option.some('https://example.com'),
    };

    const result = await runEffect(resolveLoopOptions(args));

    expect(result.devices).toEqual(['desktop-1920']);
    expect(result.provider).toBe('ollama');
    expect(result.maxIterations).toBe(5);
    expect(result.autoFix).toBe('high');
    expect(result.dryRun).toBe(false);
    expect(result.placeholderMedia).toBe(false);
  });

  it('errors when URL is missing', async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
    };

    const result = await runEffectExit(resolveLoopOptions(args));

    expect(result._tag).toBe('Failure');
  });

  it('project is always from CLI', async () => {
    const args: LoopCliArgs = {
      ...emptyLoopArgs,
      url: Option.some('https://example.com'),
      project: '/my/project/path',
    };

    const result = await runEffect(resolveLoopOptions(args));

    expect(result.projectRoot).toBe('/my/project/path');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Profile Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveScanOptions profile handling', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.VEX_OUTPUT_DIR;
    process.env.VEX_OUTPUT_DIR = '/test/output';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.VEX_OUTPUT_DIR = originalEnv;
    } else {
      delete process.env.VEX_OUTPUT_DIR;
    }
  });

  it('defaults to minimal profile', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      provider: Option.some('codex-cli'),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.profile).toBe('minimal');
  });

  it('parses --provider-profile correctly', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      provider: Option.some('codex-cli'),
      providerProfile: Option.some('codex:fast'),
    };

    const result = await runEffect(resolveScanOptions(args));

    expect(result.profile).toBe('fast');
  });

  it('rejects mismatched profile prefix', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      provider: Option.some('codex-cli'),
      providerProfile: Option.some('claude:fast'),
    };

    const exit = await runEffectExit(resolveScanOptions(args));

    expect(exit._tag).toBe('Failure');
  });

  it('rejects invalid profile format', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      provider: Option.some('codex-cli'),
      providerProfile: Option.some('fast'), // Missing provider: prefix
    };

    const exit = await runEffectExit(resolveScanOptions(args));

    expect(exit._tag).toBe('Failure');
  });

  it('rejects nonexistent profile name', async () => {
    const args: ScanCliArgs = {
      ...emptyScanArgs,
      url: Option.some('https://example.com'),
      provider: Option.some('codex-cli'),
      providerProfile: Option.some('codex:typo'),
    };

    const exit = await runEffectExit(resolveScanOptions(args));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error._tag).toBe('ProfileNotFoundError');
      expect((exit.cause.error as { availableProfiles: readonly string[] }).availableProfiles).toContain('fast');
    }
  });
});
