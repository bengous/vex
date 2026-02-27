import { describe, expect, it } from 'bun:test';
import { captureOnly } from './presets.js';

const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false };

describe('captureOnly preset', () => {
  it('includes folds and grid by default', () => {
    const pipeline = captureOnly('https://example.com', viewport);
    expect(pipeline.outputs).toEqual(['image-with-grid']);
    expect(pipeline.nodes.map((node) => node.id)).toEqual(['capture', 'folds', 'grid']);
    expect(pipeline.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['capture->folds', 'folds->grid']);
  });

  it('supports folds only', () => {
    const pipeline = captureOnly('https://example.com', viewport, true, false);
    expect(pipeline.outputs).toEqual(['image-with-folds']);
    expect(pipeline.nodes.map((node) => node.id)).toEqual(['capture', 'folds']);
  });

  it('supports grid only', () => {
    const pipeline = captureOnly('https://example.com', viewport, false, true);
    expect(pipeline.outputs).toEqual(['image-with-grid']);
    expect(pipeline.nodes.map((node) => node.id)).toEqual(['capture', 'grid']);
  });

  it('supports raw capture with no overlays', () => {
    const pipeline = captureOnly('https://example.com', viewport, false, false);
    expect(pipeline.outputs).toEqual(['image']);
    expect(pipeline.nodes.map((node) => node.id)).toEqual(['capture']);
  });
});
