import type { AuditPlan } from "../plan.js";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEffect } from "../../../testing/effect-helpers.js";
import { createAuditManifest } from "../../../testing/factories.js";
import { FsManifestStore } from "./fs-manifest-store.js";

function createPlan(baseDir: string): AuditPlan {
  return {
    auditId: "audit-test",
    auditDir: baseDir,
    auditManifestPath: join(baseDir, "audit.json"),
    configUsedPath: join(baseDir, "config.used.json"),
    urlsPath: join(baseDir, "urls.txt"),
    urls: ["https://example.com"],
    devices: ["desktop-1920"],
    runs: [],
  };
}

describe("FsManifestStore", () => {
  test("initializes layout and writes manifest/config files", async () => {
    const auditDir = mkdtempSync(join(tmpdir(), "vex-audit-store-"));
    const plan = createPlan(auditDir);

    await runEffect(FsManifestStore.initLayout(plan, plan.urls));
    await runEffect(FsManifestStore.writeConfigUsed(plan, { command: "scan" }));
    await runEffect(FsManifestStore.saveManifest(plan, createAuditManifest({ auditId: "x" })));

    expect(await readFile(plan.urlsPath, "utf-8")).toBe("https://example.com\n");
    expect(await readFile(plan.configUsedPath, "utf-8")).toContain('"command": "scan"');
    expect(await readFile(plan.auditManifestPath, "utf-8")).toContain('"auditId": "x"');
  });
});
