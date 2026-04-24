import type { ViewportConfig } from "../core/types.js";
import type { PipelineDefinition } from "../pipeline/types.js";
import type {
  ResolvedFullPageScrollFix,
  ResolvedPlaceholderMedia,
  ResolvedScanMode,
} from "./resolve.js";
import { captureOnly, fullAnnotation, simpleAnalysis } from "../pipeline/presets.js";

export type BuildScanPipelineSpec = {
  readonly url: string;
  readonly viewport: ViewportConfig;
  readonly mode: ResolvedScanMode;
  readonly full: boolean;
  readonly provider: string;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
  readonly placeholderMedia: ResolvedPlaceholderMedia | undefined;
  readonly fullPageScrollFix: ResolvedFullPageScrollFix | undefined;
};

export function buildScanPipeline(spec: BuildScanPipelineSpec): PipelineDefinition {
  if (spec.mode === "capture-only") {
    return captureOnly(
      spec.url,
      spec.viewport,
      true,
      true,
      spec.placeholderMedia,
      spec.fullPageScrollFix,
    );
  }

  if (spec.full) {
    return fullAnnotation(
      spec.url,
      spec.viewport,
      spec.provider,
      spec.model,
      spec.reasoning,
      spec.placeholderMedia,
      spec.fullPageScrollFix,
    );
  }

  return simpleAnalysis(
    spec.url,
    spec.viewport,
    spec.provider,
    spec.model,
    spec.reasoning,
    spec.placeholderMedia,
    spec.fullPageScrollFix,
  );
}
