import type {
  AwardExploreInput,
  AwardResult,
  AwardSearchInput,
  AwardVerifyInput,
  SourceKind,
  SourceStatus
} from "../domain/types.js";

export interface AdapterSearchResponse {
  results: AwardResult[];
  warnings: string[];
}

export interface AwardSourceAdapter {
  id: string;
  name: string;
  kind: SourceKind;
  supportsBatch: boolean;
  supportsExplore: boolean;
  rateLimitMs?: number;

  status(): SourceStatus;
  search(input: AwardSearchInput): Promise<AdapterSearchResponse>;
  explore?(input: AwardExploreInput): Promise<AdapterSearchResponse>;
  verify?(input: AwardVerifyInput): Promise<AdapterSearchResponse>;
}
