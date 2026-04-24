# Plan: Complete Test Fixture Consolidation (Issue #13)

## Context

Commit `4a0a237` created `src/testing/factories.ts` with canonical factories and migrated most test files. However, several local duplicates remain. This plan addresses the remaining duplication to fully close issue #13.

## Remaining Duplicates

| Factory | Location | Status |
|---------|----------|--------|
| `createValidIssue` | `src/core/validation.test.ts:25` | Duplicate of `createIssue` (diff: description text, `as Issue` cast) |
| `createMockLogger` | `src/core/validation.test.ts:36` | Narrow duplicate of `createCapturingLogger` |
| `createLoopOptions` | `src/loop/orchestrator.test.ts:36` | Spread-override pattern, 6 required fields |
| `createLoopOptions` | `src/cli/commands/loop.test.ts:13` | Different signature (positional arg), 8 fields |
| `DEFAULT_VIEWPORT` | `orchestrator.test.ts:20`, `loop.test.ts:6` | Identical constant in 2 files |

**Not consolidating** (domain-specific, single consumer):
- `createBaseState` in `state.test.ts` — thin wrapper over canonical `createPipelineState`, test-specific node setup
- `createAppliedFix`, `createMockCallbacks` in `orchestrator.test.ts` — loop-specific, depend on mocked Effects
- `createIssuesResponse` in `analyze.test.ts` — builds JSON strings, not domain objects

## Implementation Tasks

### Task 1: Replace `createValidIssue` with canonical `createIssue`

**Files:** `src/core/validation.test.ts`

**Changes:**
1. Add import: `import { createIssue } from '../testing/factories.js';`
2. Remove import of `type { Issue } from './schema.js'` (no longer needed for factory)
3. Delete `createValidIssue` function (lines 25-33)
4. Replace all `createValidIssue(` with `createIssue(` (used ~25 times)
5. Drop the `as Issue` cast — canonical factory returns `Issue` directly

**Verify:** `bun test src/core/validation.test.ts`
**Commit:** `refactor(testing): replace createValidIssue with canonical createIssue`

### Task 2: Replace `createMockLogger` with `createCapturingLogger`

**Files:** `src/core/validation.test.ts`

**Changes:**
1. Add import: `import { createCapturingLogger } from '../testing/mocks/pipeline-context.js';`
2. Delete `createMockLogger` function (lines 36-42)
3. Replace all `createMockLogger()` calls (~8 uses) with `createCapturingLogger()`
4. Update assertions: `logger.warnings` → filter `logger.messages` by level

Current usage pattern:
```typescript
const logger = createMockLogger();
// ... operation using logger.warn(msg)
expect(logger.warnings).toHaveLength(1);
```

New pattern:
```typescript
const logger = createCapturingLogger();
// ... operation using logger.warn(msg)
const warnings = logger.messages.filter(m => m.level === 'warn');
expect(warnings).toHaveLength(1);
```

**Verify:** `bun test src/core/validation.test.ts`
**Commit:** `refactor(testing): replace createMockLogger with canonical createCapturingLogger`

### Task 3: Add `createLoopOptions` and `DEFAULT_VIEWPORT` to shared factories

**Files:** `src/testing/factories.ts`, `src/loop/orchestrator.test.ts`, `src/cli/commands/loop.test.ts`

**Changes to `src/testing/factories.ts`:**
1. Add imports for `ViewportConfig` from `../core/types.js` and `LoopOptions` from `../loop/types.js`
2. Export `DEFAULT_VIEWPORT` constant:
```typescript
export const DEFAULT_VIEWPORT: ViewportConfig = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};
```
3. Export `createLoopOptions` with spread-override pattern (matching orchestrator.test.ts style since it's the more complete consumer):
```typescript
export function createLoopOptions(overrides: Partial<LoopOptions> = {}): LoopOptions {
  return {
    url: 'https://example.com',
    maxIterations: 5,
    viewports: [DEFAULT_VIEWPORT],
    provider: 'test',
    projectRoot: '/tmp/test',
    interactive: false,
    autoFixThreshold: 'high',
    ...overrides,
  };
}
```

**Changes to `src/loop/orchestrator.test.ts`:**
1. Update import: add `createLoopOptions, DEFAULT_VIEWPORT` to the factories import
2. Remove local `DEFAULT_VIEWPORT` (line 20-25) and `createLoopOptions` (lines 36-48)

**Changes to `src/cli/commands/loop.test.ts`:**
1. Add import: `import { createLoopOptions } from '../../testing/factories.js';`
2. Remove local `DEFAULT_VIEWPORT` (lines 6-11) and `createLoopOptions` (lines 13-26)
3. Update call sites — current: `createLoopOptions(threshold)` → new: `createLoopOptions({ autoFixThreshold: threshold, provider: 'ollama', model: 'qwen3-vl:8b', sessionDir: '/tmp/test-loop-session', projectRoot: '/tmp/test-project', maxIterations: 3, dryRun: true })`

**Verify:** `bun test src/loop/orchestrator.test.ts src/cli/commands/loop.test.ts`
**Commit:** `refactor(testing): consolidate createLoopOptions and DEFAULT_VIEWPORT into shared factories`

### Task 4: Verify all tests pass + lint

**Files:** None (verification only)

**Verify:**
```bash
bun test src/
bunx tsc --noEmit
bun run autofix
```

**Commit:** Fix any lint issues from prior tasks (if needed)

### Task 5: Post-Implementation Verification

**Files:** None (verification only)

**Verify:** Spawn 3 parallel subagents:
1. **Compliance Agent** (Explore) — verify all factories listed in issue #13 inventory are either consolidated or explicitly kept local with justification
2. **Best Practices Agent** (general-purpose) — validate factory patterns match project conventions in CLAUDE.md
3. **Code Simplifier Agent** (code-simplifier) — check no over-engineering was introduced

**Commit:** None

## Task Dependencies

```
Task 1 → Task 2 (same file, sequential to avoid conflicts)
Task 3 (parallel with Task 1+2, different files)
Task 1+2+3 → Task 4 → Task 5
```

## Shared Infrastructure

All new shared code goes into the existing `src/testing/factories.ts` — no new files needed. The original issue proposed a `src/testing/fixtures/` directory, but the simpler flat-file approach from commit `4a0a237` is sufficient.

## Best Practices References

- Project CLAUDE.md: "Fixture factories with spread overrides" pattern
- Project CLAUDE.md: "Mock provider cleanup" and "Section separators for readability"
- Existing canonical factories in `src/testing/factories.ts` (lines 1-62) establish the pattern
