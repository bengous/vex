# Issue #11: Standardize artifact ID generation on crypto.randomUUID()

## Context

Two sites in `src/core/capture.ts` use `` `img_${Date.now()}` `` for artifact IDs, while all 7 pipeline operations use `crypto.randomUUID()`. The `Date.now()` pattern risks collisions under rapid calls and leaks type info into the ID (redundant with `type: 'image'`).

## Task 1: Replace Date.now() IDs with crypto.randomUUID()

**Files:** `src/core/capture.ts` (lines 457, 635)

**Changes:**
- Line 457: `id: \`img_${Date.now()}\`` -> `id: crypto.randomUUID()`
- Line 635: `id: \`img_${Date.now()}\`` -> `id: crypto.randomUUID()`

No imports needed — `crypto.randomUUID()` is a global Web API available in Bun.

**Verify:** `bunx tsc --noEmit && bun test src/`

**Commit:** `fix(core): standardize artifact IDs on crypto.randomUUID() (#11)`

## Task 2: Post-Implementation Verification

**Verify:** Spawn 3 parallel subagents:
1. Compliance Agent — confirm no remaining `Date.now()` artifact IDs
2. Best Practices Agent — confirm `crypto.randomUUID()` is correct for Bun runtime
3. Code Simplifier — check no unnecessary changes were introduced

## Best Practices References

- `crypto.randomUUID()` is a W3C standard available in all modern runtimes including Bun
- Existing convention in all 7 pipeline operations confirms this is the project standard
