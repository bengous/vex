import { BunContext } from "@effect/platform-bun";
import { describe, expect, it } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { Subprocess, SubprocessLive } from "./subprocess.js";

// Create a test layer that satisfies CommandExecutor requirement
const TestLayer = Layer.provide(SubprocessLive, BunContext.layer);

describe("SubprocessService", () => {
  it("returns stdout on success", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.exec("echo", ["hello"], 5000);
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("returns SubprocessError on non-zero exit", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.exec("false", [], 5000);
    });
    const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(TestLayer)));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("times out long-running commands", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.exec("sleep", ["5"], 100);
    });
    const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(TestLayer)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(error?._tag).toBe("SubprocessError");
      expect(error?.timedOut).toBe(true);
    }
  });

  it("handles unicode output", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.exec("echo", ["こんにちは"], 5000);
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result.stdout.trim()).toBe("こんにちは");
  });

  it("closes stdin so commands waiting for EOF can complete", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.exec("bash", ["-lc", "cat >/dev/null; echo done"], 5000);
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result.stdout.trim()).toBe("done");
  });

  it("commandExists returns true for existing commands", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.commandExists("ls");
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result).toBe(true);
  });

  it("commandExists returns false for non-existing commands", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.commandExists("nonexistent-command-xyz");
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result).toBe(false);
  });

  it("measures duration", async () => {
    const program = Effect.gen(function* () {
      const subprocess = yield* Subprocess;
      return yield* subprocess.exec("sleep", ["0.1"], 5000);
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result.durationMs).toBeGreaterThan(50);
    expect(result.durationMs).toBeLessThan(1000);
  });
});
