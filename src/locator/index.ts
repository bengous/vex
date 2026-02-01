/**
 * Code locator for vex - maps visual issues to code locations.
 *
 * @module vex/locator
 */

export { createResolver, createResolverWithStrategies, StrategyResolver } from './resolver.js';
export { domTracerStrategy, findElementMatch } from './strategies/index.js';
export type {
  BatchResolutionResult,
  ElementMatch,
  GrepMatch,
  HintConfig,
  LocatorContext,
  LocatorError,
  LocatorStrategy,
  ResolutionResult,
  ResolverOptions,
  SourceMapEntry,
  SourceMapIndex,
} from './types.js';
export { DEFAULT_RESOLVER_OPTIONS } from './types.js';
