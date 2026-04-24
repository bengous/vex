/**
 * Tests for Codex CLI profile schema.
 */

import { describe, expect, test } from "bun:test";
import { Schema as S } from "effect";
import { BUILTIN_PROFILES, CodexProfile, CodexSandbox } from "./schema.js";

describe("CodexProfile schema", () => {
  test("validates builtin profiles", () => {
    for (const profile of Object.values(BUILTIN_PROFILES)) {
      const result = S.decodeUnknownSync(CodexProfile)(profile);
      expect(result).toEqual(profile);
    }
  });

  test("rejects invalid sandbox value", () => {
    const invalid = { ...BUILTIN_PROFILES.minimal, sandbox: "invalid" };
    expect(() => S.decodeUnknownSync(CodexProfile)(invalid)).toThrow();
  });

  test("rejects invalid approval value", () => {
    const invalid = { ...BUILTIN_PROFILES.minimal, approval: "invalid" };
    expect(() => S.decodeUnknownSync(CodexProfile)(invalid)).toThrow();
  });

  test("rejects invalid webSearch value", () => {
    const invalid = { ...BUILTIN_PROFILES.minimal, webSearch: "invalid" };
    expect(() => S.decodeUnknownSync(CodexProfile)(invalid)).toThrow();
  });
});

describe("CodexSandbox schema", () => {
  test("accepts valid sandbox values", () => {
    const valid = ["read-only", "workspace-write", "danger-full-access"] as const;
    for (const value of valid) {
      expect(S.decodeUnknownSync(CodexSandbox)(value)).toBe(value);
    }
  });

  test("rejects invalid sandbox values", () => {
    expect(() => S.decodeUnknownSync(CodexSandbox)("full-write")).toThrow();
    expect(() => S.decodeUnknownSync(CodexSandbox)("readonly")).toThrow();
  });
});

describe("BUILTIN_PROFILES", () => {
  test("has expected profiles", () => {
    expect(Object.keys(BUILTIN_PROFILES)).toEqual(["minimal", "fast", "safe"]);
  });

  test("minimal profile has strictest settings", () => {
    expect(BUILTIN_PROFILES.minimal.sandbox).toBe("read-only");
    expect(BUILTIN_PROFILES.minimal.approval).toBe("on-request");
    expect(BUILTIN_PROFILES.minimal.webSearch).toBe("disabled");
  });

  test("fast profile auto-approves and allows workspace writes", () => {
    expect(BUILTIN_PROFILES.fast.sandbox).toBe("workspace-write");
    expect(BUILTIN_PROFILES.fast.approval).toBe("never");
    expect(BUILTIN_PROFILES.fast.webSearch).toBe("disabled");
  });

  test("safe profile requires approval and uses cached web search", () => {
    expect(BUILTIN_PROFILES.safe.sandbox).toBe("read-only");
    expect(BUILTIN_PROFILES.safe.approval).toBe("untrusted");
    expect(BUILTIN_PROFILES.safe.webSearch).toBe("cached");
  });

  test("all profiles have empty mcpServers", () => {
    for (const profile of Object.values(BUILTIN_PROFILES)) {
      expect(profile.mcpServers).toEqual({});
    }
  });
});
