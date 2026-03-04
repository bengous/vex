/**
 * Shared test fixture factories for vex.
 *
 * Canonical factories for core domain types used across test files.
 * Each factory accepts a Partial<T> spread override for per-test customization.
 */

import type { CodeLocation, Issue } from '../core/types.js';
import type { PipelineDefinition, PipelineState } from '../pipeline/types.js';

export function createIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		id: 1,
		description: 'Test issue',
		severity: 'medium',
		region: 'A1',
		...overrides,
	};
}

export function createCodeLocation(
	overrides: Partial<CodeLocation> = {},
): CodeLocation {
	return {
		file: 'test.liquid',
		confidence: 'high',
		reasoning: 'Test location',
		strategy: 'test',
		...overrides,
	};
}

export function createPipelineDefinition(
	overrides: Partial<PipelineDefinition> = {},
): PipelineDefinition {
	return {
		name: 'test-pipeline',
		description: 'Test pipeline',
		nodes: [],
		edges: [],
		inputs: [],
		outputs: [],
		...overrides,
	};
}

export function createPipelineState(
	overrides: Partial<PipelineState> = {},
): PipelineState {
	return {
		definition: createPipelineDefinition(),
		sessionDir: '/tmp/test-session',
		startedAt: new Date().toISOString(),
		status: 'completed',
		nodes: {},
		artifacts: {},
		data: {},
		issues: [],
		semanticNames: {},
		...overrides,
	};
}
