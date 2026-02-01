# vex - Visual Explorer

Visual analysis tool for web layouts with VLM-powered issue detection and iterative feedback loops.

## Usage

```bash
# CLI commands (use --help for full options)
bun vex/cli/index.ts scan <url>           # Capture and analyze URL
bun vex/cli/index.ts analyze <image>      # Analyze existing screenshot
bun vex/cli/index.ts locate <session>     # Find code for issues
bun vex/cli/index.ts loop <url>           # Iterative improvement (--dry-run for safe mode)
bun vex/cli/index.ts verify <session>     # Compare iterations
bun vex/cli/index.ts providers            # List available VLM providers

# With presets (from vex.config.ts)
bun vex/cli/index.ts scan <url> --preset quick
bun vex/cli/index.ts loop <url> --preset safe --project .

# Direct options (override preset or use without config)
bun vex/cli/index.ts scan <url> --device iphone-15-pro --provider codex-cli --reasoning low
bun vex/cli/index.ts loop <url> --project . --max-iterations 3 --dry-run

# API usage (primary interface)
import { runPipeline, presets } from './vex/index.js';
```

## Configuration

Create `vex.config.ts` from the example:

```bash
cp vex.config.example.ts vex.config.ts
```

```typescript
// vex.config.ts
import { defineConfig } from './vex/config/index.js';

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
vex/
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
├── providers/      # VLM backends
│   ├── ollama.ts   # Local Ollama
│   ├── claude-cli.ts, codex-cli.ts, gemini-cli.ts
│   └── registry.ts # Provider registration
│
└── cli/            # @effect/cli based interface
    ├── commands/   # scan, analyze, locate, loop, verify, providers
    ├── options.ts  # Shared CLI options with schema validation
    ├── resolve.ts  # Merge CLI args + preset + defaults
    └── index.ts    # Entry point (run with bun)
```

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

**Artifact system:** All operations produce typed artifacts (image, analysis, dom-snapshot) stored in session directories.

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

## Development

```bash
bunx tsc --noEmit                    # Type check
bunx biome check --write .           # Lint + format

# Test CLI help
bun vex/cli/index.ts --help
bun vex/cli/index.ts scan --help

# Test with preset
bun vex/cli/index.ts scan <url> --preset quick

# Test with direct options
bun vex/cli/index.ts scan <url> --provider codex-cli --model gpt-5.2 --reasoning low
bun vex/cli/index.ts scan <url> --device iphone-15-pro --placeholder-media

# List available providers
bun vex/cli/index.ts providers --json
```

## Consolidation Note

vex consolidates functionality from:

- `scripts/design-audit/` - Screenshot capture, device presets, overlays
- `scripts/vision-audit/` - VLM integration, annotation system

The design-audit CLAUDE.md documents the legacy tool interface.
