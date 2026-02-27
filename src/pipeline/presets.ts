/**
 * Pipeline presets - common pipeline configurations.
 */

import type { FullPageScrollFixOptions, PlaceholderMediaOptions } from '../core/capture.js';
import type { ViewportConfig } from '../core/types.js';
import type { PipelineDefinition } from './types.js';

/**
 * Simple analysis pipeline: capture → folds → grid → analyze
 */
export function simpleAnalysis(
  url: string,
  viewport: ViewportConfig,
  provider: string,
  model?: string,
  reasoning?: string,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineDefinition {
  return {
    name: 'simple-analysis',
    description: 'Capture screenshot and analyze for issues',
    inputs: ['url', 'viewport', 'provider'],
    outputs: ['analysis'],
    nodes: [
      {
        id: 'capture',
        operation: 'capture',
        config: { url, viewport, filename: 'screenshot.png', withDOM: true, placeholderMedia, fullPageScrollFix },
        inputs: [],
        outputs: ['image'],
      },
      {
        id: 'folds',
        operation: 'overlay-folds',
        config: { viewportHeight: viewport.height },
        inputs: ['image'],
        outputs: ['image-with-folds'],
      },
      {
        id: 'grid',
        operation: 'overlay-grid',
        config: { showLabels: true },
        inputs: ['image-with-folds'],
        outputs: ['image-with-grid'],
      },
      {
        id: 'analyze',
        operation: 'analyze',
        config: { provider, model, reasoning },
        inputs: ['image-with-grid'],
        outputs: ['analysis'],
      },
    ],
    edges: [
      { from: 'capture', to: 'folds', artifact: 'image' },
      { from: 'folds', to: 'grid', artifact: 'image' },
      { from: 'grid', to: 'analyze', artifact: 'image' },
    ],
  };
}

/**
 * Full annotation pipeline: capture → folds → grid → analyze → annotate → render
 */
export function fullAnnotation(
  url: string,
  viewport: ViewportConfig,
  provider: string,
  model?: string,
  reasoning?: string,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineDefinition {
  return {
    name: 'full-annotation',
    description: 'Capture, analyze, and render annotated screenshot',
    inputs: ['url', 'viewport', 'provider'],
    outputs: ['annotated-image'],
    nodes: [
      {
        id: 'capture',
        operation: 'capture',
        config: { url, viewport, filename: 'screenshot.png', withDOM: true, placeholderMedia, fullPageScrollFix },
        inputs: [],
        outputs: ['image'],
      },
      {
        id: 'folds',
        operation: 'overlay-folds',
        config: { viewportHeight: viewport.height },
        inputs: ['image'],
        outputs: ['image-with-folds'],
      },
      {
        id: 'grid',
        operation: 'overlay-grid',
        config: { showLabels: true },
        inputs: ['image-with-folds'],
        outputs: ['image-with-grid'],
      },
      {
        id: 'analyze',
        operation: 'analyze',
        config: { provider, model, reasoning },
        inputs: ['image-with-grid'],
        outputs: ['analysis'],
      },
      {
        id: 'annotate',
        operation: 'annotate',
        config: { provider },
        inputs: ['analysis'],
        outputs: ['toolCalls'],
      },
      {
        id: 'render',
        operation: 'render',
        config: {},
        inputs: ['image-with-grid', 'toolCalls'],
        outputs: ['annotated-image'],
      },
    ],
    edges: [
      { from: 'capture', to: 'folds', artifact: 'image' },
      { from: 'folds', to: 'grid', artifact: 'image' },
      { from: 'grid', to: 'analyze', artifact: 'image' },
      { from: 'analyze', to: 'annotate', artifact: 'result' },
      { from: 'grid', to: 'render', artifact: 'image' },
      { from: 'annotate', to: 'render', artifact: 'toolCalls' },
    ],
  };
}

/**
 * Responsive comparison pipeline: capture(desktop) + capture(mobile) → diff
 */
export function responsiveComparison(
  url: string,
  desktopViewport: ViewportConfig,
  mobileViewport: ViewportConfig,
): PipelineDefinition {
  return {
    name: 'responsive-comparison',
    description: 'Compare desktop and mobile screenshots',
    inputs: ['url', 'desktopViewport', 'mobileViewport'],
    outputs: ['diff-report'],
    nodes: [
      {
        id: 'capture-desktop',
        operation: 'capture',
        config: { url, viewport: desktopViewport, filename: 'desktop.png' },
        inputs: [],
        outputs: ['desktop-image'],
      },
      {
        id: 'capture-mobile',
        operation: 'capture',
        config: { url, viewport: mobileViewport, filename: 'mobile.png' },
        inputs: [],
        outputs: ['mobile-image'],
      },
      {
        id: 'diff',
        operation: 'diff',
        config: { threshold: 5 },
        inputs: ['desktop-image', 'mobile-image'],
        outputs: ['diff-report'],
      },
    ],
    edges: [
      { from: 'capture-desktop', to: 'diff', artifact: 'image', targetField: 'baseImage' },
      { from: 'capture-mobile', to: 'diff', artifact: 'image', targetField: 'compareImage' },
    ],
  };
}

/**
 * Capture only pipeline - just take screenshots.
 */
export function captureOnly(
  url: string,
  viewport: ViewportConfig,
  withFolds = true,
  withGrid = true,
  placeholderMedia?: PlaceholderMediaOptions,
  fullPageScrollFix?: FullPageScrollFixOptions,
): PipelineDefinition {
  if (withFolds && withGrid) {
    return {
      name: 'capture-only',
      description: 'Capture screenshot with fold lines and grid',
      inputs: ['url', 'viewport'],
      outputs: ['image-with-grid'],
      nodes: [
        {
          id: 'capture',
          operation: 'capture',
          config: { url, viewport, filename: 'screenshot.png', placeholderMedia, fullPageScrollFix },
          inputs: [],
          outputs: ['image'],
        },
        {
          id: 'folds',
          operation: 'overlay-folds',
          config: { viewportHeight: viewport.height },
          inputs: ['image'],
          outputs: ['image-with-folds'],
        },
        {
          id: 'grid',
          operation: 'overlay-grid',
          config: { showLabels: true },
          inputs: ['image-with-folds'],
          outputs: ['image-with-grid'],
        },
      ],
      edges: [
        { from: 'capture', to: 'folds', artifact: 'image' },
        { from: 'folds', to: 'grid', artifact: 'image' },
      ],
    };
  }

  if (withFolds) {
    return {
      name: 'capture-only',
      description: 'Capture screenshot with fold lines',
      inputs: ['url', 'viewport'],
      outputs: ['image-with-folds'],
      nodes: [
        {
          id: 'capture',
          operation: 'capture',
          config: { url, viewport, filename: 'screenshot.png', placeholderMedia, fullPageScrollFix },
          inputs: [],
          outputs: ['image'],
        },
        {
          id: 'folds',
          operation: 'overlay-folds',
          config: { viewportHeight: viewport.height },
          inputs: ['image'],
          outputs: ['image-with-folds'],
        },
      ],
      edges: [{ from: 'capture', to: 'folds', artifact: 'image' }],
    };
  }

  if (withGrid) {
    return {
      name: 'capture-only',
      description: 'Capture screenshot with grid',
      inputs: ['url', 'viewport'],
      outputs: ['image-with-grid'],
      nodes: [
        {
          id: 'capture',
          operation: 'capture',
          config: { url, viewport, filename: 'screenshot.png', placeholderMedia, fullPageScrollFix },
          inputs: [],
          outputs: ['image'],
        },
        {
          id: 'grid',
          operation: 'overlay-grid',
          config: { showLabels: true },
          inputs: ['image'],
          outputs: ['image-with-grid'],
        },
      ],
      edges: [{ from: 'capture', to: 'grid', artifact: 'image' }],
    };
  }

  return {
    name: 'capture-only',
    description: 'Capture screenshot without fold lines',
    inputs: ['url', 'viewport'],
    outputs: ['image'],
    nodes: [
      {
        id: 'capture',
        operation: 'capture',
        config: { url, viewport, filename: 'screenshot.png', placeholderMedia, fullPageScrollFix },
        inputs: [],
        outputs: ['image'],
      },
    ],
    edges: [],
  };
}
