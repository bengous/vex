/**
 * Tests for scoped Codex environment resource.
 */

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeCodexEnvResource } from "./environment.js";
import { BUILTIN_PROFILES } from "./schema.js";

describe("makeCodexEnvResource", () => {
  test("creates temp dir with config.toml", async () => {
    let capturedPath: string | undefined;

    const program = Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeCodexEnvResource(BUILTIN_PROFILES.fast);
        capturedPath = service.codexHome;

        // Verify during scope
        expect(existsSync(capturedPath)).toBe(true);
        expect(existsSync(join(capturedPath, "config.toml"))).toBe(true);

        const content = readFileSync(join(capturedPath, "config.toml"), "utf-8");
        expect(content).toContain('sandbox_mode = "workspace-write"');
        expect(content).toContain('approval_policy = "never"');
      }),
    );

    await Effect.runPromise(program);

    // Verify cleanup after scope
    assert(capturedPath);
    expect(existsSync(capturedPath)).toBe(false);
  });

  test("temp dir name follows expected pattern", async () => {
    let capturedPath: string | undefined;

    const program = Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeCodexEnvResource(BUILTIN_PROFILES.minimal);
        capturedPath = service.codexHome;
      }),
    );

    await Effect.runPromise(program);

    // Path should contain vex-codex prefix
    expect(capturedPath).toMatch(/vex-codex-\d+-[a-z0-9]+$/);
  });

  test("service exposes profile", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeCodexEnvResource(BUILTIN_PROFILES.safe);
        expect(service.profile).toEqual(BUILTIN_PROFILES.safe);
      }),
    );

    await Effect.runPromise(program);
  });

  test("cleans up on scope exit even with error", async () => {
    let capturedPath: string | undefined;

    const program = Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeCodexEnvResource(BUILTIN_PROFILES.fast);
        capturedPath = service.codexHome;

        // Throw after capturing path
        throw new Error("Simulated error");
      }),
    );

    // Run and expect failure
    const exit = await Effect.runPromiseExit(program);
    expect(exit._tag).toBe("Failure");

    // Verify cleanup happened despite error
    assert(capturedPath);
    expect(existsSync(capturedPath)).toBe(false);
  });
});
