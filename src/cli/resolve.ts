/**
 * CLI override resolution logic.
 *
 * Merges CLI arguments with preset values following the override rule:
 * CLI flag > preset value > default > error (if required)
 */

import type { FileSystem } from '@effect/platform';
import { Effect, Option } from 'effect';
import { ConfigError, getLoopPreset, getScanPreset, loadCodexProfile, loadConfigOptional } from '../config/loader.js';
import type {
  DeviceSpec,
  FullPageScrollFixSpec,
  LoopPreset,
  PlaceholderMediaSpec,
  ProviderSpec,
  ScanPreset,
  VexConfig,
} from '../config/schema.js';
import { getAllDeviceIds, lookupDevice } from '../core/devices.js';
import { BUILTIN_PROFILES } from '../providers/codex-cli/schema.js';
import { ProfileNotFoundError } from '../providers/shared/errors.js';
import { getProviderMetadata } from '../providers/shared/registry.js';

// ═══════════════════════════════════════════════════════════════════════════
// Resolved Options Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fully resolved placeholder media options.
 *
 * Type hierarchy:
 * - PlaceholderMediaSpec (schema) = boolean | PlaceholderMediaConfig
 * - PlaceholderMediaConfig (schema) = { svgMinSize?, preserve? }
 * - ResolvedPlaceholderMedia (CLI) = { enabled: true, svgMinSize, preserve } | undefined
 * - PlaceholderMediaOptions (core) = { enabled: boolean, svgMinSize, preserve }
 *
 * ResolvedPlaceholderMedia is a subtype of core PlaceholderMediaOptions,
 * allowing direct pass-through to capture operations.
 */
export interface ResolvedPlaceholderMedia {
  readonly enabled: true;
  readonly svgMinSize: number;
  readonly preserve: readonly string[];
}

/**
 * Fully resolved full-page scroll fix options.
 *
 * Type hierarchy:
 * - FullPageScrollFixSpec (schema) = boolean | FullPageScrollFixConfig
 * - FullPageScrollFixConfig (schema) = { selectors?, settleMs?, preserveHorizontalOverflow? }
 * - ResolvedFullPageScrollFix (CLI) = { enabled: true, selectors, settleMs, preserveHorizontalOverflow } | undefined
 */
export interface ResolvedFullPageScrollFix {
  readonly enabled: true;
  readonly selectors: readonly string[];
  readonly settleMs: number;
  readonly preserveHorizontalOverflow: boolean;
}

export type ResolvedScanMode = 'analyze' | 'capture-only';

/**
 * Fully resolved scan options ready for pipeline execution.
 */
export interface ResolvedScanOptions {
  readonly urls: readonly string[];
  readonly devices: readonly string[];
  readonly provider: string;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
  readonly profile: string;
  readonly mode: ResolvedScanMode;
  readonly full: boolean;
  readonly placeholderMedia: ResolvedPlaceholderMedia | undefined;
  readonly fullPageScrollFix: ResolvedFullPageScrollFix | undefined;
  readonly outputDir: string;
}

/**
 * Fully resolved loop options ready for orchestrator execution.
 */
export interface ResolvedLoopOptions {
  readonly urls: readonly string[];
  readonly devices: readonly string[];
  readonly provider: string;
  readonly model: string | undefined;
  readonly profile: string;
  readonly maxIterations: number;
  readonly autoFix: 'high' | 'medium' | 'none';
  readonly dryRun: boolean;
  readonly placeholderMedia: ResolvedPlaceholderMedia | undefined;
  readonly fullPageScrollFix: ResolvedFullPageScrollFix | undefined;
  readonly outputDir: string;
  readonly projectRoot: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI Args Types (from @effect/cli parsing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CLI args shared between scan and loop commands.
 */
export interface CommonCliArgs {
  readonly url: Option.Option<string>;
  readonly preset: Option.Option<string>;
  readonly device: Option.Option<string>;
  readonly provider: Option.Option<string>;
  readonly model: Option.Option<string>;
  readonly providerProfile: Option.Option<string>;
  readonly placeholderMedia: boolean;
  readonly output: Option.Option<string>;
}

/**
 * Raw CLI args for scan command.
 */
export interface ScanCliArgs extends CommonCliArgs {
  readonly reasoning: Option.Option<string>;
  readonly full: boolean;
}

/**
 * Raw CLI args for loop command.
 */
export interface LoopCliArgs extends CommonCliArgs {
  readonly maxIterations: Option.Option<number>;
  readonly autoFix: Option.Option<string>;
  readonly dryRun: boolean;
  readonly project: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  devices: ['desktop-1920'] as readonly string[],
  provider: 'ollama',
  profile: 'minimal',
  mode: 'analyze' as ResolvedScanMode,
  full: false,
  maxIterations: 5,
  autoFix: 'high' as const,
  dryRun: false,
  placeholderMedia: {
    svgMinSize: 100,
    preserve: [] as readonly string[],
  },
  fullPageScrollFix: {
    selectors: ['#page-scroll-container'] as readonly string[],
    settleMs: 500,
    preserveHorizontalOverflow: false,
  },
};

/**
 * Normalize placeholder media spec to resolved format.
 *
 * - false / undefined → undefined (disabled)
 * - true → defaults
 * - object → merge with defaults
 */
function normalizePlaceholderMedia(
  cliEnabled: boolean,
  presetSpec: PlaceholderMediaSpec | undefined,
): ResolvedPlaceholderMedia | undefined {
  // CLI flag takes precedence
  if (cliEnabled) {
    // CLI is just a boolean, use defaults
    return { enabled: true, ...DEFAULTS.placeholderMedia };
  }

  // Preset not set
  if (presetSpec === undefined || presetSpec === false) {
    return undefined;
  }

  // Preset is true (use defaults)
  if (presetSpec === true) {
    return { enabled: true, ...DEFAULTS.placeholderMedia };
  }

  // Preset is object, merge with defaults
  return {
    enabled: true,
    svgMinSize: presetSpec.svgMinSize ?? DEFAULTS.placeholderMedia.svgMinSize,
    preserve: presetSpec.preserve ?? DEFAULTS.placeholderMedia.preserve,
  };
}

/**
 * Normalize full-page scroll fix spec to resolved format.
 *
 * - false / undefined → undefined (disabled)
 * - true → defaults
 * - object → merge with defaults
 */
function normalizeFullPageScrollFix(
  presetSpec: FullPageScrollFixSpec | undefined,
): ResolvedFullPageScrollFix | undefined {
  if (presetSpec === undefined || presetSpec === false) {
    return undefined;
  }

  if (presetSpec === true) {
    return { enabled: true, ...DEFAULTS.fullPageScrollFix };
  }

  return {
    enabled: true,
    selectors: presetSpec.selectors ?? DEFAULTS.fullPageScrollFix.selectors,
    settleMs: presetSpec.settleMs ?? DEFAULTS.fullPageScrollFix.settleMs,
    preserveHorizontalOverflow:
      presetSpec.preserveHorizontalOverflow ?? DEFAULTS.fullPageScrollFix.preserveHorizontalOverflow,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Profile Resolution
// ═══════════════════════════════════════════════════════════════════════════

/** Maps provider names to their profile prefix */
const PROVIDER_TO_PROFILE_PREFIX: Record<string, string> = {
  'codex-cli': 'codex',
  'claude-cli': 'claude',
  'gemini-cli': 'gemini',
  ollama: 'ollama',
};

/**
 * Parse "provider:profile" string into tuple.
 */
function parseProviderProfile(input: string): Effect.Effect<[provider: string, profile: string], ConfigError> {
  const idx = input.indexOf(':');
  if (idx === -1) {
    return Effect.fail(
      new ConfigError({
        kind: 'invalid_schema',
        message: `Invalid profile format '${input}'. Expected 'provider:profile' (e.g., codex:fast).`,
      }),
    );
  }
  return Effect.succeed([input.slice(0, idx), input.slice(idx + 1)]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize device spec to array.
 */
function normalizeDevices(spec: DeviceSpec | undefined): readonly string[] | undefined {
  if (!spec) return undefined;
  if (Array.isArray(spec)) {
    return spec as readonly string[];
  }
  return [spec as string];
}

/**
 * Validate that resolved device IDs exist in runtime registry.
 * This catches config/schema drift and enforces explicit device IDs only.
 */
function validateResolvedDevices(devices: readonly string[]): Effect.Effect<void, ConfigError> {
  const unknown = devices.filter((device) => !lookupDevice(device));
  if (unknown.length === 0) {
    return Effect.void;
  }

  const valid = getAllDeviceIds().join(', ');
  return Effect.fail(
    new ConfigError({
      kind: 'invalid_schema',
      message: `Unknown device preset(s): ${unknown.join(', ')}.
Use explicit device IDs (e.g., iphone-se-2016 or iphone-se-2022).
Valid devices: ${valid}`,
    }),
  );
}

/**
 * Extract provider name and model from ProviderSpec.
 */
function extractProviderInfo(spec: ProviderSpec | undefined): {
  provider?: string;
  model?: string;
  reasoning?: string;
} {
  if (!spec) return {};
  return {
    provider: spec.name,
    model: spec.model,
    reasoning: 'reasoning' in spec ? spec.reasoning : undefined,
  };
}

/**
 * Get output directory from multiple sources.
 * Priority: CLI --output > VEX_OUTPUT_DIR env > config outputDir
 */
function resolveOutputDir(
  cliOutput: Option.Option<string>,
  config: VexConfig | undefined,
): Effect.Effect<string, ConfigError> {
  if (Option.isSome(cliOutput)) {
    return Effect.succeed(cliOutput.value);
  }

  const envDir = process.env.VEX_OUTPUT_DIR;
  if (envDir) {
    return Effect.succeed(envDir);
  }

  if (config?.outputDir) {
    return Effect.succeed(config.outputDir);
  }

  return Effect.fail(
    new ConfigError({
      kind: 'missing_required',
      message: `Output directory required.
Use --output flag, set VEX_OUTPUT_DIR env var, or create vex.config.ts`,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Scan Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve scan options from CLI args and optional preset.
 */
export function resolveScanOptions(
  cliArgs: ScanCliArgs,
  projectRoot?: string,
): Effect.Effect<ResolvedScanOptions, ConfigError | ProfileNotFoundError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const config = yield* loadConfigOptional(projectRoot);

    let preset: ScanPreset | undefined;
    if (Option.isSome(cliArgs.preset)) {
      if (!config) {
        return yield* Effect.fail(
          new ConfigError({
            kind: 'not_found',
            message: `Cannot use --preset: no vex.config.ts found.
Create a config file or remove the --preset flag.`,
          }),
        );
      }
      preset = yield* getScanPreset(config, cliArgs.preset.value);
    }

    let urls: readonly string[];
    if (Option.isSome(cliArgs.url)) {
      urls = [cliArgs.url.value];
    } else if (preset?.urls && preset.urls.length > 0) {
      urls = preset.urls;
    } else {
      const presetInfo = Option.isSome(cliArgs.preset) ? ` Preset '${cliArgs.preset.value}' has no 'urls' field.` : '';
      return yield* Effect.fail(
        new ConfigError({
          kind: 'missing_required',
          message: `URL required.${presetInfo}
Either provide a URL argument or add 'urls' field to the preset.`,
        }),
      );
    }

    // Resolve devices: CLI > preset > default
    const presetProviderInfo = extractProviderInfo(preset?.provider);
    const presetDevices = normalizeDevices(preset?.devices);

    const devices = Option.isSome(cliArgs.device) ? [cliArgs.device.value] : (presetDevices ?? DEFAULTS.devices);
    yield* validateResolvedDevices(devices);

    // Resolve provider: CLI > preset > default
    const provider = Option.isSome(cliArgs.provider)
      ? cliArgs.provider.value
      : (presetProviderInfo.provider ?? DEFAULTS.provider);

    // Resolve model: CLI > preset > undefined
    const model = Option.isSome(cliArgs.model) ? cliArgs.model.value : presetProviderInfo.model;

    // Resolve reasoning: CLI > preset > undefined
    const reasoning = Option.isSome(cliArgs.reasoning) ? cliArgs.reasoning.value : presetProviderInfo.reasoning;

    // Resolve profile: CLI > preset.provider.profile > 'minimal'
    let profile = DEFAULTS.profile;
    if (preset?.provider && typeof preset.provider === 'object' && 'profile' in preset.provider) {
      profile = preset.provider.profile ?? profile;
    }

    // CLI override with validation
    if (Option.isSome(cliArgs.providerProfile)) {
      const [profileProvider, profileName] = yield* parseProviderProfile(cliArgs.providerProfile.value);
      const expectedPrefix = PROVIDER_TO_PROFILE_PREFIX[provider];

      if (!expectedPrefix || profileProvider !== expectedPrefix) {
        return yield* Effect.fail(
          new ConfigError({
            kind: 'invalid_schema',
            message: `Profile '${profileProvider}:${profileName}' doesn't match provider '${provider}'.
Expected: ${expectedPrefix ?? 'unknown'}:${profileName}`,
          }),
        );
      }
      profile = profileName;

      // Validate profile exists for codex-cli
      if (provider === 'codex-cli') {
        yield* loadCodexProfile(profile, config).pipe(
          Effect.mapError(() => {
            const builtinNames = Object.keys(BUILTIN_PROFILES);
            const userNames = Object.keys(config?.providers?.codex ?? {});
            return new ProfileNotFoundError({
              profileName: profile,
              availableProfiles: [...builtinNames, ...userNames],
            });
          }),
        );
      }
    }

    // Validate model against knownModels
    if (model) {
      const providerMeta = getProviderMetadata(provider);
      if (providerMeta?.knownModels && !providerMeta.knownModels.includes(model)) {
        return yield* Effect.fail(
          new ConfigError({
            kind: 'invalid_schema',
            message: `Model '${model}' not in known models for '${provider}'.
Known: ${providerMeta.knownModels.join(', ')}`,
          }),
        );
      }
    }

    // Resolve mode: preset > default
    const mode = (preset?.mode ?? DEFAULTS.mode) as ResolvedScanMode;

    // Resolve boolean flags: CLI true overrides preset, otherwise use preset or default
    const full = cliArgs.full || preset?.full || DEFAULTS.full;
    const placeholderMedia = normalizePlaceholderMedia(cliArgs.placeholderMedia, preset?.placeholderMedia);
    const fullPageScrollFix = normalizeFullPageScrollFix(preset?.fullPageScrollFix);

    const outputDir = yield* resolveOutputDir(cliArgs.output, config);

    return {
      urls,
      devices,
      provider,
      model,
      reasoning,
      profile,
      mode,
      full,
      placeholderMedia,
      fullPageScrollFix,
      outputDir,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve loop options from CLI args and optional preset.
 */
export function resolveLoopOptions(
  cliArgs: LoopCliArgs,
  projectRoot?: string,
): Effect.Effect<ResolvedLoopOptions, ConfigError | ProfileNotFoundError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const config = yield* loadConfigOptional(projectRoot);

    let preset: LoopPreset | undefined;
    if (Option.isSome(cliArgs.preset)) {
      if (!config) {
        return yield* Effect.fail(
          new ConfigError({
            kind: 'not_found',
            message: `Cannot use --preset: no vex.config.ts found.
Create a config file or remove the --preset flag.`,
          }),
        );
      }
      preset = yield* getLoopPreset(config, cliArgs.preset.value);
    }

    let urls: readonly string[];
    if (Option.isSome(cliArgs.url)) {
      urls = [cliArgs.url.value];
    } else if (preset?.urls && preset.urls.length > 0) {
      urls = preset.urls;
    } else {
      const presetInfo = Option.isSome(cliArgs.preset) ? ` Preset '${cliArgs.preset.value}' has no 'urls' field.` : '';
      return yield* Effect.fail(
        new ConfigError({
          kind: 'missing_required',
          message: `URL required.${presetInfo}
Either provide a URL argument or add 'urls' field to the preset.`,
        }),
      );
    }

    // Resolve devices: CLI > preset > default
    const presetProviderInfo = extractProviderInfo(preset?.provider);
    const presetDevices = normalizeDevices(preset?.devices);

    const devices = Option.isSome(cliArgs.device) ? [cliArgs.device.value] : (presetDevices ?? DEFAULTS.devices);
    yield* validateResolvedDevices(devices);

    // Resolve provider: CLI > preset > default
    const provider = Option.isSome(cliArgs.provider)
      ? cliArgs.provider.value
      : (presetProviderInfo.provider ?? DEFAULTS.provider);

    // Resolve model: CLI > preset > undefined
    const model = Option.isSome(cliArgs.model) ? cliArgs.model.value : presetProviderInfo.model;

    // Resolve profile: CLI > preset.provider.profile > 'minimal'
    let profile = DEFAULTS.profile;
    if (preset?.provider && typeof preset.provider === 'object' && 'profile' in preset.provider) {
      profile = preset.provider.profile ?? profile;
    }

    // CLI override with validation
    if (Option.isSome(cliArgs.providerProfile)) {
      const [profileProvider, profileName] = yield* parseProviderProfile(cliArgs.providerProfile.value);
      const expectedPrefix = PROVIDER_TO_PROFILE_PREFIX[provider];

      if (!expectedPrefix || profileProvider !== expectedPrefix) {
        return yield* Effect.fail(
          new ConfigError({
            kind: 'invalid_schema',
            message: `Profile '${profileProvider}:${profileName}' doesn't match provider '${provider}'.
Expected: ${expectedPrefix ?? 'unknown'}:${profileName}`,
          }),
        );
      }
      profile = profileName;

      // Validate profile exists for codex-cli
      if (provider === 'codex-cli') {
        yield* loadCodexProfile(profile, config).pipe(
          Effect.mapError(() => {
            const builtinNames = Object.keys(BUILTIN_PROFILES);
            const userNames = Object.keys(config?.providers?.codex ?? {});
            return new ProfileNotFoundError({
              profileName: profile,
              availableProfiles: [...builtinNames, ...userNames],
            });
          }),
        );
      }
    }

    // Validate model against knownModels
    if (model) {
      const providerMeta = getProviderMetadata(provider);
      if (providerMeta?.knownModels && !providerMeta.knownModels.includes(model)) {
        return yield* Effect.fail(
          new ConfigError({
            kind: 'invalid_schema',
            message: `Model '${model}' not in known models for '${provider}'.
Known: ${providerMeta.knownModels.join(', ')}`,
          }),
        );
      }
    }

    // Resolve maxIterations: CLI > preset > default
    const maxIterations = Option.isSome(cliArgs.maxIterations)
      ? cliArgs.maxIterations.value
      : (preset?.maxIterations ?? DEFAULTS.maxIterations);

    // Resolve autoFix: CLI > preset > default
    const autoFix = (Option.isSome(cliArgs.autoFix) ? cliArgs.autoFix.value : (preset?.autoFix ?? DEFAULTS.autoFix)) as
      | 'high'
      | 'medium'
      | 'none';

    const dryRun = cliArgs.dryRun || preset?.dryRun || DEFAULTS.dryRun;
    const placeholderMedia = normalizePlaceholderMedia(cliArgs.placeholderMedia, preset?.placeholderMedia);
    const fullPageScrollFix = normalizeFullPageScrollFix(preset?.fullPageScrollFix);

    const outputDir = yield* resolveOutputDir(cliArgs.output, config);

    // Project is required and CLI-only
    const projectRootResolved = cliArgs.project;

    return {
      urls,
      devices,
      provider,
      model,
      profile,
      maxIterations,
      autoFix,
      dryRun,
      placeholderMedia,
      fullPageScrollFix,
      outputDir,
      projectRoot: projectRootResolved,
    };
  });
}
