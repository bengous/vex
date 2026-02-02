/**
 * Validation utilities for parsing LLM responses with Effect Schema.
 *
 * Implements defense-in-depth strategy:
 * 1. Schema validation catches malformed JSON
 * 2. Partial recovery keeps valid issues when some are malformed
 */

import { Data, Effect, Either, ParseResult, Schema } from 'effect';
import * as S from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

export class IssueParseError extends Data.TaggedError('IssueParseError')<{
  readonly message: string;
  readonly raw?: unknown;
}> {}

// ═══════════════════════════════════════════════════════════════════════════
// Validation Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate an array of issues from unknown input.
 *
 * Returns Effect that either succeeds with validated issues or fails
 * with IssueParseError containing formatted validation errors.
 */
export function validateIssues(raw: unknown): Effect.Effect<S.Issue[], IssueParseError> {
  return Schema.decodeUnknown(S.IssueArray)(raw).pipe(
    Effect.mapError((parseError) => {
      const formatted = formatParseError(parseError);
      return new IssueParseError({
        message: `Invalid issue data:\n${formatted}`,
        raw,
      });
    }),
  );
}

/**
 * Validate issues with partial recovery: if the full array fails validation,
 * attempt to validate each item individually and return the valid ones.
 *
 * This is useful for LLM output where most issues may be valid but one is malformed.
 * Logs warnings for dropped issues.
 */
export function validateIssuesWithPartialRecovery(
  raw: unknown,
  logger?: { warn: (msg: string) => void },
): Effect.Effect<S.Issue[], never, never> {
  // First, check if raw is an array
  if (!Array.isArray(raw)) {
    logger?.warn('Issue data is not an array, returning empty');
    return Effect.succeed([]);
  }

  // Try validating the full array first (synchronously via decodeUnknownSync)
  const fullResult = Schema.decodeUnknownEither(S.IssueArray)(raw);

  if (Either.isRight(fullResult)) {
    return Effect.succeed(fullResult.right);
  }

  // Full validation failed - try each item individually
  logger?.warn('Full issue array validation failed, attempting partial recovery');

  const validIssues: S.Issue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const itemResult = Schema.decodeUnknownEither(S.Issue)(item);

    if (Either.isRight(itemResult)) {
      validIssues.push(itemResult.right);
    } else {
      const error = formatParseError(itemResult.left);
      logger?.warn(`Dropped invalid issue at index ${i}: ${error}`);
    }
  }

  return Effect.succeed(validIssues);
}

/**
 * Extract and validate issues from a raw LLM response string.
 *
 * 1. Extracts JSON from response (handles markdown code blocks)
 * 2. Parses JSON
 * 3. Validates with partial recovery
 */
export function parseIssuesFromResponse(
  response: string,
  logger?: { warn: (msg: string) => void },
): Effect.Effect<S.Issue[], never, never> {
  // Extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (!jsonMatch) {
    logger?.warn('No JSON with "issues" found in response');
    return Effect.succeed([]);
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    logger?.warn(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    return Effect.succeed([]);
  }

  // Extract issues array from parsed object
  if (typeof parsed !== 'object' || parsed === null) {
    logger?.warn('Parsed JSON is not an object');
    return Effect.succeed([]);
  }

  const issues = (parsed as Record<string, unknown>).issues;
  if (issues === undefined) {
    logger?.warn('No "issues" field in parsed JSON');
    return Effect.succeed([]);
  }

  // Validate with partial recovery
  return validateIssuesWithPartialRecovery(issues, logger);
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple Issue Validation (for scripts/vision-audit)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate simple issues with partial recovery (for scripts using string regions).
 */
export function validateSimpleIssuesWithPartialRecovery(raw: unknown): S.SimpleIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  // Try validating the full array first
  const fullResult = Schema.decodeUnknownEither(S.SimpleIssueArray)(raw);

  if (Either.isRight(fullResult)) {
    return fullResult.right;
  }

  // Full validation failed - try each item individually
  const validIssues: S.SimpleIssue[] = [];
  for (const item of raw) {
    const itemResult = Schema.decodeUnknownEither(S.SimpleIssue)(item);
    if (Either.isRight(itemResult)) {
      validIssues.push(itemResult.right);
    }
  }

  return validIssues;
}

/**
 * Parse analysis response for scripts (with clarification support).
 * Returns issues and optional clarification question.
 *
 * This is a synchronous function for use in scripts that don't use Effect runtime.
 */
export function parseSimpleAnalysisResponse(content: string): {
  issues: S.SimpleIssue[];
  clarificationNeeded?: string;
} {
  // Try to extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (!jsonMatch) {
    return { issues: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { issues: [] };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { issues: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const issues = validateSimpleIssuesWithPartialRecovery(obj.issues);

  return {
    issues,
    clarificationNeeded: typeof obj.clarificationNeeded === 'string' ? obj.clarificationNeeded : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a ParseError into a readable string.
 */
function formatParseError(error: ParseResult.ParseError): string {
  // Use Effect's built-in tree formatter for detailed error messages
  return ParseResult.TreeFormatter.formatErrorSync(error);
}
