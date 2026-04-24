import type { RunScanAuditOptions } from "./types.js";
import { describe, expect, test } from "bun:test";
import { Exit } from "effect";
import { runEffectExit } from "../../testing/effect-helpers.js";
import {
  createAuditPorts,
  createCapturingReporter,
  createFakePipelineRunner,
  createFixedClock,
  createInMemoryManifestStore,
  createInterruptingRunner,
  createRunOutcome,
  createTestSignalListener,
} from "../../testing/mocks/audit-ports.js";
import { runScanAuditWithPorts } from "./orchestrator.js";

const options = (
  overrides: Partial<RunScanAuditOptions["resolved"]> = {},
): RunScanAuditOptions => ({
  preset: undefined,
  cli: {
    url: undefined,
    device: undefined,
    provider: undefined,
    model: undefined,
    reasoning: undefined,
    providerProfile: undefined,
    full: false,
    placeholderMedia: false,
    output: undefined,
  },
  resolved: {
    urls: ["https://example.com"],
    devices: ["desktop-1920"],
    provider: "codex-cli",
    model: "gpt-5.4",
    reasoning: "low",
    profile: "minimal",
    mode: "analyze",
    full: false,
    placeholderMedia: undefined,
    fullPageScrollFix: undefined,
    outputDir: "/tmp/vex-output",
    ...overrides,
  },
});

describe("runScanAuditWithPorts", () => {
  test("runs multi-url scans in order and saves manifest at each boundary", async () => {
    const store = createInMemoryManifestStore();
    const reporter = createCapturingReporter();
    const exit = await runEffectExit(
      runScanAuditWithPorts(
        options({ urls: ["https://a.test", "https://b.test"] }),
        createAuditPorts({
          store,
          reporter,
          runner: createFakePipelineRunner([createRunOutcome(), createRunOutcome()]),
        }),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(store.savedManifests).toHaveLength(6);
    expect(reporter.events).toEqual([
      "auditStarted",
      "runStarted:https://a.test:desktop-1920",
      "runCompleted:https://a.test:desktop-1920",
      "runStarted:https://b.test:desktop-1920",
      "runCompleted:https://b.test:desktop-1920",
      "auditCompleted:completed",
    ]);
  });

  test("continues after a failed run outcome and completes the audit", async () => {
    const store = createInMemoryManifestStore();
    const reporter = createCapturingReporter();
    const exit = await runEffectExit(
      runScanAuditWithPorts(
        options({ urls: ["https://a.test", "https://b.test", "https://c.test"] }),
        createAuditPorts({
          store,
          reporter,
          runner: createFakePipelineRunner([
            createRunOutcome(),
            createRunOutcome({ status: "failed", error: "boom" }),
            createRunOutcome(),
          ]),
        }),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(store.savedManifests.at(-1)?.status).toBe("completed");
    expect(store.savedManifests.at(-1)?.failedRuns).toBe(1);
    expect(reporter.events).toContain("runFailed:https://b.test:desktop-1920");
  });

  test("stops before the next run when interrupted after run 2", async () => {
    const store = createInMemoryManifestStore();
    const reporter = createCapturingReporter();
    const signals = createTestSignalListener();
    const exit = await runEffectExit(
      runScanAuditWithPorts(
        options({ urls: ["https://a.test", "https://b.test", "https://c.test"] }),
        createAuditPorts({
          store,
          reporter,
          signals,
          runner: createInterruptingRunner(signals, "SIGINT", [
            createRunOutcome(),
            createRunOutcome(),
            createRunOutcome(),
          ]),
        }),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(store.savedManifests.at(-1)?.status).toBe("interrupted");
    expect(store.savedManifests.at(-1)?.runs).toHaveLength(2);
    expect(reporter.events).toContain("interrupt:SIGINT");
  });

  test("saves invalid device failure then fails without running pipeline", async () => {
    const store = createInMemoryManifestStore();
    const exit = await runEffectExit(
      runScanAuditWithPorts(options({ devices: ["unknown-device"] }), createAuditPorts({ store })),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(store.savedManifests).toHaveLength(2);
    expect(store.savedManifests.at(-1)?.runs[0]?.status).toBe("failed");
    expect(store.savedManifests.at(-1)?.completedAt).toBeUndefined();
  });

  test("supports capture-only outcomes without analysis", async () => {
    const store = createInMemoryManifestStore();
    const reporter = createCapturingReporter();
    const exit = await runEffectExit(
      runScanAuditWithPorts(
        options({ mode: "capture-only" }),
        createAuditPorts({
          store,
          reporter,
          runner: createFakePipelineRunner([createRunOutcome({ mode: "capture-only" })]),
        }),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(store.savedManifests.at(-1)?.completedRuns).toBe(1);
    expect(reporter.events).toContain("runCompleted:https://example.com:desktop-1920");
  });

  test("uses injected clock for audit id and timestamps", async () => {
    const store = createInMemoryManifestStore();
    await runEffectExit(
      runScanAuditWithPorts(
        options(),
        createAuditPorts({
          clock: createFixedClock([
            "2026-04-24T10:15:00.000Z",
            "2026-04-24T10:15:01.000Z",
            "2026-04-24T10:15:02.000Z",
            "2026-04-24T10:15:03.000Z",
          ]),
          store,
          runner: createFakePipelineRunner([createRunOutcome()]),
        }),
      ),
    );

    expect(store.initializedPlans[0]?.auditId).toBe("audit-20260424-1015");
  });
});
