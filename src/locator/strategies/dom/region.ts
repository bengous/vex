import type { BoundingBox, DOMElement, GridRef, Region } from "../../../core/types.js";
import { GRID_CONFIG } from "../../../core/types.js";

function isGridRef(region: Region): region is GridRef {
  return typeof region === "string";
}

function gridRefToCenter(
  gridRef: GridRef,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  const match = gridRef.match(/^([A-Z])(\d{1,2})$/i);
  if (!match?.[1] || !match[2]) {
    return { x: imageWidth / 2, y: imageHeight / 2 };
  }

  const col = match[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number.parseInt(match[2], 10) - 1;

  const cellWidth =
    imageWidth / Math.min(GRID_CONFIG.maxColumns, Math.ceil(imageWidth / GRID_CONFIG.cellSize));
  const cellHeight =
    imageHeight / Math.min(GRID_CONFIG.maxRows, Math.ceil(imageHeight / GRID_CONFIG.cellSize));

  return {
    x: col * cellWidth + cellWidth / 2,
    y: row * cellHeight + cellHeight / 2,
  };
}

export function regionToCenter(
  region: Region,
  imageWidth = 1920,
  imageHeight = 1080,
): { x: number; y: number } {
  if (isGridRef(region)) {
    return gridRefToCenter(region, imageWidth, imageHeight);
  }

  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  };
}

function pointInBox(x: number, y: number, box: BoundingBox): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function boxArea(box: BoundingBox): number {
  return box.width * box.height;
}

/**
 * Find the smallest element containing the given point.
 * Prefers elements with id or class attributes for better selector building.
 */
export function findElementAtPosition(
  elements: readonly DOMElement[],
  x: number,
  y: number,
): DOMElement | null {
  let bestMatch: DOMElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const el of elements) {
    if (!pointInBox(x, y, el.boundingBox)) {
      continue;
    }

    const area = boxArea(el.boundingBox);
    const hasIdentifiers = el.id ?? el.classes.length > 0;

    if (area < bestArea || (area === bestArea && hasIdentifiers && !bestMatch?.id)) {
      bestMatch = el;
      bestArea = area;
    }
  }

  return bestMatch;
}

/**
 * Find all elements containing the given point, sorted by area (smallest first).
 */
export function findAllElementsAtPosition(
  elements: readonly DOMElement[],
  x: number,
  y: number,
): DOMElement[] {
  return elements
    .filter((el) => pointInBox(x, y, el.boundingBox))
    .toSorted((a, b) => boxArea(a.boundingBox) - boxArea(b.boundingBox));
}
