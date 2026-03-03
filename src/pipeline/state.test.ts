/**
 * Unit tests for pipeline state merge logic.
 */

import { describe, expect, test } from 'bun:test';
import type { Artifact, Issue } from '../core/types.js';
import { mergeNodeResults } from './state.js';
import type { PipelineDefinition, PipelineState } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function createTestDefinition(): PipelineDefinition {
	return {
		name: 'test',
		description: 'Test pipeline',
		nodes: [
			{ id: 'a', operation: 'capture', config: {}, inputs: [], outputs: [] },
			{ id: 'b', operation: 'capture', config: {}, inputs: [], outputs: [] },
		],
		edges: [],
		inputs: [],
		outputs: [],
	};
}

function createBaseState(overrides: Partial<PipelineState> = {}): PipelineState {
	return {
		definition: createTestDefinition(),
		sessionDir: '/tmp/test-session',
		startedAt: new Date().toISOString(),
		status: 'running',
		nodes: {
			a: { id: 'a', status: 'pending', outputArtifacts: [] },
			b: { id: 'b', status: 'pending', outputArtifacts: [] },
		},
		artifacts: {},
		data: {},
		issues: [],
		semanticNames: {},
		...overrides,
	};
}

function createImageArtifact(id: string): Artifact {
	return {
		_kind: 'artifact',
		id,
		type: 'image',
		path: `/tmp/${id}.png`,
		createdAt: new Date().toISOString(),
		createdBy: 'test',
		metadata: { width: 1920, height: 1080 },
	};
}

function createIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		id: 1,
		description: 'Test issue',
		severity: 'medium',
		region: 'hero section',
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// mergeNodeResults
// ═══════════════════════════════════════════════════════════════════════════

describe('mergeNodeResults', () => {
	test('merges two node results with disjoint artifacts', () => {
		const base = createBaseState();
		const artA = createImageArtifact('art-a');
		const artB = createImageArtifact('art-b');

		const resultA: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [artA],
			state: {
				...base,
				nodes: { ...base.nodes, a: { id: 'a', status: 'completed', outputArtifacts: ['art-a'] } },
				artifacts: { [artA.id]: artA },
				semanticNames: { 'a:image': artA.id },
				data: { 'a:meta': { width: 1920 } },
			},
		};

		const resultB: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [artB],
			state: {
				...base,
				nodes: { ...base.nodes, b: { id: 'b', status: 'completed', outputArtifacts: ['art-b'] } },
				artifacts: { [artB.id]: artB },
				semanticNames: { 'b:image': artB.id },
				data: { 'b:meta': { width: 375 } },
			},
		};

		const merged = mergeNodeResults(base, [resultA, resultB]);

		expect(merged.nodes.a?.status).toBe('completed');
		expect(merged.nodes.b?.status).toBe('completed');

		expect(merged.artifacts['art-a']).toBeDefined();
		expect(merged.artifacts['art-b']).toBeDefined();

		expect(merged.semanticNames['a:image']).toBe('art-a');
		expect(merged.semanticNames['b:image']).toBe('art-b');

		expect(merged.data['a:meta']).toEqual({ width: 1920 });
		expect(merged.data['b:meta']).toEqual({ width: 375 });
	});

	test('single result returns that result state directly', () => {
		const base = createBaseState();
		const artA = createImageArtifact('art-a');

		const result: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [artA],
			state: {
				...base,
				nodes: { ...base.nodes, a: { id: 'a', status: 'completed', outputArtifacts: ['art-a'] } },
				artifacts: { [artA.id]: artA },
				semanticNames: { 'a:image': artA.id },
				data: {},
			},
		};

		const merged = mergeNodeResults(base, [result]);
		expect(merged).toEqual(result.state);
	});

	test('preserves base state fields not modified by nodes', () => {
		const base = createBaseState({
			status: 'running',
			startedAt: '2026-01-01T00:00:00Z',
		});

		const result: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [],
			state: {
				...base,
				nodes: { ...base.nodes, a: { id: 'a', status: 'completed', outputArtifacts: [] } },
			},
		};

		const merged = mergeNodeResults(base, [result]);
		expect(merged.status).toBe('running');
		expect(merged.startedAt).toBe('2026-01-01T00:00:00Z');
		expect(merged.sessionDir).toBe('/tmp/test-session');
	});

	test('merges issues from analyze nodes', () => {
		const base = createBaseState();
		const issues: Issue[] = [createIssue()];

		const resultA: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [],
			state: {
				...base,
				issues,
				nodes: { ...base.nodes, a: { id: 'a', status: 'completed', outputArtifacts: [] } },
			},
		};

		const resultB: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [],
			state: {
				...base,
				nodes: { ...base.nodes, b: { id: 'b', status: 'completed', outputArtifacts: [] } },
			},
		};

		const merged = mergeNodeResults(base, [resultA, resultB]);
		expect(merged.issues).toEqual(issues);
	});

	test('concatenates issues from multiple results', () => {
		const base = createBaseState();
		const issueA = createIssue({ id: 1, description: 'Issue from A' });
		const issueB = createIssue({ id: 2, description: 'Issue from B' });

		const resultA: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [],
			state: {
				...base,
				issues: [issueA],
				nodes: { ...base.nodes, a: { id: 'a', status: 'completed', outputArtifacts: [] } },
			},
		};

		const resultB: { artifacts: Artifact[]; state: PipelineState } = {
			artifacts: [],
			state: {
				...base,
				issues: [issueB],
				nodes: { ...base.nodes, b: { id: 'b', status: 'completed', outputArtifacts: [] } },
			},
		};

		const merged = mergeNodeResults(base, [resultA, resultB]);
		expect(merged.issues).toHaveLength(2);
		expect(merged.issues).toContainEqual(issueA);
		expect(merged.issues).toContainEqual(issueB);
	});
});
