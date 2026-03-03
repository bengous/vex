/**
 * Annotate operation - generates annotation tool calls from analysis.
 */

import { Effect } from 'effect';
import type { AnalysisResult, AnnotationsArtifact, Issue, ToolCall } from '../../core/types.js';
import { VisionProvider } from '../../providers/shared/service.js';
import { type Operation, OperationError, type PipelineContext } from '../types.js';
import { resolveProviderForOperation } from './resolve-provider.js';

export interface AnnotateConfig {
  readonly provider: string;
  readonly model?: string;
}

export interface AnnotateInput {
  readonly result: AnalysisResult;
}

export interface AnnotateOutput {
  readonly toolCalls: readonly ToolCall[];
  readonly annotations: AnnotationsArtifact;
}

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
        `- #${issue.id} [${issue.severity}]: ${issue.description} at ${typeof issue.region === 'string' ? issue.region : `(${issue.region.x},${issue.region.y})`}`,
    )
    .join('\n');
}

function parseToolCalls(response: string): ToolCall[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (call): call is ToolCall =>
        typeof call === 'object' &&
        call !== null &&
        ['draw_rectangle', 'draw_arrow', 'add_label'].includes(call.tool) &&
        typeof call.params === 'object',
    );
  } catch {
    return [];
  }
}

/**
 * Creates an annotations artifact from tool calls.
 * Writes the file and stores the artifact in context.
 */
function createAnnotationsArtifact(toolCalls: readonly ToolCall[], issueCount: number, ctx: PipelineContext) {
  return Effect.gen(function* () {
    const outputPath = yield* ctx
      .getArtifactPath('annotations')
      .pipe(
        Effect.mapError(
          (e) => new OperationError({ operation: 'annotate', detail: 'Failed to get annotations path', cause: e }),
        ),
      );

    yield* Effect.tryPromise({
      try: () => Bun.write(outputPath, JSON.stringify(toolCalls, null, 2)),
      catch: (e) => new OperationError({ operation: 'annotate', detail: 'Failed to save annotations', cause: e }),
    });

    const artifact: AnnotationsArtifact = {
      id: crypto.randomUUID(),
      type: 'annotations',
      path: outputPath,
      createdAt: new Date().toISOString(),
      createdBy: 'annotate',
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
  name: 'annotate',
  description: 'Generate annotation tool calls from analysis',
  inputTypes: ['analysis'],
  outputTypes: ['annotations'],

  execute: (input, config, ctx) =>
    Effect.gen(function* () {
      const { provider, model } = config;
      const { issues } = input.result;

      if (issues.length === 0) {
        ctx.logger.info('No issues to annotate');
        const artifact = yield* createAnnotationsArtifact([], 0, ctx);
        return { toolCalls: [] as readonly ToolCall[], annotations: artifact };
      }

      ctx.logger.info(`Generating annotations for ${issues.length} issues`);

      const prompt = ANNOTATION_PROMPT.replace('{{ISSUES}}', formatIssuesForPrompt(issues));

      const providerLayer = yield* resolveProviderForOperation(provider, 'annotate');

      const visionResult = yield* Effect.gen(function* () {
        const visionProvider = yield* VisionProvider;
        return yield* visionProvider.analyze([], prompt, { model });
      }).pipe(
        Effect.provide(providerLayer),
        Effect.mapError(
          (e) => new OperationError({ operation: 'annotate', detail: 'Annotation generation failed', cause: e }),
        ),
      );

      const toolCalls = parseToolCalls(visionResult.response);
      ctx.logger.info(`Generated ${toolCalls.length} annotations`);

      const artifact = yield* createAnnotationsArtifact(toolCalls, issues.length, ctx);
      return { toolCalls, annotations: artifact };
    }),
};
