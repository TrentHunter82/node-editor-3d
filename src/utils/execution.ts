/**
 * Execution facade — re-exports from executionProcessors.ts and executionOrchestration.ts.
 *
 * This file exists for backward compatibility: all existing imports from '../utils/execution'
 * continue to work without changes. The actual implementations live in:
 * - executionProcessors.ts  (~560 lines) — 93 node processor functions, expression cache, sandboxing
 * - executionOrchestration.ts (~380 lines) — topologicalSort, executeGraph, cache invalidation, profiling
 */

// --- Processors ---
export { processors, getCompiledExpression, setGraphVariablesContext, getGraphVariablesContext } from './executionProcessors';
export { _sandboxedGlobals, _sandboxedValues } from './executionProcessors';
export type { NodeProcessor } from './executionProcessors';

// --- Orchestration ---
export {
  topologicalSort,
  topologicalOrder,
  executeGraph,
  invalidateDownstream,
  getUpstreamPath,
  getDownstreamPath,
  getBottleneckNodes,
  getCacheHitRate,
  getExecutionTimeline,
} from './executionOrchestration';

export type {
  NodeResult,
  ExecutionResult,
  SubgraphContext,
} from './executionOrchestration';
