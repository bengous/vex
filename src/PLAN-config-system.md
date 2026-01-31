# Vex Configuration System - Implementation Plan

## Overview

This plan migrates vex CLI from manual argument parsing (`node:util.parseArgs`) to a unified Effect-based stack with:

- **@effect/cli** for CLI parsing
- **Effect Schema** for validation (CLI args + config file)
- **TypeScript config file** (`vex.config.ts`) with presets

The goal is type-safe, composable configuration with excellent developer experience (autocomplete, validation errors).

---

## Design Decisions & Rationales

### 1. TypeScript Config File (`vex.config.ts`)

**Decision:** Use TypeScript instead of JSON for config.

**Rationale:**

- Autocomplete works natively in any TS-aware editor
- Validation happens at edit-time (red squiggles) AND runtime
- Can use JS expressions if needed (e.g., `devices: process.env.CI ? ['desktop-1920'] : ['desktop-1920', 'iphone-15-pro']`)
- Bun imports `.ts` files directly - no build step required
- Precedent: Vite, Tailwind, ESLint flat config, Vitest all use JS/TS config

### 2. @effect/cli for CLI Parsing

**Decision:** Replace `node:util.parseArgs` with `@effect/cli`.

**Rationale:**

- Vex already uses Effect for pipeline operations - unifies the stack
- Schema integration: reuse the same schemas for CLI args and config validation
- Auto-generated `--help` with typo suggestions (Levenshtein distance)
- Returns `Effect` values - proper error handling, composability
- `--wizard` mode for interactive prompts (free)
- `--completions` for shell completion scripts (free)

### 3. Effect Schema for Validation

**Decision:** Use Effect's built-in Schema (`import { Schema } from 'effect'`) instead of Zod/Valibot.

**Rationale:**

- Already using Effect - no new paradigm
- `Schema.decodeUnknown` returns `Effect<A, ParseError>` - fits pipeline pattern
- Schemas compose with Effect's error channel
- Single source of truth: TypeScript types derived from schema
- Integration with `@effect/cli` via `Options.withSchema()` and `Args.withSchema()`

**Note:** Schema is in the core `effect` package, not a separate `@effect/schema` package.

### 4. Separate Preset Types (Option B)

**Decision:** `scanPresets` and `loopPresets` are separate, not unified.

**Rationale:**

- User preference: "I prefer clear configs. I don't mind a little repetition."
- Each preset type only has relevant fields (no noise)
- Explicit over implicit - no inheritance/extends mechanism
- Can add composability later once patterns emerge from real usage

### 5. CLI Override Rule

**Decision:** CLI flags always override preset values.

**Rationale:**

- Predictable: what you type is what you get
- Consistent across ALL fields
- Resolution order: `CLI flag > preset value > default > error`

### 6. URLs in Presets (Optional List)

**Decision:** Presets can optionally include `urls: string[]` for batch operations.

**Rationale:**

- Enables `vex scan --preset mpzinc-pages` to scan multiple URLs
- If CLI provides URL, preset URLs are ignored (CLI override rule)
- Useful for "full website analysis" use case

### 7. Multi-Device Support

**Decision:** `devices` field accepts single device or array.

**Rationale:**

- Enables responsive testing: `devices: ['desktop-1920', 'iphone-15-pro']`
- Single device still works: `devices: 'desktop-1920'`
- Custom viewport support deferred (TODO for later)

### 8. Project Path CLI-Only

**Decision:** `--project` (loop command) is never in presets.

**Rationale:**

- Project path is context-dependent (which repo you're in)
- Putting it in config couples preset to specific machine/path
- Breaks portability if config is committed/shared

---

## File Structure

```
vex/
├── config/
│   ├── schema.ts       # Shared schemas (CLI + config)
│   ├── loader.ts       # Load vex.config.ts file
│   └── index.ts        # Re-exports + defineConfig helper
│
├── cli/
│   ├── index.ts        # @effect/cli main entry point
│   ├── options.ts      # Shared CLI options (--device, --provider, etc.)
│   ├── resolve.ts      # CLI override rule implementation
│   └── commands/
│       ├── scan.ts     # scan command (migrated)
│       ├── loop.ts     # loop command (migrated)
│       ├── providers.ts # providers command (migrated)
│       ├── analyze.ts  # analyze command (migrated)
│       ├── locate.ts   # locate command (migrated)
│       └── verify.ts   # verify command (migrated)
│
└── cli-legacy/         # Backup of old CLI (delete after migration verified)
    └── commands/
        └── *.ts
```

---

## Tasks

Each task should be committed separately after testing. Tasks are ordered by dependency.

### Verification Protocol

After completing each task:

1. **Type check:** Run `bunx tsc --noEmit` — must pass with zero errors
2. **Task verification:** Run the verification commands listed in the task
3. **Commit:** Only commit if both checks pass
4. **Blocked?** If verification fails, fix the issue before proceeding to the next task

Do not skip verification. Do not proceed with failing checks.

---

### Task 1: Install Dependencies ✅ COMPLETE

**Description:** Add @effect/cli and @effect/platform-bun packages.

**Status:** Completed via spike validation.

**Installed versions:**

- `@effect/cli@0.73.1`
- `@effect/platform-bun@0.87.1`

**Spike validation confirmed:**

- `--name world` → outputs "Hello world"
- `--help` → auto-generated help with colors
- `--version` → shows version
- Bonus: `--completions`, `--wizard`, `--log-level` built-in

**Commit message:** `feat(vex): add @effect/cli and @effect/platform-bun`

---

### Task 2: Create Schema Definitions

**Description:** Create shared schemas used by both CLI and config file validation.

**Files to create:**

- `vex/config/schema.ts`

**Schema definitions needed:**

```typescript
// Primitives
- Url: String matching /^https?:\/\/.+/
- DeviceId: Literal union of all 11 device names
- DeviceSpec: Union(DeviceId, Array(DeviceId))
- ProviderName: Literal('ollama', 'codex-cli', 'claude-cli', 'gemini-cli')
- ReasoningLevel: Literal('low', 'medium', 'high', 'xhigh')
- AutoFixThreshold: Literal('high', 'medium', 'none')
- PositiveInt: Number.pipe(int(), positive())

// Provider discriminated union
- OllamaProvider: { name: 'ollama', model?: string }
- CodexProvider: { name: 'codex-cli', model?: CodexModel, reasoning?: ReasoningLevel }
- ClaudeProvider: { name: 'claude-cli', model?: ClaudeModel }
- GeminiProvider: { name: 'gemini-cli', model?: string }
- ProviderSpec: Union of above

// Presets
- ScanPreset: { urls?, devices?, provider?, full?, placeholderMedia? }
- LoopPreset: { urls?, devices?, provider?, maxIterations?, autoFix?, dryRun?, placeholderMedia? }

// Root config
- VexConfig: { outputDir, scanPresets?, loopPresets? }
```

**Important:** Export both schemas AND derived TypeScript types:

```typescript
export const DeviceId = S.Literal(...);
export type DeviceId = S.Schema.Type<typeof DeviceId>;
```

**Verification:**

```bash
bunx tsc --noEmit
```

**Commit message:** `feat(vex): add Effect Schema definitions for config system`

---

### Task 3: Create Config Loader

**Description:** Create loader that imports `vex.config.ts` and validates with schema.

**Files to create:**

- `vex/config/loader.ts`
- `vex/config/index.ts`

**Loader requirements:**

1. Look for `vex.config.ts` in project root (use `findProjectRoot()` from existing `config.ts`)
2. Fallback to `.vexrc.json` for backwards compatibility
3. Validate loaded config with `VexConfig` schema
4. Return `Effect<VexConfig, ConfigError>`

**ConfigError type:**

```typescript
interface ConfigError {
  _tag: 'ConfigError';
  kind: 'not_found' | 'invalid_schema' | 'preset_not_found' | 'missing_required';
  message: string;
  path?: string; // File path that failed
  availablePresets?: string[]; // For preset_not_found errors
}
```

**Mandatory fields and their sources:**

| Field            | Sources (priority order)                                    | If all missing |
| ---------------- | ----------------------------------------------------------- | -------------- |
| `url`            | CLI arg > preset `urls`                                     | **Error**      |
| `outputDir`      | `--output` flag > `VEX_OUTPUT_DIR` env > config `outputDir` | **Error**      |
| `project` (loop) | `--project` flag only (never in preset)                     | **Error**      |

**Error handling behavior:**

| Scenario                                        | Behavior                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No config + `--output` provided + URL provided  | **Works.** Uses CLI values + defaults. No config needed.                                                                                      |
| No config + no `--output` + no `VEX_OUTPUT_DIR` | **Error:** "Output directory required. Use --output flag, set VEX_OUTPUT_DIR, or create vex.config.ts"                                        |
| No config + `--preset` used                     | **Error:** "Cannot use --preset: no vex.config.ts found."                                                                                     |
| Config exists but invalid schema                | **Error with details:** "Invalid config at vex.config.ts: scanPresets.quick.devices: Expected 'desktop-1920' \| ... but got 'invalid-device'" |
| `--preset foo` but `foo` doesn't exist          | **Error with suggestions:** "Unknown scan preset 'foo'. Available: quick, dev-full, responsive"                                               |
| No URL from CLI and preset has no `urls`        | **Error:** "URL required. Provide URL argument or add 'urls' to preset 'quick'."                                                              |

**Error message examples:**

```bash
# No config, but --output provided - works fine
$ vex scan https://example.com --output ./vex-output
Scanning https://example.com...

# No config, no --output - error
$ vex scan https://example.com
Error: Output directory required.
Use --output flag, set VEX_OUTPUT_DIR env var, or create vex.config.ts

# No config, with preset - clear error
$ vex scan https://example.com --preset quick
Error: Cannot use --preset: no vex.config.ts found.
Create a config file or remove the --preset flag.

# Invalid device in config
$ vex scan https://example.com --preset quick
Error: Invalid config at vex.config.ts
  scanPresets.quick.devices: Expected one of:
    'desktop-1920', 'desktop-b3ngous-arch', 'desktop-1366', 'desktop-hidpi',
    'iphone-15-pro-max', 'iphone-15-pro', 'iphone-se', 'pixel-7', 'galaxy-s24',
    'ipad-pro-11', 'galaxy-tab-s9'
  but got: 'desktop-999'

# Unknown preset
$ vex scan https://example.com --preset typo
Error: Unknown scan preset 'typo'.
Available presets: quick, dev-full, quick-mobile, responsive, site-pages

# Missing URL
$ vex scan --preset quick
Error: URL required.
Either provide a URL argument or add 'urls' field to preset 'quick'.
```

**Index.ts exports:**

```typescript
export { defineConfig } from './schema.js';
export type { VexConfig, ScanPreset, LoopPreset } from './schema.js';
export { loadConfig, type ConfigError } from './loader.js';
```

**Verification:**
Create a test `vex.config.ts`:

```typescript
import { defineConfig } from './vex/config/index.js';

export default defineConfig({
  outputDir: 'vex-output',
  scanPresets: {
    quick: {
      devices: 'desktop-1920',
      provider: { name: 'codex-cli', model: 'gpt-5.2', reasoning: 'low' },
    },
  },
});
```

Test loading:

```bash
bun -e "import { loadConfig } from './vex/config/index.js'; import { Effect } from 'effect'; Effect.runPromise(loadConfig(process.cwd())).then(console.log)"
```

**Commit message:** `feat(vex): add config loader with Effect Schema validation`

---

### Task 4: Create Shared CLI Options

**Description:** Define reusable CLI options that are shared across commands.

**Files to create:**

- `vex/cli/options.ts`

**Options to define:**

Shared across scan and loop:

```typescript
export const presetOption; // --preset, -p <name>
export const deviceOption; // --device, -d <id> (with DeviceId schema)
export const providerOption; // --provider <name> (with ProviderName schema)
export const modelOption; // --model, -M <name>
export const outputOption; // --output, -o <dir>
export const placeholderMediaOption; // --placeholder-media (boolean)
export const listDevicesOption; // --list-devices (boolean)
```

Scan-specific:

```typescript
export const reasoningOption; // --reasoning, -R <level> (with ReasoningLevel schema)
export const fullOption; // --full, -f (boolean)
```

Loop-specific:

```typescript
export const maxIterationsOption; // --max-iterations, -n <n> (with PositiveInt schema)
export const autoFixOption; // --auto-fix <level> (with AutoFixThreshold schema)
export const projectOption; // --project, -P <dir> (required, not optional)
export const dryRunOption; // --dry-run, -D (boolean)
```

**Pattern:**

```typescript
import { Options } from '@effect/cli';
import { DeviceId } from '../config/schema.js';

export const deviceOption = Options.text('device').pipe(
  Options.withAlias('d'),
  Options.withSchema(DeviceId),
  Options.withDescription('Device preset (e.g., desktop-1920, iphone-15-pro)'),
  Options.optional,
);
```

**Verification:**

```bash
bunx tsc --noEmit
```

**Commit message:** `feat(vex): add shared CLI options with Effect Schema validation`

---

### Task 5: Create Resolution Logic

**Description:** Implement the CLI override rule that merges CLI args with preset values.

**Files to create:**

- `vex/cli/resolve.ts`

**Resolution logic:**

```
For each field:
  1. CLI provided? → Use CLI value
  2. No CLI, preset has value? → Use preset value
  3. No preset? → Use default (or error if required)
```

**Types to define:**

```typescript
// Resolved options (all required fields filled, ready for execution)
export interface ResolvedScanOptions {
  urls: string[]; // At least one URL
  devices: string[]; // At least one device
  provider: string;
  model: string | undefined;
  reasoning: string | undefined;
  full: boolean;
  placeholderMedia: boolean;
  outputDir: string;
}

export interface ResolvedLoopOptions {
  urls: string[];
  devices: string[];
  provider: string;
  model: string | undefined;
  maxIterations: number;
  autoFix: 'high' | 'medium' | 'none';
  dryRun: boolean;
  placeholderMedia: boolean;
  outputDir: string;
  projectRoot: string;
}
```

**Functions:**

```typescript
export function resolveScanOptions(
  config: VexConfig,
  cliArgs: ScanCliArgs,
): Effect.Effect<ResolvedScanOptions, ConfigError>;

export function resolveLoopOptions(
  config: VexConfig,
  cliArgs: LoopCliArgs,
): Effect.Effect<ResolvedLoopOptions, ConfigError>;
```

**Defaults table:**
| Field | Default | Required? |
|-------|---------|-----------|
| urls | - | Yes (error if missing) |
| devices | 'desktop-1920' | No |
| provider | 'ollama' | No |
| model | undefined | No |
| reasoning | undefined | No |
| full | false | No |
| placeholderMedia | false | No |
| maxIterations | 5 | No |
| autoFix | 'high' | No |
| dryRun | false | No |
| outputDir | from config.outputDir | Yes |
| projectRoot | - | Yes (CLI only) |

**Verification:**
Write unit tests in `vex/cli/resolve.test.ts`:

- Test CLI overrides preset
- Test preset fills missing CLI values
- Test defaults when neither CLI nor preset
- Test error when required field missing

```bash
bun test vex/cli/resolve.test.ts
```

**Commit message:** `feat(vex): add CLI override resolution logic`

---

### Task 6: Create Skeleton CLI Entry Point

**Description:** Create the new @effect/cli entry point as a skeleton. Commands will be added incrementally as they're migrated.

**Files to create:**

- `vex/cli/index-effect.ts` (new entry point)

**Files to preserve:**

- `vex/cli/index.ts` (keep old entry working until migration complete)

**Skeleton structure:**

```typescript
import { Command } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';

// Commands will be imported and added here as they're migrated
// import { scanCommand } from './commands/scan.js';

const vexCommand = Command.make('vex').pipe(
  Command.withDescription('Visual extraction and analysis tool'),
  // Subcommands added incrementally:
  // Command.withSubcommands([scanCommand, ...]),
);

const cli = Command.run(vexCommand, {
  name: 'vex',
  version: '0.1.0',
});

Effect.suspend(() => cli(process.argv)).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
```

**Why index-effect.ts instead of replacing index.ts:**

- Old commands keep working via `bun vex/cli/index.ts`
- New commands testable via `bun vex/cli/index-effect.ts`
- No breaking changes during migration
- Swap at the end (Task 16)

**Verification:**

```bash
# New entry should show help (no commands yet)
bun vex/cli/index-effect.ts --help

# Old entry still works
bun vex/cli/index.ts scan --help
```

**Commit message:** `feat(vex): create skeleton @effect/cli entry point`

---

### Task 7: Migrate scan Command

**Description:** Rewrite scan command using @effect/cli and add to entry point.

**Files to modify:**

- `vex/cli/commands/scan.ts` (rewrite)
- `vex/cli/index-effect.ts` (add scanCommand)

**Files to backup (for reference, delete later):**

- Copy current content to `vex/cli-legacy/commands/scan.ts`

**After creating the command, add to index-effect.ts:**

```typescript
import { scanCommand } from './commands/scan.js';

const vexCommand = Command.make('vex').pipe(
  Command.withDescription('Visual extraction and analysis tool'),
  Command.withSubcommands([scanCommand]), // Add here
);
```

**Command structure:**

```typescript
import { Args, Command } from '@effect/cli';
import { urlArg, deviceOption, providerOption, ... } from '../options.js';
import { resolveScanOptions } from '../resolve.js';
import { loadConfig } from '../../config/index.js';

const urlArg = Args.text({ name: 'url' }).pipe(
  Args.withSchema(Url),
  Args.optional,  // Can come from preset
);

export const scanCommand = Command.make(
  'scan',
  {
    url: urlArg,
    preset: presetOption,
    device: deviceOption,
    provider: providerOption,
    model: modelOption,
    reasoning: reasoningOption,
    full: fullOption,
    placeholderMedia: placeholderMediaOption,
    output: outputOption,
    listDevices: listDevicesOption,
  },
  (args) => Effect.gen(function* () {
    if (args.listDevices) {
      listDevices();  // From vex/core/devices.ts
      return;
    }

    const config = yield* loadConfig(process.cwd());
    const resolved = yield* resolveScanOptions(config, args);

    // Existing pipeline logic from current scan.ts
    // Use resolved.urls, resolved.devices, etc.
  }),
).pipe(Command.withDescription('Capture and analyze a URL for visual issues'));
```

**Verification:**

Test via the new entry point (`index-effect.ts`):

```bash
# With URL only (need --output since no config yet)
bun vex/cli/index-effect.ts scan https://example.com --output ./vex-output

# With device
bun vex/cli/index-effect.ts scan https://example.com --device iphone-15-pro --output ./vex-output

# With preset (create vex.config.ts first)
bun vex/cli/index-effect.ts scan --preset quick

# URL overrides preset
bun vex/cli/index-effect.ts scan https://other.com --preset quick

# Full pipeline
bun vex/cli/index-effect.ts scan https://example.com --full --output ./vex-output

# List devices
bun vex/cli/index-effect.ts scan --list-devices

# Help
bun vex/cli/index-effect.ts scan --help

# Old entry still works (for comparison)
bun vex/cli/index.ts scan https://example.com
```

**Commit message:** `refactor(vex): migrate scan command to @effect/cli`

---

### Task 8: Migrate loop Command

**Description:** Rewrite loop command using @effect/cli.

**Files to modify:**

- `vex/cli/commands/loop.ts` (rewrite)

**Files to backup:**

- Copy current to `vex/cli-legacy/commands/loop.ts`

**Important notes:**

- `--project` is required (not optional, not in preset)
- `--interactive` flag exists but is disabled in Phase 1 (keep it, show warning if used)

**Verification:**

```bash
# Basic loop
bun vex/cli/index.ts loop https://example.com --project /path/to/repo

# With preset
bun vex/cli/index.ts loop --preset safe --project /path/to/repo

# Dry run
bun vex/cli/index.ts loop https://example.com --project . --dry-run --max-iterations 2

# Help
bun vex/cli/index.ts loop --help
```

**Commit message:** `refactor(vex): migrate loop command to @effect/cli`

---

### Task 9: Migrate providers Command

**Description:** Rewrite providers command using @effect/cli.

**Files to modify:**

- `vex/cli/commands/providers.ts` (rewrite)

**Simple command:**

```typescript
export const providersCommand = Command.make('providers', { json: jsonOption }, (args) =>
  Effect.gen(function* () {
    // Existing logic from current providers.ts
  }),
).pipe(Command.withDescription('List available VLM providers and models'));
```

**Verification:**

```bash
bun vex/cli/index.ts providers
bun vex/cli/index.ts providers --json
bun vex/cli/index.ts providers --help
```

**Commit message:** `refactor(vex): migrate providers command to @effect/cli`

---

### Task 10: Migrate analyze Command

**Description:** Rewrite analyze command using @effect/cli.

**Files to modify:**

- `vex/cli/commands/analyze.ts` (rewrite)

**Notes:**

- Takes image path as positional arg
- Simpler than scan (no config/preset integration needed initially)

**Verification:**

```bash
bun vex/cli/index.ts analyze /path/to/screenshot.png
bun vex/cli/index.ts analyze /path/to/screenshot.png --provider codex-cli
bun vex/cli/index.ts analyze --help
```

**Commit message:** `refactor(vex): migrate analyze command to @effect/cli`

---

### Task 11: Migrate locate Command

**Description:** Rewrite locate command using @effect/cli.

**Files to modify:**

- `vex/cli/commands/locate.ts` (rewrite)

**Notes:**

- Takes session directory as positional arg
- Has `--project`, `--patterns`, `--json` flags

**Verification:**

```bash
bun vex/cli/index.ts locate /path/to/session
bun vex/cli/index.ts locate /path/to/session --project /repo
bun vex/cli/index.ts locate --help
```

**Commit message:** `refactor(vex): migrate locate command to @effect/cli`

---

### Task 12: Migrate verify Command

**Description:** Rewrite verify command using @effect/cli.

**Files to modify:**

- `vex/cli/commands/verify.ts` (rewrite)

**Notes:**

- Takes session directory as positional arg
- Has `--baseline`, `--current`, `--json` flags

**Verification:**

```bash
bun vex/cli/index.ts verify /path/to/loop-session
bun vex/cli/index.ts verify /path/to/loop-session --baseline 0 --current 2
bun vex/cli/index.ts verify --help
```

**Commit message:** `refactor(vex): migrate verify command to @effect/cli`

---

### Task 13: Swap Entry Points

**Description:** Replace old CLI entry with the new @effect/cli entry. At this point, all commands have been migrated and added to `index-effect.ts`.

**Files to modify:**

- `vex/cli/index.ts` → rename to `vex/cli/index-legacy.ts` (backup)
- `vex/cli/index-effect.ts` → rename to `vex/cli/index.ts` (promote)

**Commands:**

```bash
mv vex/cli/index.ts vex/cli/index-legacy.ts
mv vex/cli/index-effect.ts vex/cli/index.ts
```

**Final structure of `vex/cli/index.ts`:**

```typescript
import { Command } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { scanCommand } from './commands/scan.js';
import { loopCommand } from './commands/loop.js';
import { providersCommand } from './commands/providers.js';
import { analyzeCommand } from './commands/analyze.js';
import { locateCommand } from './commands/locate.js';
import { verifyCommand } from './commands/verify.js';

const vexCommand = Command.make('vex').pipe(
  Command.withDescription('Visual extraction and analysis tool'),
  Command.withSubcommands([scanCommand, loopCommand, providersCommand, analyzeCommand, locateCommand, verifyCommand]),
);

const cli = Command.run(vexCommand, {
  name: 'vex',
  version: '0.1.0',
});

Effect.suspend(() => cli(process.argv)).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
```

**Verification:**

```bash
# All commands work via main entry
bun vex/cli/index.ts --help
bun vex/cli/index.ts --version
bun vex/cli/index.ts scan --help
bun vex/cli/index.ts loop --help
bun vex/cli/index.ts providers
bun vex/cli/index.ts analyze --help
bun vex/cli/index.ts locate --help
bun vex/cli/index.ts verify --help

# Typo suggestions
bun vex/cli/index.ts scna  # Should suggest 'scan'
```

**Commit message:** `refactor(vex): swap to @effect/cli entry point`

---

### Task 14: Create Example Config File

**Description:** Create a documented example `vex.config.ts` for users.

**Files to create:**

- `vex.config.example.ts`

**Content:**

```typescript
/**
 * Vex Configuration File
 *
 * This file defines presets for the vex CLI tool.
 * Copy this to `vex.config.ts` and customize.
 *
 * Usage:
 *   vex scan <url> --preset <name>
 *   vex loop <url> --preset <name> --project <path>
 */
import { defineConfig } from './vex/config/index.js';

export default defineConfig({
  // Required: where to save session output
  outputDir: 'vex-output',

  // Scan command presets
  scanPresets: {
    // Quick development testing (low reasoning, fast)
    quick: {
      devices: 'desktop-b3ngous-arch', // Your 1440x1248 setup
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
      full: false,
    },

    // Full dev test (high reasoning, annotated) - ACCEPTANCE TEST PRESET
    'dev-full': {
      devices: 'desktop-b3ngous-arch', // Your 1440x1248 setup
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'high',
      },
      full: true,
    },

    // Mobile quick check
    'quick-mobile': {
      devices: 'iphone-15-pro',
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
      full: false,
    },

    // Responsive audit (multiple devices)
    responsive: {
      devices: ['desktop-1920', 'iphone-15-pro', 'ipad-pro-11'],
      provider: {
        name: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      },
      full: true,
      placeholderMedia: true,
    },

    // Batch scan multiple pages
    'site-pages': {
      urls: ['https://example.com/', 'https://example.com/about', 'https://example.com/contact'],
      devices: ['desktop-1920', 'iphone-15-pro'],
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
    },
  },

  // Loop command presets
  loopPresets: {
    // Safe testing (no code changes)
    safe: {
      devices: 'desktop-1920',
      provider: {
        name: 'codex-cli',
        model: 'gpt-5.2',
        reasoning: 'low',
      },
      maxIterations: 3,
      autoFix: 'none',
      dryRun: true,
    },

    // Aggressive fixing
    aggressive: {
      devices: 'desktop-1920',
      provider: {
        name: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      },
      maxIterations: 10,
      autoFix: 'medium',
      dryRun: false,
    },
  },
});
```

**Verification:**

```bash
# Validate syntax
bunx tsc --noEmit vex.config.example.ts

# Copy and test
cp vex.config.example.ts vex.config.ts
bun vex/cli/index.ts scan --preset quick https://example.com
```

**Commit message:** `docs(vex): add example config file with documented presets`

---

### Task 15: Update Documentation

**Description:** Update CLAUDE.md and add user-facing docs.

**Files to modify:**

- `vex/CLAUDE.md` - Update usage examples
- `docs/README.md` - Add config section (if exists)

**CLAUDE.md updates:**

- Add config file section explaining `vex.config.ts`
- Update command examples to show `--preset` usage
- Document CLI override rule
- List available device IDs

**Commit message:** `docs(vex): update documentation for new config system`

---

### Task 16: Clean Up Legacy Code

**Description:** Remove backup files and old config code after verifying everything works.

**Files to delete:**

- `vex/cli-legacy/` directory (if created for backup)
- Old `.vexrc.json` loading code (if fully replaced)

**Pre-deletion verification:**

```bash
# Run all commands
bun vex/cli/index.ts scan --help
bun vex/cli/index.ts loop --help
bun vex/cli/index.ts providers
bun vex/cli/index.ts analyze --help
bun vex/cli/index.ts locate --help
bun vex/cli/index.ts verify --help

# Run actual scans
bun vex/cli/index.ts scan https://example.com --preset quick
bun vex/cli/index.ts scan https://example.com --device iphone-15-pro
```

**Commit message:** `chore(vex): remove legacy CLI code`

---

## Acceptance Test (Golden Reference)

The migration is complete when this command produces equivalent output to the reference session.

**Reference session:** `vex-output/20260131-1805-4ft5`

**Command (before migration):**

```bash
bun vex/cli/index.ts scan https://www.mpzinc.fr/pages/mathis-pierre \
  --device desktop-1920 \
  --provider codex-cli \
  --model gpt-5.2 \
  --reasoning high \
  --full
```

**Command (after migration, using preset):**

```bash
bun vex/cli/index.ts scan https://www.mpzinc.fr/pages/mathis-pierre --preset dev-full
```

Where `dev-full` preset in `vex.config.ts`:

```typescript
scanPresets: {
  'dev-full': {
    devices: 'desktop-1920',  // or 'desktop-b3ngous-arch' for 1440x1248
    provider: {
      name: 'codex-cli',
      model: 'gpt-5.2',
      reasoning: 'high',
    },
    full: true,
  },
}
```

**Expected output structure:**

```
vex-output/<session-id>/
├── state.json                          # Pipeline state with definition + artifacts
└── desktop-1920x1080/                  # Viewport subdirectory
    ├── 01-screenshot.png               # Raw capture
    ├── 02-dom.json                     # DOM snapshot
    ├── 03-with-folds.png               # Screenshot + fold lines
    ├── 04-with-grid.png                # Screenshot + grid overlay
    ├── 05-analysis.json                # VLM analysis with issues[]
    ├── 06-annotations.json             # Tool calls for rendering
    └── 07-annotated.png                # Final annotated screenshot
```

**05-analysis.json structure:**

```json
{
  "provider": "codex-cli",
  "model": "gpt-5.2-codex",
  "response": "{ \"issues\": [...] }",
  "durationMs": 18866,
  "issues": [
    {
      "id": 1,
      "description": "...",
      "severity": "high" | "medium" | "low",
      "region": "E1",           // Grid reference
      "suggestedFix": "..."
    }
  ]
}
```

**Verification checklist:**

- [ ] All 7 artifact files created in viewport subdirectory
- [ ] `state.json` contains pipeline definition + artifact references
- [ ] `05-analysis.json` has `provider`, `model`, `durationMs`, `issues[]`
- [ ] Issues have `id`, `description`, `severity`, `region`, `suggestedFix`
- [ ] `07-annotated.png` has visual annotations rendered
- [ ] Console output shows issues summary (same format as before)

---

## Testing Strategy

Each command migration should be tested with:

1. **No arguments** - Should show help or error appropriately
2. **--help flag** - Should display auto-generated help
3. **Required args only** - Minimal valid invocation
4. **All flags** - Every option exercised
5. **Invalid values** - Schema validation errors
6. **Preset usage** - Load from config, verify override rule
7. **CLI override** - Preset + CLI flag, verify CLI wins

---

## Rollback Plan

If issues are discovered:

1. Keep `vex/cli-legacy/` until Task 15
2. Can revert by restoring old `vex/cli/index.ts` and commands
3. Old `.vexrc.json` support can be re-enabled in loader

---

## Future Enhancements (Out of Scope)

These are noted but NOT part of this implementation:

1. **Custom viewport support** - Allow inline `{ width, height }` in devices field
2. **Global config** - `~/.vex/config.ts` for user-wide defaults
3. **Composable presets** - Building blocks that combine (Option C from design discussion)
4. **Environment-specific presets** - `presets.dev.quick` vs `presets.prod.quick`
5. **Config schema JSON export** - For IDE support without TS

---

## Dependencies

Existing:

- `effect` (already installed)

New:

- `@effect/cli`
- `@effect/platform-bun`

---

## Execution Strategy

**Critical insight:** The schema (Task 2) is the foundation. Everything derives from it. Do NOT delegate schema work.

### Task Ownership

| Owner                    | Tasks            | Rationale                                                             |
| ------------------------ | ---------------- | --------------------------------------------------------------------- |
| **Main Agent**           | 2, 3, 4, 5, 7, 8 | Schema, loader, options, resolve, scan, loop - contracts & core logic |
| **Subagent**             | 6                | Skeleton - tiny boilerplate                                           |
| **Subagents (parallel)** | 9, 10, 11, 12    | Simple commands - follow scan/loop pattern                            |
| **Main Agent**           | 13-16            | Finalization - needs oversight                                        |

### Recommended Execution Flow

```
PHASE 1: Foundation (Main Agent)
├── Task 2: Schema
├── Task 3: Loader
├── Task 4: Options  ← contracts, keep control
└── Task 5: Resolve
                                     │
                          Subagent: Task 6 (skeleton)

PHASE 2: Core Commands (Main Agent)
├── Task 7: scan command (establishes pattern)
└── Task 8: loop command

PHASE 3: Simple Commands (Subagents in parallel)
├── Task 9:  providers
├── Task 10: analyze
├── Task 11: locate
└── Task 12: verify

PHASE 4: Finalize (Main Agent)
├── Task 13: Swap entry points
├── Task 14: Example config
├── Task 15: Documentation
└── Task 16: Cleanup
```

### Checkpoints

After each phase, the system should be in a working state:

- **After Phase 1:** Old CLI still works, new infrastructure ready
- **After Phase 2:** Core commands work via `index-effect.ts`
- **After Phase 3:** All commands migrated
- **After Phase 4:** Migration complete

### Required Reading Per Phase

Before starting a phase, read these files to understand existing patterns. This prevents creating incompatible interfaces or breaking conventions.

**Phase 1 (Foundation):**

```
vex/providers/service.ts    # VisionProvider interface — understand the service pattern
vex/core/types.ts           # Artifact, Issue, DOMSnapshot — types your schemas must align with
vex/pipeline/presets.ts     # How options flow CLI → pipeline — your resolve.ts must output compatible shapes
vex/cli/commands/scan.ts    # Current CLI structure — understand what you're replacing
```

**Phase 2 (Core Commands):**

```
vex/config/schema.ts        # Your Phase 1 output — the contracts commands must use
vex/config/loader.ts        # How config is loaded — understand error types
vex/cli/options.ts          # Shared options — import these, don't recreate
vex/cli/resolve.ts          # Resolution logic — commands call this
```

**Phase 3 (Simple Commands):**

```
vex/cli/commands/scan.ts    # The reference pattern — follow this structure exactly
vex/cli/index-effect.ts     # Where to register your command
```

**Phase 4 (Finalize):**

```
vex/cli/index-effect.ts     # Verify all commands are wired
vex/cli/index.ts            # Old entry — will be replaced
vex/CLAUDE.md               # Documentation to update
```

---

## Estimated Task Order

```
Task 1  (deps)     ──┐
                     ├──▶ Task 2 (schema) ──▶ Task 3 (loader) ──┐
                     │                                          │
                     │    ┌─────────────────────────────────────┘
                     │    │
                     │    ▼
                     └──▶ Task 4 (options) ──▶ Task 5 (resolve) ──┐
                                                                   │
┌──────────────────────────────────────────────────────────────────┘
│
▼
Task 6 (skeleton CLI) ──▶ Task 7 (scan) ──▶ Task 8 (loop) ──▶ Task 9 (providers) ──┐
                                                                                     │
                         Task 10 (analyze) ──▶ Task 11 (locate) ──▶ Task 12 (verify) │
                                                                                     │
┌────────────────────────────────────────────────────────────────────────────────────┘
│
▼
Task 13 (swap entry) ──▶ Task 14 (example config) ──▶ Task 15 (docs) ──▶ Task 16 (cleanup)
```

Tasks 7-12 (command migrations) can be parallelized if working with multiple agents, since each command is independent. However, each must add itself to `index-effect.ts`.
