/**
 * Core vex library - pure functions for visual analysis.
 *
 * @module vex/core
 */

// Capture
export {
  applyPlaceholderMedia,
  BLOCKED_SCRIPT_PATTERNS,
  type CaptureOptions,
  type CaptureResult,
  captureScreenshot,
  captureWithDOM,
  cleanupOverlays,
  type DOMCaptureOptions,
  type DOMCaptureResult,
  injectOverlayHidingCSS,
  OVERLAY_SELECTORS,
  type PlaceholderMediaOptions,
  removeOverlayElements,
  setupNetworkBlocking,
} from './capture.js';
// DOM Snapshot Loader
export { type LoadDOMSnapshotResult, loadDOMSnapshot, loadDOMSnapshotFromPath } from './dom-snapshot-loader.js';
// Overlays
export {
  addFoldLines,
  addFoldOverlay,
  addGridOverlay,
  calculateGrid,
  cellCenter,
  cellRangeToPixels,
  cellToPixels,
  type FoldLineOptions,
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
} from './overlays.js';
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
  CodeLocation,
  DiffReportArtifact,
  DOMElement,
  DOMSnapshot,
  DOMSnapshotArtifact,
  DrawArrowParams,
  DrawRectangleParams,
  FoldConfig,
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
} from './types.js';
// Constants & Helpers
export {
  ARTIFACT_NAMES,
  DEFAULT_FOLD_CONFIG,
  GRID_CONFIG,
  GRID_STYLE,
  getViewportDirName,
  SESSION_STRUCTURE,
  STYLE_MAP,
} from './types.js';
