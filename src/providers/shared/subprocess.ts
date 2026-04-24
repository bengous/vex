/**
 * Subprocess execution service.
 * Uses @effect/platform Command module for proper Effect integration.
 *
 * LLM Usage: When implementing CLI providers, use this instead of raw Bun.spawn.
 * The service handles timeout cleanup and provides typed errors.
 *
 * IMPORTANT: This layer requires CommandExecutor which must be provided
 * at the runtime boundary (via BunContext.layer in cli/index.ts).
 */

import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Chunk, Context, Data, Duration, Effect, Layer, Stream } from "effect";

export class SubprocessError extends Data.TaggedError("SubprocessError")<{
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}> {}

export type SubprocessResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
};

export type SubprocessService = {
  /**
   * Execute a command with timeout.
   * Returns stdout/stderr on success, SubprocessError on failure.
   * @param env - Optional environment variables to merge with process.env
   */
  readonly exec: (
    command: string,
    args: readonly string[],
    timeoutMs: number,
    env?: Record<string, string>,
  ) => Effect.Effect<SubprocessResult, SubprocessError>;

  /**
   * Check if a command exists (via 'which').
   * Never fails - returns false on error.
   */
  readonly commandExists: (command: string) => Effect.Effect<boolean>;
};

export class Subprocess extends Context.Tag("vex/providers/shared/subprocess")<
  Subprocess,
  SubprocessService
>() {}

const collectStreamAsUtf8 = <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((chunks) => {
      const decoder = new TextDecoder("utf-8");
      const arr = Chunk.toReadonlyArray(chunks);
      const totalLength = arr.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of arr) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return decoder.decode(combined);
    }),
  );

const cmdLabel = (command: string, args: readonly string[]) =>
  args.length > 3 ? `${command} ${args.slice(0, 3).join(" ")}...` : `${command} ${args.join(" ")}`;

/**
 * SubprocessLive using @effect/platform Command.
 *
 * This layer requires CommandExecutor which must be provided at the runtime
 * boundary. DO NOT capture CommandExecutor at layer construction time - it's
 * accessed inside each method call to ensure proper Scope alignment.
 */
export const SubprocessLive: Layer.Layer<Subprocess, never, CommandExecutor> = Layer.effect(
  Subprocess,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    return {
      exec: (command, args, timeoutMs, env) => {
        const label = cmdLabel(command, args);
        let cmd = Command.make(command, ...args);

        // Some CLIs probe stdin even when all inputs are passed as args.
        // Feeding an empty string guarantees EOF so the child does not wait
        // forever on an open pipe (notably `codex exec` in non-TTY mode).
        cmd = Command.feed(cmd, "");

        // Merge provided env vars with process.env
        if (env !== undefined && Object.keys(env).length > 0) {
          cmd = Command.env(cmd, env);
        }

        const runProcess = Effect.scoped(
          Effect.gen(function* () {
            const startMs = performance.now();
            const process = yield* executor.start(cmd);

            // CRITICAL: Drain stdout and stderr IN PARALLEL
            // Sequential reading can deadlock if stderr buffer fills
            const [stdout, stderr] = yield* Effect.all(
              [collectStreamAsUtf8(process.stdout), collectStreamAsUtf8(process.stderr)],
              { concurrency: 2 },
            );

            // CRITICAL: Read exitCode AFTER streams complete
            // Reading concurrently with streams can hang (Bun issue)
            const exitCode = yield* process.exitCode;

            const durationMs = Math.round(performance.now() - startMs);
            return { stdout, stderr, exitCode, durationMs };
          }),
        );

        return runProcess.pipe(
          Effect.timeout(Duration.millis(timeoutMs)),
          Effect.catchTags({
            TimeoutException: () =>
              Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode: null,
                  stderr: "",
                  timedOut: true,
                }),
              ),
            SystemError: (err) =>
              Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode: null,
                  stderr: err.message,
                  timedOut: false,
                }),
              ),
            BadArgument: (err) =>
              Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode: null,
                  stderr: err.message,
                  timedOut: false,
                }),
              ),
          }),
          Effect.flatMap((result) => {
            const code = result.exitCode as number;
            if (code !== 0) {
              return Effect.fail(
                new SubprocessError({
                  command: label,
                  exitCode: code,
                  stderr: result.stderr,
                  timedOut: false,
                }),
              );
            }
            return Effect.succeed({
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: code,
              durationMs: result.durationMs,
            });
          }),
        );
      },

      commandExists: (cmd) =>
        executor.exitCode(Command.make("which", cmd)).pipe(
          Effect.map((code) => code === 0),
          Effect.catchAll(() => Effect.succeed(false)),
        ),
    } satisfies SubprocessService;
  }),
);
