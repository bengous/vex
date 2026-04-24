import type { DOMElement } from "../../../core/types.js";
import type { ElementMatch } from "../../types.js";

/**
 * Build searchable CSS selectors from an element.
 * Returns selectors in order of specificity (most specific first).
 */
export function buildSelectors(element: DOMElement): string[] {
  const selectors: string[] = [];

  if (element.id) {
    selectors.push(`#${element.id}`);
    selectors.push(`id="${element.id}"`);
  }

  for (const cls of element.classes) {
    if (cls.length > 2 && !cls.startsWith("js-") && !/^\d/.test(cls)) {
      selectors.push(`.${cls}`);
      selectors.push(`class="${cls}"`);
      selectors.push(`class="${cls} `);
      selectors.push(` ${cls}"`);
      selectors.push(` ${cls} `);
    }
  }

  if (element.classes.length > 0) {
    const mainClass = element.classes.find((c) => c.length > 3 && !c.startsWith("js-"));
    if (mainClass) {
      selectors.push(`${element.tagName}.${mainClass}`);
    }
  }

  for (const [attr, value] of Object.entries(element.attributes)) {
    if (attr.startsWith("data-") && value && value.length < 50) {
      selectors.push(`${attr}="${value}"`);
      selectors.push(`[${attr}="${value}"]`);
    }
  }

  const semanticTags = ["section", "header", "footer", "main", "nav", "aside", "article"];
  if (semanticTags.includes(element.tagName) && element.classes.length > 0) {
    selectors.push(`<${element.tagName} class=`);
  }

  return selectors;
}

function getElementConfidence(hasId: boolean, hasUniqueClass: boolean): ElementMatch["confidence"] {
  if (hasId) {
    return "high";
  }
  if (hasUniqueClass) {
    return "medium";
  }
  return "low";
}

export function createElementMatch(
  element: DOMElement,
  selectors: readonly string[],
): ElementMatch {
  const hasId = !!element.id;
  const hasUniqueClass = element.classes.some((c) => c.length > 5);

  return {
    element: {
      tagName: element.tagName,
      id: element.id,
      classes: element.classes,
      boundingBox: element.boundingBox,
    },
    selectors,
    confidence: getElementConfidence(hasId, hasUniqueClass),
  };
}
