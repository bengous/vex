# vex - Visual Explorer

Visual analysis tool for web layouts with VLM-powered issue detection and iterative feedback loops.

## Usage

```bash
# CLI commands
bun vex/cli/index.ts scan <url>           # Capture and analyze URL
bun vex/cli/index.ts analyze <image>      # Analyze existing screenshot
bun vex/cli/index.ts locate <session>     # Find code for issues
bun vex/cli/index.ts loop <url>           # Iterative improvement (--dry-run for safe mode)
bun vex/cli/index.ts verify <session>     # Compare iterations

# Example: dry-run loop (no code changes)
bun vex/cli/index.ts loop https://example.com \
  --project /path/to/repo --max-iterations 2 --dry-run

# API usage (primary interface)
import { runPipeline, presets } from './vex/index.js';
```

## Architecture

```
vex/
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
└── cli/            # Command-line interface
    └── commands/   # scan, analyze, locate, loop, verify
```

## Key Patterns

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

- `effect` - Typed error handling
- `playwright` - Browser automation
- `sharp` - Image processing
- `bun` - Runtime + shell commands (ripgrep)

## Development

```bash
cd vex
bunx tsc --noEmit                    # Type check
bunx biome check --write .           # Lint + format
```

## Consolidation Note

vex consolidates functionality from:

- `scripts/design-audit/` - Screenshot capture, device presets, overlays
- `scripts/vision-audit/` - VLM integration, annotation system

The design-audit CLAUDE.md documents the legacy tool interface.
