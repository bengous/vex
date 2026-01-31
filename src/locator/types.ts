/**
 * Code locator types for vex.
 *
 * Maps visual issues to code locations using multiple strategies.
 */

import type { Effect } from 'effect';
import type { BoundingBox, CodeLocation, DOMSnapshot, Issue } from '../core/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Locator operation failed.
 */
export interface LocatorError {
  readonly _tag: 'LocatorError';
  readonly strategy: string;
  readonly message: string;
  readonly cause?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Locator Context
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Source map entry for CSS/JS resolution.
 */
export interface SourceMapEntry {
  readonly generatedFile: string;
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly sourceFile: string;
  readonly sourceLine: number;
  readonly sourceColumn: number;
}

/**
 * Source map index for a project.
 */
export interface SourceMapIndex {
  readonly entries: readonly SourceMapEntry[];
  readonly resolve: (file: string, line: number, col: number) => SourceMapEntry | undefined;
}

/**
 * Manual hint configuration from .vexrc.
 */
export interface HintConfig {
  /** Selector to file mappings */
  readonly selectorHints: Record<string, string>;
  /** Region to file mappings */
  readonly regionHints: Record<string, string>;
  /** Component name to file mappings */
  readonly componentHints: Record<string, string>;
}

/**
 * Context available to locator strategies.
 */
export interface LocatorContext {
  readonly projectRoot: string;
  readonly domSnapshot?: DOMSnapshot;
  readonly sourceMaps?: SourceMapIndex;
  readonly manualHints?: HintConfig;
  readonly filePatterns: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Locator Strategy Interface
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strategy for locating code related to visual issues.
 */
export interface LocatorStrategy {
  /** Strategy name */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Priority (higher = tried first) */
  readonly priority: number;

  /** Check if strategy can handle this issue */
  readonly canHandle: (issue: Issue, ctx: LocatorContext) => boolean;

  /** Locate code for an issue */
  readonly locate: (issue: Issue, ctx: LocatorContext) => Effect.Effect<readonly CodeLocation[], LocatorError>;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM Tracer Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Element match from DOM tracer.
 */
export interface ElementMatch {
  readonly element: {
    readonly tagName: string;
    readonly id?: string;
    readonly classes: readonly string[];
    readonly boundingBox: BoundingBox;
  };
  readonly selectors: readonly string[];
  readonly confidence: 'high' | 'medium' | 'low';
}

/**
 * Grep match result.
 */
export interface GrepMatch {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
  readonly content: string;
  readonly selector: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Resolver Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for the strategy resolver.
 */
export interface ResolverOptions {
  /** Maximum locations per issue */
  readonly maxLocationsPerIssue: number;
  /** Minimum confidence to include */
  readonly minConfidence: CodeLocation['confidence'];
  /** Strategies to use (empty = all) */
  readonly strategies: readonly string[];
}

/**
 * Resolution result for a single issue.
 */
export interface ResolutionResult {
  readonly issue: Issue;
  readonly locations: readonly CodeLocation[];
  readonly strategiesUsed: readonly string[];
  readonly durationMs: number;
}

/**
 * Batch resolution result.
 */
export interface BatchResolutionResult {
  readonly results: readonly ResolutionResult[];
  readonly totalDurationMs: number;
  readonly summary: {
    readonly issuesProcessed: number;
    readonly issuesWithLocations: number;
    readonly totalLocations: number;
    readonly byConfidence: Record<CodeLocation['confidence'], number>;
  };
}

/** Default resolver options */
export const DEFAULT_RESOLVER_OPTIONS: ResolverOptions = {
  maxLocationsPerIssue: 5,
  minConfidence: 'low',
  strategies: [],
};
