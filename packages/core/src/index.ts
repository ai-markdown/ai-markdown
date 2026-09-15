/** Framework-independent adapter contracts. Public contracts follow semantic versioning from 3.0.0. */
export {
  buildBlocks,
  computeBlockFingerprint,
  computeHtmlBlockDigest,
  computeHtmlBlockDigestWithExtent,
  hasMdastSource,
  isFootnoteSection,
} from './blockPlan';
export type { BlockInfo, RenderItem, BuildBlocksOptions, BuildBlocksResult } from './blockPlan';
export type { BlockPlanner } from './blockPlanner';
export { createBlockPlanner } from './blockPlanner';
export { createContributionSession } from './contribution';
export type { ContributionOptions, ContributionRegistry, ContributionSession } from './contribution';
export { createSmoothCoordinator } from './coordinator';
export { evaluateGateWarn } from './smoothCoordinator';
export type { SmoothCoordinator, GateWarnVerdict } from './smoothCoordinator';
export { deriveTailSignal } from './tailSignal';
export type { TailSignal } from './tailSignal';
export { buildAggregateTree } from './aggregateFootnotes';
export { cloneHastForRender } from './cloneHastForRender';
export { createPipelineSession } from './pipelineSession';
export type { PipelineFrameOptions, PipelineSession, PipelineTrees } from './pipelineSession';
export { derivePhantomTargets, deriveCoordinationPolicy, buildContributionChain } from './coordinationPreparation';
export type {
  DefinitionLabels,
  PhantomTargets,
  CoordinationPolicy,
  ContributionPolicyInputs,
} from './coordinationPreparation';
