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
  OperationOutputSpec,
  OperationResult,
  PipelineContext,
  PipelineDefinition,
  PipelineState,
  StoredOutput,
} from "./types.js";
import type { PlatformError } from "@effect/platform/Error";
import { FileSystem } from "@effect/platform";
import { Effect, Either, Schema as S } from "effect";
import { join } from "node:path";
import { AnalysisResult as AnalysisResultSchema } from "../core/schema.js";
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
  storeOutput,
  updateNodeState,
} from "./state.js";
import { OperationError, PipelineError } from "./types.js";

/**
 * Internal extension of PipelineContext with methods for artifact/data mapping.
 * Used by the runtime to wire operation outputs to edges.
 */
type InternalPipelineContext = {
  readonly _outputs: Map<string, StoredOutput>;
  readonly _dataMap: Map<string, unknown>;
} & PipelineContext;

export type ArtifactLayout = "viewport-subdir" | "session-root";

export type RunPipelineOptions = {
  readonly sessionId?: string;
  readonly artifactLayout?: ArtifactLayout;
};

type RuntimeOperation = Omit<Operation, "execute"> & {
  readonly execute: (
    input: unknown,
    config: Record<string, unknown>,
    ctx: PipelineContext,
  ) => Effect.Effect<OperationResult, OperationError>;
};

function toRuntimeOperation<TInput, TOutput extends OperationResult, TConfig>(
  operation: Operation<TInput, TOutput, TConfig>,
): RuntimeOperation {
  return {
    name: operation.name,
    description: operation.description,
    inputSpecs: operation.inputSpecs,
    outputSpecs: operation.outputSpecs,
    // Dynamic DAG edges are validated at runtime by operation implementations.
    // This is the single dispatch boundary between persisted graph data and typed operations.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    execute: (input, config, ctx) => operation.execute(input as TInput, config as TConfig, ctx),
  };
}

const OPERATIONS: Record<string, RuntimeOperation> = {
  capture: toRuntimeOperation(captureOperation),
  "overlay-grid": toRuntimeOperation(overlayGridOperation),
  "overlay-folds": toRuntimeOperation(overlayFoldsOperation),
  analyze: toRuntimeOperation(analyzeOperation),
  annotate: toRuntimeOperation(annotateOperation),
  render: toRuntimeOperation(renderOperation),
  diff: toRuntimeOperation(diffOperation),
};

/** @internal Test-only: register a mock operation for unit tests. */
export function registerTestOperation<TInput, TOutput extends OperationResult, TConfig>(
  name: string,
  operation: Operation<TInput, TOutput, TConfig>,
): void {
  OPERATIONS[name] = toRuntimeOperation(operation);
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
  return new PipelineError({
    phase,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
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

const UnknownRecord = S.Record({ key: S.String, value: S.Unknown });

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return S.is(UnknownRecord)(value) ? value : undefined;
}

function decodeAnalysisIssues(
  value: unknown,
): (typeof AnalysisResultSchema.Type)["issues"] | undefined {
  const result = S.decodeUnknownEither(AnalysisResultSchema)(value);
  return Either.isRight(result) ? result.right.issues : undefined;
}

/**
 * Populate context Maps from pipeline state records.
 * Used by createContext (initial population) and after parallel merges (resync).
 */
function populateContextMaps(
  state: PipelineState,
  artifacts: Map<string, Artifact>,
  outputs: Map<string, StoredOutput>,
  dataMap: Map<string, unknown>,
): void {
  for (const [id, artifact] of Object.entries(state.artifacts)) {
    artifacts.set(id, artifact);
  }
  for (const [key, output] of Object.entries(state.outputs)) {
    outputs.set(key, output);
    if (output.channel === "data") {
      dataMap.set(key, output.value);
    }
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
  const outputs = new Map<string, StoredOutput>();
  const dataMap = new Map<string, unknown>();
  populateContextMaps(state, artifacts, outputs, dataMap);

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
    ...(viewport !== undefined ? { viewport } : {}),
    getArtifact: (id) => artifacts.get(id),
    // Typed getData for known keys (implementation uses Map<string, unknown>).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    getData: <K extends DataKey>(key: K) => dataMap.get(key) as DataValue<K> | undefined,
    getViewportDir,
    getArtifactPath,
    createArtifact: <T extends Artifact>(spec: {
      readonly type: T["type"];
      readonly path: string;
      readonly metadata: T["metadata"];
      readonly createdBy?: string;
    }): T =>
      ({
        _kind: "artifact",
        id: crypto.randomUUID(),
        type: spec.type,
        path: spec.path,
        createdAt: new Date().toISOString(),
        createdBy: spec.createdBy ?? "pipeline",
        metadata: spec.metadata,
      }) as T,
    _outputs: outputs,
    _dataMap: dataMap,
  };
}

function validateInput(
  operation: RuntimeOperation,
  inputName: string,
  output: StoredOutput,
  artifacts: Map<string, Artifact>,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly detail: string } {
  const spec = operation.inputSpecs[inputName];
  if (spec === undefined) {
    return {
      ok: false,
      detail: `Operation ${operation.name} has no input spec for '${inputName}'`,
    };
  }

  if (spec.channel !== output.channel) {
    return {
      ok: false,
      detail: `Input '${inputName}' expected ${spec.channel} but received ${output.channel}`,
    };
  }

  if (spec.channel === "data") {
    return output.channel === "data"
      ? { ok: true, value: output.value }
      : {
          ok: false,
          detail: `Input '${inputName}' expected data but received artifact`,
        };
  }

  if (output.channel !== "artifact") {
    return {
      ok: false,
      detail: `Input '${inputName}' expected artifact but received data`,
    };
  }

  const artifact = artifacts.get(output.artifactId);
  if (artifact === undefined) {
    return {
      ok: false,
      detail: `Artifact output '${inputName}' points to missing artifact ${output.artifactId}`,
    };
  }

  if (artifact.type !== spec.type) {
    return {
      ok: false,
      detail: `Input '${inputName}' expected artifact type ${spec.type} but received ${artifact.type}`,
    };
  }

  return { ok: true, value: artifact };
}

function validateArtifactOutput(
  operation: RuntimeOperation,
  key: string,
  spec: Extract<OperationOutputSpec, { readonly channel: "artifact" }>,
  artifact: Artifact | undefined,
): Artifact | undefined | OperationError {
  if (artifact === undefined) {
    return spec.optional === true
      ? undefined
      : new OperationError({
          operation: operation.name,
          detail: `Required artifact output '${key}' was not returned`,
        });
  }

  if (artifact._kind !== "artifact" || artifact.type !== spec.type) {
    return new OperationError({
      operation: operation.name,
      detail: `Artifact output '${key}' expected type ${spec.type} but received ${artifact.type}`,
    });
  }

  return artifact;
}

function validateNoUndeclaredOutputs(
  operation: RuntimeOperation,
  result: OperationResult,
): OperationError | undefined {
  for (const key of Object.keys(result.artifacts ?? {})) {
    const spec = operation.outputSpecs[key];
    if (spec === undefined || spec.channel !== "artifact") {
      return new OperationError({
        operation: operation.name,
        detail: `Undeclared artifact output '${key}'`,
      });
    }
  }

  for (const key of Object.keys(result.data ?? {})) {
    const spec = operation.outputSpecs[key];
    if (spec === undefined || spec.channel !== "data") {
      return new OperationError({
        operation: operation.name,
        detail: `Undeclared data output '${key}'`,
      });
    }
  }

  return undefined;
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

    // Gather inputs from declared routed outputs.
    const inputEdges = state.definition.edges.filter((e) => e.to === nodeId);
    const inputs: Record<string, unknown> = {};
    for (const edge of inputEdges) {
      const sourceKey = `${edge.from}:${edge.output}`;
      const targetKey = edge.input ?? edge.output;
      const output = ctx._outputs.get(sourceKey);
      if (output === undefined) {
        return yield* new OperationError({
          operation: node.operation,
          detail: `Edge ${edge.from}.${edge.output} -> ${nodeId}.${targetKey} references a missing output`,
        });
      }

      const validation = validateInput(operation, targetKey, output, ctx.artifacts);
      if (!validation.ok) {
        return yield* new OperationError({
          operation: node.operation,
          detail: validation.detail,
        });
      }
      inputs[targetKey] = validation.value;
    }

    const result = yield* operation.execute(inputs, node.config, ctx);

    // Parallel-safe: output keys are "${nodeId}:${key}", so sibling writes are disjoint.
    const outputArtifacts: string[] = [];
    if (asRecord(result) === undefined) {
      return yield* new OperationError({
        operation: node.operation,
        detail: "Operation returned a non-object result",
      });
    }

    const undeclaredOutputError = validateNoUndeclaredOutputs(operation, result);
    if (undeclaredOutputError !== undefined) {
      return yield* undeclaredOutputError;
    }

    for (const [key, spec] of Object.entries(operation.outputSpecs)) {
      const outputKey = `${nodeId}:${key}`;
      if (spec.channel === "artifact") {
        const validation = validateArtifactOutput(operation, key, spec, result.artifacts?.[key]);
        if (validation instanceof OperationError) {
          return yield* validation;
        }
        if (validation !== undefined) {
          currentState = storeArtifact(currentState, validation);
          currentState = storeOutput(currentState, outputKey, {
            channel: "artifact",
            artifactId: validation.id,
            type: validation.type,
          });
          outputArtifacts.push(validation.id);
          ctx.artifacts.set(validation.id, validation);
          ctx._outputs.set(outputKey, {
            channel: "artifact",
            artifactId: validation.id,
            type: validation.type,
          });
        }
      } else if (Object.hasOwn(result.data ?? {}, key)) {
        const data = result.data?.[key];
        if (data === undefined && spec.optional !== true) {
          return yield* new OperationError({
            operation: node.operation,
            detail: `Required data output '${key}' was not returned`,
          });
        }
        if (data !== undefined) {
          const storedOutput = { channel: "data" as const, value: data };
          currentState = storeOutput(currentState, outputKey, storedOutput);
          ctx._outputs.set(outputKey, storedOutput);
          ctx._dataMap.set(outputKey, data);
        }
      } else if (spec.optional !== true) {
        return yield* new OperationError({
          operation: node.operation,
          detail: `Required data output '${key}' was not returned`,
        });
      }
    }

    // Populate state.issues from analysis result for external consumers
    if (node.operation === "analyze") {
      const dataKey = `${nodeId}:result`;
      const output = currentState.outputs[dataKey];
      const issues = output?.channel === "data" ? decodeAnalysisIssues(output.value) : undefined;
      if (issues !== undefined) {
        currentState = {
          ...currentState,
          issues,
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
    _outputs: Map<string, StoredOutput>;
    _dataMap: Map<string, unknown>;
  },
): void {
  populateContextMaps(state, ctx.artifacts, ctx._outputs, ctx._dataMap);
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
