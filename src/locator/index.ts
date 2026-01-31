/**
 * Code locator for vex - maps visual issues to code locations.
 *
 * @module vex/locator
 */


// Resolver
export { createResolver, createResolverWithStrategies, StrategyResolver } from './resolver.js';
// Strategies
export { domTracerStrategy, findElementMatch } from './strategies/index.js';
export type {
  BatchResolutionResult,
  // DOM Tracer
  ElementMatch,
  GrepMatch,
  HintConfig,
  LocatorContext,
  // Errors
  LocatorError,
  // Strategy
  LocatorStrategy,
  ResolutionResult,
  // Resolver
  ResolverOptions,
  // Context
  SourceMapEntry,
  SourceMapIndex,
} from './types.js';
export { DEFAULT_RESOLVER_OPTIONS } from './types.js';
