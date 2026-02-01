/**
 * Unit tests for grid math and overlay functions.
 *
 * Tests the coordinate system that maps visual regions to code locations
 * using a cell reference system (A1-J99).
 */

import { describe, expect, test } from 'bun:test';
import {
  calculateGrid,
  cellCenter,
  cellRangeToPixels,
  cellToPixels,
  isValidCellRef,
  parseCellRef,
  pixelsToCell,
} from './overlays.js';
import type { GridConfig } from './types.js';
import { GRID_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// calculateGrid Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateGrid', () => {
  test('standard viewport (1920x1080)', () => {
    const grid = calculateGrid(1920, 1080);

    // 1920/200 = 9.6 → ceil = 10, but maxColumns = 10 → 10
    expect(grid.cols).toBe(10);
    // 1080/200 = 5.4 → ceil = 6
    expect(grid.rows).toBe(6);
    expect(grid.cellSize).toBe(GRID_CONFIG.cellSize);
    expect(grid.gridWidth).toBe(10 * GRID_CONFIG.cellSize);
    expect(grid.gridHeight).toBe(6 * GRID_CONFIG.cellSize);
  });

  test('small viewport clamps to available cells', () => {
    const grid = calculateGrid(100, 100);

    // 100/200 = 0.5 → ceil = 1
    expect(grid.cols).toBe(1);
    expect(grid.rows).toBe(1);
  });

  test('large viewport respects maxColumns/maxRows', () => {
    // Very large viewport
    const grid = calculateGrid(5000, 25000);

    // 5000/200 = 25 → clamped to maxColumns (10)
    expect(grid.cols).toBe(GRID_CONFIG.maxColumns);
    // 25000/200 = 125 → clamped to maxRows (99)
    expect(grid.rows).toBe(GRID_CONFIG.maxRows);
  });

  test('custom config overrides defaults', () => {
    const customConfig: GridConfig = {
      cellSize: 100,
      maxColumns: 5,
      maxRows: 10,
    };
    const grid = calculateGrid(500, 500, customConfig);

    expect(grid.cols).toBe(5);
    expect(grid.rows).toBe(5);
    expect(grid.cellSize).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isValidCellRef Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('isValidCellRef', () => {
  test('valid: A1', () => {
    expect(isValidCellRef('A1')).toBe(true);
  });

  test('valid: J99 (max valid)', () => {
    expect(isValidCellRef('J99')).toBe(true);
  });

  test('valid: B10', () => {
    expect(isValidCellRef('B10')).toBe(true);
  });

  test('invalid: K1 (column out of range)', () => {
    expect(isValidCellRef('K1')).toBe(false);
  });

  test('invalid: A0 (row 0 not allowed)', () => {
    expect(isValidCellRef('A0')).toBe(false);
  });

  test('invalid: A100 (row > 99)', () => {
    expect(isValidCellRef('A100')).toBe(false);
  });

  test('invalid: empty string', () => {
    expect(isValidCellRef('')).toBe(false);
  });

  test('invalid: lowercase', () => {
    expect(isValidCellRef('a1')).toBe(false);
  });

  test('invalid: just letter', () => {
    expect(isValidCellRef('A')).toBe(false);
  });

  test('invalid: just number', () => {
    expect(isValidCellRef('1')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseCellRef Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('parseCellRef', () => {
  test('A1 → {col: 0, row: 0}', () => {
    expect(parseCellRef('A1')).toEqual({ col: 0, row: 0 });
  });

  test('J99 → {col: 9, row: 98}', () => {
    expect(parseCellRef('J99')).toEqual({ col: 9, row: 98 });
  });

  test('B2 → {col: 1, row: 1}', () => {
    expect(parseCellRef('B2')).toEqual({ col: 1, row: 1 });
  });

  test('E50 → {col: 4, row: 49}', () => {
    expect(parseCellRef('E50')).toEqual({ col: 4, row: 49 });
  });

  test('invalid throws with clear message', () => {
    expect(() => parseCellRef('invalid')).toThrow('Invalid cell reference');
    expect(() => parseCellRef('K1')).toThrow('Invalid cell reference');
    // A0 matches pattern but row 0 - 1 = -1 fails row range check
    expect(() => parseCellRef('A0')).toThrow('Invalid row number');
    // A100 has 3 digits, doesn't match \d{1,2} pattern
    expect(() => parseCellRef('A100')).toThrow('Invalid cell reference');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cellToPixels Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('cellToPixels', () => {
  const cellSize = GRID_CONFIG.cellSize; // 200

  test('A1 → {x: 0, y: 0, width: cellSize, height: cellSize}', () => {
    const box = cellToPixels('A1');
    expect(box).toEqual({
      x: 0,
      y: 0,
      width: cellSize,
      height: cellSize,
    });
  });

  test('B2 → offset by cellSize', () => {
    const box = cellToPixels('B2');
    expect(box).toEqual({
      x: cellSize, // col 1 * 200
      y: cellSize, // row 1 * 200
      width: cellSize,
      height: cellSize,
    });
  });

  test('J99 → far corner', () => {
    const box = cellToPixels('J99');
    expect(box).toEqual({
      x: 9 * cellSize, // col 9
      y: 98 * cellSize, // row 98
      width: cellSize,
      height: cellSize,
    });
  });

  test('custom config respected', () => {
    const customConfig: GridConfig = {
      cellSize: 100,
      maxColumns: 10,
      maxRows: 99,
    };
    const box = cellToPixels('B2', customConfig);
    expect(box).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cellRangeToPixels Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('cellRangeToPixels', () => {
  const cellSize = GRID_CONFIG.cellSize;

  test('single cell (no end) → same as cellToPixels', () => {
    const single = cellRangeToPixels('A1');
    const direct = cellToPixels('A1');
    expect(single).toEqual(direct);
  });

  test('range A1:C3 → combined bounding box', () => {
    const box = cellRangeToPixels('A1', 'C3');
    expect(box).toEqual({
      x: 0, // min(A, C) = 0
      y: 0, // min(1, 3) = 0
      width: 3 * cellSize, // C - A + 1 = 3 cells
      height: 3 * cellSize, // 3 - 1 + 1 = 3 cells
    });
  });

  test('reversed range C3:A1 → still correct box', () => {
    const box = cellRangeToPixels('C3', 'A1');
    expect(box).toEqual({
      x: 0,
      y: 0,
      width: 3 * cellSize,
      height: 3 * cellSize,
    });
  });

  test('horizontal range A1:D1', () => {
    const box = cellRangeToPixels('A1', 'D1');
    expect(box).toEqual({
      x: 0,
      y: 0,
      width: 4 * cellSize,
      height: cellSize,
    });
  });

  test('vertical range A1:A5', () => {
    const box = cellRangeToPixels('A1', 'A5');
    expect(box).toEqual({
      x: 0,
      y: 0,
      width: cellSize,
      height: 5 * cellSize,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cellCenter Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('cellCenter', () => {
  const cellSize = GRID_CONFIG.cellSize;
  const halfCell = cellSize / 2;

  test('A1 → center of first cell', () => {
    const center = cellCenter('A1');
    expect(center).toEqual({
      x: halfCell,
      y: halfCell,
    });
  });

  test('B2 → center offset by one cell', () => {
    const center = cellCenter('B2');
    expect(center).toEqual({
      x: cellSize + halfCell,
      y: cellSize + halfCell,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// pixelsToCell Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('pixelsToCell', () => {
  const cellSize = GRID_CONFIG.cellSize;

  test('(0, 0) → A1', () => {
    expect(pixelsToCell(0, 0)).toBe('A1');
  });

  test('(cellSize, cellSize) → B2', () => {
    expect(pixelsToCell(cellSize, cellSize)).toBe('B2');
  });

  test('point inside A1 cell → A1', () => {
    expect(pixelsToCell(50, 50)).toBe('A1');
    expect(pixelsToCell(199, 199)).toBe('A1');
  });

  test('point at cell boundary → next cell', () => {
    expect(pixelsToCell(200, 0)).toBe('B1');
    expect(pixelsToCell(0, 200)).toBe('A2');
  });

  test('out of bounds → clamped to max', () => {
    // Very large x → clamped to J (col 9)
    expect(pixelsToCell(50000, 0)).toBe('J1');
    // Very large y → clamped to row 99
    expect(pixelsToCell(0, 50000)).toBe('A99');
    // Both out of bounds
    expect(pixelsToCell(50000, 50000)).toBe('J99');
  });

  test('negative coords produce invalid cell refs (undefined behavior)', () => {
    // Implementation does NOT clamp negative inputs to 0.
    // Math.floor(-50/200) = -1 → col -1 → charCode(65-1) = '@'
    // This produces invalid cell refs like '@0' which fail isValidCellRef().
    //
    // This is documented undefined behavior - callers must ensure x >= 0, y >= 0.
    // We test the actual output to prevent silent changes to this edge case.
    expect(pixelsToCell(-50, -50)).toBe('@0');
    expect(pixelsToCell(-200, 0)).toBe('@1');
    expect(pixelsToCell(0, -200)).toBe('A0');

    // Verify these are indeed invalid
    expect(isValidCellRef('@0')).toBe(false);
    expect(isValidCellRef('A0')).toBe(false);
  });

  test('round-trip: cellToPixels(pixelsToCell(x,y)) contains original point', () => {
    // Test that converting pixel to cell and back gives a box containing the pixel
    const testPoints = [
      { x: 0, y: 0 },
      { x: 150, y: 350 },
      { x: 400, y: 600 },
      { x: 1800, y: 1200 },
    ];

    for (const point of testPoints) {
      const cell = pixelsToCell(point.x, point.y);
      const box = cellToPixels(cell);

      // Point should be inside or on boundary of box
      const contained =
        point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height;

      expect(contained).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge Cases & Boundary Conditions
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  test('all valid column letters', () => {
    const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    for (const col of columns) {
      expect(isValidCellRef(`${col}1`)).toBe(true);
      expect(() => parseCellRef(`${col}1`)).not.toThrow();
    }
  });

  test('row boundaries', () => {
    expect(isValidCellRef('A1')).toBe(true);
    expect(isValidCellRef('A99')).toBe(true);
    expect(isValidCellRef('A0')).toBe(false);
    expect(isValidCellRef('A100')).toBe(false);
  });
});
