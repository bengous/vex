/**
 * Pipeline state management - session persistence and artifact storage.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Artifact } from '../core/types.js';
import { SESSION_STRUCTURE } from '../core/types.js';
import type { PipelineDefinition, PipelineState } from './types.js';

/**
 * Generate a unique session ID.
 * Format: YYYYMMDD-HHMM-xxxx (where xxxx is random)
 */
export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 16).replace(':', '');
  const random = Math.random().toString(36).slice(2, 6);
  return `${date}-${time}-${random}`;
}

/**
 * Create session directory.
 * Note: Viewport subdirectories are created by operations, not here.
 */
export async function createSessionDir(baseDir: string, sessionId?: string): Promise<string> {
  const id = sessionId ?? generateSessionId();
  const sessionDir = join(baseDir, id);

  await mkdir(sessionDir, { recursive: true });

  return sessionDir;
}

/**
 * Initialize pipeline state.
 */
export function initializePipelineState(definition: PipelineDefinition, sessionDir: string): PipelineState {
  const nodes: PipelineState['nodes'] = {};

  for (const node of definition.nodes) {
    nodes[node.id] = {
      id: node.id,
      status: 'pending',
      outputArtifacts: [],
    };
  }

  return {
    definition,
    sessionDir,
    startedAt: new Date().toISOString(),
    status: 'running',
    nodes,
    artifacts: {},
    data: {},
    issues: [],
  };
}

/**
 * Save pipeline state to disk.
 */
export async function savePipelineState(state: PipelineState): Promise<void> {
  const statePath = join(state.sessionDir, SESSION_STRUCTURE.stateFile);
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Load pipeline state from disk.
 */
export async function loadPipelineState(sessionDir: string): Promise<PipelineState> {
  const statePath = join(sessionDir, SESSION_STRUCTURE.stateFile);
  const content = await readFile(statePath, 'utf-8');
  return JSON.parse(content) as PipelineState;
}

/**
 * Store an artifact in the state.
 */
export function storeArtifact(state: PipelineState, artifact: Artifact): PipelineState {
  return {
    ...state,
    artifacts: {
      ...state.artifacts,
      [artifact.id]: artifact,
    },
  };
}

/**
 * Store non-artifact data in the state.
 */
export function storeData(state: PipelineState, key: string, value: unknown): PipelineState {
  return {
    ...state,
    data: {
      ...state.data,
      [key]: value,
    },
  };
}

/**
 * Update node state.
 */
export function updateNodeState(
  state: PipelineState,
  nodeId: string,
  update: Partial<PipelineState['nodes'][string]>,
): PipelineState {
  const currentNode = state.nodes[nodeId];
  if (!currentNode) return state;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: { ...currentNode, ...update },
    },
  };
}

/**
 * Check if all nodes are complete.
 */
export function isComplete(state: PipelineState): boolean {
  return Object.values(state.nodes).every((node) => node.status === 'completed' || node.status === 'skipped');
}

/**
 * Check if any node has failed.
 */
export function hasFailed(state: PipelineState): boolean {
  return Object.values(state.nodes).some((node) => node.status === 'failed');
}

/**
 * Get nodes that are ready to execute (all dependencies satisfied).
 */
export function getReadyNodes(state: PipelineState): string[] {
  const ready: string[] = [];

  for (const node of state.definition.nodes) {
    const nodeState = state.nodes[node.id];
    if (!nodeState || nodeState.status !== 'pending') continue;

    // Check if all input edges are satisfied
    const inputEdges = state.definition.edges.filter((e) => e.to === node.id);
    const allInputsReady = inputEdges.every((edge) => {
      const sourceNode = state.nodes[edge.from];
      return sourceNode?.status === 'completed';
    });

    if (allInputsReady) {
      ready.push(node.id);
    }
  }

  return ready;
}
