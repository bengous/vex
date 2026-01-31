/**
 * Shared CLI options for vex commands.
 *
 * Uses @effect/cli Options with Effect Schema validation.
 * These options are reused across scan, loop, and other commands.
 */

import { Options } from '@effect/cli';
import { AutoFixThreshold, DeviceId, PositiveInt, ProviderName, ReasoningLevel } from '../config/schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Shared Options (scan + loop)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Preset name from config file.
 */
export const presetOption = Options.text('preset').pipe(
  Options.withAlias('p'),
  Options.withDescription('Use a named preset from vex.config.ts'),
  Options.optional,
);

/**
 * Device preset ID.
 */
export const deviceOption = Options.text('device').pipe(
  Options.withAlias('d'),
  Options.withSchema(DeviceId),
  Options.withDescription('Device preset (e.g., desktop-1920, iphone-15-pro)'),
  Options.optional,
);

/**
 * VLM provider name.
 */
export const providerOption = Options.text('provider').pipe(
  Options.withSchema(ProviderName),
  Options.withDescription('VLM provider (ollama, codex-cli, claude-cli, gemini-cli)'),
  Options.optional,
);

/**
 * Model override.
 */
export const modelOption = Options.text('model').pipe(
  Options.withAlias('M'),
  Options.withDescription('Model name override'),
  Options.optional,
);

/**
 * Output directory.
 */
export const outputOption = Options.directory('output').pipe(
  Options.withAlias('o'),
  Options.withDescription('Output directory (overrides VEX_OUTPUT_DIR/config)'),
  Options.optional,
);

/**
 * Replace images/videos with placeholder boxes.
 */
export const placeholderMediaOption = Options.boolean('placeholder-media').pipe(
  Options.withDescription('Replace images/videos with placeholder boxes'),
  Options.withDefault(false),
);

/**
 * List available device presets.
 */
export const listDevicesOption = Options.boolean('list-devices').pipe(
  Options.withDescription('List available device presets'),
  Options.withDefault(false),
);

// ═══════════════════════════════════════════════════════════════════════════
// Scan-specific Options
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reasoning effort level for codex-cli.
 */
export const reasoningOption = Options.text('reasoning').pipe(
  Options.withAlias('R'),
  Options.withSchema(ReasoningLevel),
  Options.withDescription('Reasoning effort (codex-cli: low, medium, high, xhigh)'),
  Options.optional,
);

/**
 * Full annotation pipeline (analyze + annotate + render).
 */
export const fullOption = Options.boolean('full').pipe(
  Options.withAlias('f'),
  Options.withDescription('Full annotation pipeline (analyze + annotate + render)'),
  Options.withDefault(false),
);

// ═══════════════════════════════════════════════════════════════════════════
// Loop-specific Options
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum iterations before stopping.
 */
export const maxIterationsOption = Options.integer('max-iterations').pipe(
  Options.withAlias('n'),
  Options.withSchema(PositiveInt),
  Options.withDescription('Maximum iterations before stopping'),
  Options.optional,
);

/**
 * Auto-fix confidence threshold.
 */
export const autoFixOption = Options.text('auto-fix').pipe(
  Options.withSchema(AutoFixThreshold),
  Options.withDescription('Auto-fix confidence threshold (high, medium, none)'),
  Options.optional,
);

/**
 * Project root directory (required for loop).
 */
export const projectOption = Options.directory('project').pipe(
  Options.withAlias('P'),
  Options.withDescription('Project root directory'),
);

/**
 * Dry run mode - no code changes.
 */
export const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withAlias('D'),
  Options.withDescription('Dry run mode (no code changes)'),
  Options.withDefault(false),
);

// ═══════════════════════════════════════════════════════════════════════════
// Other Command Options
// ═══════════════════════════════════════════════════════════════════════════

/**
 * JSON output format.
 */
export const jsonOption = Options.boolean('json').pipe(
  Options.withDescription('Output as JSON'),
  Options.withDefault(false),
);

/**
 * Interactive mode (currently disabled).
 */
export const interactiveOption = Options.boolean('interactive').pipe(
  Options.withAlias('i'),
  Options.withDescription('Interactive mode (currently disabled)'),
  Options.withDefault(false),
);

/**
 * Pattern globs for file matching.
 */
export const patternsOption = Options.text('patterns').pipe(
  Options.withDescription('File patterns to search (comma-separated globs)'),
  Options.optional,
);

/**
 * Baseline iteration index for verification.
 */
export const baselineOption = Options.integer('baseline').pipe(
  Options.withDescription('Baseline iteration index'),
  Options.optional,
);

/**
 * Current iteration index for verification.
 */
export const currentOption = Options.integer('current').pipe(
  Options.withDescription('Current iteration index'),
  Options.optional,
);
