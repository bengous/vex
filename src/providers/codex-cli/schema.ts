/**
 * Effect Schema definitions for Codex CLI provider profiles.
 *
 * Profiles configure sandbox permissions, approval policies, and features.
 * Built-in profiles cover common use cases; user profiles extend via config.
 *
 * LLM: Before modifying sandbox/approval/webSearch values, fetch official docs:
 * - https://developers.openai.com/codex/config-reference/ (valid enum values)
 * - https://developers.openai.com/codex/security/ (sandbox and approval behavior)
 */

import { Schema as S } from 'effect';

// ═══════════════════════════════════════════════════════════════════════════
// Profile Field Schemas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sandbox mode controls file system access.
 * - read-only: No writes allowed (safest)
 * - workspace-write: Can write to workspace only
 * - danger-full-access: Full system access (dangerous)
 */
export const CodexSandbox = S.Literal('read-only', 'workspace-write', 'danger-full-access');
export type CodexSandbox = S.Schema.Type<typeof CodexSandbox>;

/**
 * Approval policy for tool calls.
 * - untrusted: Approve every action
 * - on-failure: Approve only on failures
 * - on-request: Approve when codex asks
 * - never: Auto-approve all (fastest)
 */
export const CodexApproval = S.Literal('untrusted', 'on-failure', 'on-request', 'never');
export type CodexApproval = S.Schema.Type<typeof CodexApproval>;

/**
 * Web search feature mode.
 * - disabled: No web searches
 * - cached: Use cached results only
 * - live: Live web searches
 */
export const CodexWebSearch = S.Literal('disabled', 'cached', 'live');
export type CodexWebSearch = S.Schema.Type<typeof CodexWebSearch>;

// ═══════════════════════════════════════════════════════════════════════════
// Profile Schema
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Complete Codex profile configuration.
 */
export const CodexProfile = S.Struct({
  sandbox: CodexSandbox,
  approval: CodexApproval,
  webSearch: CodexWebSearch,
  /** MCP servers configuration. MVP: must be empty. */
  mcpServers: S.Record({ key: S.String, value: S.Unknown }),
});
export type CodexProfile = S.Schema.Type<typeof CodexProfile>;

// ═══════════════════════════════════════════════════════════════════════════
// Built-in Profiles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Built-in profiles for common use cases.
 *
 * - minimal: Maximum restrictions, interactive approval
 * - fast: Auto-approve, workspace writes, no web (for vex VLM calls)
 * - safe: Read-only with approval, cached web search
 */
export const BUILTIN_PROFILES = {
  minimal: {
    sandbox: 'read-only',
    approval: 'on-request',
    webSearch: 'disabled',
    mcpServers: {},
  },
  fast: {
    sandbox: 'workspace-write',
    approval: 'never',
    webSearch: 'disabled',
    mcpServers: {},
  },
  safe: {
    sandbox: 'read-only',
    approval: 'untrusted',
    webSearch: 'cached',
    mcpServers: {},
  },
} as const satisfies Record<string, CodexProfile>;

export type BuiltinProfileName = keyof typeof BUILTIN_PROFILES;
