import { useCallback, useEffect, useState } from 'react';
import useLocalStorage from './localStorage';

export const SPONSOR_TOKEN_KEY = 'dmm:sponsorToken';

export type SponsorSource = 'github' | 'patreon' | 'onetime';

interface SponsorClaims {
	shortId: string;
	githubUsername: string;
	sources: SponsorSource[];
	keyVersion: number;
	exp: number;
}

/**
 * Reads the token payload without checking the signature.
 *
 * Deliberately browser-only - it never imports the server's crypto helpers, so
 * node:crypto stays out of the client bundle. Cosmetics only; the signature is
 * checked server-side by requireSponsor.
 */
export function decodeSponsorClaims(token: string | null): SponsorClaims | null {
	if (!token) return null;
	const separator = token.lastIndexOf('.');
	if (separator <= 0) return null;
	try {
		const body = token.slice(0, separator).replace(/-/g, '+').replace(/_/g, '/');
		const claims = JSON.parse(atob(body)) as SponsorClaims;
		if (!claims || typeof claims.shortId !== 'string') return null;
		if (typeof claims.exp === 'number' && claims.exp <= Date.now()) return null;
		return claims;
	} catch {
		return null;
	}
}

/**
 * Reads the stored sponsor token outside React, for the plain API clients that
 * need to send it as a header. Unwraps the `{ value, expiry }` envelope
 * useLocalStorage writes when a TTL is given, and drops an expired token.
 */
export function getSponsorToken(): string | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(SPONSOR_TOKEN_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (typeof parsed === 'string') return parsed;
		if (parsed && typeof parsed.value === 'string') {
			if (typeof parsed.expiry === 'number' && parsed.expiry < Date.now()) return null;
			return parsed.value;
		}
		return null;
	} catch {
		return null;
	}
}

/** Header carrying the sponsor token on requests that widen a limit. */
export function sponsorHeaders(): Record<string, string> {
	const token = getSponsorToken();
	return token ? { 'x-dmm-sponsor': token } : {};
}

/** Refresh once the token is inside its last day. */
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface LinkResult {
	ok: boolean;
	error?: string;
}

export interface SponsorState {
	isSponsor: boolean;
	sources: SponsorSource[];
	githubUsername: string | null;
	shortId: string | null;
	token: string | null;
	link: (apiKey: string) => Promise<LinkResult>;
	disconnect: () => void;
}

export function useSponsor(): SponsorState {
	const [token, setToken] = useLocalStorage<string>(SPONSOR_TOKEN_KEY);
	const [claims, setClaims] = useState<SponsorClaims | null>(null);

	useEffect(() => {
		setClaims(decodeSponsorClaims(token));
	}, [token]);

	// Renew in the background so an active sponsor never has to re-enter the key,
	// and so a lapsed or reset one loses the badge on the next refresh rather
	// than at expiry.
	useEffect(() => {
		if (!token || !claims) return;
		if (claims.exp - Date.now() > REFRESH_THRESHOLD_MS) return;

		let cancelled = false;
		fetch('/api/sponsor/status', { headers: { 'x-dmm-sponsor': token } })
			.then((res) => res.json())
			.then((data) => {
				if (cancelled) return;
				if (data.isSponsor && data.token) {
					setToken(data.token, data.expiresIn);
				} else {
					setToken(null);
				}
			})
			.catch(() => {
				// Offline or a transient failure: keep the current token until it expires.
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [token, claims]);

	const link = useCallback(
		async (apiKey: string): Promise<LinkResult> => {
			try {
				const res = await fetch('/api/sponsor/link', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ apiKey: apiKey.trim() }),
				});
				const data = await res.json();
				if (data.isSponsor && data.token) {
					setToken(data.token, data.expiresIn);
					return { ok: true };
				}
				return { ok: false, error: data.error ?? 'Could not verify that key' };
			} catch {
				return { ok: false, error: 'Could not reach the server' };
			}
		},
		[setToken]
	);

	const disconnect = useCallback(() => setToken(null), [setToken]);

	return {
		isSponsor: claims !== null,
		sources: claims?.sources ?? [],
		githubUsername: claims?.githubUsername ?? null,
		shortId: claims?.shortId ?? null,
		token,
		link,
		disconnect,
	};
}

export default useSponsor;
