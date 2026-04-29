/**
 * vex - Visual Explorer
 *
 * Unified visual analysis tool for web layouts with iterative feedback loops.
 *
 * Architecture:
 * - Layer 0 (core): Pure functions - capture, overlays, analysis, types
 * - Layer 1 (pipeline): Composable operations with typed artifacts
 * - Layer 2 (locator): Map visual issues to code locations
 * - Layer 3 (loop): Feedback loop orchestration
 *
 * @module vex
 */

// ═══════════════════════════════════════════════════════════════════════════
// Core library (Layer 0)
// ═══════════════════════════════════════════════════════════════════════════

// Capture
// Public API entry point for vex library.
export {
  applyPlaceholderMedia,
  BLOCKED_SCRIPT_PATTERNS,
  type CaptureOptions,
  type CaptureResult,
  captureScreenshot,
  captureWithDOM,
  collectViewportMetrics,
  cleanupOverlays,
  type DOMCaptureOptions,
  type DOMCaptureResult,
  injectOverlayHidingCSS,
  OVERLAY_SELECTORS,
  type PlaceholderMediaOptions,
  removeOverlayElements,
  setupNetworkBlocking,
  type ViewportMetrics,
} from "./core/capture.js";

// DOM Snapshot Loader
export {
  type LoadDOMSnapshotResult,
  loadDOMSnapshot,
  loadDOMSnapshotFromPath,
} from "./core/dom-snapshot-loader.js";

// Overlays
export {
  addFoldLines,
  addFoldOverlay,
  addGridOverlay,
  calculateGrid,
  calculateFoldPositions,
  cellCenter,
  cellRangeToPixels,
  cellToPixels,
  type FoldLineOptions,
  type FoldLinePosition,
  generateAnnotationSvg,
  generateGridSvg,
  isValidCellRef,
  parseCellRef,
  pixelsToCell,
  renderAnnotations,
  renderAnnotationsToFile,
  renderArrowSvg,
  renderLabelSvg,
  renderRectangleSvg,
  renderToolCallSvg,
  saveAnnotationSvg,
} from "./core/overlays.js";

// Types
export type {
  AddLabelParams,
  AnalysisArtifact,
  AnalysisResult,
  AnnotationStyle,
  Artifact,
  ArtifactName,
  ArtifactType,
  BoundingBox,
  BrowserType,
  CodeLocation,
  DiffReportArtifact,
  DOMElement,
  DOMSnapshot,
  DOMSnapshotArtifact,
  DrawArrowParams,
  DrawRectangleParams,
  FoldConfig,
  FoldOcclusionEdge,
  FoldOcclusionMetrics,
  FoldOcclusionMode,
  FoldOcclusionOptions,
  FoldOcclusionRegion,
  GridConfig,
  GridMetadata,
  GridRef,
  GridStyleConfig,
  ImageArtifact,
  Issue,
  LabelPosition,
  Point,
  Region,
  SessionState,
  Severity,
  StyleConfig,
  ToolCall,
  ToolName,
  ViewportConfig,
  ViewportPreset,
} from "./core/types.js";

export {
  ARTIFACT_NAMES,
  DEFAULT_FOLD_CONFIG,
  GRID_CONFIG,
  GRID_STYLE,
  getViewportDirName,
  SESSION_STRUCTURE,
  STYLE_MAP,
} from "./core/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline runtime (Layer 1)
// ═══════════════════════════════════════════════════════════════════════════

// Operations
export {
  type AnalyzeConfig,
  type AnalyzeInput,
  type AnalyzeOutput,
  analyzeOperation,
} from "./pipeline/operations/analyze.js";
export {
  type AnnotateConfig,
  type AnnotateInput,
  type AnnotateOutput,
  annotateOperation,
} from "./pipeline/operations/annotate.js";
export {
  type CaptureConfig,
  type CaptureOutput,
  captureOperation,
} from "./pipeline/operations/capture.js";
export {
  type DiffConfig,
  type DiffInput,
  type DiffOutput,
  diffOperation,
} from "./pipeline/operations/diff.js";
export {
  type OverlayFoldsConfig,
  type OverlayFoldsInput,
  type OverlayFoldsOutput,
  overlayFoldsOperation,
} from "./pipeline/operations/overlay-folds.js";
export {
  type OverlayGridConfig,
  type OverlayGridInput,
  type OverlayGridOutput,
  overlayGridOperation,
} from "./pipeline/operations/overlay-grid.js";
export {
  type RenderConfig,
  type RenderInput,
  type RenderOutput,
  renderOperation,
} from "./pipeline/operations/render.js";

// Runtime
export { checkProviderInstalled } from "./pipeline/preflight.js";
// Presets
export {
  captureOnly,
  fullAnnotation,
  responsiveComparison,
  simpleAnalysis,
} from "./pipeline/presets.js";
export { resumePipeline, runPipeline } from "./pipeline/runtime.js";

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
  storeOutput,
  updateNodeState,
} from "./pipeline/state.js";
export type {
  Logger,
  NodeState,
  NodeStatus,
  Operation,
  OperationInputSpec,
  OperationOutputSpec,
  OperationRegistry,
  OperationResult,
  PipelineBuilder,
  PipelineContext,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  PipelineState,
  StoredOutput,
} from "./pipeline/types.js";
// Types
export { OperationError, PipelineError } from "./pipeline/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Code locator (Layer 2)
// ═══════════════════════════════════════════════════════════════════════════

export { createResolverWithStrategies, StrategyResolver } from "./locator/resolver.js";
export { domTracerStrategy, findElementMatch } from "./locator/strategies/dom-tracer.js";
export type {
  BatchResolutionResult,
  ElementMatch,
  GrepMatch,
  HintConfig,
  LocatorContext,
  LocatorStrategy,
  ResolutionResult,
  ResolverOptions,
  SourceMapEntry,
  SourceMapIndex,
} from "./locator/types.js";
export { DEFAULT_RESOLVER_OPTIONS, LocatorError } from "./locator/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Feedback loop (Layer 3)
// ═══════════════════════════════════════════════════════════════════════════

export { evaluateGate, evaluateGates, filterByAction, summarizeDecisions } from "./loop/gates.js";
export {
  calculateLoopMetrics,
  createIterationMetrics,
  formatDuration,
  formatResolutionRate,
  metricsFromState,
  summarizeMetrics,
} from "./loop/metrics.js";
export type { LocateResult, LoopCallbacks, LoopCaptureResult } from "./loop/orchestrator.js";
export { LoopOrchestrator, runLoop } from "./loop/orchestrator.js";
export type {
  AppliedFix,
  AutoFixThreshold,
  GateAction,
  GateConfig,
  GateDecision,
  HumanResponse,
  IterationMetrics,
  IterationState,
  LoopMetrics,
  LoopOptions,
  LoopResult,
  LoopStatus,
  VerificationMetrics,
  VerificationResult,
  VerificationVerdict,
} from "./loop/types.js";
export { DEFAULT_GATE_CONFIG, DEFAULT_LOOP_OPTIONS, LoopError } from "./loop/types.js";
export { isImproved, isResolved, verifyChanges } from "./loop/verify.js";

// ═══════════════════════════════════════════════════════════════════════════
// VLM providers
// ═══════════════════════════════════════════════════════════════════════════

export {
  getAllProviders,
  getProviderInfo,
  type ProviderInfo,
} from "./providers/shared/introspection.js";
export {
  getAllProviderMetadata,
  getProviderMetadata,
  listProviderNames,
  type ProviderMetadata,
  registerProvider,
  resolveProviderLayer,
  unregisterProvider,
} from "./providers/shared/registry.js";
export {
  AnalysisFailed,
  type ProviderError,
  ProviderUnavailable,
  VisionProvider,
  type VisionProviderService,
  type VisionQueryOptions,
  type VisionResult,
} from "./providers/shared/service.js";
export {
  Subprocess,
  SubprocessError,
  SubprocessLive,
  type SubprocessResult,
} from "./providers/shared/subprocess.js";
