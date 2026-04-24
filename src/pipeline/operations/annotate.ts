/**
 * Annotate operation - generates annotation tool calls from analysis.
 */

import type { AnalysisResult, AnnotationsArtifact, Issue, ToolCall } from "../../core/types.js";
import type { Operation, PipelineContext } from "../types.js";
import { Effect, Either, Schema as S } from "effect";
import { ToolCall as ToolCallSchema } from "../../core/schema.js";
import { VisionProvider } from "../../providers/shared/service.js";
import { OperationError } from "../types.js";
import { resolveProviderForOperation } from "./resolve-provider.js";

export type AnnotateConfig = {
  readonly provider: string;
  readonly model?: string;
};

export type AnnotateInput = {
  readonly result: AnalysisResult;
};

export type AnnotateOutput = {
  readonly toolCalls: readonly ToolCall[];
  readonly annotations: AnnotationsArtifact;
};

const ANNOTATION_PROMPT = `Based on the following issues, generate annotation tool calls to visually mark them on the screenshot.

Available tools:
1. draw_rectangle(start: "A1", end?: "B2", style: "error"|"warning"|"info"|"suggestion", label?: "text")
2. draw_arrow(from: "A1", to: "B2", style: "error"|"warning"|"info"|"suggestion", label?: "text")
3. add_label(cell: "A1", text: "label text", style: "error"|"warning"|"info"|"suggestion", position?: "top"|"bottom"|"left"|"right")

Style mapping:
- high severity → "error" (red)
- medium severity → "warning" (orange)
- low severity → "info" (blue)
- suggestions → "suggestion" (green)

Issues to annotate:
{{ISSUES}}

Generate a JSON array of tool calls:
[
  {"tool": "draw_rectangle", "params": {"start": "A1", "end": "B2", "style": "error", "label": "Issue description"}},
  ...
]`;

function formatIssuesForPrompt(issues: readonly Issue[]): string {
  return issues
    .map(
      (issue) =>
        `- #${issue.id} [${issue.severity}]: ${issue.description} at ${typeof issue.region === "string" ? issue.region : `(${issue.region.x},${issue.region.y})`}`,
    )
    .join("\n");
}

function parseToolCalls(response: string): readonly ToolCall[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch === null) {
      return [];
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    const result = S.decodeUnknownEither(S.Array(ToolCallSchema))(parsed);
    if (Either.isRight(result)) {
      return result.right.map(normalizeToolCall);
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const toolCalls: ToolCall[] = [];
    const items: readonly unknown[] = parsed;
    for (const item of items) {
      const itemResult = S.decodeUnknownEither(ToolCallSchema)(item);
      if (Either.isRight(itemResult)) {
        toolCalls.push(normalizeToolCall(itemResult.right));
      }
    }
    return toolCalls;
  } catch {
    return [];
  }
}

function normalizeToolCall(call: typeof ToolCallSchema.Type): ToolCall {
  switch (call.tool) {
    case "draw_rectangle":
      return {
        tool: call.tool,
        params: {
          start: call.params.start,
          style: call.params.style,
          ...(call.params.end !== undefined ? { end: call.params.end } : {}),
          ...(call.params.label !== undefined ? { label: call.params.label } : {}),
        },
      };
    case "draw_arrow":
      return {
        tool: call.tool,
        params: {
          from: call.params.from,
          to: call.params.to,
          style: call.params.style,
          ...(call.params.label !== undefined ? { label: call.params.label } : {}),
        },
      };
    case "add_label":
      return {
        tool: call.tool,
        params: {
          cell: call.params.cell,
          text: call.params.text,
          style: call.params.style,
          ...(call.params.position !== undefined ? { position: call.params.position } : {}),
        },
      };
    default:
      return call;
  }
}

/**
 * Creates an annotations artifact from tool calls.
 * Writes the file and stores the artifact in context.
 */
function createAnnotationsArtifact(
  toolCalls: readonly ToolCall[],
  issueCount: number,
  ctx: PipelineContext,
): Effect.Effect<AnnotationsArtifact, OperationError> {
  return Effect.gen(function* () {
    const outputPath = yield* ctx.getArtifactPath("annotations").pipe(
      Effect.mapError(
        (e) =>
          new OperationError({
            operation: "annotate",
            detail: "Failed to get annotations path",
            cause: e,
          }),
      ),
    );

    yield* Effect.tryPromise({
      try: async () => Bun.write(outputPath, JSON.stringify(toolCalls, null, 2)),
      catch: (e) =>
        new OperationError({
          operation: "annotate",
          detail: "Failed to save annotations",
          cause: e,
        }),
    });

    const artifact: AnnotationsArtifact = {
      _kind: "artifact",
      id: crypto.randomUUID(),
      type: "annotations",
      path: outputPath,
      createdAt: new Date().toISOString(),
      createdBy: "annotate",
      metadata: {
        toolCallCount: toolCalls.length,
        issueCount,
      },
    };

    ctx.storeArtifact(artifact);
    return artifact;
  });
}

export const annotateOperation: Operation<AnnotateInput, AnnotateOutput, AnnotateConfig> = {
  name: "annotate",
  description: "Generate annotation tool calls from analysis",
  inputTypes: ["analysis"],
  outputTypes: ["annotations"],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { provider, model } = config;
      const { issues } = input.result;

      if (issues.length === 0) {
        ctx.logger.info("No issues to annotate");
        const artifact = yield* createAnnotationsArtifact([], 0, ctx);
        return { toolCalls: [], annotations: artifact };
      }

      ctx.logger.info(`Generating annotations for ${issues.length} issues`);

      const prompt = ANNOTATION_PROMPT.replace("{{ISSUES}}", formatIssuesForPrompt(issues));

      const providerLayer = yield* resolveProviderForOperation(provider, "annotate");

      const visionResult = yield* Effect.gen(function* () {
        const visionProvider = yield* VisionProvider;
        return yield* visionProvider.analyze([], prompt, model !== undefined ? { model } : {});
      }).pipe(
        // @effect-diagnostics-next-line strictEffectProvide:off
        Effect.provide(providerLayer),
        Effect.mapError(
          (e) =>
            new OperationError({
              operation: "annotate",
              detail: "Annotation generation failed",
              cause: e,
            }),
        ),
      );

      const toolCalls = parseToolCalls(visionResult.response);
      ctx.logger.info(`Generated ${toolCalls.length} annotations`);

      const artifact = yield* createAnnotationsArtifact(toolCalls, issues.length, ctx);
      return { toolCalls, annotations: artifact };
    }),
};
