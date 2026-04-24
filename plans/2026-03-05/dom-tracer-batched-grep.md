# Plan: Batch Ripgrep Calls in DOM Tracer (Issue #7)

## Context

`src/locator/strategies/dom-tracer.ts` runs one ripgrep subprocess per selector in a sequential loop (`grepForSelectors`, lines 201-216). With 10-20 selectors per element and up to 3 elements per issue, this means 30-60 sequential subprocess spawns. Each spawn has fork/exec overhead, making the locate phase unnecessarily slow.

**Goal:** Replace the sequential per-selector loop with a single ripgrep call using regex alternation, achieving ~10x reduction in subprocess calls.

## Approach

Replace `grepForSelector` (single) + `grepForSelectors` (sequential loop) with a batched `grepForSelectors` that:

1. Escapes each selector individually (same escaping as today)
2. Joins them with `|` into an alternation pattern: `(escaped1|escaped2|...)`
3. Runs ONE ripgrep call with the combined pattern
4. Maps each result line back to originating selector(s) via `content.includes(originalSelector)`

This preserves exact current behavior — the same line can match multiple selectors, and the same `content.includes()` semantics apply.

**Why not `--json`?** More precise submatch tracking, but adds parsing complexity and subtly changes behavior (e.g., `.hero` would no longer match lines where it only appears inside `.hero-section`). Since this is a performance optimization, preserving semantics matters more.

## Files to Modify

| File | Change |
|------|--------|
| `src/locator/strategies/dom-tracer.ts` | Replace `grepForSelector` + loop with single batched function |
| `src/locator/strategies/dom-tracer.test.ts` | Add unit tests for batched grep function |

## Implementation Tasks

### Task 1: Rewrite `grepForSelectors` as batched single-call

**File:** `src/locator/strategies/dom-tracer.ts`

Delete `grepForSelector` (lines 164-199). Rewrite `grepForSelectors` (lines 201-216):

```typescript
async function grepForSelectors(
  selectors: string[],
  projectRoot: string,
  patterns: readonly string[],
): Promise<Map<string, GrepMatch[]>> {
  const results = new Map<string, GrepMatch[]>();
  if (selectors.length === 0) return results;

  // Escape each selector for regex, build alternation
  const escapedSelectors = selectors.map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = escapedSelectors.length === 1
    ? escapedSelectors[0]
    : `(${escapedSelectors.join('|')})`;

  const globArgs = patterns.flatMap((p) => ['--glob', p]);

  try {
    const result = await $`rg -n --no-heading ${pattern} ${globArgs} ${projectRoot}`.quiet().nothrow();
    const stdout = result.stdout.toString();

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const lineMatch = line.match(/^(.+?):(\d+):(.*)$/);
      if (!lineMatch) continue;

      const [, filePath, lineNum, content] = lineMatch;
      if (!filePath || !lineNum || content === undefined) continue;

      // Attribute this match to each selector that appears in the content
      for (const selector of selectors) {
        if (content.includes(selector)) {
          const matches = results.get(selector) ?? [];
          matches.push({
            file: filePath,
            line: parseInt(lineNum, 10),
            content,
            selector,
          });
          results.set(selector, matches);
        }
      }
    }
  } catch {
    // rg returns non-zero when no matches found
  }

  return results;
}
```

**Verify:** `bunx tsc --noEmit` passes, `bun test src/locator/` passes.

### Task 2: Export `grepForSelectors` for unit testing

**File:** `src/locator/strategies/dom-tracer.ts`

Add export: `export async function grepForSelectors(...)` — the codebase pattern is to export pure/testable functions for direct testing.

**Verify:** No type errors.

### Task 3: Add unit tests for batched grep

**File:** `src/locator/strategies/dom-tracer.test.ts`

Add a `describe('grepForSelectors - batched')` block with temp directory fixtures:

1. **Empty selectors** — returns empty Map
2. **Single selector** — equivalent to old single-call behavior
3. **Multiple selectors, different files** — each selector maps to correct file
4. **Multi-selector line** — line containing both `id="hero"` and `class="hero-section"` maps to both selectors
5. **Regex metacharacters** — selector `.hero-section` (contains dot) matches literally, not as wildcard

Use the existing `mkdtempSync` pattern from the test file.

**Verify:** `bun test src/locator/strategies/dom-tracer.test.ts` passes.

### Task 4: Post-implementation verification

**Verify:**
- `bun test src/locator/` — all locator tests pass
- `bunx tsc --noEmit` — type check
- `bun run lint` — lint + format check
- Spawn 3 verification agents: compliance, best practices, code simplifier

## Task Dependencies

```
Task 1 → Task 2 → Task 3 → Task 4
```

All sequential — each builds on the previous.

## Shared Infrastructure

No new shared code needed. Reuses:
- `GrepMatch` from `src/locator/types.ts`
- `mkdtempSync` temp fixture pattern from existing tests
- `DEFAULT_FILE_PATTERNS` already exported from `dom-tracer.ts`

## Best Practices References

- Ripgrep regex alternation: `(pat1|pat2)` is the standard way to search multiple patterns in one call
- Bun shell `$` template: handles long arguments without shell expansion limits
