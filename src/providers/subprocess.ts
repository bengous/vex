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
  } catch (e) {
    console.log(`[subprocess] Stream read error:`, e);
    return '';
  }
}

/** Live implementation using Bun.spawn */
export const SubprocessLive = Layer.succeed(Subprocess, {
  exec: (command, args, timeoutMs) =>
    Effect.promise<SubprocessResult>(async () => {
      console.log(`[subprocess] Spawning: ${command}`);
      console.log(`[subprocess] Args count: ${args.length}`);
      console.log(`[subprocess] Last 10 args:`, args.slice(-10));
      console.log(`[subprocess] Timeout: ${timeoutMs}ms`);
      const startMs = performance.now();

      const proc = Bun.spawn([command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      console.log(`[subprocess] Process spawned, PID: ${proc.pid}`);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        console.log(`[subprocess] Timeout reached, killing process`);
        proc.kill();
      }, timeoutMs);

      try {
        console.log(`[subprocess] Waiting for process to complete...`);

        // Read streams first - they complete when process closes them
        const stdoutPromise = readStream(proc.stdout).then((text) => {
          console.log(`[subprocess] stdout read complete, length: ${text.length}`);
          return text;
        });
        const stderrPromise = readStream(proc.stderr).then((text) => {
          console.log(`[subprocess] stderr read complete, length: ${text.length}`);
          return text;
        });

        // Wait for streams first
        const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
        console.log(`[subprocess] Streams read, waiting for exit code...`);

        // Wait for exit with a fallback timeout (streams closed = process done)
        // This works around a Bun issue where proc.exited sometimes never resolves
        const exitCode = await Promise.race([
          proc.exited.then((code) => {
            console.log(`[subprocess] proc.exited resolved with code: ${code}`);
            return code;
          }),
          new Promise<number>((resolve) =>
            setTimeout(() => {
              console.log(`[subprocess] Exit code timeout, assuming 0 (streams completed)`);
              resolve(0);
            }, 5000),
          ),
        ]);
        console.log(`[subprocess] Exit code: ${exitCode}`);

        clearTimeout(timeoutId);
        const durationMs = Math.round(performance.now() - startMs);
        const timedOut = proc.signalCode === 'SIGTERM' || proc.signalCode === 'SIGKILL';

        console.log(`[subprocess] Process exited, code: ${exitCode}, duration: ${durationMs}ms, timedOut: ${timedOut}`);

        if (timedOut) {
          throw new SubprocessError({
            command: `${command} ${args.slice(0, 3).join(' ')}...`,
            exitCode: null,
            stderr,
            timedOut: true,
          });
        }

        if (exitCode !== 0) {
          throw new SubprocessError({
            command: `${command} ${args.slice(0, 3).join(' ')}...`,
            exitCode,
            stderr,
            timedOut: false,
          });
        }

        return { stdout, stderr, exitCode, durationMs };
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof SubprocessError) throw err;
        throw new SubprocessError({
          command: `${command} ${args.slice(0, 3).join(' ')}...`,
          exitCode: null,
          stderr: err instanceof Error ? err.message : String(err),
          timedOut: false,
        });
      }
    }).pipe(Effect.catchAll((e) => Effect.fail(e as SubprocessError))),

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
