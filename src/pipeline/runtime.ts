/**
 * Pipeline runtime - DAG executor for composable operations.
 */

import type { Artifact, ViewportConfig } from "../core/types.js";
import type { NodeResult } from "./state.js";
import type {
  DataKey,
  DataValue,
  Logger,
  Operation,
  PipelineContext,
  PipelineDefinition,
  PipelineState,
} from "./types.js";
import type { PlatformError } from "@effect/platform/Error";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { ARTIFACT_NAMES, getViewportDirName } from "../core/types.js";
import { analyzeOperation } from "./operations/analyze.js";
import { annotateOperation } from "./operations/annotate.js";
import { captureOperation } from "./operations/capture.js";
import { diffOperation } from "./operations/diff.js";
import { overlayFoldsOperation } from "./operations/overlay-folds.js";
import { overlayGridOperation } from "./operations/overlay-grid.js";
import { renderOperation } from "./operations/render.js";
import {
  createSessionDir,
  getReadyNodes,
  hasFailed,
  initializePipelineState,
  isComplete,
  loadPipelineState,
  mergeNodeResults,
  savePipelineState,
  storeArtifact,
  storeData,
  storeSemanticName,
  updateNodeState,
} from "./state.js";
import { OperationError, PipelineError } from "./types.js";

/**
 * Internal extension of PipelineContext with methods for artifact/data mapping.
 * Used by the runtime to wire operation outputs to edges.
 */
type InternalPipelineContext = {
  readonly _semanticNames: Map<string, Artifact>;
  readonly _dataMap: Map<string, unknown>;
} & PipelineContext;

export type ArtifactLayout = "viewport-subdir" | "session-root";

export type RunPipelineOptions = {
  readonly sessionId?: string;
  readonly artifactLayout?: ArtifactLayout;
};

const OPERATIONS: Record<string, Operation<any, any, any>> = {
  capture: captureOperation,
  "overlay-grid": overlayGridOperation,
  "overlay-folds": overlayFoldsOperation,
  analyze: analyzeOperation,
  annotate: annotateOperation,
  render: renderOperation,
  diff: diffOperation,
};

/** @internal Test-only: register a mock operation for unit tests. */
export function registerTestOperation(name: string, operation: Operation<any, any, any>): void {
  OPERATIONS[name] = operation;
}

/** @internal Test-only: remove a mock operation registered by registerTestOperation. */
export function unregisterTestOperation(name: string): void {
  delete OPERATIONS[name];
}

function makeError(
  phase: PipelineError["phase"],
  detail: string,
  cause?: OperationError,
): PipelineError {
  return new PipelineError({ phase, detail, cause });
}

/**
 * Extract viewport from pipeline definition.
 * Looks for a capture node and returns its viewport config.
 */
function extractViewport(definition: PipelineDefinition): ViewportConfig | undefined {
  const captureNode = definition.nodes.find((n) => n.operation === "capture");
  if (captureNode === undefined) {
    return undefined;
  }

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
 * Populate context Maps from pipeline state records.
 * Used by createContext (initial population) and after parallel merges (resync).
 */
function populateContextMaps(
  state: PipelineState,
  artifacts: Map<string, Artifact>,
  semanticNames: Map<string, Artifact>,
  dataMap: Map<string, unknown>,
): void {
  for (const [id, artifact] of Object.entries(state.artifacts)) {
    artifacts.set(id, artifact);
  }
  for (const [key, artifactId] of Object.entries(state.semanticNames)) {
    const artifact = state.artifacts[artifactId];
    if (artifact !== undefined) {
      semanticNames.set(key, artifact);
    }
  }
  for (const [key, value] of Object.entries(state.data)) {
    dataMap.set(key, value);
  }
}

/**
 * Create pipeline context for operation execution.
 */
function createContext(
  state: PipelineState,
  viewport: ViewportConfig | undefined,
  fs: FileSystem.FileSystem,
  artifactLayout: ArtifactLayout = "viewport-subdir",
): InternalPipelineContext {
  const artifacts = new Map<string, Artifact>();
  const semanticNames = new Map<string, Artifact>();
  const dataMap = new Map<string, unknown>();
  populateContextMaps(state, artifacts, semanticNames, dataMap);

  const createdDirs = new Set<string>();

  const getViewportDir = (): Effect.Effect<string, PlatformError> => {
    if (artifactLayout === "session-root") {
      return Effect.succeed(state.sessionDir);
    }

    if (viewport === undefined) {
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

  const getArtifactPath = (
    name: keyof typeof ARTIFACT_NAMES,
  ): Effect.Effect<string, PlatformError> => {
    return getViewportDir().pipe(
      Effect.map((viewportDir) => join(viewportDir, ARTIFACT_NAMES[name])),
    );
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
    _semanticNames: semanticNames,
    _dataMap: dataMap,
  };
}

/**
 * Execute a single pipeline node.
 */
function executeNode(
  state: PipelineState,
  nodeId: string,
  ctx: InternalPipelineContext,
): Effect.Effect<NodeResult, OperationError> {
  return Effect.gen(function* () {
    const node = state.definition.nodes.find((n) => n.id === nodeId);
    if (node === undefined) {
      return yield* new OperationError({
        operation: nodeId,
        detail: `Node not found: ${nodeId}`,
      });
    }

    const operation = OPERATIONS[node.operation];
    if (operation === undefined) {
      return yield* new OperationError({
        operation: node.operation,
        detail: `Unknown operation: ${node.operation}`,
      });
    }

    let currentState = updateNodeState(state, nodeId, {
      status: "running",
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
      if (artifact !== undefined) {
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

    // Parallel-safe: keys are "${nodeId}:${key}" — no two concurrent nodes share a
    // prefix, so sibling writes are disjoint. Inputs are gathered from frozen baseState
    // edges above (lines 218-233) before any writes. syncContextFromState reconciles
    // all Maps after the full parallel wave completes.
    const outputArtifacts: string[] = [];
    const resultObj = result as Record<string, unknown>;
    for (const [key, value] of Object.entries(resultObj)) {
      if (
        value !== undefined &&
        value !== null &&
        typeof value === "object" &&
        "_kind" in value &&
        value._kind === "artifact"
      ) {
        // This is an artifact - store in artifacts channel
        const artifact = value as Artifact;
        currentState = storeArtifact(currentState, artifact);
        currentState = storeSemanticName(currentState, `${nodeId}:${key}`, artifact.id);
        outputArtifacts.push(artifact.id);
        ctx._semanticNames.set(`${nodeId}:${key}`, artifact);
      } else if (value !== undefined) {
        // Non-artifact data - store in data channel
        const dataKey = `${nodeId}:${key}`;
        currentState = storeData(currentState, dataKey, value);
        ctx._dataMap.set(dataKey, value);
      }
    }

    // Populate state.issues from analysis result for external consumers
    if (node.operation === "analyze") {
      const dataKey = `${nodeId}:result`;
      const analysisResult = currentState.data[dataKey] as { issues?: unknown[] } | undefined;
      if (analysisResult !== undefined && Array.isArray(analysisResult.issues)) {
        currentState = {
          ...currentState,
          issues: analysisResult.issues as typeof currentState.issues,
        };
      }
    }

    currentState = updateNodeState(currentState, nodeId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      outputArtifacts,
    });

    return {
      nodeId,
      artifacts: outputArtifacts
        .map((id) => currentState.artifacts[id])
        .filter((a): a is Artifact => a !== undefined),
      state: currentState,
    };
  });
}

/** @internal Exported for testing only. */
export function syncContextFromState(
  state: PipelineState,
  ctx: {
    artifacts: Map<string, Artifact>;
    _semanticNames: Map<string, Artifact>;
    _dataMap: Map<string, unknown>;
  },
): void {
  populateContextMaps(state, ctx.artifacts, ctx._semanticNames, ctx._dataMap);
}

/**
 * Shared DAG execution loop used by both runPipeline and resumePipeline.
 *
 * Executes nodes in topological order until complete or failed, saving state
 * after each iteration. Returns the finalized pipeline state.
 */
function executePipelineLoop(
  initialState: PipelineState,
  ctx: InternalPipelineContext,
): Effect.Effect<PipelineState, PipelineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    let state = initialState;

    while (!isComplete(state) && !hasFailed(state)) {
      const readyNodes = getReadyNodes(state);

      if (readyNodes.length === 0 && !isComplete(state)) {
        return yield* makeError("execution", "Pipeline deadlock: no ready nodes but not complete");
      }

      // Execute ready nodes in parallel — independent nodes at the same
      // topological level have disjoint state writes (node-prefixed keys)
      const baseState = state;
      // Fail-fast: first node failure interrupts remaining fibers (no point continuing
      // a doomed wave). Use { mode: 'either' } if partial results are ever needed.
      const results = yield* Effect.all(
        readyNodes.map((nodeId) =>
          executeNode(baseState, nodeId, ctx).pipe(
            Effect.catchAll((e) =>
              Effect.gen(function* () {
                const failedState = updateNodeState(baseState, nodeId, {
                  status: "failed",
                  error: e,
                });
                yield* savePipelineState({
                  ...failedState,
                  status: "failed",
                  completedAt: new Date().toISOString(),
                }).pipe(Effect.catchAll(() => Effect.void));
                return yield* e;
              }),
            ),
            Effect.mapError((e) =>
              makeError("execution", `Node ${nodeId} failed: ${e.message}`, e),
            ),
          ),
        ),
        { concurrency: "unbounded" },
      );

      state = mergeNodeResults(baseState, results);
      syncContextFromState(state, ctx);

      yield* savePipelineState(state).pipe(
        Effect.mapError((e) => makeError("persistence", `Failed to save state: ${e.message}`)),
      );
    }

    state = {
      ...state,
      completedAt: new Date().toISOString(),
      status: hasFailed(state) ? "failed" : "completed",
    };

    yield* savePipelineState(state).pipe(
      Effect.mapError((e) => makeError("persistence", `Failed to save final state: ${e.message}`)),
    );

    return state;
  });
}

/**
 * Run a pipeline definition.
 */
export function runPipeline(
  definition: PipelineDefinition,
  baseDir: string,
  _inputs?: Record<string, unknown>,
  options?: RunPipelineOptions,
): Effect.Effect<PipelineState, PipelineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (definition.nodes.length === 0) {
      return yield* makeError("validation", "Pipeline has no nodes");
    }

    const sessionDir = yield* createSessionDir(baseDir, options?.sessionId).pipe(
      Effect.mapError((e) =>
        makeError("execution", `Failed to create session directory: ${e.message}`),
      ),
    );

    const fs = yield* FileSystem.FileSystem;
    const state = initializePipelineState(definition, sessionDir);
    const viewport = extractViewport(definition);
    const ctx = createContext(state, viewport, fs, options?.artifactLayout ?? "viewport-subdir");

    ctx.logger.info(`Starting pipeline: ${definition.name}`);
    ctx.logger.info(`Session: ${sessionDir}`);

    return yield* executePipelineLoop(state, ctx);
  });
}

/**
 * Resume a paused pipeline.
 */
export function resumePipeline(
  sessionDir: string,
): Effect.Effect<PipelineState, PipelineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const loaded = yield* loadPipelineState(sessionDir).pipe(
      Effect.mapError((e) => makeError("execution", `Failed to load pipeline state: ${e.message}`)),
    );

    if (loaded.status === "completed" || loaded.status === "failed") {
      return loaded;
    }

    const fs = yield* FileSystem.FileSystem;
    const viewport = extractViewport(loaded.definition);
    const ctx = createContext(loaded, viewport, fs);
    ctx.logger.info(`Resuming pipeline from ${sessionDir}`);

    const state = { ...loaded, status: "running" as const };

    return yield* executePipelineLoop(state, ctx);
  });
}
