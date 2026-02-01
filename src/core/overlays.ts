/**
 * Visual overlays for vex.
 *
 * Provides Sharp-based image manipulation for:
 * - Grid overlays (cell reference system)
 * - Fold line markers (above-the-fold visualization)
 * - Annotation rendering (rectangles, arrows, labels)
 */

import sharp from 'sharp';
import type {
  AddLabelParams,
  BoundingBox,
  DrawArrowParams,
  DrawRectangleParams,
  FoldConfig,
  GridConfig,
  GridMetadata,
  GridRef,
  StyleConfig,
  ToolCall,
} from './types.js';
import { GRID_CONFIG, GRID_STYLE, STYLE_MAP } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Grid Math
// ═══════════════════════════════════════════════════════════════════════════

const CELL_REF_PATTERN = /^([A-J])(\d{1,2})$/;

/**
 * Calculate grid metadata for an image.
 */
export function calculateGrid(width: number, height: number, config: GridConfig = GRID_CONFIG): GridMetadata {
  const { cellSize, maxColumns, maxRows } = config;

  const cols = Math.min(Math.ceil(width / cellSize), maxColumns);
  const rows = Math.min(Math.ceil(height / cellSize), maxRows);

  return {
    cellSize,
    cols,
    rows,
    gridWidth: cols * cellSize,
    gridHeight: rows * cellSize,
  };
}

/**
 * Validate a cell reference string.
 */
export function isValidCellRef(cell: string): boolean {
  const match = cell.match(CELL_REF_PATTERN);
  if (!match || match[2] === undefined) return false;

  const row = Number.parseInt(match[2], 10);
  return row >= 1 && row <= GRID_CONFIG.maxRows;
}

/**
 * Parse a cell reference into column and row indices (0-based).
 */
export function parseCellRef(cell: string): { col: number; row: number } {
  const match = cell.match(CELL_REF_PATTERN);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid cell reference: ${cell}. Expected format: A1-J99`);
  }

  const col = match[1].charCodeAt(0) - 65;
  const row = Number.parseInt(match[2], 10) - 1;

  if (row < 0 || row >= GRID_CONFIG.maxRows) {
    throw new Error(`Invalid row number in cell reference: ${cell}. Expected 1-${GRID_CONFIG.maxRows}`);
  }

  return { col, row };
}

/**
 * Convert a cell reference to pixel bounding box.
 */
export function cellToPixels(cell: GridRef, config: GridConfig = GRID_CONFIG): BoundingBox {
  const { col, row } = parseCellRef(cell);
  const { cellSize } = config;

  return {
    x: col * cellSize,
    y: row * cellSize,
    width: cellSize,
    height: cellSize,
  };
}

/**
 * Convert a cell range to pixel bounding box.
 */
export function cellRangeToPixels(start: GridRef, end?: GridRef, config: GridConfig = GRID_CONFIG): BoundingBox {
  const startBox = cellToPixels(start, config);
  if (!end) return startBox;

  const endBox = cellToPixels(end, config);

  return {
    x: Math.min(startBox.x, endBox.x),
    y: Math.min(startBox.y, endBox.y),
    width: Math.abs(endBox.x - startBox.x) + config.cellSize,
    height: Math.abs(endBox.y - startBox.y) + config.cellSize,
  };
}

/**
 * Get the center point of a cell.
 */
export function cellCenter(cell: GridRef, config: GridConfig = GRID_CONFIG): { x: number; y: number } {
  const box = cellToPixels(cell, config);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

/**
 * Convert pixel coordinates to the nearest cell reference.
 */
export function pixelsToCell(x: number, y: number, config: GridConfig = GRID_CONFIG): GridRef {
  const { cellSize, maxColumns, maxRows } = config;

  const col = Math.min(Math.floor(x / cellSize), maxColumns - 1);
  const row = Math.min(Math.floor(y / cellSize), maxRows - 1);

  const colLetter = String.fromCharCode(65 + col);
  const rowNumber = row + 1;

  return `${colLetter}${rowNumber}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid Overlay
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate SVG grid overlay.
 */
export function generateGridSvg(width: number, height: number, options: { showLabels?: boolean } = {}): string {
  const { showLabels = true } = options;
  const grid = calculateGrid(width, height);
  const style = GRID_STYLE;

  const lines: string[] = [];
  const labels: string[] = [];

  for (let col = 0; col <= grid.cols; col++) {
    const x = col * grid.cellSize;
    if (x <= width) {
      lines.push(
        `<line x1="${x}" y1="0" x2="${x}" y2="${height}" ` +
          `stroke="${style.lineColor}" stroke-opacity="${style.lineOpacity}" ` +
          `stroke-width="${style.lineWidth}"/>`,
      );
    }
  }

  for (let row = 0; row <= grid.rows; row++) {
    const y = row * grid.cellSize;
    if (y <= height) {
      lines.push(
        `<line x1="0" y1="${y}" x2="${width}" y2="${y}" ` +
          `stroke="${style.lineColor}" stroke-opacity="${style.lineOpacity}" ` +
          `stroke-width="${style.lineWidth}"/>`,
      );
    }
  }

  if (showLabels) {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const label = String.fromCharCode(65 + col) + (row + 1);
        const x = col * grid.cellSize + 4;
        const y = row * grid.cellSize + 14;

        labels.push(`<rect x="${x - 2}" y="${y - 11}" width="22" height="13" fill="${style.labelBackground}" rx="2"/>`);
        labels.push(
          `<text x="${x}" y="${y}" font-family="monospace" ` +
            `font-size="${style.labelFontSize}" fill="${style.labelColor}">${label}</text>`,
        );
      }
    }
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g id="grid-lines">${lines.join('\n    ')}</g>
  ${showLabels ? `<g id="grid-labels">${labels.join('\n    ')}</g>` : ''}
</svg>`;
}

/**
 * Add grid overlay to a screenshot image.
 */
export async function addGridOverlay(imageBuffer: Buffer, options: { showLabels?: boolean } = {}): Promise<Buffer> {
  const { showLabels = true } = options;

  const metadata = await sharp(imageBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  if (width === 0 || height === 0) {
    throw new Error('Failed to read image dimensions');
  }

  const svg = generateGridSvg(width, height, { showLabels });

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════
// Fold Lines
// ═══════════════════════════════════════════════════════════════════════════

export interface FoldLineOptions {
  readonly viewportHeight: number;
  readonly lineColor?: string;
  readonly showLabels?: boolean;
  readonly cssViewportHeight?: number;
}

/**
 * Add viewport fold line markers to a screenshot.
 */
export async function addFoldLines(imageBuffer: Buffer, options: FoldLineOptions): Promise<Buffer> {
  const { viewportHeight, lineColor = '#FF0000', showLabels = true, cssViewportHeight } = options;
  const cssHeightForLabel = cssViewportHeight ?? viewportHeight;

  const metadata = await sharp(imageBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  if (height <= viewportHeight) {
    return imageBuffer;
  }

  const folds: number[] = [];
  for (let y = viewportHeight; y < height; y += viewportHeight) {
    folds.push(y);
  }

  const svgLines = folds
    .map((y, i) => {
      const foldNum = i + 1;
      const boxWidth = 130;
      const boxHeight = 18;
      const boxY = y - boxHeight - 2;
      const cssPosition = cssHeightForLabel * foldNum;

      return `
      <!-- Fold ${foldNum} at ${y}px (CSS: ${cssPosition}px) -->
      <line x1="0" y1="${y}" x2="${width}" y2="${y}"
            stroke="${lineColor}" stroke-width="2"
            stroke-dasharray="10,5" stroke-opacity="0.9"/>
      ${
        showLabels
          ? `
        <rect x="4" y="${boxY}" width="${boxWidth}" height="${boxHeight}"
              fill="${lineColor}" opacity="0.85" rx="3"/>
        <text x="10" y="${y - 6}" fill="white"
              font-family="monospace" font-size="11" font-weight="bold">
          ━ Fold ${foldNum} (${cssPosition}px)
        </text>
      `
          : ''
      }
    `;
    })
    .join('\n');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgLines}</svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

/**
 * Add fold lines based on FoldConfig.
 */
export async function addFoldOverlay(imageBuffer: Buffer, viewportHeight: number, config: FoldConfig): Promise<Buffer> {
  if (!config.enabled) {
    return imageBuffer;
  }

  return addFoldLines(imageBuffer, {
    viewportHeight,
    lineColor: config.color,
    showLabels: config.showLabels,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Annotation SVG Generators
// ═══════════════════════════════════════════════════════════════════════════

function dashArrayAttr(style: StyleConfig): string {
  if (!style.strokeDash) return '';
  return ` stroke-dasharray="${style.strokeDash.join(',')}"`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

function renderLabelText(x: number, y: number, text: string, style: StyleConfig, anchor: string): string {
  const escapedText = escapeXml(text);
  const padding = 4;
  const fontSize = 12;
  const textWidth = estimateTextWidth(text, fontSize);
  const textHeight = fontSize + 4;

  let bgX: number;
  switch (anchor) {
    case 'middle':
      bgX = x - textWidth / 2 - padding;
      break;
    case 'end':
      bgX = x - textWidth - padding;
      break;
    default:
      bgX = x - padding;
  }
  const bgY = y - fontSize - padding / 2;
  const bgWidth = textWidth + padding * 2;
  const bgHeight = textHeight + padding;

  return `<rect x="${bgX}" y="${bgY}" width="${bgWidth}" height="${bgHeight}" fill="white" fill-opacity="0.9" rx="3"/>
<text x="${x}" y="${y}" font-family="sans-serif" font-size="${fontSize}" fill="${style.color}" text-anchor="${anchor}" font-weight="500">${escapedText}</text>`;
}

/**
 * Generate SVG for a rectangle annotation.
 */
export function renderRectangleSvg(params: DrawRectangleParams, config: GridConfig = GRID_CONFIG): string {
  const box = cellRangeToPixels(params.start, params.end, config);
  const style = STYLE_MAP[params.style];

  const elements: string[] = [];

  elements.push(
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" ` +
      `fill="none" stroke="${style.color}" stroke-width="${style.strokeWidth}"${dashArrayAttr(style)}/>`,
  );

  if (params.label) {
    const labelX = box.x + box.width / 2;
    const labelY = box.y - 8;
    elements.push(renderLabelText(labelX, labelY, params.label, style, 'middle'));
  }

  return elements.join('\n');
}

/**
 * Generate SVG for an arrow annotation.
 */
export function renderArrowSvg(params: DrawArrowParams, config: GridConfig = GRID_CONFIG): string {
  const from = cellCenter(params.from, config);
  const to = cellCenter(params.to, config);
  const style = STYLE_MAP[params.style];

  const elements: string[] = [];
  const markerId = `arrow-${params.style}-${Math.random().toString(36).slice(2, 8)}`;

  elements.push(
    `<defs>
      <marker id="${markerId}" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="${style.color}"/>
      </marker>
    </defs>`,
  );

  elements.push(
    `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ` +
      `stroke="${style.color}" stroke-width="${style.strokeWidth}"${dashArrayAttr(style)} ` +
      `marker-end="url(#${markerId})"/>`,
  );

  if (params.label) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 12;
    elements.push(renderLabelText(midX, midY, params.label, style, 'middle'));
  }

  return elements.join('\n');
}

/**
 * Generate SVG for a label annotation.
 */
export function renderLabelSvg(params: AddLabelParams, config: GridConfig = GRID_CONFIG): string {
  const box = cellToPixels(params.cell, config);
  const style = STYLE_MAP[params.style];
  const position = params.position ?? 'auto';

  let x: number;
  let y: number;
  let anchor: 'start' | 'middle' | 'end';

  switch (position) {
    case 'top':
      x = box.x + box.width / 2;
      y = box.y - 8;
      anchor = 'middle';
      break;
    case 'bottom':
      x = box.x + box.width / 2;
      y = box.y + box.height + 18;
      anchor = 'middle';
      break;
    case 'left':
      x = box.x - 8;
      y = box.y + box.height / 2;
      anchor = 'end';
      break;
    default:
      // 'right', 'auto', or unrecognized position
      x = box.x + box.width + 8;
      y = box.y + box.height / 2;
      anchor = 'start';
      break;
  }

  const elements: string[] = [];

  elements.push(
    `<circle cx="${box.x + box.width / 2}" cy="${box.y + box.height / 2}" r="4" ` +
      `fill="${style.color}" stroke="white" stroke-width="1"/>`,
  );

  if (position !== 'auto') {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    elements.push(
      `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y - 4}" ` +
        `stroke="${style.color}" stroke-width="1" stroke-dasharray="2,2"/>`,
    );
  }

  elements.push(renderLabelText(x, y, params.text, style, anchor));

  return elements.join('\n');
}

/**
 * Render a single tool call to SVG.
 */
export function renderToolCallSvg(call: ToolCall, config: GridConfig = GRID_CONFIG): string {
  switch (call.tool) {
    case 'draw_rectangle':
      return renderRectangleSvg(call.params, config);
    case 'draw_arrow':
      return renderArrowSvg(call.params, config);
    case 'add_label':
      return renderLabelSvg(call.params, config);
  }
}

/**
 * Generate complete SVG containing all annotations.
 */
export function generateAnnotationSvg(
  toolCalls: readonly ToolCall[],
  width: number,
  height: number,
  config: GridConfig = GRID_CONFIG,
): string {
  const elements = toolCalls.map((call) => renderToolCallSvg(call, config));

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g id="annotations">
    ${elements.join('\n    ')}
  </g>
</svg>`;
}

/**
 * Render annotations onto an image buffer.
 */
export async function renderAnnotations(
  imageBuffer: Buffer,
  toolCalls: readonly ToolCall[],
  config: GridConfig = GRID_CONFIG,
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  if (width === 0 || height === 0) {
    throw new Error('Failed to read image dimensions');
  }

  const svg = generateAnnotationSvg(toolCalls, width, height, config);

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

/**
 * Render annotations onto an image file.
 */
export async function renderAnnotationsToFile(
  imagePath: string,
  toolCalls: readonly ToolCall[],
  outputPath?: string,
  config: GridConfig = GRID_CONFIG,
): Promise<string> {
  const imageBuffer = await sharp(imagePath).toBuffer();
  const annotatedBuffer = await renderAnnotations(imageBuffer, toolCalls, config);

  const output = outputPath ?? imagePath.replace(/(\.[^.]+)$/, '-annotated$1');
  await sharp(annotatedBuffer).toFile(output);

  return output;
}

/**
 * Save annotations as standalone SVG file.
 */
export async function saveAnnotationSvg(
  toolCalls: readonly ToolCall[],
  width: number,
  height: number,
  outputPath: string,
  config: GridConfig = GRID_CONFIG,
): Promise<void> {
  const svg = generateAnnotationSvg(toolCalls, width, height, config);
  const fs = await import('node:fs/promises');
  await fs.writeFile(outputPath, svg, 'utf-8');
}
