import type { ResolvedScanOptions } from "../resolve.js";
import { describe, expect, test } from "bun:test";
import { planAudit } from "./plan.js";

const resolved = (overrides: Partial<ResolvedScanOptions> = {}): ResolvedScanOptions => ({
  urls: ["https://example.com/fr/about"],
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
  ...overrides,
});

describe("planAudit", () => {
  test("creates one valid run with audit-relative paths", () => {
    const { manifest, plan } = planAudit(
      resolved(),
      undefined,
      "2026-04-24T00:00:00.000Z",
      "audit-test",
    );

    expect(plan.auditDir).toBe("/tmp/vex-output/audit-test");
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]).toMatchObject({
      kind: "valid",
      url: "https://example.com/fr/about",
      deviceId: "desktop-1920",
      pagePath: "pages/example.com/fr/about/_index",
    });
    expect(manifest.totalRuns).toBe(1);
    expect(manifest.outputDir).toBe(plan.auditDir);
  });

  test("creates runs in url-major order", () => {
    const { plan } = planAudit(
      resolved({
        urls: ["https://a.test", "https://b.test"],
        devices: ["desktop-1920", "iphone-se-2022", "ipad-pro-11"],
      }),
      "quick",
      "2026-04-24T00:00:00.000Z",
      "audit-test",
    );

    expect(plan.runs.map((run) => `${run.url}:${run.deviceId}`)).toEqual([
      "https://a.test:desktop-1920",
      "https://a.test:iphone-se-2022",
      "https://a.test:ipad-pro-11",
      "https://b.test:desktop-1920",
      "https://b.test:iphone-se-2022",
      "https://b.test:ipad-pro-11",
    ]);
  });

  test("keeps unknown devices in position as invalid specs", () => {
    const { plan } = planAudit(
      resolved({ devices: ["desktop-1920", "unknown-device", "iphone-se-2022"] }),
      undefined,
      "2026-04-24T00:00:00.000Z",
      "audit-test",
    );

    expect(plan.runs[1]).toMatchObject({
      kind: "invalid-device",
      deviceId: "unknown-device",
      viewportPath: "",
    });
    expect(plan.runs[1]?.kind === "invalid-device" ? plan.runs[1].error : "").toContain(
      "Valid devices:",
    );
  });

  test("respects resolved outputDir", () => {
    const { plan } = planAudit(
      resolved({ outputDir: "/tmp/custom-output" }),
      undefined,
      "2026-04-24T00:00:00.000Z",
      "audit-test",
    );

    expect(plan.auditManifestPath).toBe("/tmp/custom-output/audit-test/audit.json");
  });
});
