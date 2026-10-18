export type MetricName = 'input' | 'cached' | 'fresh' | 'output' | 'reasoning';
export interface Metric { value: number | null; complete: boolean; validObservations: number; indeterminateObservations: number; incompleteReasons?: Record<string, number> }
export interface Ratio { value: number | null; complete: boolean; available: boolean; denominator: string }
export interface Bucket {
  key: string; observations: number; totals: Record<MetricName, Metric>;
  activity: { usageEvents: number; sessions: number; complete: boolean };
  state: 'missing' | 'zero' | 'incomplete' | 'observed';
}
export interface Stats {
  verification?: { mode: 'snapshot' | 'fresh'; liveSourceAttestation: false; snapshotId: string;
    checkedSources: number; reusedSources: number; unavailableSources: number; conflictingSources: number; retainedConflicts: number;
    oldestVerifiedAt: string | null; newestVerifiedAt: string | null };
  analytics?: Analytics;
  period: { from: string; to: string; timezone: string; label: string };
  totals: Record<MetricName, Metric>; ratios: { cachedPercent: Ratio; freshPercent: Ratio };
  activity: { usageEvents: number; sessions: number; complete: boolean };
  sessions: { sessionId: string; displayName: string; input: Metric; inputShare: Ratio }[];
  coverage: { observations: number; invalidTimestampObservations: number; allowanceOnlyObservations?: number; unknownProvenanceObservations?: number };
  bucketUnit: 'hour' | 'day'; buckets: Bucket[];
}
export interface Session {
  id: string; name: string; project: string; model: string | null; updatedAt: string | null;
  archived: boolean; recorded: boolean; hasLocalTelemetry: boolean;
  isAutoReview?: boolean; reviewClassification?: string | null;
}
export interface SessionDetail {
  session: Session;
  telemetry: null | {
    modelName: string; reasoningEffort: string | null; usageAt: string | null;
    lastRequest: null | { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; reasoningOutputTokens: number | null };
    totals: null | { inputTokens: number | null; outputTokens: number | null };
    context: { usedPercent: number | null; inputTokens: number | null; windowTokens: number | null; basis: string };
    diagnostics: { parseFailures: number; pendingTail: boolean; error: string | null };
  };
  recent: { event_seq: number; event_timestamp: string | null; model: string | null; reasoning_effort: string | null; input_tokens: number | null; output_tokens: number | null; context_window_tokens: number | null }[];
}
export interface RecorderStatus {
  running: boolean; busy: boolean; lastSync: string | null; lastError: string | null; exists: boolean;
  events: number; sources: number; dbPath: string; latestSourceUpdate: string | null; ownership: string;
  summary: CollectionSummary | null;
}
export interface CollectionSummary {
  inserted_events?: number; rebuilt_sources?: number; partial_sources: number; errors: {code:string}[];
  discovered_files?: number; scanned_sources?: number; skipped_sources?: number; skipped_files?: number; failed_sources?: number;
  inherited_history_sources?: number; skips?: {code:string}[]; error_types?: {code:string;count:number}[]; skip_types?: {code:string;count:number}[];
  outcome?: 'complete' | 'partial' | 'failed'; failed_source_history_preserved?: boolean;
}
export interface SourceDiagnostics extends CollectionSummary {readOnly:true;checkedAt:string;pending_events:number;changed_sources:number;events:number;sources:number}

export type Workload = 'input' | 'output' | 'combined';
export interface AnalyticsGroup {
  model: string | null; effort: string | null; observations: number; totals: Record<MetricName, Metric>;
  usageEvents: number; distinctSessions: number; activityComplete: boolean; sessionIds: string[];
  observedTurns: { value: number; complete: boolean; unknownIdentityEvents: number };
  cacheRatio: Ratio; shares: Record<Workload, Ratio>; buckets?: Bucket[];
}
export interface Analytics {
  coverage?: {knownModelMetadata:number;knownEffortMetadata:number;validPrimaryDeltas:number};
  filters: {model?: string | null; effort?: string | null}; modelOptions: (string | null)[]; effortOptions: (string | null)[];
  totals: Record<MetricName, Metric>; observations: number; models: AnalyticsGroup[]; efforts: AnalyticsGroup[]; cross: AnalyticsGroup[];
}
