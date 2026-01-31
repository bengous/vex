/**
 * Configuration loader for vex.
 *
 * Loads vex.config.ts (preferred) or .vexrc.json (legacy fallback).
 * Validates with Effect Schema and returns typed config.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Data, Effect, ParseResult, Schema as S } from 'effect';
import { VexConfig } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration error - Effect-style tagged error.
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly kind: 'not_found' | 'invalid_schema' | 'preset_not_found' | 'missing_required';
  readonly message: string;
  readonly path?: string;
  readonly availablePresets?: readonly string[];
}> {}

// ═══════════════════════════════════════════════════════════════════════════
// Project Root Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find project root by looking for package.json.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  const root = dirname(current);

  while (current !== root) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    current = dirname(current);
  }

  return startDir;
}

// ═══════════════════════════════════════════════════════════════════════════
// Config Loading
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load vex.config.ts using Bun's native TypeScript import.
 */
function loadTsConfig(configPath: string): Effect.Effect<VexConfig, ConfigError> {
  return Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: () => import(configPath),
      catch: (error) =>
        new ConfigError({
          kind: 'invalid_schema',
          message: `Failed to load ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
          path: configPath,
        }),
    });

    const raw = module.default;
    if (!raw) {
      return yield* Effect.fail(
        new ConfigError({
          kind: 'invalid_schema',
          message: `${configPath} must have a default export`,
          path: configPath,
        }),
      );
    }

    // Validate with schema
    const decoded = yield* S.decodeUnknown(VexConfig)(raw).pipe(
      Effect.mapError((parseError) => {
        const formatted = formatParseError(parseError);
        return new ConfigError({
          kind: 'invalid_schema',
          message: `Invalid config at ${configPath}:\n${formatted}`,
          path: configPath,
        });
      }),
    );

    return decoded;
  });
}

/**
 * Load .vexrc.json (legacy format).
 */
function loadJsonConfig(configPath: string): Effect.Effect<VexConfig, ConfigError> {
  return Effect.gen(function* () {
    const content = yield* Effect.try({
      try: () => readFileSync(configPath, 'utf-8'),
      catch: (error) =>
        new ConfigError({
          kind: 'invalid_schema',
          message: `Failed to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
          path: configPath,
        }),
    });

    const raw = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: () =>
        new ConfigError({
          kind: 'invalid_schema',
          message: `Invalid JSON in ${configPath}`,
          path: configPath,
        }),
    });

    // Validate with schema
    const decoded = yield* S.decodeUnknown(VexConfig)(raw).pipe(
      Effect.mapError((parseError) => {
        const formatted = formatParseError(parseError);
        return new ConfigError({
          kind: 'invalid_schema',
          message: `Invalid config at ${configPath}:\n${formatted}`,
          path: configPath,
        });
      }),
    );

    return decoded;
  });
}

/**
 * Format Effect Schema parse error for human-readable output.
 * Uses Effect's built-in TreeFormatter.
 */
function formatParseError(error: ParseResult.ParseError): string {
  return ParseResult.TreeFormatter.formatErrorSync(error);
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load vex configuration.
 *
 * Priority:
 * 1. vex.config.ts (TypeScript config)
 * 2. .vexrc.json (legacy JSON config)
 *
 * @param projectRoot - Project root directory (defaults to auto-detected)
 * @returns Effect containing validated VexConfig or ConfigError
 */
export function loadConfig(projectRoot?: string): Effect.Effect<VexConfig, ConfigError> {
  return Effect.gen(function* () {
    const root = projectRoot ?? findProjectRoot();

    // Try vex.config.ts first
    const tsConfigPath = join(root, 'vex.config.ts');
    if (existsSync(tsConfigPath)) {
      return yield* loadTsConfig(tsConfigPath);
    }

    // Fallback to .vexrc.json
    const jsonConfigPath = join(root, '.vexrc.json');
    if (existsSync(jsonConfigPath)) {
      return yield* loadJsonConfig(jsonConfigPath);
    }

    // No config found - this is OK, will use CLI args + env vars
    // Return a minimal config that can be merged with CLI options
    return yield* Effect.fail(
      new ConfigError({
        kind: 'not_found',
        message: 'No configuration file found (vex.config.ts or .vexrc.json)',
      }),
    );
  });
}

/**
 * Load config or return undefined if not found.
 * Useful when config is optional (CLI args can provide all values).
 */
export function loadConfigOptional(projectRoot?: string): Effect.Effect<VexConfig | undefined, ConfigError> {
  return loadConfig(projectRoot).pipe(
    Effect.catchTag('ConfigError', (error) =>
      error.kind === 'not_found' ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );
}

/**
 * Get a scan preset from config.
 */
export function getScanPreset(
  config: VexConfig,
  presetName: string,
): Effect.Effect<NonNullable<VexConfig['scanPresets']>[string], ConfigError> {
  return Effect.gen(function* () {
    const presets = config.scanPresets ?? {};
    const preset = presets[presetName];

    if (!preset) {
      const available = Object.keys(presets);
      return yield* Effect.fail(
        new ConfigError({
          kind: 'preset_not_found',
          message:
            available.length > 0
              ? `Unknown scan preset '${presetName}'. Available: ${available.join(', ')}`
              : `Unknown scan preset '${presetName}'. No scan presets defined in config.`,
          availablePresets: available,
        }),
      );
    }

    return preset;
  });
}

/**
 * Get a loop preset from config.
 */
export function getLoopPreset(
  config: VexConfig,
  presetName: string,
): Effect.Effect<NonNullable<VexConfig['loopPresets']>[string], ConfigError> {
  return Effect.gen(function* () {
    const presets = config.loopPresets ?? {};
    const preset = presets[presetName];

    if (!preset) {
      const available = Object.keys(presets);
      return yield* Effect.fail(
        new ConfigError({
          kind: 'preset_not_found',
          message:
            available.length > 0
              ? `Unknown loop preset '${presetName}'. Available: ${available.join(', ')}`
              : `Unknown loop preset '${presetName}'. No loop presets defined in config.`,
          availablePresets: available,
        }),
      );
    }

    return preset;
  });
}
