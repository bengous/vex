/**
 * vex - Visual Explorer
 *
 * Unified visual analysis tool for web layouts with iterative feedback loops.
 *
 * Architecture:
 * - Layer 0 (core): Pure functions - capture, overlays, analysis, types
 * - Layer 1 (pipeline): Composable operations with typed artifacts
 * - Layer 2 (locator): Map visual issues to code locations
 * - Layer 3 (loop): Feedback loop orchestration
 *
 * @module vex
 */

// Core library (Layer 0)
export * from './core/index.js';
// Code locator (Layer 2)
export * from './locator/index.js';
// Feedback loop (Layer 3)
export * from './loop/index.js';
// Pipeline runtime (Layer 1)
export * from './pipeline/index.js';

// VLM providers
export * from './providers/index.js';
