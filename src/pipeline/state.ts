/**
 * Pipeline state management - session persistence and artifact storage.
 */

import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Data, Effect } from 'effect';
import type { Artifact } from '../core/types.js';
import { SESSION_STRUCTURE } from '../core/types.js';
import type { PipelineDefinition, PipelineState } from './types.js';

/**
 * JSON parsing failed when loading pipeline state.
 */
export class JsonParseError extends Data.TaggedError('JsonParseError')<{
  readonly message: string;
  readonly path: string;
}> {}

/**
 * Generate a unique session ID.
 * Format: YYYYMMDD-HHMM-xxxx (where xxxx is random)
 */
export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 16).replace(':', '');
  const random = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${random}`;
}

/**
 * Create session directory.
 * Note: Viewport subdirectories are created by operations, not here.
 */
export function createSessionDir(
  baseDir: string,
  sessionId?: string,
): Effect.Effect<string, PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const id = sessionId ?? generateSessionId();
    const sessionDir = join(baseDir, id);
    yield* fs.makeDirectory(sessionDir, { recursive: true });
    return sessionDir;
  });
}

/**
 * Initialize pipeline state.
 */
export function initializePipelineState(definition: PipelineDefinition, sessionDir: string): PipelineState {
  const nodes: PipelineState['nodes'] = {};

  for (const node of definition.nodes) {
    nodes[node.id] = {
      id: node.id,
      status: 'pending',
      outputArtifacts: [],
    };
  }

  return {
    definition,
    sessionDir,
    startedAt: new Date().toISOString(),
    status: 'running',
    nodes,
    artifacts: {},
    data: {},
    issues: [],
    semanticNames: {},
  };
}

/**
 * Save pipeline state to disk.
 */
export function savePipelineState(state: PipelineState): Effect.Effect<void, PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const statePath = join(state.sessionDir, SESSION_STRUCTURE.stateFile);
    yield* fs.writeFileString(statePath, JSON.stringify(state, null, 2));
  });
}

/**
 * Load pipeline state from disk.
 */
export function loadPipelineState(
  sessionDir: string,
): Effect.Effect<PipelineState, PlatformError | JsonParseError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const statePath = join(sessionDir, SESSION_STRUCTURE.stateFile);
    const content = yield* fs.readFileString(statePath);
    return yield* Effect.try({
      try: () => JSON.parse(content) as PipelineState,
      catch: (e) =>
        new JsonParseError({
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
          path: statePath,
        }),
    });
  });
}

/**
 * Store an artifact in the state.
 */
export function storeArtifact(state: PipelineState, artifact: Artifact): PipelineState {
  return {
    ...state,
    artifacts: {
      ...state.artifacts,
      [artifact.id]: artifact,
    },
  };
}

/**
 * Store a semantic name mapping in the state.
 */
export function storeSemanticName(state: PipelineState, name: string, artifactId: string): PipelineState {
  return {
    ...state,
    semanticNames: {
      ...state.semanticNames,
      [name]: artifactId,
    },
  };
}

/**
 * Store non-artifact data in the state.
 */
export function storeData(state: PipelineState, key: string, value: unknown): PipelineState {
  return {
    ...state,
    data: {
      ...state.data,
      [key]: value,
    },
  };
}

/**
 * Update node state.
 */
export function updateNodeState(
  state: PipelineState,
  nodeId: string,
  update: Partial<PipelineState['nodes'][string]>,
): PipelineState {
  const currentNode = state.nodes[nodeId];
  if (!currentNode) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: { ...currentNode, ...update },
    },
  };
}

/**
 * Check if all nodes are complete.
 */
export function isComplete(state: PipelineState): boolean {
  return Object.values(state.nodes).every((node) => node.status === 'completed' || node.status === 'skipped');
}

/**
 * Check if any node has failed.
 */
export function hasFailed(state: PipelineState): boolean {
  return Object.values(state.nodes).some((node) => node.status === 'failed');
}

/**
 * Get nodes that are ready to execute (all dependencies satisfied).
 */
export function getReadyNodes(state: PipelineState): string[] {
  const ready: string[] = [];

  for (const node of state.definition.nodes) {
    const nodeState = state.nodes[node.id];
    if (!nodeState || nodeState.status !== 'pending') continue;

    const inputEdges = state.definition.edges.filter((e) => e.to === node.id);
    const allInputsReady = inputEdges.every((edge) => {
      const sourceNode = state.nodes[edge.from];
      return sourceNode?.status === 'completed';
    });

    if (allInputsReady) {
      ready.push(node.id);
    }
  }

  return ready;
}

/** Result from a single node execution, used by mergeNodeResults. */
export interface NodeResult {
  readonly nodeId: string;
  readonly artifacts: Artifact[];
  readonly state: PipelineState;
}

/**
 * Merge results from parallel node executions into a single state.
 *
 * Each parallel executeNode receives the base state, so each result contains
 * the full nodes record with only its own entry updated. We detect changed
 * nodes by comparing status against the base state to avoid later results
 * overwriting earlier results' completed nodes back to pending.
 *
 * Safe because parallel nodes write to disjoint key spaces:
 * - nodes[nodeId] — unique per node
 * - artifacts[uuid] — unique IDs
 * - semanticNames["nodeId:field"] — node-prefixed
 * - data["nodeId:field"] — node-prefixed
 */
export function mergeNodeResults(
  base: PipelineState,
  results: ReadonlyArray<NodeResult>,
): PipelineState {
  const [only] = results;
  if (only && results.length === 1) return only.state;

  let merged = base;
  for (const result of results) {
    const changedNode = result.state.nodes[result.nodeId];

    merged = {
      ...merged,
      nodes: { ...merged.nodes, ...(changedNode ? { [result.nodeId]: changedNode } : {}) },
      artifacts: { ...merged.artifacts, ...result.state.artifacts },
      semanticNames: { ...merged.semanticNames, ...result.state.semanticNames },
      data: { ...merged.data, ...result.state.data },
      issues: [...merged.issues, ...result.state.issues],
    };
  }
  return merged;
}
