import type { ResolvedScanOptions } from "../resolve.js";

export type ScanAuditCliMetadata = {
  readonly url: string | undefined;
  readonly device: string | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
  readonly providerProfile: string | undefined;
  readonly full: boolean;
  readonly placeholderMedia: boolean;
  readonly output: string | undefined;
};

export type RunScanAuditOptions = {
  readonly resolved: ResolvedScanOptions;
  readonly preset: string | undefined;
  readonly cli: ScanAuditCliMetadata;
};
