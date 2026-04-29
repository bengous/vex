/**
 * Core types for the vex visual explorer.
 *
 * Unified artifact and operation types that serve as the foundation
 * for the pipeline, locator, and loop layers.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Re-export validated types from schema (single source of truth)
// ═══════════════════════════════════════════════════════════════════════════

// Import for local use and re-export
import type {
  BoundingBox as BoundingBoxSchema,
  CodeLocation as CodeLocationSchema,
  Confidence as ConfidenceSchema,
  GridRef as GridRefSchema,
  IssueArray as IssueArraySchema,
  Issue as IssueSchema,
  Region as RegionSchema,
  Severity as SeveritySchema,
} from "./schema.js";

// Re-export with original names
export type BoundingBox = BoundingBoxSchema;
export type CodeLocation = CodeLocationSchema;
export type Confidence = ConfidenceSchema;
export type GridRef = GridRefSchema;
export type Issue = IssueSchema;
export type IssueArray = IssueArraySchema;
export type Region = RegionSchema;
export type Severity = SeveritySchema;

// ═══════════════════════════════════════════════════════════════════════════
// Viewport & Capture Configuration
// ═══════════════════════════════════════════════════════════════════════════

/** Playwright browser engine identifier. */
export type BrowserType = "chromium" | "webkit" | "firefox";

/**
 * Viewport configuration for screenshot capture.
 */
export type ViewportConfig = {
  readonly width: number;
  readonly height: number;
  readonly screen?: {
    readonly width: number;
    readonly height: number;
  };
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly hasTouch?: boolean;
  readonly userAgent?: string;
  readonly defaultBrowserType?: BrowserType;
};

/**
 * Named viewport preset for capture operations.
 */
export type ViewportPreset = {
  readonly name: string;
  readonly config: ViewportConfig;
};

/**
 * Fold line configuration for above-the-fold visualization.
 */
export type FoldConfig = {
  readonly enabled: boolean;
  readonly color: string;
  readonly showLabels: boolean;
};

export type FoldOcclusionMode = "auto";

export type FoldOcclusionEdge = "top" | "bottom";

export type FoldOcclusionRegion = {
  readonly selector: string;
  readonly tagName: string;
  readonly position: "fixed" | "sticky";
  readonly edge: FoldOcclusionEdge;
  readonly source: "auto";
  readonly scrollY: number;
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
};

export type FoldOcclusionMetrics = {
  readonly mode: FoldOcclusionMode;
  readonly top: number;
  readonly bottom: number;
  readonly usableViewportHeight: number;
  readonly regions: readonly FoldOcclusionRegion[];
};

export type FoldOcclusionOptions = {
  readonly enabled: true;
  readonly mode: FoldOcclusionMode;
  readonly minHeight: number;
  readonly sampleScrolls?: readonly number[];
};

export type SafariFrameStyle = "singleshot";

export type SafariFrameOptions = {
  readonly name: "safari-ios";
  readonly style: SafariFrameStyle;
};

// ═══════════════════════════════════════════════════════════════════════════
// Geometry Types (not in schema)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Point in 2D space.
 */
export type Point = {
  readonly x: number;
  readonly y: number;
};

// ═══════════════════════════════════════════════════════════════════════════
// Artifact System
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Artifact types produced by pipeline operations.
 */
export type ArtifactType =
  | "image"
  | "annotated-image"
  | "analysis"
  | "manifest"
  | "dom-snapshot"
  | "diff-report"
  | "annotations";

/**
 * Base artifact - all pipeline outputs inherit from this.
 */
export type Artifact = {
  readonly _kind: "artifact";
  readonly id: string;
  readonly type: ArtifactType;
  readonly path: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly metadata: Record<string, unknown>;
};

/**
 * Image artifact (screenshot, with or without overlays).
 */
export type ImageArtifact = {
  readonly type: "image" | "annotated-image";
  readonly metadata: {
    readonly width: number;
    readonly height: number;
    readonly url?: string;
    readonly viewport?: ViewportConfig;
    readonly hasGrid?: boolean;
    readonly hasFoldLines?: boolean;
    readonly hasAnnotations?: boolean;
    readonly foldOcclusion?: FoldOcclusionMetrics;
  };
} & Artifact;

/**
 * DOM snapshot artifact for code location resolution.
 */
export type DOMSnapshotArtifact = {
  readonly type: "dom-snapshot";
  readonly metadata: {
    readonly url: string;
    readonly elementCount: number;
    readonly viewport: ViewportConfig;
  };
} & Artifact;

/**
 * Analysis artifact containing VLM results.
 */
export type AnalysisArtifact = {
  readonly type: "analysis";
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly durationMs: number;
    readonly issueCount: number;
  };
} & Artifact;

/**
 * Annotations artifact containing VLM-generated tool calls.
 */
export type AnnotationsArtifact = {
  readonly type: "annotations";
  readonly metadata: {
    readonly toolCallCount: number;
    readonly issueCount: number;
  };
} & Artifact;

/**
 * Diff report comparing two images.
 */
export type DiffReportArtifact = {
  readonly type: "diff-report";
  readonly metadata: {
    readonly baseImageId: string;
    readonly compareImageId: string;
    readonly pixelDiffPercent: number;
  };
} & Artifact;

// ═══════════════════════════════════════════════════════════════════════════
// Analysis Types (not in schema - wrapper types for pipeline)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * VLM analysis result.
 */
export type AnalysisResult = {
  readonly provider: string;
  readonly model: string;
  readonly response: string;
  readonly durationMs: number;
  readonly issues: readonly Issue[];
  readonly rawJson?: unknown;
};

// ═══════════════════════════════════════════════════════════════════════════
// Annotation Types (from vision-audit/annotation/types.ts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Semantic annotation styles - AI specifies meaning, renderer maps to appearance.
 */
export type AnnotationStyle = "error" | "warning" | "info" | "suggestion";

/**
 * Label positioning relative to anchor cell.
 */
export type LabelPosition = "top" | "bottom" | "left" | "right" | "auto";

/**
 * Draw rectangle annotation parameters.
 */
export type DrawRectangleParams = {
  readonly start: GridRef;
  readonly end?: GridRef;
  readonly style: AnnotationStyle;
  readonly label?: string;
};

/**
 * Draw arrow annotation parameters.
 */
export type DrawArrowParams = {
  readonly from: GridRef;
  readonly to: GridRef;
  readonly style: AnnotationStyle;
  readonly label?: string;
};

/**
 * Add label annotation parameters.
 */
export type AddLabelParams = {
  readonly cell: GridRef;
  readonly text: string;
  readonly style: AnnotationStyle;
  readonly position?: LabelPosition;
};

/**
 * Tool call discriminated union for annotation operations.
 */
export type ToolCall =
  | { readonly tool: "draw_rectangle"; readonly params: DrawRectangleParams }
  | { readonly tool: "draw_arrow"; readonly params: DrawArrowParams }
  | { readonly tool: "add_label"; readonly params: AddLabelParams };

export type ToolName = ToolCall["tool"];

// ═══════════════════════════════════════════════════════════════════════════
// Grid Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Grid configuration constants.
 */
export type GridConfig = {
  readonly cellSize: number;
  readonly maxColumns: number;
  readonly maxRows: number;
};

/**
 * Computed grid metadata for a specific image.
 */
export type GridMetadata = {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
};

/**
 * Visual style properties for rendering.
 */
export type StyleConfig = {
  readonly color: string;
  readonly strokeWidth: number;
  readonly strokeDash: readonly number[] | null;
};

/**
 * Grid visual style configuration.
 */
export type GridStyleConfig = {
  readonly lineColor: string;
  readonly lineOpacity: number;
  readonly lineWidth: number;
  readonly labelColor: string;
  readonly labelBackground: string;
  readonly labelFontSize: number;
};

// ═══════════════════════════════════════════════════════════════════════════
// Default Configurations
// ═══════════════════════════════════════════════════════════════════════════

/** Default grid configuration: 200x200 cells, A-Z columns, 1-99 rows */
export const GRID_CONFIG: GridConfig = {
  cellSize: 200,
  maxColumns: 26,
  maxRows: 99,
};

/** Semantic style to visual properties mapping */
export const STYLE_MAP: Record<AnnotationStyle, StyleConfig> = {
  error: {
    color: "#DC2626",
    strokeWidth: 3,
    strokeDash: null,
  },
  warning: {
    color: "#F59E0B",
    strokeWidth: 2,
    strokeDash: null,
  },
  info: {
    color: "#3B82F6",
    strokeWidth: 2,
    strokeDash: [8, 4],
  },
  suggestion: {
    color: "#10B981",
    strokeWidth: 2,
    strokeDash: [4, 4],
  },
};

/** Default grid visual style */
export const GRID_STYLE: GridStyleConfig = {
  lineColor: "#666666",
  lineOpacity: 0.4,
  lineWidth: 1,
  labelColor: "#333333",
  labelBackground: "rgba(255,255,255,0.7)",
  labelFontSize: 11,
};

/** Default fold line configuration */
export const DEFAULT_FOLD_CONFIG: FoldConfig = {
  enabled: true,
  color: "#FF0000",
  showLabels: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM Snapshot Types (for code locator)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Serialized DOM element with position and style info.
 */
export type DOMElement = {
  readonly tagName: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly boundingBox: BoundingBox;
  readonly computedStyles: Record<string, string>;
  readonly attributes: Record<string, string>;
  readonly xpath?: string;
};

/**
 * Complete DOM snapshot for a page.
 */
export type DOMSnapshot = {
  readonly url: string;
  readonly timestamp: string;
  readonly viewport: ViewportConfig;
  readonly html: string;
  readonly elements: readonly DOMElement[];
};

// ═══════════════════════════════════════════════════════════════════════════
// Session Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Session state for persistence and resume.
 */
export type SessionState = {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
  readonly iteration: number;
  readonly artifacts: Record<string, Artifact>;
  readonly issues: Issue[];
  readonly status: "pending" | "running" | "paused" | "completed" | "failed";
};

/**
 * Session directory structure constants.
 * Note: Viewport subdirectories are created by operations, not session init.
 */
export const SESSION_STRUCTURE = {
  stateFile: "state.json",
} as const;

/**
 * Artifact file names in pipeline execution order.
 * Numbered prefixes ensure consistent sorting.
 */
export const ARTIFACT_NAMES = {
  screenshot: "01-screenshot.png",
  dom: "02-dom.json",
  withFolds: "03-with-folds.png",
  withGrid: "04-with-grid.png",
  analysis: "05-analysis.json",
  annotations: "06-annotations.json",
  annotated: "07-annotated.png",
  diffReport: "08-diff-report.json",
  safariFrame: "09-safari-frame.png",
} as const;

export type ArtifactName = keyof typeof ARTIFACT_NAMES;

/**
 * Generate viewport directory name from config.
 * Format:
 * - default: {deviceType}-{width}x{height}
 * - with deviceId: {deviceId}-{width}x{height}
 *
 * @example
 * getViewportDirName({ width: 1920, height: 1080, isMobile: false, ... }) // "desktop-1920x1080"
 * getViewportDirName({ width: 375, height: 812, isMobile: true, ... }) // "mobile-375x812"
 * getViewportDirName({ width: 375, height: 812, isMobile: true, ... }, "iphone-15-pro") // "iphone-15-pro-375x812"
 */
export function getViewportDirName(viewport: ViewportConfig, deviceId?: string): string {
  const deviceType = viewport.isMobile ? "mobile" : "desktop";
  const trimmedDeviceId = deviceId?.trim();
  const baseName =
    trimmedDeviceId !== undefined && trimmedDeviceId.length > 0
      ? trimmedDeviceId.toLowerCase()
      : deviceType;
  return `${baseName}-${viewport.width}x${viewport.height}`;
}
