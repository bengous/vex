import { afterEach, describe, expect, test } from "bun:test";
import { createRunSpec } from "../../../testing/factories.js";
import { createRunOutcome } from "../../../testing/mocks/audit-ports.js";
import { planAudit } from "../plan.js";
import { ConsoleReporter } from "./console-reporter.js";

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

function captureConsole(): { lines: string[]; warns: string[]; errors: string[] } {
  const lines: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  console.warn = (...args: unknown[]) => warns.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return { lines, warns, errors };
}

describe("ConsoleReporter", () => {
  test("prints audit start and completion lines", () => {
    const captured = captureConsole();
    const { manifest, plan } = planAudit(
      {
        urls: ["https://example.com"],
        devices: ["desktop-1920"],
        provider: "codex-cli",
        model: "gpt-5.4",
        reasoning: "low",
        profile: "minimal",
        mode: "analyze",
        full: false,
        frame: undefined,
        placeholderMedia: undefined,
        fullPageScrollFix: undefined,
        outputDir: "/tmp/vex-output",
      },
      undefined,
      "2026-04-24T00:00:00.000Z",
      "audit-test",
    );

    ConsoleReporter.auditStarted(plan, 1);
    ConsoleReporter.auditCompleted(plan, { ...manifest, status: "completed", completedRuns: 1 });

    expect(captured.lines).toEqual([
      "Audit: /tmp/vex-output/audit-test",
      "Targets: 1 (1 URL(s) x 1 device(s))",
      "",
      "Audit complete: completed",
      "Completed runs: 1/1",
      "Audit metadata: /tmp/vex-output/audit-test/audit.json",
      "",
    ]);
  });

  test("prints capture-only completion without analysis", () => {
    const captured = captureConsole();
    ConsoleReporter.runCompleted(createRunSpec(), createRunOutcome({ mode: "capture-only" }));

    expect(captured.lines).toContain("\nAnalysis skipped (capture-only mode).");
  });

  test("prints failed error line", () => {
    const captured = captureConsole();
    ConsoleReporter.runFailed(
      createRunSpec(),
      createRunOutcome({ status: "failed", error: "boom" }),
    );

    expect(captured.errors).toEqual(["[ERROR] Failed https://example.com (desktop-1920): boom"]);
  });
});
