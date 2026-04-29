import type { ViewportConfig } from "../../core/types.js";
import type { ResolvedScanOptions } from "../resolve.js";
import type { AuditManifest } from "../scan-layout.js";
import { join, relative } from "node:path";
import { getAllDeviceIds, lookupDevice } from "../../core/devices.js";
import { getViewportDirName } from "../../core/types.js";
import { getAuditPageDir, getAuditViewportDir } from "../scan-layout.js";

export type ValidRunSpec = {
  readonly kind: "valid";
  readonly url: string;
  readonly deviceId: string;
  readonly viewport: ViewportConfig;
  readonly pageDir: string;
  readonly pagePath: string;
  readonly viewportDir: string;
  readonly viewportPath: string;
  readonly viewportDirName: string;
};

export type InvalidDeviceRunSpec = {
  readonly kind: "invalid-device";
  readonly url: string;
  readonly deviceId: string;
  readonly pageDir: string;
  readonly pagePath: string;
  readonly viewportPath: "";
  readonly error: string;
};

export type RunSpec = ValidRunSpec | InvalidDeviceRunSpec;

export type AuditPlan = {
  readonly auditId: string;
  readonly auditDir: string;
  readonly auditManifestPath: string;
  readonly configUsedPath: string;
  readonly urlsPath: string;
  readonly urls: readonly string[];
  readonly devices: readonly string[];
  readonly runs: readonly RunSpec[];
};

export type PlanResult = {
  readonly plan: AuditPlan;
  readonly manifest: AuditManifest;
};

export function planAudit(
  resolved: ResolvedScanOptions,
  preset: string | undefined,
  now: string,
  auditId: string,
): PlanResult {
  const auditDir = join(resolved.outputDir, auditId);
  const runs: RunSpec[] = [];

  for (const url of resolved.urls) {
    for (const deviceId of resolved.devices) {
      const pageDir = getAuditPageDir(auditDir, url);
      const pagePath = relative(auditDir, pageDir);
      const deviceResult = lookupDevice(deviceId);

      if (deviceResult === undefined) {
        runs.push({
          kind: "invalid-device",
          url,
          deviceId,
          pageDir,
          pagePath,
          viewportPath: "",
          error: `Unknown device: ${deviceId}.
Use explicit device IDs (e.g., iphone-se-2016 or iphone-se-2022).
Valid devices: ${getAllDeviceIds().join(", ")}`,
        });
        continue;
      }

      const viewport = deviceResult.preset.viewport;
      const viewportDirName = getViewportDirName(viewport, deviceId);
      const viewportDir = getAuditViewportDir(auditDir, url, viewport, deviceId);
      runs.push({
        kind: "valid",
        url,
        deviceId,
        viewport,
        pageDir,
        pagePath,
        viewportDir,
        viewportPath: relative(auditDir, viewportDir),
        viewportDirName,
      });
    }
  }

  return {
    plan: {
      auditId,
      auditDir,
      auditManifestPath: join(auditDir, "audit.json"),
      configUsedPath: join(auditDir, "config.used.json"),
      urlsPath: join(auditDir, "urls.txt"),
      urls: resolved.urls,
      devices: resolved.devices,
      runs,
    },
    manifest: {
      type: "vex-audit",
      auditId,
      status: "running",
      startedAt: now,
      outputDir: auditDir,
      provider: resolved.provider,
      ...(resolved.model !== undefined ? { model: resolved.model } : {}),
      ...(resolved.reasoning !== undefined ? { reasoning: resolved.reasoning } : {}),
      ...(preset !== undefined ? { preset } : {}),
      urls: resolved.urls,
      devices: resolved.devices,
      mode: resolved.mode,
      full: resolved.full,
      ...(resolved.frame !== undefined
        ? { frame: resolved.frame.name, frameStyle: resolved.frame.style }
        : {}),
      placeholderMedia: resolved.placeholderMedia !== undefined,
      fullPageScrollFix: resolved.fullPageScrollFix !== undefined,
      totalRuns: resolved.urls.length * resolved.devices.length,
      completedRuns: 0,
      failedRuns: 0,
      runs: [],
    },
  };
}
