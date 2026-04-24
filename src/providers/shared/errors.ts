/**
 * Provider-related error types.
 *
 * These extend beyond the runtime errors in service.ts to include
 * configuration and setup errors.
 */

import { Data } from "effect";

/**
 * CLI provider is not installed on the system.
 */
export class ProviderNotInstalled extends Data.TaggedError("ProviderNotInstalled")<{
  readonly provider: string;
  readonly command: string;
  /** Installation instructions (e.g., "npm install -g @openai/codex") */
  readonly installHint?: string;
}> {}

/**
 * Profile not found in built-in or user profiles.
 */
export class ProfileNotFoundError extends Data.TaggedError("ProfileNotFoundError")<{
  readonly profileName: string;
  readonly availableProfiles: readonly string[];
}> {
  override get message(): string {
    return this.availableProfiles.length > 0
      ? `Profile '${this.profileName}' not found. Available: ${this.availableProfiles.join(", ")}`
      : `Profile '${this.profileName}' not found. No profiles available.`;
  }
}

/**
 * Profile prefix doesn't match the target provider.
 * e.g., using "claude:fast" with codex-cli provider.
 */
export class ProfileProviderMismatchError extends Data.TaggedError("ProfileProviderMismatchError")<{
  readonly profileName: string;
  readonly expectedProvider: string;
  readonly actualPrefix: string;
}> {}

/** Union of all provider configuration errors */
export type ProviderConfigError =
  | ProviderNotInstalled
  | ProfileNotFoundError
  | ProfileProviderMismatchError;
