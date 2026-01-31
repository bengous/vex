/**
 * Pipeline runtime for vex - composable operations with typed artifacts.
 *
 * @module vex/pipeline
 */


// Operations
export * from './operations/index.js';
// Presets
export { captureOnly, fullAnnotation, responsiveComparison, simpleAnalysis } from './presets.js';

// Runtime
export { resumePipeline, runPipeline } from './runtime.js';

// State management
export {
  createSessionDir,
  generateSessionId,
  getReadyNodes,
  hasFailed,
  initializePipelineState,
  isComplete,
  loadPipelineState,
  savePipelineState,
  storeArtifact,
  updateNodeState,
} from './state.js';
// Types
export type {
  Logger,
  NodeState,
  NodeStatus,
  Operation,
  OperationError,
  OperationRegistry,
  PipelineBuilder,
  PipelineContext,
  PipelineDefinition,
  PipelineEdge,
  PipelineError,
  PipelineNode,
  PipelineState,
} from './types.js';
