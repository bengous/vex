/**
 * Test helpers for running Effects with BunContext.
 *
 * Uses ManagedRuntime to reuse the runtime across test runs (performance)
 * and properly type-constrain Effects to BunContext services (type safety).
 */
import { BunContext } from '@effect/platform-bun';
import { Effect, type Layer, ManagedRuntime } from 'effect';

/** Services provided by BunContext.layer */
type BunContextServices = Layer.Layer.Success<typeof BunContext.layer>;

/** Shared runtime for all tests - reused across runs */
const TestRuntime = ManagedRuntime.make(BunContext.layer);

/** Run an Effect that requires BunContext services */
export const runEffect = <A, E>(effect: Effect.Effect<A, E, BunContextServices>) => TestRuntime.runPromise(effect);

/** Run an Effect and return Exit (for testing error paths) */
export const runEffectExit = <A, E>(effect: Effect.Effect<A, E, BunContextServices>) =>
  TestRuntime.runPromiseExit(effect);
