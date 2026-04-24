import { describe, expect, it } from 'bun:test';
import { captureOnly, fullAnnotation, responsiveComparison, simpleAnalysis } from './presets.js';
import type { PipelineDefinition } from './types.js';

const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false };
const mobileViewport = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true };

function nodeIds(pipeline: PipelineDefinition): string[] {
  return pipeline.nodes.map((node) => node.id);
}

function nodeOutputs(pipeline: PipelineDefinition): string[][] {
  return pipeline.nodes.map((node) => [...node.outputs]);
}

function edgeRefs(pipeline: PipelineDefinition): string[] {
  return pipeline.edges.map((edge) =>
    edge.targetField
      ? `${edge.from}->${edge.to}:${edge.artifact}:${edge.targetField}`
      : `${edge.from}->${edge.to}:${edge.artifact}`,
  );
}

function captureConfig(pipeline: PipelineDefinition, nodeId = 'capture'): Record<string, unknown> {
  const node = pipeline.nodes.find((candidate) => candidate.id === nodeId);
  expect(node).toBeDefined();
  return node?.config ?? {};
}

describe('simpleAnalysis preset', () => {
  it('preserves graph shape and enables DOM capture', () => {
    const pipeline = simpleAnalysis('https://example.com', viewport, 'codex-cli', 'gpt-5.4', 'low');

    expect(pipeline.name).toBe('simple-analysis');
    expect(pipeline.outputs).toEqual(['analysis']);
    expect(nodeIds(pipeline)).toEqual(['capture', 'folds', 'grid', 'analyze']);
    expect(nodeOutputs(pipeline)).toEqual([['image'], ['image-with-folds'], ['image-with-grid'], ['analysis']]);
    expect(edgeRefs(pipeline)).toEqual(['capture->folds:image', 'folds->grid:image', 'grid->analyze:image']);
    expect(captureConfig(pipeline).withDOM).toBe(true);
  });
});

describe('fullAnnotation preset', () => {
  it('preserves graph shape and enables DOM capture', () => {
    const pipeline = fullAnnotation('https://example.com', viewport, 'codex-cli', 'gpt-5.4', 'low');

    expect(pipeline.name).toBe('full-annotation');
    expect(pipeline.outputs).toEqual(['annotated-image']);
    expect(nodeIds(pipeline)).toEqual(['capture', 'folds', 'grid', 'analyze', 'annotate', 'render']);
    expect(nodeOutputs(pipeline)).toEqual([
      ['image'],
      ['image-with-folds'],
      ['image-with-grid'],
      ['analysis'],
      ['toolCalls'],
      ['annotated-image'],
    ]);
    expect(edgeRefs(pipeline)).toEqual([
      'capture->folds:image',
      'folds->grid:image',
      'grid->analyze:image',
      'analyze->annotate:result',
      'grid->render:image',
      'annotate->render:toolCalls',
    ]);
    expect(captureConfig(pipeline).withDOM).toBe(true);
  });
});

describe('responsiveComparison preset', () => {
  it('preserves graph shape and leaves DOM capture disabled', () => {
    const pipeline = responsiveComparison('https://example.com', viewport, mobileViewport);

    expect(pipeline.name).toBe('responsive-comparison');
    expect(pipeline.outputs).toEqual(['diff-report']);
    expect(nodeIds(pipeline)).toEqual(['capture-desktop', 'capture-mobile', 'diff']);
    expect(nodeOutputs(pipeline)).toEqual([['desktop-image'], ['mobile-image'], ['diff-report']]);
    expect(edgeRefs(pipeline)).toEqual([
      'capture-desktop->diff:image:baseImage',
      'capture-mobile->diff:image:compareImage',
    ]);
    expect(captureConfig(pipeline, 'capture-desktop').withDOM).toBeUndefined();
    expect(captureConfig(pipeline, 'capture-mobile').withDOM).toBeUndefined();
  });
});

describe('captureOnly preset', () => {
  it('includes folds and grid by default without DOM capture', () => {
    const pipeline = captureOnly('https://example.com', viewport);

    expect(pipeline.outputs).toEqual(['image-with-grid']);
    expect(nodeIds(pipeline)).toEqual(['capture', 'folds', 'grid']);
    expect(nodeOutputs(pipeline)).toEqual([['image'], ['image-with-folds'], ['image-with-grid']]);
    expect(edgeRefs(pipeline)).toEqual(['capture->folds:image', 'folds->grid:image']);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  it('supports folds only', () => {
    const pipeline = captureOnly('https://example.com', viewport, true, false);
    expect(pipeline.outputs).toEqual(['image-with-folds']);
    expect(nodeIds(pipeline)).toEqual(['capture', 'folds']);
    expect(edgeRefs(pipeline)).toEqual(['capture->folds:image']);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  it('supports grid only', () => {
    const pipeline = captureOnly('https://example.com', viewport, false, true);
    expect(pipeline.outputs).toEqual(['image-with-grid']);
    expect(nodeIds(pipeline)).toEqual(['capture', 'grid']);
    expect(edgeRefs(pipeline)).toEqual(['capture->grid:image']);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });

  it('supports raw capture with no overlays', () => {
    const pipeline = captureOnly('https://example.com', viewport, false, false);
    expect(pipeline.outputs).toEqual(['image']);
    expect(nodeIds(pipeline)).toEqual(['capture']);
    expect(edgeRefs(pipeline)).toEqual([]);
    expect(captureConfig(pipeline).withDOM).toBeUndefined();
  });
});
