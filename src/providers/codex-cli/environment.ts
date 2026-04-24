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
 *   console.log(`CODEX_HOME=${env.codexHome}`);
 * });
 *
 * // Run with scoped environment
 * const withEnv = Effect.scoped(
 *   Effect.gen(function* () {
 *     const codexEnv = yield* makeCodexEnvResource(profile);
 *     return yield* program.pipe(Effect.provideService(CodexEnv, codexEnv));
 *   })
 * );
 * ```
 */

import type { CodexProfile } from "./schema.js";
import type { Scope } from "effect";
import { Context, Effect } from "effect";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { generateConfigToml } from "./toml.js";

// ═══════════════════════════════════════════════════════════════════════════
// Service Definition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Codex environment context.
 * Provides the CODEX_HOME path for subprocess configuration.
 */
export type CodexEnvService = {
  /** Path to the temporary CODEX_HOME directory */
  readonly codexHome: string;
  /** The profile used to create this environment */
  readonly profile: CodexProfile;
};

/**
 * Effect service tag for Codex environment.
 */
export class CodexEnv extends Context.Tag("CodexEnv")<CodexEnv, CodexEnvService>() {}

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
 * The returned Effect requires a Scope for lifecycle management.
 * Caller must use Effect.scoped() or provide a Scope to run this.
 *
 * @param profile - Codex profile configuration
 * @returns Effect that acquires/releases the environment service
 */
export function makeCodexEnvResource(
  profile: CodexProfile,
): Effect.Effect<CodexEnvService, never, Scope.Scope> {
  const acquire = Effect.sync(() => {
    const codexHome = generateTempDir();

    // Create temp directory
    mkdirSync(codexHome, { recursive: true });

    // Write config.toml
    const configToml = generateConfigToml(profile);
    writeFileSync(join(codexHome, "config.toml"), configToml, "utf-8");

    // Symlink auth.json from user's ~/.codex/ if it exists
    const userAuthPath = join(homedir(), ".codex", "auth.json");
    if (existsSync(userAuthPath)) {
      symlinkSync(userAuthPath, join(codexHome, "auth.json"));
    }

    return { codexHome, profile };
  });

  const release = (env: CodexEnvService) =>
    Effect.sync(() => {
      // Clean up temp directory
      rmSync(env.codexHome, { recursive: true, force: true });
    });

  return Effect.acquireRelease(acquire, release);
}
