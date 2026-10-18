import type { Bucket, MetricName } from '../../lib/gui/contracts';
export function niceAxis(maximum: number, expanded?: boolean): {maximum: number; step: number; ticks: number[]; minor: number[]};
export function gapGuides(buckets: Bucket[], metric: MetricName): [{x: string; y: number}, {x: string; y: number}][];
