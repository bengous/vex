/**
 * Strategy Resolver - coordinates locator strategies and aggregates results.
 *
 * Responsibilities:
 * - Register and manage locator strategies
 * - Run strategies in priority order for each issue
 * - Deduplicate and rank code locations by confidence
 * - Produce batch resolution results with metrics
 */

import type { CodeLocation, Issue } from "../core/types.js";
import type {
  BatchResolutionResult,
  LocatorContext,
  LocatorError,
  LocatorStrategy,
  ResolutionResult,
  ResolverOptions,
} from "./types.js";
import { Effect } from "effect";
import { compareConfidence, CONFIDENCE_RANK } from "../core/schema.js";
import { DEFAULT_RESOLVER_OPTIONS } from "./types.js";

export { compareConfidence } from "../core/schema.js";

/**
 * Check if a location meets the minimum confidence threshold.
 */
export function meetsMinConfidence(
  location: CodeLocation,
  minConfidence: CodeLocation["confidence"],
): boolean {
  return CONFIDENCE_RANK[location.confidence] <= CONFIDENCE_RANK[minConfidence];
}

// ═══════════════════════════════════════════════════════════════════════════
// Deduplication
// ═══════════════════════════════════════════════════════════════════════════

export function toFileLineKey(loc: CodeLocation): string {
  return `${loc.file}:${loc.lineNumber ?? 0}`;
}

/**
 * Remove duplicate locations, keeping the higher confidence version.
 */
export function dedupeLocations(locations: CodeLocation[]): CodeLocation[] {
  const seen = new Map<string, CodeLocation>();

  for (const loc of locations) {
    const key = toFileLineKey(loc);
    const existing = seen.get(key);

    if (existing === undefined || compareConfidence(loc.confidence, existing.confidence) < 0) {
      seen.set(key, loc);
    }
  }

  return Array.from(seen.values());
}

// ═══════════════════════════════════════════════════════════════════════════
// Strategy Resolver
// ═══════════════════════════════════════════════════════════════════════════

export class StrategyResolver {
  private readonly strategies: LocatorStrategy[] = [];

  /**
   * Register a locator strategy.
   */
  register(strategy: LocatorStrategy): void {
    this.strategies.push(strategy);
    // Sort by priority (highest first)
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  getStrategyNames(): string[] {
    return this.strategies.map((s) => s.name);
  }

  /**
   * Locate code for a single issue.
   */
  locateOne(
    issue: Issue,
    ctx: LocatorContext,
    options: Partial<ResolverOptions> = {},
  ): Effect.Effect<ResolutionResult, LocatorError> {
    const opts = { ...DEFAULT_RESOLVER_OPTIONS, ...options };

    return Effect.gen(this, function* () {
      const startTime = Date.now();
      const allLocations: CodeLocation[] = [];
      const strategiesUsed: string[] = [];

      const applicableStrategies =
        opts.strategies.length > 0
          ? this.strategies.filter((s) => opts.strategies.includes(s.name))
          : this.strategies;

      for (const strategy of applicableStrategies) {
        if (!strategy.canHandle(issue, ctx)) {
          continue;
        }

        strategiesUsed.push(strategy.name);

        const locations = yield* strategy.locate(issue, ctx).pipe(
          Effect.catchAll((e) => {
            // Log but don't fail - continue with other strategies
            console.warn(`Strategy ${strategy.name} failed: ${e.message}`);
            return Effect.succeed([] as readonly CodeLocation[]);
          }),
        );

        allLocations.push(...locations);

        // Early exit if we have enough high-confidence matches
        const highConfidenceCount = allLocations.filter((l) => l.confidence === "high").length;
        if (highConfidenceCount >= opts.maxLocationsPerIssue) {
          break;
        }
      }

      const filtered = allLocations.filter((loc) => meetsMinConfidence(loc, opts.minConfidence));

      const deduped = dedupeLocations(filtered);
      deduped.sort((a, b) => compareConfidence(a.confidence, b.confidence));

      const limited = deduped.slice(0, opts.maxLocationsPerIssue);

      return {
        issue,
        locations: limited,
        strategiesUsed,
        durationMs: Date.now() - startTime,
      };
    });
  }

  /**
   * Locate code for multiple issues.
   */
  locateAll(
    issues: readonly Issue[],
    ctx: LocatorContext,
    options: Partial<ResolverOptions> = {},
  ): Effect.Effect<BatchResolutionResult, LocatorError> {
    return Effect.gen(this, function* () {
      const startTime = Date.now();
      const results: ResolutionResult[] = [];

      for (const issue of issues) {
        const result = yield* this.locateOne(issue, ctx, options);
        results.push(result);
      }

      const byConfidence: Record<CodeLocation["confidence"], number> = {
        high: 0,
        medium: 0,
        low: 0,
      };

      let totalLocations = 0;
      let issuesWithLocations = 0;

      for (const result of results) {
        if (result.locations.length > 0) {
          issuesWithLocations++;
        }
        for (const loc of result.locations) {
          totalLocations++;
          byConfidence[loc.confidence]++;
        }
      }

      return {
        results,
        totalDurationMs: Date.now() - startTime,
        summary: {
          issuesProcessed: issues.length,
          issuesWithLocations,
          totalLocations,
          byConfidence,
        },
      };
    });
  }
}

/**
 * Create a resolver with pre-registered strategies.
 */
export function createResolverWithStrategies(strategies: LocatorStrategy[]): StrategyResolver {
  const resolver = new StrategyResolver();
  for (const strategy of strategies) {
    resolver.register(strategy);
  }
  return resolver;
}
