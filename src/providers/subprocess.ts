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

/** Read stream to Blob then to text - works better with Bun.spawn */
async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  try {
    const blob = await Bun.readableStreamToBlob(stream);
    return await blob.text();
  } catch {
    return '';
  }
}

/** Build a descriptive command string for error messages */
const cmdLabel = (command: string, args: readonly string[]) =>
  args.length > 3 ? `${command} ${args.slice(0, 3).join(' ')}...` : `${command} ${args.join(' ')}`;

/** Live implementation using Bun.spawn wrapped in Effect */
export const SubprocessLive = Layer.succeed(Subprocess, {
  exec: (command, args, timeoutMs) =>
    Effect.async<SubprocessResult, SubprocessError>((resume) => {
      const label = cmdLabel(command, args);
      const startMs = performance.now();

      const proc = Bun.spawn([command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        proc.kill();
      }, timeoutMs);

      // Read streams first, then get exit code
      // This works around a Bun issue where proc.exited can hang
      Promise.all([readStream(proc.stdout), readStream(proc.stderr)])
        .then(async ([stdout, stderr]) => {
          // Wait for exit with a fallback timeout
          const exitCode = await Promise.race([
            proc.exited,
            new Promise<number>((resolve) => setTimeout(() => resolve(0), 5000)),
          ]);

          clearTimeout(timeoutId);
          const durationMs = Math.round(performance.now() - startMs);
          const timedOut = proc.signalCode === 'SIGTERM' || proc.signalCode === 'SIGKILL';

          if (timedOut) {
            resume(
              Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode: null,
                  stderr,
                  timedOut: true,
                }),
              ),
            );
            return;
          }

          if (exitCode !== 0) {
            resume(
              Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode,
                  stderr,
                  timedOut: false,
                }),
              ),
            );
            return;
          }

          resume(Effect.succeed({ stdout, stderr, exitCode, durationMs }));
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          resume(
            Effect.fail(
              new SubprocessError({
                command: label,
                exitCode: null,
                stderr: err instanceof Error ? err.message : String(err),
                timedOut: false,
              }),
            ),
          );
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
