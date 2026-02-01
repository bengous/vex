/**
 * Subprocess execution service using @effect/platform Command.
 * Provides typed errors and proper timeout handling.
 *
 * LLM Usage: When implementing CLI providers, use this instead of raw Bun.spawn.
 * The service handles timeout cleanup and provides typed errors.
 */

import { Command } from '@effect/platform';
import { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Context, Data, Duration, Effect, Layer, String as Str, Stream } from 'effect';

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

/** Collect stream output as a string */
const runString = <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
  stream.pipe(Stream.decodeText(), Stream.runFold(Str.empty, Str.concat));

/** Build a descriptive command string for error messages */
const cmdLabel = (command: string, args: readonly string[]) =>
  args.length > 3 ? `${command} ${args.slice(0, 3).join(' ')}...` : `${command} ${args.join(' ')}`;

/**
 * Live implementation using @effect/platform Command.
 * Requires CommandExecutor (provided by BunContext.layer at CLI entry).
 */
export const SubprocessLive: Layer.Layer<Subprocess, never, CommandExecutor> = Layer.effect(
  Subprocess,
  Effect.gen(function* () {
    // Capture CommandExecutor at layer construction time
    const executor = yield* CommandExecutor;

    return {
      exec: (command, args, timeoutMs) => {
        const label = cmdLabel(command, args);
        const cmd = Command.make(command, ...args);

        const runProcess = Command.start(cmd).pipe(
          Effect.flatMap((process) =>
            Effect.all([process.exitCode, runString(process.stdout), runString(process.stderr)], { concurrency: 3 }),
          ),
          Effect.scoped,
        );

        return Effect.timed(runProcess).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(timeoutMs),
            onTimeout: () =>
              new SubprocessError({
                command: label,
                exitCode: null,
                stderr: '',
                timedOut: true,
              }),
          }),
          Effect.flatMap(([duration, [exitCode, stdout, stderr]]) => {
            const durationMs = Math.round(Duration.toMillis(duration));

            if (exitCode !== 0) {
              return Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode,
                  stderr,
                  timedOut: false,
                }),
              );
            }

            return Effect.succeed({ stdout, stderr, exitCode, durationMs });
          }),
          Effect.catchTag('SystemError', (err) =>
            Effect.fail(
              new SubprocessError({
                command: label,
                exitCode: null,
                stderr: err.message,
                timedOut: false,
              }),
            ),
          ),
          Effect.catchTag('BadArgument', (err) =>
            Effect.fail(
              new SubprocessError({
                command: label,
                exitCode: null,
                stderr: err.message,
                timedOut: false,
              }),
            ),
          ),
          // Satisfy CommandExecutor requirement with captured executor
          Effect.provideService(CommandExecutor, executor),
        );
      },

      commandExists: (cmd) =>
        Command.make('which', cmd).pipe(
          Command.exitCode,
          Effect.map((code) => code === 0),
          Effect.catchAll(() => Effect.succeed(false)),
          // Satisfy CommandExecutor requirement with captured executor
          Effect.provideService(CommandExecutor, executor),
        ),
    } satisfies SubprocessService;
  }),
);
