# Task: Fix Grid Reference Hallucination in vex

## Context

vex is a visual analysis tool that captures web page screenshots, sends them to a VLM (Vision Language Model) for analysis, and maps detected issues back to source code locations.

The tool was recently consolidated from two separate tools (`design-audit` and `visual-audit`). During consolidation, a regression was introduced in the pipeline ordering.

## The Bug

**The VLM outputs grid cell references (e.g., "B14", "E22") that are hallucinated, not grounded in visual evidence.**

### Root Cause

1. The analysis prompt asks the VLM to provide issue locations using "grid cell references (A1-J99)"
2. The VLM receives an image with **no visible grid overlay**
3. The VLM complies with the prompt format by inventing plausible grid coordinates
4. Downstream, the `locate` command trusts these coordinates to map issues to code

### Why This Matters

The `locate` command uses `gridRefToCenter()` to convert grid refs like "B14" to pixel coordinates, then finds DOM elements at those positions. If "B14" is hallucinated:

- The pixel position is arbitrary
- The wrong DOM element is selected
- The wrong code file is identified
- **The entire locate → fix pipeline is compromised**

## Fact-Check Results (Confirmed)

The following was independently verified:

1. **Image passed to VLM**: The analyze operation receives `03-with-folds.png` (screenshot + fold lines only). No grid is visible.

2. **No grid in image**: Pixel-wise comparison of `01-screenshot.png` vs `03-with-folds.png` shows only horizontal fold lines at ~1080px intervals. No vertical grid lines exist.

3. **No code path shows grid to VLM**: In both `simpleAnalysis` and `fullAnnotation` pipelines, the `overlay-grid` operation runs AFTER `analyze`. The VLM never sees the grid.

4. **Grid references are hallucinated**: The analysis output contains regions like "B14", "E22" that cannot be grounded in visible grid labels because no grid was shown.

## Evidence Files

| File                                             | Purpose                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `vex/pipeline/presets.ts`                | Pipeline definitions showing grid runs after analyze               |
| `vex/pipeline/operations/analyze.ts`     | DEFAULT_PROMPT asking for grid refs                                |
| `vex/core/types.ts`                      | ARTIFACT_NAMES showing intended order (04-grid before 05-analysis) |
| `vex/locator/strategies/dom-tracer.ts`   | `gridRefToCenter()` function that trusts grid refs                 |
| `vex/docs/GRID-HALLUCINATION-FINDING.md` | Full investigation with code references                            |

## What Needs to Be Fixed

### Primary Fix

The VLM must see the grid overlay before being asked to provide grid cell references.

**Current pipeline flow:**

```
capture → folds → analyze → grid → ...
                    ↑
              VLM sees no grid
```

**Required pipeline flow:**

```
capture → folds → grid → analyze → ...
                           ↑
                    VLM sees labeled grid
```

### Pipelines to Fix

1. `simpleAnalysis` - used by `scan` command
2. `fullAnnotation` - used for full annotation rendering

### Verification

After the fix:

1. Run `vex scan` on any URL
2. Confirm `04-with-grid.png` is created BEFORE `05-analysis.json`
3. Open `04-with-grid.png` and verify A1-J99 grid labels are visible
4. Check that grid references in analysis output correspond to visible grid cells

## Out of Scope

- Artifact naming/numbering scheme changes (current scheme is fine)
- New features or pipelines
- Changes to the `locate` command (it correctly handles grid refs, just needs accurate input)

## Notes

- The artifact numbering `04-with-grid` before `05-analysis` suggests the original intent was correct; the pipeline wiring is what's wrong
- VLMs are good at reading labeled grids but bad at pixel/spatial reasoning - this is why the grid overlay strategy exists
- The consolidation from `design-audit` + `visual-audit` into `vex` likely caused this regression
