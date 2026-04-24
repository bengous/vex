import type { AuditManifest } from "../../scan-layout.js";
import type { RunOutcome } from "../manifest.js";
import type { AuditReporter } from "../ports.js";

function printRunDetails(outcome: RunOutcome): void {
  if (outcome.sessionDir !== undefined) {
    console.log(`\nSession: ${outcome.sessionDir}`);
  }
  console.log(`Status: ${outcome.status}`);

  console.log(`\nArtifacts (${outcome.artifacts.length}):`);
  for (const artifact of outcome.artifacts) {
    console.log(`  - ${artifact.type}: ${artifact.path}`);
  }

  if (outcome.analysis !== undefined) {
    console.log(`\nAnalysis (${outcome.analysis.provider}/${outcome.analysis.model}):`);
    console.log(`Duration: ${outcome.analysis.durationMs}ms`);

    if (outcome.analysis.issues.length > 0) {
      console.log(`\nIssues found (${outcome.analysis.issues.length}):`);
      for (const issue of outcome.analysis.issues) {
        const regionStr =
          typeof issue.region === "string" ? issue.region : `(${issue.region.x},${issue.region.y})`;
        console.log(`  [${issue.severity.toUpperCase()}] ${issue.description} @ ${regionStr}`);
        if (issue.suggestedFix !== undefined && issue.suggestedFix.length > 0) {
          console.log(`           Fix: ${issue.suggestedFix}`);
        }
      }
    } else {
      console.log("\nNo issues found.");
    }
  } else if (outcome.mode === "capture-only") {
    console.log("\nAnalysis skipped (capture-only mode).");
  }

  console.log("");
}

export const ConsoleReporter: AuditReporter = {
  auditStarted: (plan, totalRuns) => {
    console.log(`Audit: ${plan.auditDir}`);
    console.log(
      `Targets: ${totalRuns} (${plan.urls.length} URL(s) x ${plan.devices.length} device(s))`,
    );
    console.log("");
  },

  runStarted: (spec, resolved) => {
    console.log(`Scanning ${spec.url}`);
    console.log(`Viewport: ${spec.viewport.width}x${spec.viewport.height} (${spec.deviceId})`);
    if (resolved.mode === "capture-only") {
      console.log("Pipeline: capture-only (no model call)");
    } else {
      console.log(
        `Provider: ${resolved.provider}${resolved.model !== undefined && resolved.model.length > 0 ? ` (model: ${resolved.model})` : ""}${resolved.reasoning !== undefined && resolved.reasoning.length > 0 ? ` (reasoning: ${resolved.reasoning})` : ""}${resolved.profile !== "minimal" ? ` (profile: ${resolved.profile})` : ""}`,
      );
      if (resolved.full) {
        console.log("Pipeline: full-annotation (analyze + annotate + render)");
      } else {
        console.log("Pipeline: simple-analysis (capture + analyze)");
      }
    }
    if (resolved.placeholderMedia !== undefined) {
      console.log("Placeholder media: enabled");
    }
    if (resolved.fullPageScrollFix !== undefined) {
      console.log("Full-page scroll fix: enabled");
    }
    console.log(`Output: ${spec.viewportDir}`);
    console.log("");
  },

  runCompleted: (_spec, outcome) => printRunDetails(outcome),

  runFailed: (spec, outcome) => {
    if (outcome.error !== undefined) {
      console.error(`[ERROR] Failed ${spec.url} (${spec.deviceId}): ${outcome.error}`);
      console.log("");
      return;
    }
    printRunDetails(outcome);
  },

  interruptRequested: (signal) => {
    if (signal === "SIGINT") {
      console.warn("\n[WARN] Interrupt received. Finishing current page, then stopping audit.");
    } else {
      console.warn("\n[WARN] Termination requested. Finishing current page, then stopping audit.");
    }
  },

  auditCompleted: (plan, manifest: AuditManifest) => {
    console.log(`Audit complete: ${manifest.status}`);
    console.log(`Completed runs: ${manifest.completedRuns}/${manifest.totalRuns}`);
    if (manifest.failedRuns > 0) {
      console.log(`Failed runs: ${manifest.failedRuns}`);
    }
    console.log(`Audit metadata: ${plan.auditManifestPath}`);
    console.log("");
  },
};
