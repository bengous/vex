# Changelog

All notable changes to vex are documented here.

<!--
## For AI Agents: How to Update This File

This changelog follows [Keep a Changelog](https://keepachangelog.com/) conventions.
It is append-only and linear—never rewrite history, only add new entries.

### Structure

```
## [Unreleased]        ← Work in progress (always at top)
## [X.Y.Z] - YYYY-MM-DD ← Released versions (newest first)
```

### Categories (use only what applies)

- **Added** - New features
- **Changed** - Changes to existing functionality
- **Fixed** - Bug fixes
- **Removed** - Removed features
- **Deprecated** - Soon-to-be removed features
- **Security** - Vulnerability fixes

### Entry Format

```markdown
- **Feature name** (`affected-file` or `command`) - Brief description
  - Sub-bullet for implementation details if needed
```

### Rules

1. **Always add to [Unreleased]** - Never create new version sections
2. **One entry per logical change** - Group related sub-changes as bullets
3. **Start with verb** - "Add", "Fix", "Change", "Remove" (not "Added")
4. **Be specific** - Name files, commands, flags affected
5. **No commit hashes** - The git log has those

### When Releasing

Human maintainer moves [Unreleased] content to a new version section:
```markdown
## [Unreleased]
(empty or new work)

## [0.2.0] - 2026-02-15
(moved from Unreleased)
```
-->

## [Unreleased]

### Added

- **Loop command Phase 1** (`vex loop`) - Wire CLI to LoopOrchestrator
  - Capture callback using `simpleAnalysis` pipeline preset
  - Machine-readable `iterations.json` with `phase: 1` tracking
  - `state.json` compatibility for `vex verify` integration
  - Progress logging with per-iteration summaries
  - Final summary with status, issue count progression, session path

- **LoopOptions.dryRun** field added to `loop/types.ts`

### Changed

- **Loop command: flat directory structure** - Each pipeline session IS the iteration
  directory. No more double-nesting (`iteration-0/<timestamp>/` → just `<timestamp>/`)

- **Loop command: config resolution** - Now uses `loadConfig()` like scan command,
  respecting `VEX_OUTPUT_DIR` and `.vexrc.json` instead of hardcoded `vex-output`

- **Loop command: Phase 1 enforcement** - `--dry-run` and `--interactive` flags are
  accepted but ignored; Phase 1 always runs in dry-run mode with interactive disabled.
  Clear `[Phase 1]` log messages explain this behavior.

- Updated CLAUDE.md to reflect loop command is now implemented

## [0.1.0] - 2026-01-31

### Added

- Initial vex architecture with 4-layer design:
  - **Layer 0 (core)**: Pure functions for capture, overlays, types
  - **Layer 1 (pipeline)**: DAG-based operation composition with presets
  - **Layer 2 (locator)**: DOM tracer strategy for mapping visual issues to code
  - **Layer 3 (loop)**: LoopOrchestrator with gate decision matrix

- Pipeline operations: capture, overlay-folds, overlay-grid, analyze, annotate, render, diff

- VLM providers: ollama, claude-cli, codex-cli, gemini-cli

- CLI commands (initial implementations): scan, analyze, locate, verify

- Effect.ts error handling throughout
