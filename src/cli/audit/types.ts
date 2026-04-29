import type { FoldOcclusionMode, FrameName, FrameStyle } from "../../config/schema.js";
import type { ResolvedScanOptions } from "../resolve.js";

export type ScanAuditCliMetadata = {
  readonly url: string | undefined;
  readonly device: string | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
  readonly providerProfile: string | undefined;
  readonly full: boolean;
  readonly frame: FrameName | undefined;
  readonly frameStyle: FrameStyle | undefined;
  readonly foldOcclusion: FoldOcclusionMode | undefined;
  readonly placeholderMedia: boolean;
  readonly output: string | undefined;
};

export type RunScanAuditOptions = {
  readonly resolved: ResolvedScanOptions;
  readonly preset: string | undefined;
  readonly cli: ScanAuditCliMetadata;
};
