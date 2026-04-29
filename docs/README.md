# VEX Documentation

These docs are organized around what a person wants to do with VEX.

The root [README](../README.md) explains the product: VEX exists to show where device viewports cut a page, so broken responsive folds are easier to see and fix. This folder explains the main workflows. Technical architecture and implementation notes live elsewhere.

## Human Docs

- [Getting Started](GETTING-STARTED.md) - run a first useful audit.
- [Capture-Only Workflow](CAPTURE-ONLY.md) - capture screenshots, fold lines, and grids without calling an AI provider.
- [Reading Audit Output](READING-AUDIT-OUTPUT.md) - understand the files VEX creates.
- [Mobile Captures](MOBILE-CAPTURES.md) - use phone presets, folds, and sticky-aware fold markers.
- [AI Analysis](AI-ANALYSIS.md) - understand the optional AI direction without treating it as the only workflow.

## Technical Docs

- [Technical Docs Map](TECHNICAL-DOCS.md) - where agents and maintainers should look for architecture, implementation notes, and research logs.

## Writing Rule

Human docs explain outcomes, workflows, and how to read results. They should not become stack documentation. If a section mostly explains internal code, move it to the technical docs.
