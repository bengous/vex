/**
 * Effect Schema definitions for vex types.
 *
 * These schemas provide runtime validation and compile-time types from a single
 * source of truth, eliminating `as Type[]` assertions when parsing LLM JSON.
 */

import { Schema as S } from "effect";

// ═══════════════════════════════════════════════════════════════════════════
// Severity
// ═══════════════════════════════════════════════════════════════════════════

export const Severity = S.Literal("high", "medium", "low");
export type Severity = typeof Severity.Type;

// ═══════════════════════════════════════════════════════════════════════════
// Geometry Types
// ═══════════════════════════════════════════════════════════════════════════

export const BoundingBox = S.mutable(
  S.Struct({
    x: S.Number.pipe(S.nonNegative()),
    y: S.Number.pipe(S.nonNegative()),
    width: S.Number.pipe(S.positive()),
    height: S.Number.pipe(S.positive()),
  }),
);
export type BoundingBox = typeof BoundingBox.Type;

/**
 * Grid reference pattern: A1-Z99
 * - Columns: A-Z (26 columns)
 * - Rows: 1-99
 */
export const GridRef = S.String.pipe(
  S.pattern(/^[A-Z]\d{1,2}$/, {
    message: () => "Invalid grid reference (expected A1-Z99)",
  }),
);
export type GridRef = typeof GridRef.Type;

/**
 * Region can be specified as pixels (BoundingBox) or grid reference (GridRef).
 */
export const Region = S.Union(BoundingBox, GridRef);
export type Region = typeof Region.Type;

// ═══════════════════════════════════════════════════════════════════════════
// Code Location Types
// ═══════════════════════════════════════════════════════════════════════════

export const Confidence = S.Literal("high", "medium", "low");
export type Confidence = typeof Confidence.Type;

export const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function compareConfidence(a: Confidence, b: Confidence): number {
  return CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b];
}

export const CodeLocation = S.mutable(
  S.Struct({
    file: S.String,
    lineNumber: S.optional(S.Number),
    columnNumber: S.optional(S.Number),
    selector: S.optional(S.String),
    confidence: Confidence,
    reasoning: S.String,
    strategy: S.String,
  }),
);
export type CodeLocation = typeof CodeLocation.Type;

// ═══════════════════════════════════════════════════════════════════════════
// Issue Types
// ═══════════════════════════════════════════════════════════════════════════

export const Issue = S.mutable(
  S.Struct({
    id: S.Number,
    description: S.String,
    severity: Severity,
    region: Region,
    suggestedFix: S.optional(S.String),
    category: S.optional(S.String),
    codeLocations: S.optional(S.mutable(S.Array(CodeLocation))),
  }),
);
export type Issue = typeof Issue.Type;

export const IssueArray = S.mutable(S.Array(Issue));
export type IssueArray = typeof IssueArray.Type;

// ═══════════════════════════════════════════════════════════════════════════
// LLM Response Wrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for the JSON structure LLMs return when analyzing images.
 * The `issues` field is required but may be empty.
 */
export const AnalysisResponse = S.Struct({
  issues: IssueArray,
});
export type AnalysisResponse = typeof AnalysisResponse.Type;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Artifact & Snapshot Types
// ═══════════════════════════════════════════════════════════════════════════

export const ViewportConfig = S.mutable(
  S.Struct({
    width: S.Number.pipe(S.positive()),
    height: S.Number.pipe(S.positive()),
    deviceScaleFactor: S.Number.pipe(S.positive()),
    isMobile: S.Boolean,
    hasTouch: S.optional(S.Boolean),
    userAgent: S.optional(S.String),
  }),
);
export type ViewportConfig = typeof ViewportConfig.Type;

export const ArtifactType = S.Literal(
  "image",
  "annotated-image",
  "analysis",
  "manifest",
  "dom-snapshot",
  "diff-report",
  "annotations",
);
export type ArtifactType = typeof ArtifactType.Type;

export const Artifact = S.mutable(
  S.Struct({
    _kind: S.optional(S.Literal("artifact")),
    id: S.String,
    type: ArtifactType,
    path: S.String,
    createdAt: S.String,
    createdBy: S.String,
    metadata: S.Record({ key: S.String, value: S.Unknown }),
  }),
);
export type Artifact = typeof Artifact.Type & { readonly _kind: "artifact" };

export const AnalysisResult = S.mutable(
  S.Struct({
    provider: S.String,
    model: S.String,
    response: S.String,
    durationMs: S.Number,
    issues: S.mutable(S.Array(Issue)),
    rawJson: S.optional(S.Unknown),
  }),
);
export type AnalysisResult = typeof AnalysisResult.Type;

export const DOMElement = S.mutable(
  S.Struct({
    tagName: S.String,
    id: S.optional(S.String),
    classes: S.mutable(S.Array(S.String)),
    boundingBox: BoundingBox,
    computedStyles: S.Record({ key: S.String, value: S.String }),
    attributes: S.Record({ key: S.String, value: S.String }),
    xpath: S.optional(S.String),
  }),
);
export type DOMElement = typeof DOMElement.Type;

export const DOMSnapshot = S.mutable(
  S.Struct({
    url: S.String,
    timestamp: S.String,
    viewport: ViewportConfig,
    html: S.String,
    elements: S.mutable(S.Array(DOMElement)),
  }),
);
export type DOMSnapshot = typeof DOMSnapshot.Type;

// ═══════════════════════════════════════════════════════════════════════════
// Annotation Tool Calls
// ═══════════════════════════════════════════════════════════════════════════

export const AnnotationStyle = S.Literal("error", "warning", "info", "suggestion");
export type AnnotationStyle = typeof AnnotationStyle.Type;

export const LabelPosition = S.Literal("top", "bottom", "left", "right", "auto");
export type LabelPosition = typeof LabelPosition.Type;

export const DrawRectangleParams = S.mutable(
  S.Struct({
    start: GridRef,
    end: S.optional(GridRef),
    style: AnnotationStyle,
    label: S.optional(S.String),
  }),
);
export type DrawRectangleParams = typeof DrawRectangleParams.Type;

export const DrawArrowParams = S.mutable(
  S.Struct({
    from: GridRef,
    to: GridRef,
    style: AnnotationStyle,
    label: S.optional(S.String),
  }),
);
export type DrawArrowParams = typeof DrawArrowParams.Type;

export const AddLabelParams = S.mutable(
  S.Struct({
    cell: GridRef,
    text: S.String,
    style: AnnotationStyle,
    position: S.optional(LabelPosition),
  }),
);
export type AddLabelParams = typeof AddLabelParams.Type;

export const ToolCall = S.Union(
  S.Struct({ tool: S.Literal("draw_rectangle"), params: DrawRectangleParams }),
  S.Struct({ tool: S.Literal("draw_arrow"), params: DrawArrowParams }),
  S.Struct({ tool: S.Literal("add_label"), params: AddLabelParams }),
);
export type ToolCall = typeof ToolCall.Type;
