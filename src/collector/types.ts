export type CollectorCabin = "economy" | "premium" | "business" | "first";

export interface CollectorRoute {
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  cabins?: CollectorCabin[];
  passengers?: number;
  programs?: string[];
}

export interface CollectorConfig {
  adapters: string[];
  routes: CollectorRoute[];
  headless: boolean;
  intervalMinutes: number;
  profileDir: string;
  outputPath: string;
  debugDir?: string;
  navigationTimeoutMs: number;
  actionDelayMs: number;
  maxCapturedJsonResponses: number;
}

export interface CollectedAward {
  id: string;
  source: string;
  source_updated_at?: string;
  program?: string;
  airline?: string;
  operating_airline?: string;
  flight_numbers?: string;
  origin: string;
  destination: string;
  date: string;
  cabin?: CollectorCabin | string;
  miles?: number;
  taxes?: {
    amount: number;
    currency: string;
  };
  seats?: number;
  aircraft?: string;
  fare_class?: string;
  departure?: string;
  arrival?: string;
  duration_minutes?: number;
  stops?: number;
  booking_url?: string;
  raw?: unknown;
  warnings?: string[];
}

export interface CollectorRunResult {
  adapterId: string;
  route: CollectorRoute;
  results: CollectedAward[];
  warnings: string[];
  debugArtifacts?: string[];
}

export interface CollectorFeed {
  updatedAt: string;
  source: string;
  notice: string;
  diagnostics: Array<{
    adapterId: string;
    route: string;
    resultCount: number;
    warnings: string[];
    debugArtifacts?: string[];
  }>;
  results: CollectedAward[];
}
