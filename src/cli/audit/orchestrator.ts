import type { RunScanAuditOptions } from "../audit-runner.js";
import type { AuditPorts } from "./ports.js";
import type { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import { buildAuditId } from "../scan-layout.js";
import {
  applyInvalidDeviceRun,
  applyRunOutcome,
  applyRunStarted,
  getAuditFinalStatus,
  toErrorMessage,
} from "./manifest.js";
import { planAudit } from "./plan.js";

export class AuditRunError extends Data.TaggedError("AuditRunError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export function runScanAuditWithPorts(
  options: RunScanAuditOptions,
  ports: AuditPorts,
): Effect.Effect<void, AuditRunError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const { cli, preset, resolved } = options;
    const startedAt = ports.clock.now();
    const auditId = buildAuditId(new Date(startedAt));
    const { plan, manifest: initialManifest } = planAudit(resolved, preset, startedAt, auditId);

    yield* ports.store.initLayout(plan, resolved.urls);
    yield* ports.store.writeConfigUsed(plan, {
      generatedAt: ports.clock.now(),
      command: "scan",
      preset,
      cli,
      resolved,
    });
    yield* ports.store.saveManifest(plan, initialManifest);
    ports.reporter.auditStarted(plan, plan.runs.length);

    let interrupted = false;
    const cleanup = yield* ports.signals.onInterrupt((signal) => {
      if (!interrupted) {
        interrupted = true;
        ports.reporter.interruptRequested(signal);
      }
    });

    let manifest = initialManifest;
    try {
      for (const spec of plan.runs) {
        if (interrupted) {
          break;
        }

        const started = { startedAt: ports.clock.now() };
        if (spec.kind === "invalid-device") {
          manifest = applyInvalidDeviceRun(manifest, spec, started, ports.clock.now());
          yield* ports.store.saveManifest(plan, manifest);
          return yield* new AuditRunError({ detail: spec.error });
        }

        manifest = applyRunStarted(manifest, spec, started);
        yield* ports.store.saveManifest(plan, manifest);
        ports.reporter.runStarted(spec, resolved);
        const outcome = yield* ports.runner.run(spec, resolved);
        manifest = applyRunOutcome(manifest, spec, started, outcome);
        yield* ports.store.saveManifest(plan, manifest);

        if (outcome.status === "completed") {
          ports.reporter.runCompleted(spec, outcome);
        } else {
          ports.reporter.runFailed(spec, outcome);
        }
      }
    } finally {
      yield* cleanup;
    }

    const finalManifest = {
      ...manifest,
      status: getAuditFinalStatus(manifest, interrupted),
      completedAt: ports.clock.now(),
    };
    yield* ports.store.saveManifest(plan, finalManifest);
    ports.reporter.auditCompleted(plan, finalManifest);
  }).pipe(
    Effect.mapError((error) =>
      error instanceof AuditRunError ? error : new AuditRunError({ detail: toErrorMessage(error) }),
    ),
  );
}
