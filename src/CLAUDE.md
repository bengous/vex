# vex - Visual Explorer

Visual analysis tool for web layouts with VLM-powered issue detection and iterative feedback loops.

## Usage

```bash
# CLI commands (use --help for full options)
bun src/cli/index.ts scan <url>           # Capture and analyze URL
bun src/cli/index.ts analyze <image>      # Analyze existing screenshot
bun src/cli/index.ts locate <session>     # Find code for issues
bun src/cli/index.ts loop <url>           # Iterative improvement (--dry-run for safe mode)
bun src/cli/index.ts verify <session>     # Compare iterations
bun src/cli/index.ts providers            # List available VLM providers

# With presets (from vex.config.ts)
bun src/cli/index.ts scan <url> --preset quick
bun src/cli/index.ts loop <url> --preset safe --project .

# Direct options (override preset or use without config)
bun src/cli/index.ts scan <url> --device iphone-15-pro --provider codex-cli --reasoning low
bun src/cli/index.ts loop <url> --project . --max-iterations 3 --dry-run

# API usage (primary interface)
import { runPipeline, presets } from './src/index.js';
```

## Configuration

Create `vex.config.ts` from the example:

```bash
cp vex.config.example.ts vex.config.ts
```

```typescript
// vex.config.ts
import { defineConfig } from './src/config/index.js';

export default defineConfig({
  outputDir: 'vex-output',
  scanPresets: {
    quick: {
      devices: 'desktop-1920',
      provider: { name: 'codex-cli', model: 'gpt-5.2', reasoning: 'low' },
    },
  },
  loopPresets: {
    safe: {
      devices: 'desktop-1920',
      maxIterations: 3,
      autoFix: 'none',
      dryRun: true,
    },
  },
});
```

**CLI override rule:** CLI flag > preset value > default

## Architecture

```
src/
├── config/         # Configuration and schema
│   ├── schema.ts   # Effect Schema definitions (DeviceId, ProviderSpec, presets)
│   ├── loader.ts   # Load vex.config.ts with validation
│   └── index.ts    # Public exports, defineConfig()
│
├── core/           # Layer 0: Pure functions
│   ├── types.ts    # Unified types (Artifact, Issue, DOMSnapshot, etc.)
│   ├── capture.ts  # Playwright screenshot + DOM capture
│   └── overlays.ts # Grid overlay, fold lines, annotation rendering
│
├── pipeline/       # Layer 1: Composable operations
│   ├── operations/ # 7 atomic ops (capture, overlay-*, analyze, annotate, render, diff)
│   ├── runtime.ts  # DAG executor with topological ordering
│   ├── state.ts    # Session persistence, artifact storage
│   └── presets.ts  # simpleAnalysis, fullAnnotation, responsiveComparison
│
├── locator/        # Layer 2: Code location
│   ├── strategies/ # DOM tracer (element→selector→grep)
│   ├── resolver.ts # Strategy coordination, deduplication
│   └── types.ts    # LocatorStrategy, CodeLocation, confidence
│
├── loop/           # Layer 3: Feedback orchestration
│   ├── orchestrator.ts  # capture→analyze→locate→fix→verify cycle
│   ├── gates.ts    # Human-in-the-loop decision matrix
│   ├── verify.ts   # Regression detection
│   └── metrics.ts  # Iteration tracking
│
├── providers/      # VLM backends (directory-per-provider)
│   ├── codex-cli/  # index.ts + config.toml (colocated via CODEX_HOME)
│   ├── claude-cli/, gemini-cli/, ollama/
│   ├── shared/     # cli-factory, subprocess, service, registry, introspection
│   └── index.ts    # Re-exports shared, imports providers for registration
│
└── cli/            # @effect/cli based interface
    ├── commands/   # scan, analyze, locate, loop, verify, providers
    ├── options.ts  # Shared CLI options with schema validation
    ├── resolve.ts  # Merge CLI args + preset + defaults
    └── index.ts    # Entry point (run with bun)
```

## Type Architecture

- **Single source of truth**: Types with runtime validation live in `core/schema.ts` (Effect Schema)
- **Re-export pattern**: `core/types.ts` re-exports schema types; don't duplicate definitions

## Key Patterns

**Options flow (CLI → Core):**

```
CLI (@effect/cli) → resolve.ts (merge preset) → ResolvedOptions → pipeline → core
```

When adding CLI flags:

1. Add option in `cli/options.ts` with schema validation
2. Add to command in `cli/commands/*.ts`
3. Add to preset schema in `config/schema.ts`
4. Add merge logic in `cli/resolve.ts`
5. Pass through pipeline and core layers

**Effect.ts for error handling:**

```typescript
function operation(input): Effect.Effect<Output, MyError> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({ try: () => asyncOp(), catch: makeError });
    return result;
  });
}
```

**Tagged errors for pattern matching:**

```typescript
interface MyError {
  readonly _tag: 'MyError';
  readonly message: string;
}
```

**Type narrowing with TaggedError:** TypeScript correctly narrows `Data.TaggedError` unions via `'_tag' in x` - no `as` casts needed. Use `Predicate.isTagged(tag)` for explicit guards when matching specific tags.

**Optional service injection:** Use `Effect.serviceOption(Tag)` when a service may or may not be provided. Returns `Option<Service>` - gracefully handles absence without requiring the service in the type signature.

**Scoped resources vs Layers:** `acquireRelease` returns `Effect<A, E, Scope>` - return the service directly, not wrapped in Layer. Use Layer only for app-wide singletons shared across the dependency graph. Per-invocation resources (like `CodexEnv`) should return the service directly and callers use `Effect.provideService`.

**Effect TaggedError messages:** `Data.TaggedError` provides "An error has occurred" by default. Add `override get message(): string` getter for useful CLI error output. When using a message getter, name the inner field `detail`, `reason`, or similar (not `message`) to avoid getter recursion. See `ProfileNotFoundError` in `providers/shared/errors.ts` and `OperationError` in `pipeline/types.ts` for examples.

**Artifact system:** All operations produce typed artifacts (image, analysis, dom-snapshot) stored in session directories.

**Effect service requirements in interfaces:** If a callback implementation needs a service (e.g., `FileSystem`), declare it in the interface's Effect return type. Type assertions to hide requirements are a code smell - either be honest about dependencies or restructure so the callback doesn't need the service.

**Config option evolution pattern:** When upgrading a boolean config option to support detailed options:

1. Schema: `FooSpec = S.Union(S.Boolean, FooConfig)` - accept both forms
2. Resolve: `normalizeFoo(cli, preset)` → `ResolvedFoo | undefined` - merge with defaults
3. Runtime: Pass resolved type directly to core (no defaults at call sites)

Type naming convention to avoid collisions across layers:

- `*Config` - schema input type (user-facing, partial fields)
- `*Spec` - union of boolean | config (schema)
- `Resolved*` - fully populated after CLI resolution
- `*Options` - core runtime type (internal, all fields required)

## DOM Tracer Algorithm

The core innovation for mapping visual issues to code:

1. **Find element** at issue.region position in DOMSnapshot
2. **Build selectors** from element (id, classes, data-\*, tag+class)
3. **Grep codebase** for selectors in CSS/HTML/Liquid files
4. **Return CodeLocation[]** with confidence scores (high/medium/low)

## Gate Decision Matrix

Human-in-the-loop controls based on confidence × severity × scope:

| Confidence | Severity | Scope       | Action       |
| ---------- | -------- | ----------- | ------------ |
| High       | Any      | Single file | auto-fix     |
| Medium     | Low/Med  | Single file | auto-fix     |
| Medium     | High     | Any         | human-review |
| Low        | Any      | Any         | human-review |
| Any        | Any      | Multi-file  | human-review |

## Dependencies

- `effect` - Typed error handling, Effect Schema validation
- `@effect/cli` - CLI parsing with schema validation
- `@effect/platform-bun` - Bun runtime integration
- `playwright` - Browser automation
- `sharp` - Image processing
- `bun` - Runtime + shell commands (ripgrep)

## Known Issues

**@effect/platform subprocess constraints:** `providers/subprocess.ts` uses `@effect/platform` Command module. Critical patterns:

- Drain stdout/stderr in parallel (sequential can deadlock if buffer fills)
- Read `exitCode` AFTER streams complete (concurrent read hangs in Bun)
- Don't capture `CommandExecutor` at layer construction - provide `BunContext.layer` where layer is composed

**Codex MCP startup overhead:** User codex configs with MCPs add 30-60s per call. Solved via colocated `config.toml` in `providers/codex-cli/` with CODEX_HOME env var (set by `buildEnv` in CliProviderConfig).

**Provider initialization:** Providers self-register via `registerProvider()` at import time. `src/providers/init.ts` centralizes these side-effect imports. CLI entry (`cli/index.ts`) imports init.ts once. The `sideEffects` field in package.json marks this file for bundlers.

**Import patterns:** Internal modules use leaf imports directly (no barrels):

- ✅ `import { CodexEnv } from '../codex-cli/environment.js'`
- ✅ `import { VisionProvider } from '../providers/shared/service.js'`
- ❌ `import { ... } from '../providers/index.js'` (barrel files removed)

Public API: External consumers import from `src/index.ts` only.

**Effect Schema re-exports:** When a module exports both `const Foo = S.Literal(...)` and `type Foo = S.Schema.Type<typeof Foo>`, re-exporting just the value (`export { Foo }`) automatically includes the type. No need for separate `export type { Foo as FooType }`.

**@effect/platform HttpClient patterns:** When using HttpClient for HTTP providers:

- Use typed schemas with `HttpClientResponse.schemaBodyJson(MySchema)` - avoid `Schema.Unknown`
- Use `Effect.catchTags({ TimeoutException, RequestError, ResponseError, ParseError })` for error handling
- API names differ from some docs: `bodyUnsafeJson` (not `jsonBody`), `schemaBodyJson` (not `json`)
- `HttpClient.filterStatusOk` wraps client to fail on non-2xx → produces `ResponseError`
- Self-contained layers: use `.pipe(Layer.provide(FetchHttpClient.layer))` instead of modifying CLI entry

## External Tool Integration

When modifying integration with external CLIs (codex, claude, etc.):

1. Fetch official documentation first - do not guess from error messages
2. Add `LLM:` prefixed comments with doc links for future agents
3. Test with actual CLI before assuming error messages are accurate

## Development

```bash
bunx tsc --noEmit                    # Type check
bunx biome check --write .           # Lint + format
bun test                             # Run all tests
bun test src/                        # Run vex tests only
bun test --watch                     # Watch mode

# Debug subprocess issues - logs are in providers/subprocess.ts
# Look for [subprocess] prefixed console.log statements

# Test CLI help
bun src/cli/index.ts --help
bun src/cli/index.ts scan --help

# Test with preset
bun src/cli/index.ts scan <url> --preset quick

# Test with direct options
bun src/cli/index.ts scan <url> --provider codex-cli --model gpt-5.2 --reasoning low
bun src/cli/index.ts scan <url> --device iphone-15-pro --placeholder-media

# List available providers
bun src/cli/index.ts providers --json
```

## E2E Test Setup

The E2E test (`src/e2e/pipeline.e2e.test.ts`) exercises the full pipeline with real VLM providers. It requires codex-cli authentication:

```bash
# Symlink your codex auth to the provider directory
ln -sf ~/.codex/auth.json src/providers/codex-cli/auth.json

# Run E2E test
bun test src/e2e/
```

**Why symlink?** The codex-cli provider uses `CODEX_HOME` override to disable MCPs (faster execution). This loses access to `~/.codex/auth.json`, so we symlink it.

**TODO:** Find a cleaner auth strategy that doesn't require manual symlink setup.

## Testing Patterns

**Type narrowing with node:assert:** Use `node:assert` for type narrowing instead of non-null assertions (`!`) or `as` casts. Bun fully supports Node's standard library, so mixing `bun:test` with `node:assert` is idiomatic:

```typescript
import { expect, test } from 'bun:test';
import assert from 'node:assert';

let captured: string | undefined;
// ... effect that sets captured ...
assert(captured); // narrows to string, throws if undefined
expect(existsSync(captured)).toBe(false); // no cast needed
```

**Test helpers with ManagedRuntime:** Use `ManagedRuntime.make(BunContext.layer)` for test helpers instead of `any` type parameters. See `src/testing/effect-helpers.ts` - provides type safety and runtime reuse across tests.

**Fixture factories with spread overrides:**

```typescript
function createIssue(overrides: Partial<Issue> = {}): Issue {
  return { id: 1, description: 'Test', severity: 'medium', ...overrides };
}
// Usage: createIssue({ severity: 'high' })
```

**Mock callback factories:**

```typescript
const createMockCallbacks = (): LoopCallbacks => ({
  onIterationStart: mock(() => Effect.void),
  onIterationComplete: mock(() => Effect.void),
});
```

**Parameterized tests with test.each:**

```typescript
type MatrixCase = [Confidence, Severity, boolean, GateAction];
const cases: MatrixCase[] = [['high', 'low', true, 'auto-fix'], ...];
test.each(cases)('conf=%s, sev=%s → %s', (conf, sev, single, expected) => { ... });
```

**Effect error path testing:**

```typescript
const exit = await runEffectExit(program);
const error = expectOperationFailure(exit, 'operationName');
expect(error.detail).toContain('expected message');
```

**Mock provider cleanup:** Call `unregisterProvider(name)` in `afterAll` to prevent registry pollution. See `analyze.test.ts` for pattern.

**Temp fixtures for grep integration tests:** Use `mkdtempSync` for unique directories - guarantees uniqueness via OS-level random suffix, avoiding `Date.now()` collision risk in parallel tests.

```typescript
const tempDir = mkdtempSync(join(tmpdir(), 'test-'));
writeFileSync(join(tempDir, 'test.liquid'), '<div class="hero">');
// Cleanup in afterEach or afterAll
```

**Section separators for readability:**

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════
```

**Export pure functions for unit testing:** When a module has complex internal logic, export helpers for direct testing (see `dom-tracer.ts`).

## Learning Resources

- **[docs/EFFECT-PATTERNS.md](docs/EFFECT-PATTERNS.md)** - Comprehensive guide to Effect.js patterns used in this codebase with ASCII diagrams and real examples

## Origin

vex was originally developed within the shopify-mpzinc project, consolidating:

- `scripts/design-audit/` - Screenshot capture, device presets, overlays
- `scripts/vision-audit/` - VLM integration, annotation system

