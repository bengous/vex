/**
 * Pipeline runtime - DAG executor for composable operations.
 */

import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect } from 'effect';
import type { Artifact, ViewportConfig } from '../core/types.js';
import { ARTIFACT_NAMES, getViewportDirName } from '../core/types.js';
import { analyzeOperation } from './operations/analyze.js';
import { annotateOperation } from './operations/annotate.js';
import { captureOperation } from './operations/capture.js';
import { diffOperation } from './operations/diff.js';
import { overlayFoldsOperation } from './operations/overlay-folds.js';
import { overlayGridOperation } from './operations/overlay-grid.js';
import { renderOperation } from './operations/render.js';
import {
  createSessionDir,
  getReadyNodes,
  hasFailed,
  initializePipelineState,
  isComplete,
  loadPipelineState,
  savePipelineState,
  storeArtifact,
  storeData,
  storeSemanticName,
  updateNodeState,
} from './state.js';
import {
  type DataKey,
  type DataValue,
  type Logger,
  type Operation,
  OperationError,
  type PipelineContext,
  type PipelineDefinition,
  type PipelineError,
  type PipelineState,
} from './types.js';

/**
 * Internal extension of PipelineContext with methods for artifact/data mapping.
 * Used by the runtime to wire operation outputs to edges.
 */
interface InternalPipelineContext extends PipelineContext {
  _mapSemanticName: (name: string, artifact: Artifact) => void;
  _mapData: (name: string, value: unknown) => void;
}

// Operation registry - use any to avoid complex generic constraints
// biome-ignore lint/suspicious/noExplicitAny: Operations have varying signatures
const OPERATIONS: Record<string, Operation<any, any, any>> = {
  capture: captureOperation,
  'overlay-grid': overlayGridOperation,
  'overlay-folds': overlayFoldsOperation,
  analyze: analyzeOperation,
  annotate: annotateOperation,
  render: renderOperation,
  diff: diffOperation,
};

function makeError(phase: PipelineError['phase'], message: string, cause?: OperationError): PipelineError {
  return { _tag: 'PipelineError', phase, message, cause };
}

/**
 * Extract viewport from pipeline definition.
 * Looks for a capture node and returns its viewport config.
 */
function extractViewport(definition: PipelineDefinition): ViewportConfig | undefined {
  const captureNode = definition.nodes.find((n) => n.operation === 'capture');
  if (!captureNode) return undefined;

  const config = captureNode.config as { viewport?: ViewportConfig };
  return config.viewport;
}

function createLogger(): Logger {
  return {
    debug: (msg) => console.debug(`[DEBUG] ${msg}`),
    info: (msg) => console.info(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
  };
}

/**
 * Create pipeline context for operation execution.
 */
function createContext(
  state: PipelineState,
  viewport: ViewportConfig | undefined,
  fs: FileSystem.FileSystem,
): InternalPipelineContext {
  const artifacts = new Map<string, Artifact>();
  for (const [id, artifact] of Object.entries(state.artifacts)) {
    artifacts.set(id, artifact);
  }

  const semanticNames = new Map<string, Artifact>();
  for (const [key, artifactId] of Object.entries(state.semanticNames)) {
    const artifact = state.artifacts[artifactId];
    if (artifact) {
      semanticNames.set(key, artifact);
    }
  }

  // Non-artifact data channel (e.g., AnalysisResult, ToolCall[])
  const dataMap = new Map<string, unknown>();
  for (const [key, value] of Object.entries(state.data)) {
    dataMap.set(key, value);
  }

  const createdDirs = new Set<string>();

  const getViewportDir = (): Effect.Effect<string, PlatformError> => {
    if (!viewport) {
      return Effect.succeed(state.sessionDir);
    }
    const viewportDir = join(state.sessionDir, getViewportDirName(viewport));
    if (createdDirs.has(viewportDir)) {
      return Effect.succeed(viewportDir);
    }
    return fs.makeDirectory(viewportDir, { recursive: true }).pipe(
      Effect.map(() => {
        createdDirs.add(viewportDir);
        return viewportDir;
      }),
    );
  };

  const getArtifactPath = (name: keyof typeof ARTIFACT_NAMES): Effect.Effect<string, PlatformError> => {
    return getViewportDir().pipe(Effect.map((viewportDir) => join(viewportDir, ARTIFACT_NAMES[name])));
  };

  return {
    sessionDir: state.sessionDir,
    artifacts,
    logger: createLogger(),
    viewport,
    storeArtifact: (artifact) => {
      artifacts.set(artifact.id, artifact);
      return artifact.id;
    },
    getArtifact: (id) => artifacts.get(id) ?? semanticNames.get(id),
    // Typed getData for known keys (implementation uses Map<string, unknown>)
    getData: <K extends DataKey>(key: K) => dataMap.get(key) as DataValue<K> | undefined,
    // Raw getData for dynamic node:field keys used in edge routing
    getDataRaw: (key) => dataMap.get(key),
    getViewportDir,
    getArtifactPath,
    _mapSemanticName: (name: string, artifact: Artifact) => {
      semanticNames.set(name, artifact);
    },
    _mapData: (name: string, value: unknown) => {
      dataMap.set(name, value);
    },
  };
}

/**
 * Execute a single pipeline node.
 */
function executeNode(
  state: PipelineState,
  nodeId: string,
  ctx: InternalPipelineContext,
): Effect.Effect<{ artifacts: Artifact[]; state: PipelineState }, OperationError> {
  return Effect.gen(function* () {
    const node = state.definition.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return yield* Effect.fail(new OperationError({ operation: nodeId, detail: `Node not found: ${nodeId}` }));
    }

    const operation = OPERATIONS[node.operation];
    if (!operation) {
      return yield* Effect.fail(
        new OperationError({ operation: node.operation, detail: `Unknown operation: ${node.operation}` }),
      );
    }

    let currentState = updateNodeState(state, nodeId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    ctx.logger.info(`Executing ${node.operation} (${nodeId})`);

    // Gather inputs from edges (check artifacts first, then data channel)
    const inputEdges = state.definition.edges.filter((e) => e.to === nodeId);
    const inputs: Record<string, unknown> = {};
    for (const edge of inputEdges) {
      const sourceKey = `${edge.from}:${edge.artifact}`;
      const targetKey = edge.targetField ?? edge.artifact;
      const artifact = ctx.getArtifact(sourceKey);
      if (artifact) {
        inputs[targetKey] = artifact;
      } else {
        // Use getDataRaw for dynamic edge routing keys
        const data = ctx.getDataRaw(sourceKey);
        if (data !== undefined) {
          inputs[targetKey] = data;
        }
      }
    }

    const result = yield* operation.execute(inputs, node.config, ctx);

    const outputArtifacts: string[] = [];
    const resultObj = result as Record<string, unknown>;
    for (const [key, value] of Object.entries(resultObj)) {
      if (value && typeof value === 'object' && 'id' in value && 'type' in value) {
        // This is an artifact - store in artifacts channel
        const artifact = value as Artifact;
        currentState = storeArtifact(currentState, artifact);
        currentState = storeSemanticName(currentState, `${nodeId}:${key}`, artifact.id);
        outputArtifacts.push(artifact.id);
        ctx._mapSemanticName(`${nodeId}:${key}`, artifact);
      } else if (value !== undefined) {
        // Non-artifact data - store in data channel
        const dataKey = `${nodeId}:${key}`;
        currentState = storeData(currentState, dataKey, value);
        ctx._mapData(dataKey, value);
      }
    }

    // Populate state.issues from analysis result for external consumers
    if (node.operation === 'analyze') {
      const dataKey = `${nodeId}:result`;
      const analysisResult = currentState.data[dataKey] as { issues?: unknown[] } | undefined;
      if (analysisResult && Array.isArray(analysisResult.issues)) {
        currentState = { ...currentState, issues: analysisResult.issues as typeof currentState.issues };
      }
    }

    currentState = updateNodeState(currentState, nodeId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      outputArtifacts,
    });

    return {
      artifacts: outputArtifacts.map((id) => currentState.artifacts[id]).filter((a): a is Artifact => a !== undefined),
      state: currentState,
    };
  });
}

/**
 * Run a pipeline definition.
 */
export function runPipeline(
  definition: PipelineDefinition,
  baseDir: string,
  _inputs?: Record<string, unknown>,
): Effect.Effect<PipelineState, PipelineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (definition.nodes.length === 0) {
      return yield* Effect.fail(makeError('validation', 'Pipeline has no nodes'));
    }

    const sessionDir = yield* createSessionDir(baseDir).pipe(
      Effect.mapError((e) => makeError('execution', `Failed to create session directory: ${e.message}`, undefined)),
    );

    const fs = yield* FileSystem.FileSystem;
    let state = initializePipelineState(definition, sessionDir);
    const viewport = extractViewport(definition);
    const ctx = createContext(state, viewport, fs);

    ctx.logger.info(`Starting pipeline: ${definition.name}`);
    ctx.logger.info(`Session: ${sessionDir}`);

    // Execute nodes in topological order
    while (!isComplete(state) && !hasFailed(state)) {
      const readyNodes = getReadyNodes(state);

      if (readyNodes.length === 0 && !isComplete(state)) {
        return yield* Effect.fail(makeError('execution', 'Pipeline deadlock: no ready nodes but not complete'));
      }

      // Execute ready nodes (could be parallelized in future)
      for (const nodeId of readyNodes) {
        const result = yield* executeNode(state, nodeId, ctx).pipe(
          Effect.catchAll((e) =>
            Effect.gen(function* () {
              const failedState = updateNodeState(state, nodeId, {
                status: 'failed',
                error: e,
              });
              yield* savePipelineState({
                ...failedState,
                status: 'failed',
                completedAt: new Date().toISOString(),
              }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
              return yield* Effect.fail(e);
            }),
          ),
          Effect.mapError((e) => makeError('execution', `Node ${nodeId} failed: ${e.message}`, e)),
        );
        state = result.state;
      }

      yield* savePipelineState(state).pipe(
        Effect.mapError((e) => makeError('persistence', `Failed to save state: ${e.message}`)),
      );
    }

    state = {
      ...state,
      completedAt: new Date().toISOString(),
      status: hasFailed(state) ? 'failed' : 'completed',
    };

    yield* savePipelineState(state).pipe(
      Effect.mapError((e) => makeError('persistence', `Failed to save final state: ${e.message}`)),
    );

    ctx.logger.info(`Pipeline ${state.status}: ${Object.keys(state.artifacts).length} artifacts`);

    return state;
  });
}

/**
 * Resume a paused pipeline.
 */
export function resumePipeline(sessionDir: string): Effect.Effect<PipelineState, PipelineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    let state = yield* loadPipelineState(sessionDir).pipe(
      Effect.mapError((e) => makeError('execution', `Failed to load pipeline state: ${e.message}`)),
    );

    if (state.status === 'completed' || state.status === 'failed') {
      return state;
    }

    const fs = yield* FileSystem.FileSystem;
    const viewport = extractViewport(state.definition);
    const ctx = createContext(state, viewport, fs);
    ctx.logger.info(`Resuming pipeline from ${sessionDir}`);

    state = { ...state, status: 'running' };

    while (!isComplete(state) && !hasFailed(state)) {
      const readyNodes = getReadyNodes(state);

      if (readyNodes.length === 0 && !isComplete(state)) {
        return yield* Effect.fail(makeError('execution', 'Pipeline deadlock'));
      }

      for (const nodeId of readyNodes) {
        const result = yield* executeNode(state, nodeId, ctx).pipe(
          Effect.catchAll((e) =>
            Effect.gen(function* () {
              const failedState = updateNodeState(state, nodeId, {
                status: 'failed',
                error: e,
              });
              yield* savePipelineState({
                ...failedState,
                status: 'failed',
                completedAt: new Date().toISOString(),
              }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
              return yield* Effect.fail(e);
            }),
          ),
          Effect.mapError((e) => makeError('execution', `Node ${nodeId} failed: ${e.message}`, e)),
        );
        state = result.state;
      }

      yield* savePipelineState(state).pipe(
        Effect.mapError((e) => makeError('persistence', `Failed to save state: ${e.message}`)),
      );
    }

    state = {
      ...state,
      completedAt: new Date().toISOString(),
      status: hasFailed(state) ? 'failed' : 'completed',
    };

    yield* savePipelineState(state).pipe(
      Effect.mapError((e) => makeError('persistence', `Failed to save final state: ${e.message}`)),
    );

    return state;
  });
}
