/**
 * Configuration loader for vex.
 *
 * Loads vex.config.ts (preferred) or .vexrc.json (legacy fallback).
 * Validates with Effect Schema and returns typed config.
 */

import type { CodexProfile } from "../providers/codex-cli/schema.js";
import { FileSystem } from "@effect/platform";
import { Data, Effect, ParseResult, Schema as S } from "effect";
import { dirname, join, resolve } from "node:path";
import { BUILTIN_PROFILES } from "../providers/codex-cli/schema.js";
import { VexConfig } from "./schema.js";

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration error - Effect-style tagged error.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly kind: "not_found" | "invalid_schema" | "preset_not_found" | "missing_required";
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
export function findProjectRoot(
  startDir: string = process.cwd(),
): Effect.Effect<string, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    let current = resolve(startDir);
    const root = dirname(current);

    while (current !== root) {
      // Treat any error (permission denied, I/O error, etc.) as "not found" - continue searching upward
      const found = yield* fs
        .exists(join(current, "package.json"))
        .pipe(Effect.orElseSucceed(() => false));
      if (found) {
        return current;
      }
      current = dirname(current);
    }

    return startDir;
  });
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
      try: async () => import(configPath),
      catch: (error) =>
        new ConfigError({
          kind: "invalid_schema",
          message: `Failed to load ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
          path: configPath,
        }),
    });

    const raw = (module as { readonly default?: unknown }).default;
    if (raw === undefined) {
      return yield* new ConfigError({
        kind: "invalid_schema",
        message: `${configPath} must have a default export`,
        path: configPath,
      });
    }

    const decoded = yield* S.decodeUnknown(VexConfig)(raw).pipe(
      Effect.mapError((parseError) => {
        const formatted = formatParseError(parseError);
        return new ConfigError({
          kind: "invalid_schema",
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
function loadJsonConfig(
  configPath: string,
): Effect.Effect<VexConfig, ConfigError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(configPath).pipe(
      Effect.mapError((e) => {
        // Preserve NotFound vs other errors for loadConfigOptional
        const kind =
          e._tag === "SystemError" && e.reason === "NotFound" ? "not_found" : "invalid_schema";
        return new ConfigError({
          kind,
          message: `Failed to read ${configPath}: ${e.message}`,
          path: configPath,
        });
      }),
    );

    const raw = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: () =>
        new ConfigError({
          kind: "invalid_schema",
          message: `Invalid JSON in ${configPath}`,
          path: configPath,
        }),
    });

    const decoded = yield* S.decodeUnknown(VexConfig)(raw).pipe(
      Effect.mapError((parseError) => {
        const formatted = formatParseError(parseError);
        return new ConfigError({
          kind: "invalid_schema",
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
export function loadConfig(
  projectRoot?: string,
): Effect.Effect<VexConfig, ConfigError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = projectRoot ?? (yield* findProjectRoot());

    const tsConfigPath = join(root, "vex.config.ts");
    if (yield* fs.exists(tsConfigPath).pipe(Effect.orElseSucceed(() => false))) {
      return yield* loadTsConfig(tsConfigPath);
    }

    const jsonConfigPath = join(root, ".vexrc.json");
    if (yield* fs.exists(jsonConfigPath).pipe(Effect.orElseSucceed(() => false))) {
      return yield* loadJsonConfig(jsonConfigPath);
    }

    // No config found - this is OK, will use CLI args + env vars
    // Return a minimal config that can be merged with CLI options
    return yield* new ConfigError({
      kind: "not_found",
      message: "No configuration file found (vex.config.ts or .vexrc.json)",
    });
  });
}

/**
 * Load config or return undefined if not found.
 * Useful when config is optional (CLI args can provide all values).
 */
export function loadConfigOptional(
  projectRoot?: string,
): Effect.Effect<VexConfig | undefined, ConfigError, FileSystem.FileSystem> {
  return loadConfig(projectRoot).pipe(
    Effect.catchTag("ConfigError", (error) =>
      error.kind === "not_found" ? Effect.void.pipe(Effect.as(undefined)) : Effect.fail(error),
    ),
  );
}

/**
 * Get a scan preset from config.
 */
export function getScanPreset(
  config: VexConfig,
  presetName: string,
): Effect.Effect<NonNullable<VexConfig["scanPresets"]>[string], ConfigError> {
  return Effect.gen(function* () {
    const presets = config.scanPresets ?? {};
    const preset = presets[presetName];

    if (preset === undefined) {
      const available = Object.keys(presets);
      return yield* new ConfigError({
        kind: "preset_not_found",
        message:
          available.length > 0
            ? `Unknown scan preset '${presetName}'. Available: ${available.join(", ")}`
            : `Unknown scan preset '${presetName}'. No scan presets defined in config.`,
        availablePresets: available,
      });
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
): Effect.Effect<NonNullable<VexConfig["loopPresets"]>[string], ConfigError> {
  return Effect.gen(function* () {
    const presets = config.loopPresets ?? {};
    const preset = presets[presetName];

    if (preset === undefined) {
      const available = Object.keys(presets);
      return yield* new ConfigError({
        kind: "preset_not_found",
        message:
          available.length > 0
            ? `Unknown loop preset '${presetName}'. Available: ${available.join(", ")}`
            : `Unknown loop preset '${presetName}'. No loop presets defined in config.`,
        availablePresets: available,
      });
    }

    return preset;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Profile Loading
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load a Codex CLI profile by name.
 *
 * Resolution order:
 * 1. Built-in profiles (minimal, fast, safe)
 * 2. User-defined profiles in config.providers.codex
 *
 * @param name - Profile name
 * @param config - Optional vex config (for user-defined profiles)
 */
export function loadCodexProfile(
  name: string,
  config?: VexConfig,
): Effect.Effect<CodexProfile, ConfigError> {
  return Effect.gen(function* () {
    // Check built-in profiles first
    if (name in BUILTIN_PROFILES) {
      return BUILTIN_PROFILES[name as keyof typeof BUILTIN_PROFILES];
    }

    // Check user-defined profiles
    const userProfiles = config?.providers?.codex ?? {};
    const userProfile = userProfiles[name];
    if (userProfile !== undefined) {
      return userProfile;
    }

    // Profile not found
    const builtinNames = Object.keys(BUILTIN_PROFILES);
    const userNames = Object.keys(userProfiles);
    const allAvailable = [...builtinNames, ...userNames];

    return yield* new ConfigError({
      kind: "preset_not_found",
      message:
        allAvailable.length > 0
          ? `Unknown codex profile '${name}'. Available: ${allAvailable.join(", ")}`
          : `Unknown codex profile '${name}'. No profiles available.`,
      availablePresets: allAvailable,
    });
  });
}
