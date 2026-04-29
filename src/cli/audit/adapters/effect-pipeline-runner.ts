import type { AnalysisResult } from "../../../core/types.js";
import type { PipelineRunner } from "../ports.js";
import { Effect, Schema as S } from "effect";
import { Issue as IssueSchema } from "../../../core/schema.js";
import { runPipeline } from "../../../pipeline/runtime.js";
import { withProviderExecution } from "../../../providers/shared/profile-execution.js";
import { buildScanPipeline } from "../../scan-pipeline.js";
import { toErrorMessage } from "../manifest.js";

const AnalysisResultSchema = S.Struct({
  provider: S.String,
  model: S.String,
  response: S.String,
  durationMs: S.Number,
  issues: S.Array(IssueSchema),
  rawJson: S.optional(S.Unknown),
});

export const EffectPipelineRunner: PipelineRunner = {
  run: (spec, resolved) =>
    Effect.gen(function* () {
      const completedAt = () => new Date().toISOString();
      const pipeline = buildScanPipeline({
        url: spec.url,
        viewport: spec.viewport,
        mode: resolved.mode,
        full: resolved.full,
        provider: resolved.provider,
        model: resolved.model,
        reasoning: resolved.reasoning,
        frame: resolved.frame,
        placeholderMedia: resolved.placeholderMedia,
        fullPageScrollFix: resolved.fullPageScrollFix,
      });

      const exit = yield* Effect.either(
        Effect.gen(function* () {
          const result = yield* withProviderExecution(
            { provider: resolved.provider, profile: resolved.profile },
            runPipeline(pipeline, spec.pageDir, undefined, {
              sessionId: spec.viewportDirName,
              artifactLayout: "session-root",
            }),
          );
          const artifacts = Object.values(result.artifacts);
          const analysisArtifact = artifacts.find((artifact) => artifact.type === "analysis");
          const analysis =
            analysisArtifact !== undefined
              ? ((yield* S.decodeUnknown(S.parseJson(AnalysisResultSchema))(
                  yield* Effect.promise(async () => Bun.file(analysisArtifact.path).text()),
                )) as AnalysisResult)
              : undefined;

          return {
            status: result.status === "completed" ? "completed" : "failed",
            completedAt: completedAt(),
            mode: resolved.mode,
            sessionDir: result.sessionDir,
            issueCount: result.issues.length,
            artifacts,
            ...(analysis !== undefined ? { analysis } : {}),
          } as const;
        }),
      );

      if (exit._tag === "Right") {
        return exit.right;
      }

      return {
        status: "failed",
        completedAt: completedAt(),
        mode: resolved.mode,
        error: toErrorMessage(exit.left),
        artifacts: [],
      } as const;
    }),
};
