# Investigation: VLM Grid Reference Hallucination in vex

## Summary

The vex tool's VLM analysis outputs grid cell references (e.g., "B14", "E22") that appear to be hallucinated rather than derived from visual evidence. The VLM never sees a grid overlay during analysis, yet the prompt instructs it to provide grid cell references.

## Evidence

### 1. Analysis Output Contains Grid References

From `vex-output/20260131-1717-wzlz/desktop-1920x1080/05-analysis.json`:

```json
{
  "issues": [
    {
      "id": 1,
      "description": "Bright red horizontal divider lines...",
      "severity": "high",
      "region": "B14",
      "suggestedFix": "..."
    },
    {
      "id": 2,
      "description": "Layout appears to keep a two-column structure...",
      "severity": "high",
      "region": "E22",
      "suggestedFix": "..."
    }
  ]
}
```

### 2. Artifacts Produced by simpleAnalysis Pipeline

```
vex-output/20260131-1717-wzlz/desktop-1920x1080/
├── 01-screenshot.png      # Raw screenshot
├── 02-dom.json            # DOM snapshot
├── 03-with-folds.png      # Screenshot + red fold lines
├── (04-with-grid.png)     # MISSING - grid overlay not produced
└── 05-analysis.json       # Analysis with grid references
```

### 3. The Prompt Asks for Grid References

From `vex/pipeline/operations/analyze.ts:30-49`:

```typescript
const DEFAULT_PROMPT = `Analyze this web page screenshot for visual and layout issues.

For each issue found, provide:
1. A clear description of the problem
2. The severity (high, medium, low)
3. The approximate location using grid cell references (A1-J99) or pixel coordinates
4. A suggested fix
...`;
```

### 4. simpleAnalysis Pipeline Flow

From `vex/pipeline/presets.ts:11-50`:

```
simpleAnalysis: capture → overlay-folds → analyze
```

The analyze operation receives `03-with-folds.png` as input. No grid overlay is ever shown to the VLM.

### 5. fullAnnotation Pipeline Flow

From `vex/pipeline/presets.ts:54-119`:

```
fullAnnotation: capture → folds → analyze → grid → annotate → render
                                    ↑         ↑
                              VLM sees this   Grid added AFTER analysis
```

Even in the full pipeline, the grid overlay (`overlay-grid` operation) happens **after** the analyze step. The grid is used for rendering annotations, not for VLM input.

### 6. ARTIFACT_NAMES Shows Intended Order

From `vex/core/types.ts:405-414`:

```typescript
export const ARTIFACT_NAMES = {
  screenshot: '01-screenshot.png',
  dom: '02-dom.json',
  withFolds: '03-with-folds.png',
  withGrid: '04-with-grid.png', // Numbered BEFORE analysis
  analysis: '05-analysis.json',
  // ...
} as const;
```

The numbering suggests the original intent was for grid (04) to precede analysis (05), but the pipeline doesn't implement this order.

---

## Questions for Fact-Check

1. **Confirm the analyze operation input**: What image file path is actually passed to the VLM in the `simpleAnalysis` pipeline? Trace from `scan.ts` → `simpleAnalysis()` → `analyzeOperation.execute()` → `visionProvider.analyze()`.

2. **Confirm no grid is visible**: Open `vex-output/20260131-1717-wzlz/desktop-1920x1080/03-with-folds.png` and verify it contains only fold lines, not a labeled A1-J99 grid.

3. **Check if grid could be rendered elsewhere**: Is there any code path where the grid overlay is applied to the image before analysis? Search for `overlay-grid` usage.

4. **Verify the pipeline edge connections**: In `simpleAnalysis`, what artifact flows from `folds` node to `analyze` node? Check the `edges` array.

5. **Check fullAnnotation more carefully**: Does the analyze node in fullAnnotation receive a different input than simpleAnalysis? Or do both receive `image-with-folds`?

---

## Expected Conclusion

If confirmed, the VLM is hallucinating grid cell references because:

1. The prompt explicitly asks for "grid cell references (A1-J99)"
2. The VLM receives an image with NO visible grid
3. The VLM complies with the prompt format by inventing plausible grid coordinates

This is problematic because:

- Grid references are meaningless without a grid
- The `locate` command may rely on these coordinates for code location
- Users may trust these coordinates as accurate

---

## Proposed Fix (if confirmed)

**Option A: Add grid before analyze**

Reorder `simpleAnalysis` to: `capture → folds → grid → analyze`

The VLM would then see the labeled grid and provide accurate cell references.

**Option B: Change prompt for non-grid pipelines**

Create two prompts:

- `PROMPT_WITH_GRID`: Asks for grid cell references
- `PROMPT_NO_GRID`: Asks for pixel coordinates or descriptive regions only

Use the appropriate prompt based on whether grid overlay is in the pipeline.

---

## Files to Examine

- `vex/pipeline/operations/analyze.ts` - DEFAULT_PROMPT and input handling
- `vex/pipeline/presets.ts` - Pipeline definitions and edge connections
- `vex/pipeline/runtime.ts` - How artifacts flow between nodes
- `vex/core/types.ts` - ARTIFACT_NAMES ordering
- `vex-output/20260131-1717-wzlz/desktop-1920x1080/03-with-folds.png` - Actual VLM input image
