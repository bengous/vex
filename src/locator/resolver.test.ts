/**
 * Unit tests for resolver deduplication and confidence utilities.
 *
 * Tests the strategy resolver that coordinates locator strategies
 * and deduplicates code locations by file:line.
 */

import { describe, expect, test } from 'bun:test';
import type { CodeLocation } from '../core/types.js';
import { compareConfidence, dedupeLocations, meetsMinConfidence, StrategyResolver, toFileLineKey } from './resolver.js';
import type { LocatorStrategy } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function createLocation(overrides: Partial<CodeLocation> = {}): CodeLocation {
  return {
    file: 'test.liquid',
    confidence: 'medium',
    reasoning: 'Test location',
    strategy: 'test',
    ...overrides,
  };
}

function createMockStrategy(name: string, priority: number): LocatorStrategy {
  return {
    name,
    description: `Mock ${name} strategy`,
    priority,
    canHandle: () => true,
    locate: () => {
      throw new Error('Not implemented');
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// compareConfidence Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('compareConfidence', () => {
  test('high < medium (high sorts first)', () => {
    expect(compareConfidence('high', 'medium')).toBeLessThan(0);
  });

  test('medium < low', () => {
    expect(compareConfidence('medium', 'low')).toBeLessThan(0);
  });

  test('high < low', () => {
    expect(compareConfidence('high', 'low')).toBeLessThan(0);
  });

  test('same confidence → 0', () => {
    expect(compareConfidence('high', 'high')).toBe(0);
    expect(compareConfidence('medium', 'medium')).toBe(0);
    expect(compareConfidence('low', 'low')).toBe(0);
  });

  test('low > medium (reverse order)', () => {
    expect(compareConfidence('low', 'medium')).toBeGreaterThan(0);
  });

  test('sorting by confidence', () => {
    const locations = [
      createLocation({ confidence: 'low' }),
      createLocation({ confidence: 'high' }),
      createLocation({ confidence: 'medium' }),
    ];

    locations.sort((a, b) => compareConfidence(a.confidence, b.confidence));

    expect(locations[0]?.confidence).toBe('high');
    expect(locations[1]?.confidence).toBe('medium');
    expect(locations[2]?.confidence).toBe('low');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// meetsMinConfidence Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('meetsMinConfidence', () => {
  test('high meets high threshold', () => {
    const loc = createLocation({ confidence: 'high' });
    expect(meetsMinConfidence(loc, 'high')).toBe(true);
  });

  test('high meets medium threshold', () => {
    const loc = createLocation({ confidence: 'high' });
    expect(meetsMinConfidence(loc, 'medium')).toBe(true);
  });

  test('high meets low threshold', () => {
    const loc = createLocation({ confidence: 'high' });
    expect(meetsMinConfidence(loc, 'low')).toBe(true);
  });

  test('medium meets medium threshold', () => {
    const loc = createLocation({ confidence: 'medium' });
    expect(meetsMinConfidence(loc, 'medium')).toBe(true);
  });

  test('medium meets low threshold', () => {
    const loc = createLocation({ confidence: 'medium' });
    expect(meetsMinConfidence(loc, 'low')).toBe(true);
  });

  test('medium does NOT meet high threshold', () => {
    const loc = createLocation({ confidence: 'medium' });
    expect(meetsMinConfidence(loc, 'high')).toBe(false);
  });

  test('low meets only low threshold', () => {
    const loc = createLocation({ confidence: 'low' });
    expect(meetsMinConfidence(loc, 'low')).toBe(true);
    expect(meetsMinConfidence(loc, 'medium')).toBe(false);
    expect(meetsMinConfidence(loc, 'high')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toFileLineKey Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('toFileLineKey', () => {
  test('consistent key for same file:line', () => {
    const loc1 = createLocation({ file: 'foo.liquid', lineNumber: 42 });
    const loc2 = createLocation({ file: 'foo.liquid', lineNumber: 42 });

    expect(toFileLineKey(loc1)).toBe(toFileLineKey(loc2));
    expect(toFileLineKey(loc1)).toBe('foo.liquid:42');
  });

  test('different files → different keys', () => {
    const loc1 = createLocation({ file: 'foo.liquid', lineNumber: 42 });
    const loc2 = createLocation({ file: 'bar.liquid', lineNumber: 42 });

    expect(toFileLineKey(loc1)).not.toBe(toFileLineKey(loc2));
  });

  test('different lines → different keys', () => {
    const loc1 = createLocation({ file: 'foo.liquid', lineNumber: 42 });
    const loc2 = createLocation({ file: 'foo.liquid', lineNumber: 43 });

    expect(toFileLineKey(loc1)).not.toBe(toFileLineKey(loc2));
  });

  test('handles missing lineNumber → :0', () => {
    const loc = createLocation({ file: 'foo.liquid', lineNumber: undefined });
    expect(toFileLineKey(loc)).toBe('foo.liquid:0');
  });

  test('handles paths with colons', () => {
    const loc = createLocation({ file: 'C:\\Users\\foo.liquid', lineNumber: 10 });
    expect(toFileLineKey(loc)).toBe('C:\\Users\\foo.liquid:10');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dedupeLocations Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('dedupeLocations', () => {
  test('removes duplicates by file:line', () => {
    const locations = [
      createLocation({ file: 'foo.liquid', lineNumber: 10 }),
      createLocation({ file: 'foo.liquid', lineNumber: 10 }),
      createLocation({ file: 'foo.liquid', lineNumber: 10 }),
    ];

    const deduped = dedupeLocations(locations);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.file).toBe('foo.liquid');
  });

  test('keeps higher confidence when duplicate', () => {
    const locations = [
      createLocation({ file: 'foo.liquid', lineNumber: 10, confidence: 'low' }),
      createLocation({ file: 'foo.liquid', lineNumber: 10, confidence: 'high' }),
      createLocation({ file: 'foo.liquid', lineNumber: 10, confidence: 'medium' }),
    ];

    const deduped = dedupeLocations(locations);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.confidence).toBe('high');
  });

  test('preserves order of first occurrence', () => {
    const locations = [
      createLocation({ file: 'first.liquid', lineNumber: 1, confidence: 'high' }),
      createLocation({ file: 'second.liquid', lineNumber: 2, confidence: 'high' }),
      createLocation({ file: 'third.liquid', lineNumber: 3, confidence: 'high' }),
    ];

    const deduped = dedupeLocations(locations);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((l) => l.file)).toEqual(['first.liquid', 'second.liquid', 'third.liquid']);
  });

  test('handles empty array', () => {
    expect(dedupeLocations([])).toEqual([]);
  });

  test('mixed scenario: some duplicates, some unique', () => {
    const locations = [
      createLocation({ file: 'a.liquid', lineNumber: 1, confidence: 'medium' }),
      createLocation({ file: 'b.liquid', lineNumber: 2, confidence: 'low' }),
      createLocation({ file: 'a.liquid', lineNumber: 1, confidence: 'high' }), // duplicate, higher confidence
      createLocation({ file: 'c.liquid', lineNumber: 3, confidence: 'medium' }),
      createLocation({ file: 'b.liquid', lineNumber: 2, confidence: 'medium' }), // duplicate, higher confidence
    ];

    const deduped = dedupeLocations(locations);
    expect(deduped).toHaveLength(3);

    const aLoc = deduped.find((l) => l.file === 'a.liquid');
    const bLoc = deduped.find((l) => l.file === 'b.liquid');

    expect(aLoc?.confidence).toBe('high');
    expect(bLoc?.confidence).toBe('medium');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// StrategyResolver.register Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('StrategyResolver.register', () => {
  test('sorts by priority (highest first)', () => {
    const resolver = new StrategyResolver();

    resolver.register(createMockStrategy('low-priority', 10));
    resolver.register(createMockStrategy('high-priority', 100));
    resolver.register(createMockStrategy('medium-priority', 50));

    const names = resolver.getStrategyNames();

    expect(names).toEqual(['high-priority', 'medium-priority', 'low-priority']);
  });

  test('multiple strategies registered', () => {
    const resolver = new StrategyResolver();

    resolver.register(createMockStrategy('strategy-a', 1));
    resolver.register(createMockStrategy('strategy-b', 2));

    expect(resolver.getStrategyNames().length).toBe(2);
    expect(resolver.getStrategyNames()).toContain('strategy-a');
    expect(resolver.getStrategyNames()).toContain('strategy-b');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// StrategyResolver.getStrategyNames Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('StrategyResolver.getStrategyNames', () => {
  test('returns names in priority order', () => {
    const resolver = new StrategyResolver();

    resolver.register(createMockStrategy('z-strategy', 1));
    resolver.register(createMockStrategy('a-strategy', 100));

    // Despite alphabetical order (a < z), priority determines order
    expect(resolver.getStrategyNames()).toEqual(['a-strategy', 'z-strategy']);
  });

  test('empty resolver returns empty array', () => {
    const resolver = new StrategyResolver();
    expect(resolver.getStrategyNames()).toEqual([]);
  });
});
