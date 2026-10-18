export function exactTokens(value: number | null | undefined): string;
export function compactTokens(value: number | null | undefined): string;
export function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T;
export function savePreference(key: string, value: string): void;
