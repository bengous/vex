import { describe, expect, test } from "bun:test";
import { createAuditManifest, createRunSpec } from "../../testing/factories.js";
import {
  applyInvalidDeviceRun,
  applyRunOutcome,
  applyRunStarted,
  getAuditFinalStatus,
  toErrorMessage,
} from "./manifest.js";

describe("toErrorMessage", () => {
  test("normalizes common thrown values", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage("plain")).toBe("plain");
    expect(toErrorMessage({ reason: "bad" })).toBe('{"reason":"bad"}');
  });
});

describe("getAuditFinalStatus", () => {
  test("reports interrupted when signal handling requested stop", () => {
    expect(getAuditFinalStatus(createAuditManifest(), true)).toBe("interrupted");
  });

  test("reports failed when every run failed", () => {
    expect(getAuditFinalStatus(createAuditManifest({ failedRuns: 1 }), false)).toBe("failed");
  });

  test("reports completed when at least one run completed or no runs exist", () => {
    expect(getAuditFinalStatus(createAuditManifest({ completedRuns: 1 }), false)).toBe("completed");
    expect(getAuditFinalStatus(createAuditManifest({ totalRuns: 0 }), false)).toBe("completed");
  });
});

describe("manifest reducers", () => {
  test("applyRunStarted appends a running record without mutating input", () => {
    const manifest = createAuditManifest();
    const next = applyRunStarted(manifest, createRunSpec(), {
      startedAt: "2026-04-24T00:00:01.000Z",
    });

    expect(manifest.runs).toHaveLength(0);
    expect(next.runs).toHaveLength(1);
    expect(next.runs[0]?.status).toBe("running");
  });

  test("applyRunOutcome replaces running record and increments completed count", () => {
    const spec = createRunSpec();
    const started = { startedAt: "2026-04-24T00:00:01.000Z" };
    const running = applyRunStarted(createAuditManifest(), spec, started);
    const next = applyRunOutcome(running, spec, started, {
      status: "completed",
      completedAt: "2026-04-24T00:00:02.000Z",
      mode: "analyze",
      issueCount: 2,
      artifacts: [],
    });

    expect(running.completedRuns).toBe(0);
    expect(next.completedRuns).toBe(1);
    expect(next.failedRuns).toBe(0);
    expect(next.runs).toHaveLength(1);
    expect(next.runs[0]?.issueCount).toBe(2);
  });

  test("applyRunOutcome increments failed count and stores error", () => {
    const spec = createRunSpec();
    const started = { startedAt: "2026-04-24T00:00:01.000Z" };
    const running = applyRunStarted(createAuditManifest(), spec, started);
    const next = applyRunOutcome(running, spec, started, {
      status: "failed",
      completedAt: "2026-04-24T00:00:02.000Z",
      mode: "analyze",
      error: "boom",
      artifacts: [],
    });

    expect(next.completedRuns).toBe(0);
    expect(next.failedRuns).toBe(1);
    expect(next.runs[0]?.error).toBe("boom");
  });

  test("applyInvalidDeviceRun appends failed record with empty viewport path", () => {
    const next = applyInvalidDeviceRun(
      createAuditManifest(),
      {
        kind: "invalid-device",
        url: "https://example.com",
        deviceId: "unknown",
        pageDir: "/tmp/audit/pages/example.com/_index",
        pagePath: "pages/example.com/_index",
        viewportPath: "",
        error: "Unknown device",
      },
      { startedAt: "2026-04-24T00:00:01.000Z" },
      "2026-04-24T00:00:02.000Z",
    );

    expect(next.failedRuns).toBe(1);
    expect(next.runs[0]?.viewportPath).toBe("");
  });
});
