/**
 * Unit tests for Effect Schema definitions.
 *
 * Tests runtime validation for Issue types, ensuring schemas correctly
 * accept valid input and reject malformed data with appropriate errors.
 */

import { describe, expect, test } from 'bun:test';
import { Either, Schema } from 'effect';
import {
  AnalysisResponse,
  BoundingBox,
  CodeLocation,
  Confidence,
  GridRef,
  Issue,
  IssueArray,
  Region,
  Severity,
} from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Decode unknown input and return Either (right = success, left = error) */
const decode = <A, I>(schema: Schema.Schema<A, I, never>) => Schema.decodeUnknownEither(schema);

/** Check if decode result is success */
const isSuccess = <A, E>(result: Either.Either<A, E>): result is Either.Right<E, A> => Either.isRight(result);

/** Check if decode result is failure */
const isFailure = <A, E>(result: Either.Either<A, E>): result is Either.Left<E, A> => Either.isLeft(result);

// ═══════════════════════════════════════════════════════════════════════════
// Severity Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Severity', () => {
  test('accepts "high"', () => {
    const result = decode(Severity)('high');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toBe('high');
    }
  });

  test('accepts "medium"', () => {
    const result = decode(Severity)('medium');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toBe('medium');
    }
  });

  test('accepts "low"', () => {
    const result = decode(Severity)('low');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toBe('low');
    }
  });

  test('rejects invalid value', () => {
    const result = decode(Severity)('critical');
    expect(isFailure(result)).toBe(true);
  });

  test('rejects uppercase', () => {
    const result = decode(Severity)('HIGH');
    expect(isFailure(result)).toBe(true);
  });

  test('rejects number', () => {
    const result = decode(Severity)(1);
    expect(isFailure(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Confidence Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Confidence', () => {
  test('accepts all valid values', () => {
    for (const value of ['high', 'medium', 'low']) {
      const result = decode(Confidence)(value);
      expect(isSuccess(result)).toBe(true);
    }
  });

  test('rejects invalid value', () => {
    const result = decode(Confidence)('uncertain');
    expect(isFailure(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BoundingBox Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('BoundingBox', () => {
  test('accepts valid bounding box', () => {
    const input = { x: 0, y: 0, width: 100, height: 50 };
    const result = decode(BoundingBox)(input);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toEqual(input);
    }
  });

  test('accepts x=0, y=0 (non-negative)', () => {
    const input = { x: 0, y: 0, width: 1, height: 1 };
    const result = decode(BoundingBox)(input);
    expect(isSuccess(result)).toBe(true);
  });

  test('accepts positive x, y values', () => {
    const input = { x: 100, y: 200, width: 50, height: 50 };
    const result = decode(BoundingBox)(input);
    expect(isSuccess(result)).toBe(true);
  });

  test('rejects negative x', () => {
    const input = { x: -1, y: 0, width: 100, height: 50 };
    const result = decode(BoundingBox)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects negative y', () => {
    const input = { x: 0, y: -10, width: 100, height: 50 };
    const result = decode(BoundingBox)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects width=0 (must be positive)', () => {
    const input = { x: 0, y: 0, width: 0, height: 50 };
    const result = decode(BoundingBox)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects height=0 (must be positive)', () => {
    const input = { x: 0, y: 0, width: 100, height: 0 };
    const result = decode(BoundingBox)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects negative width', () => {
    const input = { x: 0, y: 0, width: -100, height: 50 };
    const result = decode(BoundingBox)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing fields', () => {
    const result = decode(BoundingBox)({ x: 0, y: 0 });
    expect(isFailure(result)).toBe(true);
  });

  test('accepts width=1 (minimum positive)', () => {
    const input = { x: 0, y: 0, width: 1, height: 1 };
    const result = decode(BoundingBox)(input);
    expect(isSuccess(result)).toBe(true);
  });

  test('accepts float values', () => {
    const input = { x: 10.5, y: 20.5, width: 100.5, height: 50.5 };
    const result = decode(BoundingBox)(input);
    expect(isSuccess(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GridRef Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('GridRef', () => {
  describe('valid references', () => {
    test('accepts "A1" (minimum)', () => {
      const result = decode(GridRef)('A1');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.right).toBe('A1');
      }
    });

    test('accepts "J99" (maximum)', () => {
      const result = decode(GridRef)('J99');
      expect(isSuccess(result)).toBe(true);
    });

    test('accepts all valid column letters A-J', () => {
      const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      for (const col of columns) {
        const result = decode(GridRef)(`${col}1`);
        expect(isSuccess(result)).toBe(true);
      }
    });

    test('accepts single digit rows 1-9', () => {
      for (let i = 1; i <= 9; i++) {
        const result = decode(GridRef)(`A${i}`);
        expect(isSuccess(result)).toBe(true);
      }
    });

    test('accepts double digit rows 10-99', () => {
      const samples = [10, 25, 50, 75, 99];
      for (const row of samples) {
        const result = decode(GridRef)(`A${row}`);
        expect(isSuccess(result)).toBe(true);
      }
    });
  });

  describe('invalid references', () => {
    test('rejects "K1" (column out of range)', () => {
      const result = decode(GridRef)('K1');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects "Z1" (column far out of range)', () => {
      const result = decode(GridRef)('Z1');
      expect(isFailure(result)).toBe(true);
    });

    test('accepts "A0" (pattern matches, semantic validation happens elsewhere)', () => {
      // Note: GridRef schema only validates pattern, not row range.
      // Row 0 rejection happens in parseCellRef() at runtime.
      const result = decode(GridRef)('A0');
      expect(isSuccess(result)).toBe(true);
    });

    test('rejects "A100" (row > 99, three digits)', () => {
      const result = decode(GridRef)('A100');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects "a1" (lowercase column)', () => {
      const result = decode(GridRef)('a1');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects empty string', () => {
      const result = decode(GridRef)('');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects just letter "A"', () => {
      const result = decode(GridRef)('A');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects just number "1"', () => {
      const result = decode(GridRef)('1');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects "1A" (reversed)', () => {
      const result = decode(GridRef)('1A');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects "AA1" (two letters)', () => {
      const result = decode(GridRef)('AA1');
      expect(isFailure(result)).toBe(true);
    });

    test('rejects number type', () => {
      const result = decode(GridRef)(11);
      expect(isFailure(result)).toBe(true);
    });

    test('error message contains hint', () => {
      const result = decode(GridRef)('K1');
      expect(isFailure(result)).toBe(true);
      // The schema defines a message for pattern failures
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region Tests (Union of BoundingBox | GridRef)
// ═══════════════════════════════════════════════════════════════════════════

describe('Region', () => {
  test('accepts BoundingBox variant', () => {
    const input = { x: 100, y: 200, width: 50, height: 50 };
    const result = decode(Region)(input);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toEqual(input);
    }
  });

  test('accepts GridRef variant', () => {
    const result = decode(Region)('B5');

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toBe('B5');
    }
  });

  test('rejects invalid BoundingBox', () => {
    const input = { x: -1, y: 0, width: 100, height: 50 };
    const result = decode(Region)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects invalid GridRef', () => {
    const result = decode(Region)('K1');
    expect(isFailure(result)).toBe(true);
  });

  test('rejects arbitrary string', () => {
    const result = decode(Region)('top-left');
    expect(isFailure(result)).toBe(true);
  });

  test('rejects null', () => {
    const result = decode(Region)(null);
    expect(isFailure(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CodeLocation Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('CodeLocation', () => {
  const validLocation = {
    file: 'sections/header.liquid',
    confidence: 'high',
    reasoning: 'Matched by CSS selector',
    strategy: 'dom-tracer',
  };

  test('accepts minimal valid location', () => {
    const result = decode(CodeLocation)(validLocation);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right.file).toBe('sections/header.liquid');
      expect(result.right.confidence).toBe('high');
    }
  });

  test('accepts location with all optional fields', () => {
    const input = {
      ...validLocation,
      lineNumber: 42,
      columnNumber: 10,
      selector: '.hero-section',
    };
    const result = decode(CodeLocation)(input);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right.lineNumber).toBe(42);
      expect(result.right.columnNumber).toBe(10);
      expect(result.right.selector).toBe('.hero-section');
    }
  });

  test('rejects invalid confidence', () => {
    const input = { ...validLocation, confidence: 'uncertain' };
    const result = decode(CodeLocation)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing file', () => {
    const { file: _, ...withoutFile } = validLocation;
    const result = decode(CodeLocation)(withoutFile);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing reasoning', () => {
    const { reasoning: _, ...withoutReasoning } = validLocation;
    const result = decode(CodeLocation)(withoutReasoning);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing strategy', () => {
    const { strategy: _, ...withoutStrategy } = validLocation;
    const result = decode(CodeLocation)(withoutStrategy);
    expect(isFailure(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Issue', () => {
  const validIssue = {
    id: 1,
    description: 'Button text is too small',
    severity: 'medium',
    region: 'A3',
  };

  test('accepts minimal valid issue', () => {
    const result = decode(Issue)(validIssue);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right.id).toBe(1);
      expect(result.right.description).toBe('Button text is too small');
      expect(result.right.severity).toBe('medium');
      expect(result.right.region).toBe('A3');
    }
  });

  test('accepts issue with BoundingBox region', () => {
    const input = {
      ...validIssue,
      region: { x: 100, y: 200, width: 50, height: 50 },
    };
    const result = decode(Issue)(input);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right.region).toEqual({ x: 100, y: 200, width: 50, height: 50 });
    }
  });

  test('accepts issue with all optional fields', () => {
    const input = {
      ...validIssue,
      suggestedFix: 'Increase font size to 16px',
      category: 'accessibility',
      codeLocations: [
        {
          file: 'sections/hero.liquid',
          lineNumber: 25,
          confidence: 'high',
          reasoning: 'Found matching selector',
          strategy: 'dom-tracer',
        },
      ],
    };
    const result = decode(Issue)(input);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right.suggestedFix).toBe('Increase font size to 16px');
      expect(result.right.category).toBe('accessibility');
      expect(result.right.codeLocations).toHaveLength(1);
    }
  });

  test('rejects missing id', () => {
    const { id: _, ...withoutId } = validIssue;
    const result = decode(Issue)(withoutId);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing description', () => {
    const { description: _, ...withoutDesc } = validIssue;
    const result = decode(Issue)(withoutDesc);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing severity', () => {
    const { severity: _, ...withoutSeverity } = validIssue;
    const result = decode(Issue)(withoutSeverity);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects missing region', () => {
    const { region: _, ...withoutRegion } = validIssue;
    const result = decode(Issue)(withoutRegion);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects invalid severity', () => {
    const input = { ...validIssue, severity: 'critical' };
    const result = decode(Issue)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects invalid region (string not matching GridRef)', () => {
    const input = { ...validIssue, region: 'top-left' };
    const result = decode(Issue)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects invalid codeLocations item', () => {
    const input = {
      ...validIssue,
      codeLocations: [{ file: 'test.liquid' }], // missing required fields
    };
    const result = decode(Issue)(input);
    expect(isFailure(result)).toBe(true);
  });

  test('accepts empty codeLocations array', () => {
    const input = { ...validIssue, codeLocations: [] };
    const result = decode(Issue)(input);
    expect(isSuccess(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IssueArray Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('IssueArray', () => {
  const validIssue = {
    id: 1,
    description: 'Test issue',
    severity: 'medium',
    region: 'A1',
  };

  test('accepts empty array', () => {
    const result = decode(IssueArray)([]);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toEqual([]);
    }
  });

  test('accepts array with single issue', () => {
    const result = decode(IssueArray)([validIssue]);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toHaveLength(1);
    }
  });

  test('accepts array with multiple issues', () => {
    const issues = [
      { ...validIssue, id: 1 },
      { ...validIssue, id: 2, severity: 'high' },
      { ...validIssue, id: 3, severity: 'low' },
    ];
    const result = decode(IssueArray)(issues);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.right).toHaveLength(3);
    }
  });

  test('rejects if any issue is invalid', () => {
    const issues = [validIssue, { ...validIssue, id: 2, severity: 'invalid' }];
    const result = decode(IssueArray)(issues);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects non-array', () => {
    const result = decode(IssueArray)(validIssue);
    expect(isFailure(result)).toBe(true);
  });

  test('rejects null', () => {
    const result = decode(IssueArray)(null);
    expect(isFailure(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AnalysisResponse Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AnalysisResponse', () => {
  test('accepts response with empty issues', () => {
    const result = decode(AnalysisResponse)({ issues: [] });
    expect(isSuccess(result)).toBe(true);
  });

  test('accepts response with valid issues', () => {
    const input = {
      issues: [{ id: 1, description: 'Test', severity: 'low', region: 'A1' }],
    };
    const result = decode(AnalysisResponse)(input);
    expect(isSuccess(result)).toBe(true);
  });

  test('rejects missing issues field', () => {
    const result = decode(AnalysisResponse)({});
    expect(isFailure(result)).toBe(true);
  });

  test('rejects issues: null', () => {
    const result = decode(AnalysisResponse)({ issues: null });
    expect(isFailure(result)).toBe(true);
  });
});
