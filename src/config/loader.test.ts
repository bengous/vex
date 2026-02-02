/**
 * Tests for loadCodexProfile - profile loading from built-in and user-defined sources.
 */

import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import { BUILTIN_PROFILES, type CodexProfile } from '../providers/codex-cli/schema.js';
import { ConfigError, loadCodexProfile } from './loader.js';
import type { VexConfig } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a VexConfig with user-defined codex profiles.
 */
const createConfig = (profiles: Record<string, CodexProfile>): VexConfig => ({
  outputDir: 'test-output',
  providers: { codex: profiles },
});

/**
 * Sample user-defined profile for testing.
 */
const customProfile: CodexProfile = {
  sandbox: 'workspace-write',
  approval: 'on-failure',
  webSearch: 'live',
  mcpServers: {},
};

// ═══════════════════════════════════════════════════════════════════════════
// Built-in Profile Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('loadCodexProfile', () => {
  describe('built-in profiles', () => {
    it('loads built-in "fast" profile', async () => {
      const result = await Effect.runPromise(loadCodexProfile('fast'));

      expect(result).toEqual(BUILTIN_PROFILES.fast);
      expect(result.approval).toBe('never');
      expect(result.sandbox).toBe('workspace-write');
    });

    it('loads built-in "minimal" profile', async () => {
      const result = await Effect.runPromise(loadCodexProfile('minimal'));

      expect(result).toEqual(BUILTIN_PROFILES.minimal);
      expect(result.approval).toBe('on-request');
      expect(result.sandbox).toBe('read-only');
    });

    it('loads built-in "safe" profile', async () => {
      const result = await Effect.runPromise(loadCodexProfile('safe'));

      expect(result).toEqual(BUILTIN_PROFILES.safe);
      expect(result.approval).toBe('untrusted');
      expect(result.webSearch).toBe('cached');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // User-Defined Profile Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('user-defined profiles', () => {
    it('loads user-defined profile from config', async () => {
      const config = createConfig({ custom: customProfile });

      const result = await Effect.runPromise(loadCodexProfile('custom', config));

      expect(result).toEqual(customProfile);
      expect(result.sandbox).toBe('workspace-write');
      expect(result.approval).toBe('on-failure');
      expect(result.webSearch).toBe('live');
    });

    it('loads user profile when no built-in matches', async () => {
      const myProfile: CodexProfile = {
        sandbox: 'danger-full-access',
        approval: 'untrusted',
        webSearch: 'disabled',
        mcpServers: {},
      };
      const config = createConfig({ 'my-custom-profile': myProfile });

      const result = await Effect.runPromise(loadCodexProfile('my-custom-profile', config));

      expect(result).toEqual(myProfile);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Precedence Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('precedence', () => {
    it('built-in profile takes precedence over user-defined with same name', async () => {
      // User defines a profile named "fast" with different settings
      const userFast: CodexProfile = {
        sandbox: 'read-only', // Different from built-in (workspace-write)
        approval: 'untrusted', // Different from built-in (never)
        webSearch: 'live', // Different from built-in (disabled)
        mcpServers: {},
      };
      const config = createConfig({ fast: userFast });

      const result = await Effect.runPromise(loadCodexProfile('fast', config));

      // Built-in should win - user profile is silently ignored
      expect(result).toEqual(BUILTIN_PROFILES.fast);
      expect(result.sandbox).toBe('workspace-write');
      expect(result.approval).toBe('never');
      expect(result.webSearch).toBe('disabled');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('error cases', () => {
    it('fails for unknown profile when no config provided', async () => {
      const exit = await Effect.runPromiseExit(loadCodexProfile('nonexistent'));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
        expect(exit.cause.error._tag).toBe('ConfigError');
        expect(exit.cause.error.kind).toBe('preset_not_found');
      }
    });

    it('fails for unknown profile even with config', async () => {
      const config = createConfig({ custom: customProfile });

      const exit = await Effect.runPromiseExit(loadCodexProfile('unknown-profile', config));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
        expect(exit.cause.error._tag).toBe('ConfigError');
        expect(exit.cause.error.kind).toBe('preset_not_found');
      }
    });

    it('error message lists available profiles (built-in + user)', async () => {
      const config = createConfig({
        'my-profile': customProfile,
        'another-profile': customProfile,
      });

      const exit = await Effect.runPromiseExit(loadCodexProfile('nonexistent', config));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
        const error = exit.cause.error as ConfigError;

        // availablePresets should include both built-in and user profiles
        expect(error.availablePresets).toBeDefined();
        expect(error.availablePresets).toContain('fast');
        expect(error.availablePresets).toContain('minimal');
        expect(error.availablePresets).toContain('safe');
        expect(error.availablePresets).toContain('my-profile');
        expect(error.availablePresets).toContain('another-profile');

        // Message should be informative
        expect(error.message).toContain('nonexistent');
        expect(error.message).toContain('Available');
      }
    });
  });
});
