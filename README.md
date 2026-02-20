# vex - Visual Explorer

Visual analysis tool for web layouts with VLM-powered issue detection and iterative feedback loops.

## Quick Start

```bash
bun install
bun vex scan <url>
bun vex --help
```

## Configuration

```bash
cp vex.config.example.ts vex.config.ts
```

```typescript
import { defineConfig } from './src/config/index.js';

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

## Commands

| Command | Description |
|---------|-------------|
| `vex scan <url>` | Capture and analyze a URL |
| `vex analyze <image>` | Analyze an existing screenshot |
| `vex locate <session>` | Find code locations for detected issues |
| `vex loop <url>` | Run iterative improvement loop |
| `vex verify <session>` | Compare iterations in a session |
| `vex providers` | List available VLM providers |

## Architecture

See [src/CLAUDE.md](src/CLAUDE.md) for detailed architecture, patterns, and development guide.

## Development

```bash
bun run typecheck    # Type check
bun run lint         # Biome lint
bun run test         # Unit tests
bun run test:e2e     # E2E tests (requires VLM auth)
```

### E2E Smoke (Gemini CLI preset)

Run the dedicated smoke test for CLI preset flow with `gemini-cli` + `gemini-2.5-flash-lite`:

```bash
RUN_E2E=1 bun test src/e2e/cli-gemini-smoke.e2e.test.ts
```

## License

Private
