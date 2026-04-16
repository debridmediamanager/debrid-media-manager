import { useCallback, useEffect, useRef, useState } from 'react';

type Entry<T> = { data: T; at: number };

const cache = new Map<string, Entry<unknown>>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type UseCachedListOptions = {
	ttlMs?: number;
	enabled?: boolean;
};

export type UseCachedListResult<T> = {
	data: T | undefined;
	loading: boolean;
	error: Error | null;
	refetch: () => Promise<void>;
	reset: () => void;
};

export function useCachedList<T>(
	key: string | null | undefined,
	fetcher: () => Promise<T>,
	options: UseCachedListOptions = {}
): UseCachedListResult<T> {
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const enabled = options.enabled !== false && !!key;

	const fetcherRef = useRef(fetcher);
	fetcherRef.current = fetcher;

	const readFresh = (): T | undefined => {
		if (!key) return undefined;
		const entry = cache.get(key) as Entry<T> | undefined;
		if (!entry) return undefined;
		if (Date.now() - entry.at >= ttlMs) return undefined;
		return entry.data;
	};

	const [data, setData] = useState<T | undefined>(readFresh);
	const [loading, setLoading] = useState(() => enabled && readFresh() === undefined);
	const [error, setError] = useState<Error | null>(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const run = useCallback(async () => {
		if (!key) return;
		setLoading(true);
		setError(null);
		try {
			const result = await fetcherRef.current();
			cache.set(key, { data: result, at: Date.now() });
			if (mountedRef.current) setData(result);
		} catch (e) {
			if (mountedRef.current) setError(e instanceof Error ? e : new Error(String(e)));
		} finally {
			if (mountedRef.current) setLoading(false);
		}
	}, [key]);

	useEffect(() => {
		if (!enabled) return;
		const fresh = readFresh();
		if (fresh !== undefined) {
			setData(fresh);
			setLoading(false);
			return;
		}
		run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, enabled]);

	const reset = useCallback(() => {
		if (key) cache.delete(key);
		setData(undefined);
		setError(null);
	}, [key]);

	return { data, loading, error, refetch: run, reset };
}

export function invalidateCachedList(key: string): void {
	cache.delete(key);
}

export function clearCachedList(): void {
	cache.clear();
}
