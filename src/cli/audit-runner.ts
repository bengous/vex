import type { AuditPorts } from "./audit/ports.js";
import type { ResolvedScanOptions } from "./resolve.js";
import type { FileSystem } from "@effect/platform";
import type { Effect } from "effect";
import { ConsoleReporter } from "./audit/adapters/console-reporter.js";
import { EffectPipelineRunner } from "./audit/adapters/effect-pipeline-runner.js";
import { FsManifestStore } from "./audit/adapters/fs-manifest-store.js";
import { ProcessSignals } from "./audit/adapters/process-signals.js";
import { SystemClock } from "./audit/adapters/system-clock.js";
import { getAuditFinalStatus, toErrorMessage } from "./audit/manifest.js";
import { AuditRunError, runScanAuditWithPorts } from "./audit/orchestrator.js";

export { AuditRunError, getAuditFinalStatus, toErrorMessage };

export type ScanAuditCliMetadata = {
  readonly url: string | undefined;
  readonly device: string | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
  readonly providerProfile: string | undefined;
  readonly full: boolean;
  readonly placeholderMedia: boolean;
  readonly output: string | undefined;
};

export type RunScanAuditOptions = {
  readonly resolved: ResolvedScanOptions;
  readonly preset: string | undefined;
  readonly cli: ScanAuditCliMetadata;
};

export function createDefaultAuditPorts(): AuditPorts {
  return {
    clock: SystemClock,
    store: FsManifestStore,
    signals: ProcessSignals,
    runner: EffectPipelineRunner,
    reporter: ConsoleReporter,
  };
}

export function runScanAudit(
  options: RunScanAuditOptions,
): Effect.Effect<void, AuditRunError, FileSystem.FileSystem> {
  return runScanAuditWithPorts(options, createDefaultAuditPorts());
}
