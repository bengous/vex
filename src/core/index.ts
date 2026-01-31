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
// Config
export { getOutputDir, loadConfig, type VexConfig, VexConfigError } from './config.js';
// DOM Snapshot Loader
export { type LoadDOMSnapshotResult, loadDOMSnapshot, loadDOMSnapshotFromPath } from './dom-snapshot-loader.js';
// Overlays
export {
  // Fold lines
  addFoldLines,
  addFoldOverlay,
  addGridOverlay,
  // Grid math
  calculateGrid,
  cellCenter,
  cellRangeToPixels,
  cellToPixels,
  type FoldLineOptions,
  generateAnnotationSvg,
  // Grid overlay
  generateGridSvg,
  isValidCellRef,
  parseCellRef,
  pixelsToCell,
  renderAnnotations,
  renderAnnotationsToFile,
  renderArrowSvg,
  renderLabelSvg,
  // Annotations
  renderRectangleSvg,
  renderToolCallSvg,
  saveAnnotationSvg,
} from './overlays.js';
// Types
export type {
  AddLabelParams,
  AnalysisArtifact,
  AnalysisResult,
  // Annotations
  AnnotationStyle,
  Artifact,
  // Artifact naming
  ArtifactName,
  // Artifacts
  ArtifactType,
  // Geometry
  BoundingBox,
  CodeLocation,
  DiffReportArtifact,
  // DOM
  DOMElement,
  DOMSnapshot,
  DOMSnapshotArtifact,
  DrawArrowParams,
  DrawRectangleParams,
  FoldConfig,
  // Grid
  GridConfig,
  GridMetadata,
  GridRef,
  GridStyleConfig,
  ImageArtifact,
  Issue,
  LabelPosition,
  Point,
  Region,
  // Session
  SessionState,
  // Issues
  Severity,
  StyleConfig,
  ToolCall,
  ToolName,
  // Viewport & Capture
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
