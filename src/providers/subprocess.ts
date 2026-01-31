/**
 * Subprocess execution service.
 * Abstracts Bun.spawn with timeout handling and proper cleanup.
 *
 * LLM Usage: When implementing CLI providers, use this instead of raw Bun.spawn.
 * The service handles timeout cleanup and provides typed errors.
 */

import { Context, Data, Effect, Layer } from 'effect';

export class SubprocessError extends Data.TaggedError('SubprocessError')<{
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}> {}

export interface SubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

export interface SubprocessService {
  /**
   * Execute a command with timeout.
   * Returns stdout/stderr on success, SubprocessError on failure.
   */
  readonly exec: (
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Effect.Effect<SubprocessResult, SubprocessError>;

  /**
   * Check if a command exists (via 'which').
   * Never fails - returns false on error.
   */
  readonly commandExists: (command: string) => Effect.Effect<boolean, never>;
}

export class Subprocess extends Context.Tag('Subprocess')<Subprocess, SubprocessService>() {}

/** Live implementation using Bun.spawn */
export const SubprocessLive = Layer.succeed(Subprocess, {
  exec: (command, args, timeoutMs) =>
    Effect.async<SubprocessResult, SubprocessError>((resume) => {
      const startMs = performance.now();
      const proc = Bun.spawn([command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: timeoutMs,
      });

      Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        .then(([exitCode, stdout, stderr]) => {
          const durationMs = Math.round(performance.now() - startMs);
          const timedOut = proc.signalCode === 'SIGTERM';

          if (timedOut || exitCode !== 0) {
            resume(
              Effect.fail(
                new SubprocessError({
                  command: `${command} ${args.join(' ')}`,
                  exitCode: timedOut ? null : exitCode,
                  stderr,
                  timedOut,
                }),
              ),
            );
          } else {
            resume(Effect.succeed({ stdout, stderr, exitCode, durationMs }));
          }
        })
        .catch((err) => {
          resume(
            Effect.fail(
              new SubprocessError({
                command: `${command} ${args.join(' ')}`,
                exitCode: null,
                stderr: err instanceof Error ? err.message : String(err),
                timedOut: false,
              }),
            ),
          );
        });

      return Effect.sync(() => {
        proc.kill();
      });
    }),

  commandExists: (command) =>
    Effect.promise(async () => {
      try {
        const proc = Bun.spawn(['which', command], { stdout: 'ignore', stderr: 'ignore' });
        return (await proc.exited) === 0;
      } catch {
        return false;
      }
    }),
});
