/**
 * Validation utilities for parsing LLM responses with Effect Schema.
 *
 * Implements defense-in-depth strategy:
 * 1. Schema validation catches malformed JSON
 * 2. Partial recovery keeps valid issues when some are malformed
 */

import { Data, Effect, Either, ParseResult, Schema } from "effect";
import * as S from "./schema.js";

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

export class IssueParseError extends Data.TaggedError("IssueParseError")<{
  readonly message: string;
  readonly raw?: unknown;
}> {}

/**
 * Error indicating validation failed and retry may help.
 * Contains details for constructing a schema-reminder retry prompt.
 */
export class ValidationRetryNeeded extends Data.TaggedError("ValidationRetryNeeded")<{
  readonly reason: "no_json" | "json_parse_error" | "schema_validation_error";
  readonly details: string;
  readonly partialIssues: S.Issue[];
}> {
  override get message(): string {
    return `Validation retry needed (${this.reason}): ${this.details}`;
  }
}

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
): Effect.Effect<S.Issue[]> {
  // First, check if raw is an array
  if (!Array.isArray(raw)) {
    logger?.warn("Issue data is not an array, returning empty");
    return Effect.succeed([]);
  }

  // Try validating the full array first (synchronously via decodeUnknownSync)
  const fullResult = Schema.decodeUnknownEither(S.IssueArray)(raw);

  if (Either.isRight(fullResult)) {
    return Effect.succeed(fullResult.right);
  }

  // Full validation failed - try each item individually
  logger?.warn("Full issue array validation failed, attempting partial recovery");

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
 * Parse issues with strict validation - FAILS if any issues found.
 * Use with Effect.orElse or Effect.catchTag for retry-then-fallback pattern.
 *
 * Failure modes:
 * - no_json: Response contains no JSON with "issues" field
 * - json_parse_error: JSON is malformed
 * - schema_validation_error: JSON parses but doesn't match Issue schema
 */
export function parseIssuesStrict(
  response: string,
): Effect.Effect<S.Issue[], ValidationRetryNeeded> {
  // Extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (!jsonMatch) {
    return Effect.fail(
      new ValidationRetryNeeded({
        reason: "no_json",
        details: 'No JSON object with "issues" field found in response',
        partialIssues: [],
      }),
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return Effect.fail(
      new ValidationRetryNeeded({
        reason: "json_parse_error",
        details: e instanceof Error ? e.message : String(e),
        partialIssues: [],
      }),
    );
  }

  // Extract issues array from parsed object
  if (typeof parsed !== "object" || parsed === null) {
    return Effect.fail(
      new ValidationRetryNeeded({
        reason: "json_parse_error",
        details: "Parsed JSON is not an object",
        partialIssues: [],
      }),
    );
  }

  const issues = (parsed as Record<string, unknown>).issues;
  if (issues === undefined) {
    return Effect.fail(
      new ValidationRetryNeeded({
        reason: "no_json",
        details: 'JSON object missing "issues" field',
        partialIssues: [],
      }),
    );
  }

  // Validate strictly - fail if array validation fails or any individual issue is invalid
  if (!Array.isArray(issues)) {
    return Effect.fail(
      new ValidationRetryNeeded({
        reason: "schema_validation_error",
        details: '"issues" field is not an array',
        partialIssues: [],
      }),
    );
  }

  // Try validating the full array
  const fullResult = Schema.decodeUnknownEither(S.IssueArray)(issues);
  if (Either.isRight(fullResult)) {
    return Effect.succeed(fullResult.right);
  }

  // Full validation failed - collect partial issues for the error
  const partialIssues: S.Issue[] = [];
  for (const item of issues) {
    const itemResult = Schema.decodeUnknownEither(S.Issue)(item);
    if (Either.isRight(itemResult)) {
      partialIssues.push(itemResult.right);
    }
  }

  return Effect.fail(
    new ValidationRetryNeeded({
      reason: "schema_validation_error",
      details: formatParseError(fullResult.left),
      partialIssues,
    }),
  );
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
): Effect.Effect<S.Issue[]> {
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
  if (typeof parsed !== "object" || parsed === null) {
    logger?.warn("Parsed JSON is not an object");
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
// Retry Prompt Builder
// ═══════════════════════════════════════════════════════════════════════════

const ERROR_MESSAGES: Record<ValidationRetryNeeded["reason"], string> = {
  no_json: 'Your response did not contain valid JSON with an "issues" array.',
  json_parse_error: "Your response contained malformed JSON that could not be parsed.",
  schema_validation_error: "Some issues in your response did not match the required schema.",
};

const ISSUE_SCHEMA_EXAMPLE = `{
  "issues": [
    {
      "id": 1,
      "description": "Brief description of the visual issue",
      "severity": "high" | "medium" | "low",
      "region": "A1" | {"x": number, "y": number, "width": number, "height": number},
      "suggestedFix": "Optional fix suggestion"
    }
  ]
}`;

/**
 * Build a retry prompt that reminds the LLM of the expected JSON schema.
 * Includes the original prompt plus error context and schema specification.
 */
export function buildRetryPrompt(originalPrompt: string, error: ValidationRetryNeeded): string {
  const errorMessage = ERROR_MESSAGES[error.reason];
  const detailLine = error.details ? `\nDetails: ${error.details}` : "";

  return `${originalPrompt}

IMPORTANT: Your previous response could not be parsed. ${errorMessage}${detailLine}

Please ensure your response contains valid JSON matching this exact schema:

${ISSUE_SCHEMA_EXAMPLE}

Return ONLY the JSON object, no markdown code blocks or additional text.`;
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
