# Plan: Consolidate confidence ordering into core/schema.ts

## Context

Issue #5: `dom-tracer.ts` (line 353) and `gates.ts` (lines 34-38) both define identical confidence ordering maps (`{ high: 0, medium: 1, low: 2 }`). The `Confidence` type already lives in `core/schema.ts`, so the ordering logic should live there too.

## Implementation

### Task 1: Add `CONFIDENCE_RANK` and `compareConfidence` to `core/schema.ts`

**Files**: `src/core/schema.ts`

Add after the existing `Confidence` type definition (line 54):

```typescript
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function compareConfidence(a: Confidence, b: Confidence): number {
  return CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b];
}
```

The `compareConfidence` helper follows `Array.sort` comparator convention (negative = a first, positive = b first).

**Verify**: `bunx tsc --noEmit`

### Task 2: Re-export from `core/types.ts`

**Files**: `src/core/types.ts`

Add `CONFIDENCE_RANK` and `compareConfidence` to the existing re-exports from `core/schema.ts`.

**Verify**: `bunx tsc --noEmit`

### Task 3: Replace inline ordering in `dom-tracer.ts`

**Files**: `src/locator/strategies/dom-tracer.ts`

Replace lines 352-354:
```typescript
// Sort by confidence (high > medium > low)
const confidenceOrder = { high: 0, medium: 1, low: 2 };
locations.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);
```

With:
```typescript
// Sort by confidence (high > medium > low)
locations.sort((a, b) => compareConfidence(a.confidence, b.confidence));
```

Add `compareConfidence` to the import from `../../core/types.js`.

**Verify**: `bun test src/locator/strategies/dom-tracer.test.ts`

### Task 4: Replace inline ordering in `gates.ts`

**Files**: `src/loop/gates.ts`

Remove the local `CONFIDENCE_RANK` definition (lines 34-38). Import `CONFIDENCE_RANK` from `../core/types.js` and use it in `isConfidenceAtLeast`.

The existing `isConfidenceAtLeast` function references `CONFIDENCE_RANK` directly, so the import is a drop-in replacement.

**Verify**: `bun test src/loop/gates.test.ts`

### Task 5: Add unit test for `compareConfidence` in `schema.test.ts`

**Files**: `src/core/schema.test.ts`

Add a test that validates the sort comparator produces the correct ordering.

**Verify**: `bun test src/core/schema.test.ts`

## Task Dependencies

```
Task 1 → Task 2 → Task 3, Task 4 (parallel)
Task 1 → Task 5
```

## Verification

```bash
bunx tsc --noEmit                           # Type check
bun test src/core/schema.test.ts             # New test
bun test src/locator/strategies/dom-tracer.test.ts  # Existing tests still pass
bun test src/loop/gates.test.ts              # Existing tests still pass
bunx biome check --write .                   # Lint + format
```
