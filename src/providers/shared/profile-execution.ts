import type { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import { type ConfigError, loadCodexProfile, loadConfigOptional } from '../../config/loader.js';
import { CodexEnv, makeCodexEnvResource } from '../codex-cli/environment.js';

export interface ProviderExecutionSpec {
  readonly provider: string;
  readonly profile: string;
}

export function needsProviderExecution(spec: ProviderExecutionSpec): boolean {
  return spec.provider === 'codex-cli' && spec.profile !== 'minimal';
}

export function withProviderExecution<A, E, R>(
  spec: ProviderExecutionSpec,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ConfigError, R | FileSystem.FileSystem> {
  if (!needsProviderExecution(spec)) {
    return effect;
  }

  return Effect.scoped(
    Effect.gen(function* () {
      const config = yield* loadConfigOptional();
      const profile = yield* loadCodexProfile(spec.profile, config);
      const codexEnv = yield* makeCodexEnvResource(profile);
      return yield* effect.pipe(Effect.provideService(CodexEnv, codexEnv));
    }),
  );
}
