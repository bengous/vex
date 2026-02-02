/**
 * Effect Schema definitions for vex types.
 *
 * These schemas provide runtime validation and compile-time types from a single
 * source of truth, eliminating `as Type[]` assertions when parsing LLM JSON.
 */

import { Schema as S } from 'effect';

// ═══════════════════════════════════════════════════════════════════════════
// Severity
// ═══════════════════════════════════════════════════════════════════════════

export const Severity = S.Literal('high', 'medium', 'low');
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
 * Grid reference pattern: A1-J99
 * - Columns: A-J (10 columns)
 * - Rows: 1-99
 */
export const GridRef = S.String.pipe(
  S.pattern(/^[A-J]\d{1,2}$/, {
    message: () => 'Invalid grid reference (expected A1-J99)',
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

export const Confidence = S.Literal('high', 'medium', 'low');
export type Confidence = typeof Confidence.Type;

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
