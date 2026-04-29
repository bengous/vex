# AI Analysis

AI analysis is optional in VEX.

The most exercised workflow today is capture-only: collect screenshots, fold markers, grids, and audit folders. AI-assisted review is the product direction, especially for detecting suspicious viewport cuts automatically, but it should not be treated as the only way to use VEX.

## When To Use It

Use AI analysis when you want a model to inspect visual evidence and produce issue candidates.

Do not use it as a substitute for checking the screenshot yourself. Treat model output as review assistance, not truth.

Good future targets for AI review:

- a fold cuts through a CTA;
- a text block is split in a way that harms reading;
- a sticky header consumes too much repeated viewport space;
- a section rhythm works on one phone size but breaks on another;
- a responsive tweak improves one device and regresses another.

## Basic Scan

```bash
bun src/cli/index.ts scan https://example.com --provider codex-cli --model gpt-5.4 --reasoning low
```

For a fuller pipeline:

```bash
bun src/cli/index.ts scan https://example.com --provider codex-cli --model gpt-5.4 --full
```

## What Changes Compared To Capture-Only

AI-enabled scans can add:

- `05-analysis.json` - model-generated issue candidates;
- annotated images when the full pipeline is enabled;
- locate/loop workflows that connect visual findings back to source files.

## Product Stance

The AI layer should help interpret evidence that VEX already captured. It should not hide the artifacts. The screenshot, folds, grid, DOM snapshot, and audit metadata remain the review baseline.

If a model finding disagrees with the visual artifact, trust the artifact first.
