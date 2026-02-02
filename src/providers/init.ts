/**
 * Provider initialization - call once at application startup.
 * Replaces side-effect imports for provider self-registration.
 *
 * Each provider module calls registerProvider() at import time,
 * so importing them triggers registration. This module centralizes
 * that side-effect in one place for explicit initialization.
 */

// Import each provider module for registration side-effects
// Order matters: first registered = default provider
import './ollama/index.js';
import './claude-cli/index.js';
import './codex-cli/index.js';
import './gemini-cli/index.js';

let initialized = false;

export function initProviders(): void {
  if (initialized) return;
  initialized = true;
}

export function isProvidersInitialized(): boolean {
  return initialized;
}
