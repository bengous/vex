/**
 * Effect Schema decoders for persisted pipeline state.
 *
 * These are intentionally boundary-facing. Runtime code keeps the richer
 * TypeScript types; disk reloads must prove external JSON before reuse.
 */

import type { Artifact } from "../core/types.js";
import type { PipelineDefinition, PipelineState } from "./types.js";
import { ParseResult, Schema as S } from "effect";
import { Artifact as ArtifactSchema, IssueArray } from "../core/schema.js";
import { OperationError } from "./types.js";

const NodeStatus = S.Literal("pending", "running", "completed", "failed", "skipped");

const OperationErrorSnapshot = S.Struct({
  _tag: S.optional(S.String),
  operation: S.String,
  detail: S.String,
  cause: S.optional(S.Unknown),
});

const NodeState = S.Struct({
  id: S.String,
  status: NodeStatus,
  startedAt: S.optional(S.String),
  completedAt: S.optional(S.String),
  outputArtifacts: S.Array(S.String),
  error: S.optional(OperationErrorSnapshot),
});

const PipelineNode = S.Struct({
  id: S.String,
  operation: S.String,
  config: S.Record({ key: S.String, value: S.Unknown }),
  inputs: S.Array(S.String),
  outputs: S.Array(S.String),
});

const PipelineEdge = S.Struct({
  from: S.String,
  to: S.String,
  artifact: S.String,
  targetField: S.optional(S.String),
});

const PipelineDefinition = S.Struct({
  name: S.String,
  description: S.String,
  nodes: S.Array(PipelineNode),
  edges: S.Array(PipelineEdge),
  inputs: S.Array(S.String),
  outputs: S.Array(S.String),
});

const PersistedPipelineState = S.Struct({
  definition: PipelineDefinition,
  sessionDir: S.String,
  startedAt: S.String,
  completedAt: S.optional(S.String),
  status: S.Literal("running", "completed", "failed", "paused"),
  nodes: S.Record({ key: S.String, value: NodeState }),
  artifacts: S.Record({ key: S.String, value: ArtifactSchema }),
  data: S.optional(S.Record({ key: S.String, value: S.Unknown })),
  issues: IssueArray,
  semanticNames: S.optional(S.Record({ key: S.String, value: S.String })),
});

type PersistedPipelineState = typeof PersistedPipelineState.Type;

function normalizeArtifact(artifact: typeof ArtifactSchema.Type): Artifact {
  return { ...artifact, _kind: "artifact" };
}

function normalizeNodeError(error: typeof OperationErrorSnapshot.Type): OperationError {
  return new OperationError({
    operation: error.operation,
    detail: error.detail,
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
  });
}

function normalizePipelineState(state: PersistedPipelineState): PipelineState {
  const artifacts: Record<string, Artifact> = {};
  for (const [id, artifact] of Object.entries(state.artifacts)) {
    artifacts[id] = normalizeArtifact(artifact);
  }

  const nodes: PipelineState["nodes"] = {};
  for (const [id, node] of Object.entries(state.nodes)) {
    nodes[id] = {
      id: node.id,
      status: node.status,
      outputArtifacts: node.outputArtifacts,
      ...(node.startedAt !== undefined ? { startedAt: node.startedAt } : {}),
      ...(node.completedAt !== undefined ? { completedAt: node.completedAt } : {}),
      ...(node.error !== undefined ? { error: normalizeNodeError(node.error) } : {}),
    };
  }

  return {
    definition: normalizePipelineDefinition(state.definition),
    sessionDir: state.sessionDir,
    startedAt: state.startedAt,
    ...(state.completedAt !== undefined ? { completedAt: state.completedAt } : {}),
    status: state.status,
    nodes,
    artifacts,
    data: state.data ?? {},
    issues: state.issues,
    semanticNames: state.semanticNames ?? {},
  };
}

function normalizePipelineDefinition(
  definition: PersistedPipelineState["definition"],
): PipelineDefinition {
  return {
    name: definition.name,
    description: definition.description,
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      operation: node.operation,
      config: node.config,
      inputs: node.inputs,
      outputs: node.outputs,
    })),
    edges: definition.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      artifact: edge.artifact,
      ...(edge.targetField !== undefined ? { targetField: edge.targetField } : {}),
    })),
    inputs: definition.inputs,
    outputs: definition.outputs,
  };
}

export const PipelineStateFromUnknown = S.transformOrFail(
  PersistedPipelineState,
  S.declare((value): value is PipelineState => typeof value === "object" && value !== null),
  {
    strict: true,
    decode: (state) => ParseResult.succeed(normalizePipelineState(state)),
    encode: (state) => ParseResult.succeed(state),
  },
);

export function decodePipelineState(raw: unknown): PipelineState {
  return S.decodeUnknownSync(PipelineStateFromUnknown)(raw);
}
