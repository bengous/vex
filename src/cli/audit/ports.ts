import type { ResolvedScanOptions } from "../resolve.js";
import type { AuditManifest } from "../scan-layout.js";
import type { RunOutcome } from "./manifest.js";
import type { AuditPlan, ValidRunSpec } from "./plan.js";
import type { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import type { Effect } from "effect";

export type Clock = {
  readonly now: () => string;
};

export type ManifestStore = {
  readonly initLayout: (
    plan: AuditPlan,
    urls: readonly string[],
  ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem>;
  readonly writeConfigUsed: (
    plan: AuditPlan,
    payload: unknown,
  ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem>;
  readonly saveManifest: (
    plan: AuditPlan,
    manifest: AuditManifest,
  ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem>;
};

export type SignalListener = {
  readonly onInterrupt: (
    handler: (signal: "SIGINT" | "SIGTERM") => void,
  ) => Effect.Effect<Effect.Effect<void>>;
};

export type PipelineRunner = {
  readonly run: (
    spec: ValidRunSpec,
    resolved: ResolvedScanOptions,
  ) => Effect.Effect<RunOutcome, never, FileSystem.FileSystem>;
};

export type AuditReporter = {
  readonly auditStarted: (plan: AuditPlan, totalRuns: number) => void;
  readonly runStarted: (spec: ValidRunSpec, resolved: ResolvedScanOptions) => void;
  readonly runCompleted: (spec: ValidRunSpec, outcome: RunOutcome) => void;
  readonly runFailed: (spec: ValidRunSpec, outcome: RunOutcome) => void;
  readonly interruptRequested: (signal: "SIGINT" | "SIGTERM") => void;
  readonly auditCompleted: (plan: AuditPlan, manifest: AuditManifest) => void;
};

export type AuditPorts = {
  readonly clock: Clock;
  readonly store: ManifestStore;
  readonly signals: SignalListener;
  readonly runner: PipelineRunner;
  readonly reporter: AuditReporter;
};
