export interface Bootstrap { token: string; timezone: string; version: string; apiVersion?: number; capabilities?: {modelAnalytics?: boolean; recorderDiagnostics?: boolean; sessionClassification?: boolean} }
export interface Range { range: string; hours?: string; from?: string; to?: string; timezone: string }
export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}
let connection: Promise<Bootstrap> | null = null;
export function bootstrap(): Promise<Bootstrap> {
  connection ||= fetch('/api/bootstrap').then(async r => {
    if (!r.ok) throw new Error('Could not connect to the local server.');
    return r.json() as Promise<Bootstrap>;
  }).catch(e => { connection = null; throw e; });
  return connection;
}
export async function request<T>(url: string, method = 'GET'): Promise<T> {
  const boot = await bootstrap();
  const response = await fetch(url, { method, headers: { 'x-codex-hud-token': boot.token } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 403) connection = null;
    throw new ApiError(data.error || 'The local request failed.', data.code || 'REQUEST_FAILED');
  }
  return data as T;
}
export function rangeUrl(range: Range) {
  const params = new URLSearchParams();
  Object.entries(range).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, v); });
  return '/api/stats?' + params;
}
export function tokenTotal(totals: { input: { value: number | null }; output: { value: number | null } }) {
  return totals.input.value === null && totals.output.value === null ? null : (totals.input.value || 0) + (totals.output.value || 0);
}
