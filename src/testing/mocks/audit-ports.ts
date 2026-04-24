import type { RunOutcome } from "../../cli/audit/manifest.js";
import type { AuditPlan, ValidRunSpec } from "../../cli/audit/plan.js";
import type {
  AuditPorts,
  AuditReporter,
  Clock,
  ManifestStore,
  PipelineRunner,
  SignalListener,
} from "../../cli/audit/ports.js";
import type { AuditManifest } from "../../cli/scan-layout.js";
import { Effect } from "effect";

export type InMemoryManifestStore = ManifestStore & {
  readonly savedManifests: AuditManifest[];
  readonly configPayloads: unknown[];
  readonly initializedPlans: AuditPlan[];
};

export function createFixedClock(values: readonly string[] = []): Clock {
  let index = 0;
  return {
    now: () => values[index++] ?? "2026-04-24T00:00:00.000Z",
  };
}

export function createInMemoryManifestStore(): InMemoryManifestStore {
  const savedManifests: AuditManifest[] = [];
  const configPayloads: unknown[] = [];
  const initializedPlans: AuditPlan[] = [];

  return {
    savedManifests,
    configPayloads,
    initializedPlans,
    initLayout: (plan) =>
      Effect.sync(() => {
        initializedPlans.push(plan);
      }),
    writeConfigUsed: (_plan, payload) =>
      Effect.sync(() => {
        configPayloads.push(payload);
      }),
    saveManifest: (_plan, manifest) =>
      Effect.sync(() => {
        savedManifests.push(structuredClone(manifest));
      }),
  };
}

export type TestSignalListener = SignalListener & {
  readonly trigger: (signal: "SIGINT" | "SIGTERM") => void;
  readonly cleanupCount: () => number;
};

export function createTestSignalListener(): TestSignalListener {
  let handler: ((signal: "SIGINT" | "SIGTERM") => void) | undefined;
  let cleanups = 0;
  return {
    trigger: (signal) => handler?.(signal),
    cleanupCount: () => cleanups,
    onInterrupt: (nextHandler) =>
      Effect.sync(() => {
        handler = nextHandler;
        return Effect.sync(() => {
          cleanups += 1;
          handler = undefined;
        });
      }),
  };
}

export function createNoopSignalListener(): SignalListener {
  return {
    onInterrupt: () => Effect.succeed(Effect.void),
  };
}

export function createFakePipelineRunner(outcomes: readonly RunOutcome[]): PipelineRunner {
  let index = 0;
  return {
    run: () =>
      Effect.sync(() => {
        const outcome = outcomes[index++];
        if (outcome === undefined) {
          return {
            status: "failed",
            completedAt: "2026-04-24T00:00:00.000Z",
            mode: "analyze",
            error: "No fake outcome configured",
            artifacts: [],
          } satisfies RunOutcome;
        }
        return outcome;
      }),
  };
}

export type CapturingAuditReporter = AuditReporter & {
  readonly events: readonly string[];
};

export function createCapturingReporter(): CapturingAuditReporter {
  const events: string[] = [];
  return {
    events,
    auditStarted: () => events.push("auditStarted"),
    runStarted: (spec) => events.push(`runStarted:${spec.url}:${spec.deviceId}`),
    runCompleted: (spec) => events.push(`runCompleted:${spec.url}:${spec.deviceId}`),
    runFailed: (spec) => events.push(`runFailed:${spec.url}:${spec.deviceId}`),
    interruptRequested: (signal) => events.push(`interrupt:${signal}`),
    auditCompleted: (_plan, manifest) => events.push(`auditCompleted:${manifest.status}`),
  };
}

export function createAuditPorts(overrides: Partial<AuditPorts> = {}): AuditPorts {
  return {
    clock: createFixedClock(),
    store: createInMemoryManifestStore(),
    signals: createNoopSignalListener(),
    runner: createFakePipelineRunner([]),
    reporter: createCapturingReporter(),
    ...overrides,
  };
}

export function createRunOutcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    status: "completed",
    completedAt: "2026-04-24T00:00:01.000Z",
    mode: "analyze",
    issueCount: 0,
    artifacts: [],
    ...overrides,
  };
}

export function createInterruptingRunner(
  signalListener: TestSignalListener,
  signal: "SIGINT" | "SIGTERM",
  outcomes: readonly RunOutcome[],
): PipelineRunner {
  const base = createFakePipelineRunner(outcomes);
  let runs = 0;
  return {
    run: (spec: ValidRunSpec, resolved) =>
      base.run(spec, resolved).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            runs += 1;
            if (runs === 2) {
              signalListener.trigger(signal);
            }
          }),
        ),
      ),
  };
}
