# Getting Started

VEX is useful as soon as it can show where a device cuts the page. Start with a screenshot, fold markers, and a grid overlay before adding AI analysis.

## Install

```bash
bun install
```

## Create A Capture Preset

Copy the example config:

```bash
cp vex.config.example.ts vex.config.ts
```

Add a small capture-only preset:

```typescript
import { defineConfig } from "./src/config/index.js";

export default defineConfig({
  outputDir: "vex-output",
  scanPresets: {
    capture: {
      urls: ["https://example.com"],
      devices: ["desktop-1920", "iphone-14-pro-max"],
      mode: "capture-only",
      foldOcclusion: true,
    },
  },
});
```

## Run It

```bash
bun src/cli/index.ts scan --preset capture
```

VEX creates an audit folder under `vex-output`. Open the page/device folder and start with:

- `01-screenshot.png` - clean full-page capture.
- `03-with-folds.png` - red viewport fold markers, useful for seeing cut buttons, awkward text breaks, and first-screen rhythm.
- `04-with-grid.png` - grid overlay for pointing to visual regions.

## Next

- Use [Capture-Only Workflow](CAPTURE-ONLY.md) when you only need screenshots and visual review artifacts.
- Use [Reading Audit Output](READING-AUDIT-OUTPUT.md) when you want to understand the generated folders.
- Use [Mobile Captures](MOBILE-CAPTURES.md) when phone folds need to match physical-device expectations.
- Use [AI Analysis](AI-ANALYSIS.md) when you want to experiment with model-assisted review.
