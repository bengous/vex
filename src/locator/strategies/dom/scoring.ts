import type { CodeLocation, DOMElement } from "../../../core/types.js";
import type { GrepMatch } from "../../types.js";

export function calculateConfidence(
  selector: string,
  matchCount: number,
  element: DOMElement,
): CodeLocation["confidence"] {
  if (selector.startsWith("#") || selector.includes('id="')) {
    return "high";
  }

  if (matchCount === 1 && (selector.startsWith(".") || selector.includes('class="'))) {
    return "high";
  }

  if (selector.startsWith("data-") || selector.includes("[data-")) {
    return matchCount <= 3 ? "high" : "medium";
  }

  if (matchCount > 5) {
    return "low";
  }

  if (selector.includes(".") && element.tagName.length > 0) {
    return "medium";
  }

  return matchCount <= 2 ? "medium" : "low";
}

export function buildReasoning(selector: string, _match: GrepMatch, element: DOMElement): string {
  const parts: string[] = [];

  if (selector.startsWith("#")) {
    parts.push(`Found ID selector "${selector}"`);
  } else if (selector.startsWith(".")) {
    parts.push(`Found class selector "${selector}"`);
  } else if (selector.includes("data-")) {
    parts.push(`Found data attribute "${selector}"`);
  } else {
    parts.push(`Found selector "${selector}"`);
  }

  parts.push(`in ${element.tagName} element`);
  if (element.id !== undefined && element.id.length > 0) {
    parts.push(`with id="${element.id}"`);
  }

  return parts.join(" ");
}

export function sortByConfidence(locations: CodeLocation[]): void {
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  locations.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);
}
