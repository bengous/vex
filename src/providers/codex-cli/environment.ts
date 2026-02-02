/**
 * Scoped Codex CLI environment resource.
 *
 * Creates isolated execution environments with profile-specific configuration.
 * Uses Effect's acquireRelease pattern for guaranteed cleanup.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const env = yield* CodexEnv;
 *   // Use env.codexHome with subprocess
 *   console.log(`CODEX_HOME=${env.codexHome}`);
 * });
 *
 * // Run with scoped environment
 * const withEnv = Effect.scoped(
 *   Effect.flatMap(
 *     makeCodexEnvResource(profile),
 *     (layer) => Effect.provide(program, layer)
 *   )
 * );
 * ```
 */

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Layer, type Scope } from 'effect';
import type { CodexProfile } from './schema.js';
import { generateConfigToml } from './toml.js';

// ═══════════════════════════════════════════════════════════════════════════
// Service Definition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Codex environment context.
 * Provides the CODEX_HOME path for subprocess configuration.
 */
export interface CodexEnvService {
  /** Path to the temporary CODEX_HOME directory */
  readonly codexHome: string;
  /** The profile used to create this environment */
  readonly profile: CodexProfile;
}

/**
 * Effect service tag for Codex environment.
 */
export class CodexEnv extends Context.Tag('CodexEnv')<CodexEnv, CodexEnvService>() {}

// ═══════════════════════════════════════════════════════════════════════════
// Resource Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique temp directory name for Codex environments.
 */
function generateTempDir(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return join(tmpdir(), `vex-codex-${timestamp}-${random}`);
}

/**
 * Create a scoped Codex environment resource.
 *
 * This uses Effect's acquireRelease pattern:
 * - acquire: Create temp directory, write config.toml, symlink auth.json
 * - release: Remove temp directory
 *
 * The returned Effect requires a Scope and produces a Layer providing CodexEnv.
 * Caller must use Effect.scoped() or provide a Scope to run this.
 *
 * @param profile - Codex profile configuration
 * @returns Effect that acquires/releases the environment and provides CodexEnv layer
 */
export function makeCodexEnvResource(profile: CodexProfile): Effect.Effect<Layer.Layer<CodexEnv>, never, Scope.Scope> {
  const acquire = Effect.sync(() => {
    const codexHome = generateTempDir();

    // Create temp directory
    mkdirSync(codexHome, { recursive: true });

    // Write config.toml
    const configToml = generateConfigToml(profile);
    writeFileSync(join(codexHome, 'config.toml'), configToml, 'utf-8');

    // Symlink auth.json from user's ~/.codex/ if it exists
    const userAuthPath = join(homedir(), '.codex', 'auth.json');
    if (existsSync(userAuthPath)) {
      symlinkSync(userAuthPath, join(codexHome, 'auth.json'));
    }

    return { codexHome, profile };
  });

  const release = (env: CodexEnvService) =>
    Effect.sync(() => {
      // Clean up temp directory
      rmSync(env.codexHome, { recursive: true, force: true });
    });

  return Effect.acquireRelease(acquire, release).pipe(Effect.map((service) => Layer.succeed(CodexEnv, service)));
}

/**
 * Create a CodexEnv layer directly (without Scope management).
 * Useful for testing or when lifetime is managed externally.
 *
 * WARNING: Does not clean up automatically. Use makeCodexEnvResource for production.
 *
 * @param profile - Codex profile configuration
 * @returns Layer providing CodexEnv
 */
export function makeCodexEnvLayerUnsafe(profile: CodexProfile): Layer.Layer<CodexEnv> {
  return Layer.effect(
    CodexEnv,
    Effect.sync(() => {
      const codexHome = generateTempDir();

      mkdirSync(codexHome, { recursive: true });
      writeFileSync(join(codexHome, 'config.toml'), generateConfigToml(profile), 'utf-8');

      const userAuthPath = join(homedir(), '.codex', 'auth.json');
      if (existsSync(userAuthPath)) {
        symlinkSync(userAuthPath, join(codexHome, 'auth.json'));
      }

      return { codexHome, profile };
    }),
  );
}
