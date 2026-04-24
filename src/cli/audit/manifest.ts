import type { AnalysisResult, Artifact } from "../../core/types.js";
import type { AuditManifest, AuditRunRecord, AuditStatus } from "../scan-layout.js";
import type { InvalidDeviceRunSpec, ValidRunSpec } from "./plan.js";

export type RunOutcome = {
  readonly status: "completed" | "failed";
  readonly completedAt: string;
  readonly mode: "analyze" | "capture-only";
  readonly sessionDir?: string;
  readonly issueCount?: number;
  readonly error?: string;
  readonly artifacts: readonly Artifact[];
  readonly analysis?: AnalysisResult;
};

export type StartedRun = {
  readonly startedAt: string;
};

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

export function getAuditFinalStatus(manifest: AuditManifest, interrupted: boolean): AuditStatus {
  if (interrupted) {
    return "interrupted";
  }
  if (manifest.totalRuns > 0 && manifest.failedRuns === manifest.totalRuns) {
    return "failed";
  }
  return "completed";
}

export function applyRunStarted(
  manifest: AuditManifest,
  spec: ValidRunSpec,
  started: StartedRun,
): AuditManifest {
  const run: AuditRunRecord = {
    url: spec.url,
    deviceId: spec.deviceId,
    viewport: spec.viewport,
    pagePath: spec.pagePath,
    viewportPath: spec.viewportPath,
    status: "running",
    startedAt: started.startedAt,
  };

  return {
    ...manifest,
    runs: [...manifest.runs, run],
  };
}

export function applyRunOutcome(
  manifest: AuditManifest,
  spec: ValidRunSpec,
  started: StartedRun,
  outcome: RunOutcome,
): AuditManifest {
  const previousRuns = manifest.runs.filter(
    (run) =>
      !(
        run.url === spec.url &&
        run.deviceId === spec.deviceId &&
        run.startedAt === started.startedAt &&
        run.status === "running"
      ),
  );
  const run: AuditRunRecord = {
    url: spec.url,
    deviceId: spec.deviceId,
    viewport: spec.viewport,
    pagePath: spec.pagePath,
    viewportPath: spec.viewportPath,
    status: outcome.status,
    startedAt: started.startedAt,
    completedAt: outcome.completedAt,
    ...(outcome.issueCount !== undefined ? { issueCount: outcome.issueCount } : {}),
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  };

  return {
    ...manifest,
    completedRuns: manifest.completedRuns + (outcome.status === "completed" ? 1 : 0),
    failedRuns: manifest.failedRuns + (outcome.status === "failed" ? 1 : 0),
    runs: [...previousRuns, run],
  };
}

export function applyInvalidDeviceRun(
  manifest: AuditManifest,
  spec: InvalidDeviceRunSpec,
  started: StartedRun,
  completedAt: string,
): AuditManifest {
  const run: AuditRunRecord = {
    url: spec.url,
    deviceId: spec.deviceId,
    pagePath: spec.pagePath,
    viewportPath: "",
    status: "failed",
    startedAt: started.startedAt,
    completedAt,
    error: spec.error,
  };

  return {
    ...manifest,
    failedRuns: manifest.failedRuns + 1,
    runs: [...manifest.runs, run],
  };
}
