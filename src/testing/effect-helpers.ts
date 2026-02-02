/**
 * Test helpers for running Effects with BunContext.
 *
 * Uses ManagedRuntime to reuse the runtime across test runs (performance)
 * and properly type-constrain Effects to BunContext services (type safety).
 */
import { BunContext } from '@effect/platform-bun';
import { Effect, Exit, type Layer, ManagedRuntime } from 'effect';
import { expect } from 'bun:test';
import type { OperationError } from '../pipeline/types.js';

/** Services provided by BunContext.layer */
type BunContextServices = Layer.Layer.Success<typeof BunContext.layer>;

/** Shared runtime for all tests - reused across runs */
const TestRuntime = ManagedRuntime.make(BunContext.layer);

/** Run an Effect that requires BunContext services */
export const runEffect = <A, E>(effect: Effect.Effect<A, E, BunContextServices>) => TestRuntime.runPromise(effect);

/** Run an Effect and return Exit (for testing error paths) */
export const runEffectExit = <A, E>(effect: Effect.Effect<A, E, BunContextServices>) =>
  TestRuntime.runPromiseExit(effect);

/**
 * Assert that an Effect exit is a failure with an OperationError.
 * Returns the error for additional assertions.
 *
 * @param exit - The Exit from runPromiseExit
 * @param expectedOperation - Optional operation name to verify
 * @returns The OperationError for further assertions
 *
 * @example
 * ```ts
 * const exit = await runEffectExit(program);
 * const error = expectOperationFailure(exit, 'analyze');
 * expect(error.detail).toContain('expected message');
 * ```
 */
export function expectOperationFailure(exit: Exit.Exit<unknown, unknown>, expectedOperation?: string): OperationError {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    throw new Error('Expected failure exit');
  }

  const cause = exit.cause;
  if (cause._tag !== 'Fail') {
    throw new Error(`Expected Fail cause, got ${cause._tag}`);
  }

  const error = cause.error as OperationError;
  expect(error._tag).toBe('OperationError');

  if (expectedOperation) {
    expect(error.operation).toBe(expectedOperation);
  }

  return error;
}
