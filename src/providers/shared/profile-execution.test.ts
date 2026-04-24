import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { Effect, Option } from 'effect';
import { runEffect } from '../../testing/effect-helpers.js';
import { CodexEnv } from '../codex-cli/environment.js';
import { needsProviderExecution, withProviderExecution } from './profile-execution.js';

describe('needsProviderExecution', () => {
  test('only wraps codex-cli with a non-minimal profile', () => {
    expect(needsProviderExecution({ provider: 'codex-cli', profile: 'fast' })).toBe(true);
    expect(needsProviderExecution({ provider: 'codex-cli', profile: 'minimal' })).toBe(false);
    expect(needsProviderExecution({ provider: 'ollama', profile: 'fast' })).toBe(false);
  });
});

describe('withProviderExecution', () => {
  test('is a no-op for non-codex providers', async () => {
    const result = await runEffect(
      withProviderExecution(
        { provider: 'ollama', profile: 'fast' },
        Effect.serviceOption(CodexEnv).pipe(Effect.map(Option.isNone)),
      ),
    );

    expect(result).toBe(true);
  });

  test('is a no-op for the codex minimal profile', async () => {
    const result = await runEffect(
      withProviderExecution(
        { provider: 'codex-cli', profile: 'minimal' },
        Effect.serviceOption(CodexEnv).pipe(Effect.map(Option.isNone)),
      ),
    );

    expect(result).toBe(true);
  });

  test('provides a scoped CodexEnv for codex non-minimal profiles', async () => {
    const result = await runEffect(
      withProviderExecution(
        { provider: 'codex-cli', profile: 'fast' },
        Effect.gen(function* () {
          const env = Option.getOrThrow(yield* Effect.serviceOption(CodexEnv));
          return {
            codexHome: env.codexHome,
            existsDuringExecution: existsSync(env.codexHome),
            sandbox: env.profile.sandbox,
          };
        }),
      ),
    );

    expect(result.existsDuringExecution).toBe(true);
    expect(result.sandbox).toBe('workspace-write');
    expect(existsSync(result.codexHome)).toBe(false);
  });
});
